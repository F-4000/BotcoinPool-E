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

interface IMiningV3 {
    function stake(uint256 amount) external;
    function unstake() external;
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
    function tier1Balance() external view returns (uint256);
}

interface IBonusEpochV3 {
    function claimBonus(uint64[] calldata epochIds) external;
    function isBonusEpoch(uint64 epochId) external view returns (bool);
    function bonusClaimsOpen(uint64 epochId) external view returns (bool);
    function bonusClaimed(uint64 epochId, address miner) external view returns (bool);
    function bonusReward(uint64 epochId) external view returns (uint256);
}

// ── Pool lifecycle ───────────────────────────────────────────────────

/// @title BotcoinPoolV3
/// @notice Single-use, non-custodial mining pool with O(1) reward
///         claims (MasterChef accRewardPerShare pattern).
///
/// Changes from V2:
///   1. submitToMining locked to submitReceipt selector only
///   2. Post-condition safety checks on mining lifecycle calls
///   3. Min tier-1 threshold enforced before staking
///   4. accRewardPerShare replaces per-epoch array accounting
///   5. rescueTokens() for stuck ERC-20 recovery
contract BotcoinPoolV3 is Ownable, ReentrancyGuard, IERC1271 {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using SafeERC20 for IERC20;

    // ── Enums ────────────────────────────────────────────────────────
    enum PoolState {
        Idle,        // Deposits accumulate; not yet staked
        Active,      // Funds staked in mining; earning credits
        Unstaking,   // unstake() called; cooldown running
        Finalized    // Terminal — withdraw principal + claim rewards
    }

    // ── Immutables ───────────────────────────────────────────────────
    IERC20       public immutable stakingToken;
    IMiningV3    public immutable mining;
    IBonusEpochV3 public immutable bonusEpoch;

    address public immutable protocolFeeRecipient;
    uint256 public immutable protocolFeeBps;
    uint256 public immutable maxStake; // 0 = unlimited (capped at 100M)

    uint256 public constant MAX_FEE_BPS = 1000;          // 10 %
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 500;   // 5 %
    uint256 public constant MINING_MAX_STAKE = 100_000_000 * 1e18;

    bytes4 internal constant EIP1271_MAGIC = 0x1626ba7e;

    /// @dev Hardcoded submitReceipt selector — the ONLY selector the
    ///      operator may forward to MiningV2 via submitToMining().
    ///      submitReceipt(uint64,uint64,bytes32,bytes32,bytes32,
    ///                    bytes32,bytes32,bytes32,bytes32,
    ///                    uint128,uint32,bytes)
    bytes4 public constant SUBMIT_RECEIPT_SELECTOR = 0xa7a1566f;

    // ── Mutable state ────────────────────────────────────────────────
    address public operator;
    uint256 public feeBps;            // can only decrease

    PoolState public poolState;       // lifecycle tracker

    // ── Principal accounting ─────────────────────────────────────────
    mapping(address => uint256) public userDeposit;
    uint256 public totalDeposits;

    // ── Reward accounting (accRewardPerShare — MasterChef style) ─────
    /// @dev Frozen copy of each user's deposit at the time of staking.
    mapping(address => uint256) public rewardDeposit;

    /// @dev Snapshot of totalDeposits at the time of stakeIntoMining().
    uint256 public totalStakeAtActive;

    /// @dev Cumulative reward per unit of deposit, scaled by 1e18.
    uint256 public accRewardPerShare;
    uint256 public accBonusRewardPerShare;

    /// @dev Tracks the already-paid portion of accRewardPerShare for
    ///      each user. pending = deposit * accRPS / 1e18 − debt.
    mapping(address => uint256) public userRewardDebt;
    mapping(address => uint256) public userBonusRewardDebt;

    /// @dev Running tally of unclaimed rewards sitting in the contract.
    ///      Incremented in triggerClaim / triggerBonusClaim, decremented
    ///      in claimReward / withdrawShare. Used by rescueTokens() to
    ///      determine the safe surplus.
    uint256 public totalUnclaimedRewards;

    // Epoch-boundary unstake gating
    uint64 public unstakeRequestEpoch; // 0 = no pending request

    // ── Events ───────────────────────────────────────────────────────
    event Deposited(address indexed user, uint256 amount);
    event ShareWithdrawn(address indexed user, uint256 principal, uint256 reward);
    event StakedIntoMining(uint256 amount, uint256 totalStaked);
    event UnstakeRequested(uint64 epoch);
    event UnstakeExecuted(uint64 epoch);
    event WithdrawFinalized(uint256 amount);
    event RewardsClaimed(uint64 indexed epochId, uint256 gross, uint256 net, bool isBonus);
    event RewardPaid(address indexed user, uint256 amount);
    event OperatorChanged(address indexed oldOp, address indexed newOp);
    event FeeUpdated(uint256 newFeeBps);
    event PoolStateChanged(PoolState oldState, PoolState newState);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);

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
        require(_operator != address(0), "Zero operator");
        require(_protocolFeeRecipient != address(0), "Zero fee recipient");
        require(_maxStake <= MINING_MAX_STAKE, "Exceeds Tier 3");

        stakingToken  = IERC20(_stakingToken);
        mining        = IMiningV3(_mining);
        bonusEpoch    = IBonusEpochV3(_bonusEpoch);
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

    // ═══════════════════════════════════════════════════════════════════
    //  1. DEPOSIT — user adds BOTCOIN to the pool (Idle only)
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Deposit BOTCOIN into the pool. Only available while Idle
    ///         (before staking into mining). Once staked, deposits are
    ///         closed for the life of this pool.
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        require(poolState == PoolState.Idle, "Deposits closed");

        uint256 effective = totalDeposits + amount;
        require(effective <= MINING_MAX_STAKE, "Exceeds mining max");
        if (maxStake > 0) {
            require(effective <= maxStake, "Pool cap reached");
        }

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        userDeposit[msg.sender]   += amount;
        rewardDeposit[msg.sender] += amount;
        totalDeposits             += amount;

        emit Deposited(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  2. STAKE INTO MINING — permissionless, one-time
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Push the pool's BOTCOIN into MiningV2.stake().
    ///         Permissionless. Requires totalDeposits >= tier1Balance.
    ///         Sets totalStakeAtActive as the frozen denominator for
    ///         all future reward distributions.
    function stakeIntoMining() external nonReentrant {
        require(poolState == PoolState.Idle, "Pool not idle");

        uint256 toStake = totalDeposits;
        require(toStake > 0, "Nothing to stake");

        // V3: Enforce minimum tier-1 threshold from mining contract
        require(toStake >= mining.tier1Balance(), "Below tier 1 minimum");

        totalStakeAtActive = toStake;

        stakingToken.forceApprove(address(mining), toStake);
        mining.stake(toStake);

        // V3: Post-condition — verify mining contract accepted the stake
        require(
            mining.stakedAmount(address(this)) >= toStake,
            "Stake not confirmed"
        );

        _setPoolState(PoolState.Active);

        emit StakedIntoMining(toStake, mining.stakedAmount(address(this)));
    }

    // ═══════════════════════════════════════════════════════════════════
    //  3. UNSTAKE — permissionless, epoch-boundary gated
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Request an unstake. Permissionless — anyone can call.
    ///         Queued for the current epoch; execution requires the
    ///         epoch to have ended.
    function requestUnstake() external nonReentrant {
        require(poolState == PoolState.Active, "Pool not active");
        require(unstakeRequestEpoch == 0, "Unstake already requested");
        unstakeRequestEpoch = mining.currentEpoch();
        emit UnstakeRequested(unstakeRequestEpoch);
    }

    /// @notice Execute the pending unstake. Permissionless.
    ///         Only succeeds after the request epoch has ended.
    function executeUnstake() external nonReentrant {
        require(poolState == PoolState.Active, "Pool not active");
        require(unstakeRequestEpoch > 0, "No unstake request");
        require(mining.currentEpoch() > unstakeRequestEpoch, "Epoch not ended");

        unstakeRequestEpoch = 0;
        mining.unstake();

        // V3: Post-condition — verify unstake was accepted
        require(
            mining.withdrawableAt(address(this)) > 0,
            "Unstake not confirmed"
        );

        _setPoolState(PoolState.Unstaking);
        emit UnstakeExecuted(mining.currentEpoch());
    }

    // ═══════════════════════════════════════════════════════════════════
    //  4. FINALIZE WITHDRAW — permissionless, terminal
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Complete the withdrawal from MiningV2 once cooldown
    ///         expires. Pool enters terminal Finalized state — no
    ///         re-staking. Depositors withdraw principal + claim rewards.
    function finalizeWithdraw() external nonReentrant {
        require(poolState == PoolState.Unstaking, "Not unstaking");
        require(
            block.timestamp >= mining.withdrawableAt(address(this)),
            "Cooldown not expired"
        );

        uint256 balBefore = stakingToken.balanceOf(address(this));
        mining.withdraw();
        uint256 received = stakingToken.balanceOf(address(this)) - balBefore;

        // V3: Post-condition — verify mining fully emptied
        require(
            mining.stakedAmount(address(this)) == 0,
            "Withdraw incomplete"
        );

        _setPoolState(PoolState.Finalized);
        emit WithdrawFinalized(received);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  5. USER PRINCIPAL WITHDRAWAL
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Withdraw principal. In Idle: free withdrawal before
    ///         staking. In Finalized: auto-claims all pending rewards
    ///         and returns them alongside principal in one transfer.
    function withdrawShare(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        require(
            poolState == PoolState.Idle || poolState == PoolState.Finalized,
            "Funds staked in mining"
        );
        require(userDeposit[msg.sender] >= amount, "Exceeds deposit");

        // In Finalized, settle all pending rewards first
        uint256 reward = 0;
        if (poolState == PoolState.Finalized) {
            reward = _settleReward(msg.sender);
        }

        userDeposit[msg.sender] -= amount;
        totalDeposits -= amount;

        // In Idle (pre-staking), adjust reward-eligible tracking too
        if (poolState == PoolState.Idle) {
            rewardDeposit[msg.sender] -= amount;
        }

        uint256 payout = amount + reward;
        stakingToken.safeTransfer(msg.sender, payout);

        if (reward > 0) emit RewardPaid(msg.sender, reward);
        emit ShareWithdrawn(msg.sender, amount, reward);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  6. REWARD CLAIMING — accRewardPerShare, O(1) per user
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Trigger regular reward claims from MiningV2. Rewards
    ///         accumulate into accRewardPerShare for O(1) user claims.
    function triggerClaim(uint64[] calldata epochIds) external nonReentrant {
        require(totalStakeAtActive > 0, "No active stake");

        uint256 totalProtocolFee = 0;
        uint256 totalOperatorFee = 0;
        uint64[] memory single = new uint64[](1);

        for (uint256 i = 0; i < epochIds.length; i++) {
            if (mining.claimed(epochIds[i], address(this))) continue;

            uint256 balBefore = stakingToken.balanceOf(address(this));
            single[0] = epochIds[i];
            mining.claim(single);
            uint256 received = stakingToken.balanceOf(address(this)) - balBefore;

            if (received > 0) {
                (uint256 pFee, uint256 oFee, uint256 net) = _splitFees(received);
                totalProtocolFee += pFee;
                totalOperatorFee += oFee;

                // Accumulate into global index (MasterChef pattern)
                accRewardPerShare += (net * 1e18) / totalStakeAtActive;
                totalUnclaimedRewards += net;

                emit RewardsClaimed(epochIds[i], received, net, false);
            }
        }

        _transferFees(totalProtocolFee, totalOperatorFee);
    }

    /// @notice Trigger bonus reward claims. Accumulates into
    ///         accBonusRewardPerShare.
    function triggerBonusClaim(uint64[] calldata epochIds) external nonReentrant {
        require(totalStakeAtActive > 0, "No active stake");

        uint256 totalProtocolFee = 0;
        uint256 totalOperatorFee = 0;
        uint64[] memory single = new uint64[](1);

        for (uint256 i = 0; i < epochIds.length; i++) {
            if (bonusEpoch.bonusClaimed(epochIds[i], address(this))) continue;

            uint256 balBefore = stakingToken.balanceOf(address(this));
            single[0] = epochIds[i];
            bonusEpoch.claimBonus(single);
            uint256 received = stakingToken.balanceOf(address(this)) - balBefore;

            if (received > 0) {
                (uint256 pFee, uint256 oFee, uint256 net) = _splitFees(received);
                totalProtocolFee += pFee;
                totalOperatorFee += oFee;

                accBonusRewardPerShare += (net * 1e18) / totalStakeAtActive;
                totalUnclaimedRewards += net;

                emit RewardsClaimed(epochIds[i], received, net, true);
            }
        }

        _transferFees(totalProtocolFee, totalOperatorFee);
    }

    /// @notice Depositor claims accumulated rewards (regular + bonus).
    function claimReward() external nonReentrant {
        uint256 reward = _settleReward(msg.sender);
        require(reward > 0, "No rewards");
        stakingToken.safeTransfer(msg.sender, reward);
        emit RewardPaid(msg.sender, reward);
    }

    // ── Internal reward helpers ──────────────────────────────────────

    /// @dev Compute pending reward and reset debt. Returns total to pay.
    function _settleReward(address user) internal returns (uint256) {
        if (totalStakeAtActive == 0) return 0;
        uint256 dep = rewardDeposit[user];
        if (dep == 0) return 0;

        uint256 accRegular = (dep * accRewardPerShare) / 1e18;
        uint256 accBonus   = (dep * accBonusRewardPerShare) / 1e18;

        uint256 pendingRegular = accRegular - userRewardDebt[user];
        uint256 pendingBonus   = accBonus - userBonusRewardDebt[user];

        userRewardDebt[user]      = accRegular;
        userBonusRewardDebt[user] = accBonus;

        uint256 total = pendingRegular + pendingBonus;
        if (total > 0) {
            totalUnclaimedRewards -= total;
        }
        return total;
    }

    /// @dev Read-only version of _settleReward.
    function _pendingReward(address user) internal view returns (uint256) {
        if (totalStakeAtActive == 0) return 0;
        uint256 dep = rewardDeposit[user];
        if (dep == 0) return 0;

        uint256 pendingRegular = (dep * accRewardPerShare) / 1e18 - userRewardDebt[user];
        uint256 pendingBonus   = (dep * accBonusRewardPerShare) / 1e18 - userBonusRewardDebt[user];
        return pendingRegular + pendingBonus;
    }

    /// @dev Split gross reward into protocol fee, operator fee, and net.
    function _splitFees(uint256 gross) internal view returns (
        uint256 protocolFee,
        uint256 operatorFee,
        uint256 net
    ) {
        protocolFee = (gross * protocolFeeBps) / 10000;
        uint256 afterProtocol = gross - protocolFee;
        operatorFee = (afterProtocol * feeBps) / 10000;
        net = afterProtocol - operatorFee;
    }

    /// @dev Batch-transfer accumulated fees.
    function _transferFees(uint256 protocolFee, uint256 operatorFee) internal {
        if (protocolFee > 0) {
            stakingToken.safeTransfer(protocolFeeRecipient, protocolFee);
        }
        if (operatorFee > 0) {
            stakingToken.safeTransfer(operator, operatorFee);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  7. OPERATOR / SOLVER INTEGRATION
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Operator forwards submitReceipt calls to MiningV2.
    ///         V3: Only the hardcoded submitReceipt selector is allowed.
    function submitToMining(bytes calldata data) external onlyOperator nonReentrant {
        require(data.length >= 4, "Calldata too short");
        bytes4 selector = bytes4(data[:4]);
        require(selector == SUBMIT_RECEIPT_SELECTOR, "Only submitReceipt allowed");

        (bool success, bytes memory returnData) = address(mining).call(data);
        if (!success) {
            if (returnData.length > 0) {
                assembly { revert(add(returnData, 32), mload(returnData)) }
            } else {
                revert("Mining call failed");
            }
        }
    }

    /// @notice EIP-1271: validate operator's signature for coordinator.
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

    // ═══════════════════════════════════════════════════════════════════
    //  9. RESCUE STUCK TOKENS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Rescue ERC-20 tokens accidentally sent to this contract.
    ///         For the staking token, only the surplus above tracked
    ///         balances (totalDeposits + totalUnclaimedRewards) can be
    ///         withdrawn. For any other ERC-20, the full balance is
    ///         rescuable.
    /// @param tokenAddr  The ERC-20 token to rescue
    /// @param to         Recipient of rescued tokens
    /// @param amount     Amount to rescue (0 = max available)
    function rescueTokens(
        address tokenAddr,
        address to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "Zero recipient");

        uint256 available;

        if (tokenAddr == address(stakingToken)) {
            uint256 balance = stakingToken.balanceOf(address(this));
            uint256 committed = totalDeposits + totalUnclaimedRewards;
            available = balance > committed ? balance - committed : 0;
        } else {
            available = IERC20(tokenAddr).balanceOf(address(this));
        }

        if (amount == 0) amount = available;
        require(amount > 0, "Nothing to rescue");
        require(amount <= available, "Exceeds surplus");

        IERC20(tokenAddr).safeTransfer(to, amount);
        emit TokensRescued(tokenAddr, to, amount);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  10. VIEW HELPERS
    // ═══════════════════════════════════════════════════════════════════

    /// @notice Pending (unclaimed) reward for a user.
    function earned(address account) public view returns (uint256) {
        return _pendingReward(account);
    }

    /// @notice Check if the pool has claimed regular rewards for an epoch.
    function epochClaimed(uint64 epochId) external view returns (bool) {
        return mining.claimed(epochId, address(this));
    }

    /// @notice Check if the pool has claimed bonus rewards for an epoch.
    function bonusEpochClaimed(uint64 epochId) external view returns (bool) {
        return bonusEpoch.bonusClaimed(epochId, address(this));
    }

    /// @notice Get a user's deposit and claimable reward in one call.
    function getUserInfo(address user) external view returns (
        uint256 depositAmt,
        uint256 pendingReward,
        uint256 shareOfPool // bps out of 10000
    ) {
        depositAmt    = userDeposit[user];
        pendingReward = _pendingReward(user);
        shareOfPool   = totalDeposits > 0
            ? (depositAmt * 10000) / totalDeposits
            : 0;
    }

    /// @notice Pool summary for UI dashboard.
    function getPoolInfo() external view returns (
        PoolState state,
        uint256 stakedInMining,
        uint256 totalDep,
        uint256 activeStake,
        uint64  currentEpoch,
        bool    eligible,
        uint256 cooldownEnd,
        uint256 unclaimedRewards
    ) {
        state            = poolState;
        stakedInMining   = mining.stakedAmount(address(this));
        totalDep         = totalDeposits;
        activeStake      = totalStakeAtActive;
        currentEpoch     = mining.currentEpoch();
        eligible         = mining.isEligible(address(this));
        cooldownEnd      = mining.withdrawableAt(address(this));
        unclaimedRewards = totalUnclaimedRewards;
    }

    // ── Internal helpers ─────────────────────────────────────────────

    function _setPoolState(PoolState newState) internal {
        emit PoolStateChanged(poolState, newState);
        poolState = newState;
    }

    /// @dev Reject accidental ETH transfers.
    receive() external payable { revert("No ETH"); }
}
