// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";

// ── External interfaces ──────────────────────────────────────────────

interface IMiningV2 {
    function stake(uint256 amount) external;
    function unstake() external;
    function cancelUnstake() external;
    function withdraw() external;
    function claim(uint64[] calldata epochIds) external;

    function stakedAmount(address miner) external view returns (uint256);
    function withdrawableAt(address miner) external view returns (uint256);
    function isEligible(address miner) external view returns (bool);
    function currentEpoch() external view returns (uint64);
    function totalStaked() external view returns (uint256);
    function unstakeCooldown() external view returns (uint256);
    function credits(uint64 epochId, address miner) external view returns (uint256);
    function totalCredits(uint64 epochId) external view returns (uint256);
    function epochReward(uint64 epochId) external view returns (uint256);
    function claimed(uint64 epochId, address miner) external view returns (bool);
}

interface IBonusEpoch {
    function claimBonus(uint64[] calldata epochIds) external;
    function isBonusEpoch(uint64 epochId) external view returns (bool);
}

// ── Pool lifecycle ───────────────────────────────────────────────────

/// @title BotcoinPoolV2
/// @notice Non-custodial mining pool — deposits stake persistently into
///         BotcoinMiningV2. Reward claiming and unstake lifecycle are
///         fully permissionless; no admin gate on exits.
contract BotcoinPoolV2 is Ownable, ReentrancyGuard, IERC1271 {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using SafeERC20 for IERC20;

    // ── Enums ────────────────────────────────────────────────────────
    enum PoolState {
        Idle,        // No funds staked in mining; deposits accumulate
        Active,      // Funds staked, mining in progress
        Unstaking,   // unstake() called on MiningV2; cooldown running
        Withdrawable // cooldown expired; anyone can call finalizeWithdraw
    }

    // ── Immutables ───────────────────────────────────────────────────
    IERC20   public immutable stakingToken;
    IMiningV2 public immutable mining;
    IBonusEpoch public immutable bonusEpoch;

    address public immutable protocolFeeRecipient;
    uint256 public immutable protocolFeeBps;
    uint256 public immutable maxStake; // 0 = unlimited (capped at 100M)

    uint256 public constant MAX_FEE_BPS = 1000;       // 10 %
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 500; // 5 %
    uint256 public constant MINING_MAX_STAKE = 100_000_000 * 1e18;

    bytes4 internal constant EIP1271_MAGIC = 0x1626ba7e;

    // ── Mutable state ────────────────────────────────────────────────
    address public operator;
    uint256 public feeBps;            // can only decrease

    PoolState public poolState;       // lifecycle tracker

    // Per-user principal accounting
    mapping(address => uint256) public userDeposit;
    uint256 public totalDeposits;     // sum of all userDeposit (principal)

    // Synthetix reward accumulator (for distributing claimed rewards)
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    uint256 public totalRewardableStake; // denominator for reward distribution

    // Operator selector whitelist (for submitReceipt forwarding)
    mapping(bytes4 => bool) public allowedOperatorSelectors;

    // ── Events ───────────────────────────────────────────────────────
    event Deposited(address indexed user, uint256 amount);
    event ShareWithdrawn(address indexed user, uint256 amount);
    event StakedIntoMining(uint256 amount, uint256 totalStaked);
    event UnstakeTriggered(uint64 epoch);
    event UnstakeCancelled();
    event WithdrawFinalized(uint256 amount);
    event RewardsClaimed(uint256 regular, uint256 bonus);
    event RewardsDistributed(uint256 amount);
    event RewardPaid(address indexed user, uint256 amount);
    event OperatorChanged(address indexed oldOp, address indexed newOp);
    event FeeUpdated(uint256 newFeeBps);
    event OperatorSelectorUpdated(bytes4 indexed selector, bool allowed);
    event PoolStateChanged(PoolState oldState, PoolState newState);

    // ── Constructor ──────────────────────────────────────────────────
    constructor(
        address _stakingToken,
        address _mining,
        address _bonusEpoch,
        address _operator,
        uint256 _feeBps,
        address _protocolFeeRecipient,
        uint256 _protocolFeeBps,
        uint256 _maxStake
    ) Ownable(msg.sender) {
        require(_feeBps <= MAX_FEE_BPS, "Fee too high");
        require(_protocolFeeBps <= MAX_PROTOCOL_FEE_BPS, "Protocol fee too high");
        require(_protocolFeeRecipient != address(0), "Zero fee recipient");
        require(_maxStake <= MINING_MAX_STAKE, "Exceeds Tier 3");

        stakingToken  = IERC20(_stakingToken);
        mining        = IMiningV2(_mining);
        bonusEpoch    = IBonusEpoch(_bonusEpoch);
        operator      = _operator;
        feeBps        = _feeBps;
        protocolFeeRecipient = _protocolFeeRecipient;
        protocolFeeBps       = _protocolFeeBps;
        maxStake      = _maxStake;
        poolState     = PoolState.Idle;
    }

    // ── Modifiers ────────────────────────────────────────────────────
    modifier onlyOperator() {
        require(msg.sender == operator, "Not operator");
        _;
    }

    modifier updateReward(address account) {
        if (account != address(0) && totalRewardableStake > 0) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  1. DEPOSIT — user adds BOTCOIN to the pool
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Deposit BOTCOIN into the pool. Tokens sit in the contract
    ///         until stakeIntoMining() is called. Only allowed when Idle.
    function deposit(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Zero amount");
        require(poolState == PoolState.Idle, "Deposits only when idle");

        uint256 effective = totalDeposits + amount;

        require(effective <= MINING_MAX_STAKE, "Exceeds mining max");
        if (maxStake > 0) {
            require(effective <= maxStake, "Pool cap reached");
        }

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        userDeposit[msg.sender] += amount;
        totalDeposits += amount;
        totalRewardableStake += amount;

        emit Deposited(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  2. STAKE INTO MINING — permissionless
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Push the pool's idle BOTCOIN balance into MiningV2.stake().
    ///         Anyone can call this. After staking, pool enters Active.
    ///         Only stakes totalDeposits — unclaimed rewards stay liquid.
    function stakeIntoMining() external nonReentrant {
        require(poolState == PoolState.Idle, "Pool not idle");

        uint256 toStake = totalDeposits;
        require(toStake > 0, "Nothing to stake");

        // Approve MiningV2 to pull tokens
        stakingToken.forceApprove(address(mining), toStake);
        mining.stake(toStake);

        _setPoolState(PoolState.Active);

        emit StakedIntoMining(toStake, mining.stakedAmount(address(this)));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  3. UNSTAKE — permissionless at epoch boundary
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Trigger unstake from MiningV2. Permissionless — anyone
    ///         can call. Begins the cooldown period.
    function triggerUnstake() external nonReentrant {
        require(poolState == PoolState.Active, "Pool not active");
        mining.unstake();
        _setPoolState(PoolState.Unstaking);
        emit UnstakeTriggered(mining.currentEpoch());
    }

    /// @notice Owner/operator can cancel a pending unstake if cooldown
    ///         has not expired, returning the pool to Active mining.
    function cancelUnstake() external nonReentrant {
        require(msg.sender == owner() || msg.sender == operator, "Not authorized");
        require(poolState == PoolState.Unstaking, "Not unstaking");
        mining.cancelUnstake();
        _setPoolState(PoolState.Active);
        emit UnstakeCancelled();
    }

    // ═══════════════════════════════════════════════════════════════════
    //  4. FINALIZE WITHDRAW — permissionless after cooldown
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Complete the withdrawal from MiningV2 once cooldown expires.
    ///         Tokens return to the pool contract. Anyone can call.
    function finalizeWithdraw() external nonReentrant {
        require(poolState == PoolState.Unstaking, "Not unstaking");
        require(block.timestamp >= mining.withdrawableAt(address(this)), "Cooldown not expired");

        uint256 balBefore = stakingToken.balanceOf(address(this));
        mining.withdraw();
        uint256 received = stakingToken.balanceOf(address(this)) - balBefore;

        _setPoolState(PoolState.Idle);
        emit WithdrawFinalized(received);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  5. USER PRINCIPAL WITHDRAWAL
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Withdraw your principal deposit. Only available when pool
    ///         is Idle (funds are in the contract, not staked in mining).
    function withdrawShare(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Zero amount");
        require(poolState == PoolState.Idle, "Funds staked in mining");
        require(userDeposit[msg.sender] >= amount, "Exceeds deposit");

        userDeposit[msg.sender] -= amount;
        totalDeposits -= amount;
        totalRewardableStake -= amount;

        stakingToken.safeTransfer(msg.sender, amount);
        emit ShareWithdrawn(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  6. REWARD CLAIMING — Regular + Bonus (permissionless trigger)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Anyone can trigger a regular reward claim from MiningV2.
    ///         Rewards are distributed pro-rata to depositors net of fees.
    function triggerClaim(uint64[] calldata epochIds) external nonReentrant {
        uint256 balBefore = stakingToken.balanceOf(address(this));
        mining.claim(epochIds);
        uint256 received = stakingToken.balanceOf(address(this)) - balBefore;

        if (received > 0) {
            _distributeRewards(received);
            emit RewardsClaimed(received, 0);
        }
    }

    /// @notice Anyone can trigger a bonus epoch reward claim.
    function triggerBonusClaim(uint64[] calldata epochIds) external nonReentrant {
        uint256 balBefore = stakingToken.balanceOf(address(this));
        bonusEpoch.claimBonus(epochIds);
        uint256 received = stakingToken.balanceOf(address(this)) - balBefore;

        if (received > 0) {
            _distributeRewards(received);
            emit RewardsClaimed(0, received);
        }
    }

    /// @notice Depositor claims their accumulated reward share.
    function claimReward() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            stakingToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    /// @dev Internal: take fees and distribute to reward accumulator.
    function _distributeRewards(uint256 amount) internal {
        // Protocol fee
        uint256 protocolFee = (amount * protocolFeeBps) / 10000;
        if (protocolFee > 0) {
            stakingToken.safeTransfer(protocolFeeRecipient, protocolFee);
        }

        // Operator fee
        uint256 afterProtocol = amount - protocolFee;
        uint256 operatorFee = (afterProtocol * feeBps) / 10000;
        if (operatorFee > 0) {
            stakingToken.safeTransfer(operator, operatorFee);
        }

        uint256 toDistribute = afterProtocol - operatorFee;
        if (toDistribute > 0 && totalRewardableStake > 0) {
            rewardPerTokenStored += (toDistribute * 1e18) / totalRewardableStake;
            emit RewardsDistributed(toDistribute);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  7. OPERATOR / SOLVER INTEGRATION
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Operator forwards submitReceipt (or other whitelisted calls)
    ///         to MiningV2 so msg.sender = this pool.
    function submitToMining(bytes calldata data) external onlyOperator nonReentrant {
        require(data.length >= 4, "Calldata too short");
        bytes4 selector = bytes4(data[:4]);
        require(allowedOperatorSelectors[selector], "Selector not whitelisted");

        (bool success, ) = address(mining).call(data);
        require(success, "Mining call failed");
    }

    /// @notice EIP-1271: validate operator's signature for coordinator auth.
    function isValidSignature(bytes32 _hash, bytes memory _signature)
        external view override returns (bytes4)
    {
        address recovered = ECDSA.recover(_hash, _signature);
        return recovered == operator ? EIP1271_MAGIC : bytes4(0xffffffff);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  8. ADMIN
    // ═══════════════════════════════════════════════════════════════════

    function setOperator(address _op) external onlyOwner {
        require(_op != address(0), "Zero address");
        emit OperatorChanged(operator, _op);
        operator = _op;
    }

    function setFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps < feeBps, "Fee can only decrease");
        feeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    function setAllowedOperatorSelector(bytes4 selector, bool allowed) external onlyOwner {
        allowedOperatorSelectors[selector] = allowed;
        emit OperatorSelectorUpdated(selector, allowed);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  9. VIEW HELPERS
    // ═══════════════════════════════════════════════════════════════════

    function earned(address account) public view returns (uint256) {
        if (totalRewardableStake == 0) return rewards[account];
        return rewards[account]
            + (userDeposit[account] * (rewardPerTokenStored - userRewardPerTokenPaid[account])) / 1e18;
    }

    /// @notice Get a user's deposit and claimable reward in one call.
    function getUserInfo(address user) external view returns (
        uint256 depositAmt,
        uint256 pendingReward,
        uint256 shareOfPool // bps out of 10000
    ) {
        depositAmt = userDeposit[user];
        pendingReward = earned(user);
        shareOfPool = totalDeposits > 0
            ? (depositAmt * 10000) / totalDeposits
            : 0;
    }

    /// @notice Pool summary for UI dashboard.
    function getPoolInfo() external view returns (
        PoolState state,
        uint256 stakedInMining,
        uint256 totalDep,
        uint256 rewardable,
        uint64  currentEpoch,
        bool    eligible,
        uint256 cooldownEnd
    ) {
        state          = poolState;
        stakedInMining = mining.stakedAmount(address(this));
        totalDep       = totalDeposits;
        rewardable     = totalRewardableStake;
        currentEpoch   = mining.currentEpoch();
        eligible       = mining.isEligible(address(this));
        cooldownEnd    = mining.withdrawableAt(address(this));
    }

    // ── Internal helpers ─────────────────────────────────────────────

    function _setPoolState(PoolState newState) internal {
        emit PoolStateChanged(poolState, newState);
        poolState = newState;
    }
}
