// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";

interface IMiningContract {
    function epochId() external view returns (uint64);
}

contract BotcoinPool is Ownable, ReentrancyGuard, IERC1271 {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;
    IMiningContract public immutable miningContract;
    address public operator;
    
    // Fee in basis points (e.g. 500 = 5%), max 10%
    uint256 public feeBps;
    uint256 public constant MAX_FEE_BPS = 1000;

    // Pool stake cap — 0 means unlimited (immutable once deployed)
    uint256 public immutable maxStake;

    // Protocol fee — taken before operator fee, sent to protocol treasury
    address public immutable protocolFeeRecipient;
    uint256 public immutable protocolFeeBps;
    uint256 public constant MAX_PROTOCOL_FEE_BPS = 500; // hard cap 5% 

    // --- Stake State ---
    // Active stake: Eligible for rewards in current epoch
    uint256 public totalActiveStake;
    mapping(address => uint256) public userActiveStake;

    // Pending stake: Waiting for next epoch to become active
    uint256 public totalPendingStake;
    mapping(address => uint256) public userPendingStake;
    mapping(address => uint64) public lastDepositEpoch; // Track when pending was added

    // --- Reward State ---
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    // --- Selector Whitelist (for trustless public claiming) ---
    mapping(bytes4 => bool) public allowedClaimSelectors;

    // EIP-1271 Magic Value
    bytes4 internal constant MAGIC_VALUE = 0x1626ba7e;

    event Staked(address indexed user, uint256 amount, uint64 epoch, bool isPending);
    event Withdrawn(address indexed user, uint256 amount, uint64 epoch);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDistributed(uint256 amount);
    event OperatorChanged(address indexed previousOperator, address indexed newOperator);
    event FeeUpdated(uint256 newFeeBps);
    event MaxStakeUpdated(uint256 newMaxStake);
    event Submitted(address indexed target, bool success, bytes data);
    event ClaimSelectorUpdated(bytes4 indexed selector, bool allowed);

    constructor(
        address _stakingToken,
        address _miningContract,
        address _operator,
        uint256 _feeBps,
        address _protocolFeeRecipient,
        uint256 _protocolFeeBps,
        uint256 _maxStake
    ) Ownable(msg.sender) {
        require(_feeBps <= MAX_FEE_BPS, "Fee too high");
        require(_protocolFeeBps <= MAX_PROTOCOL_FEE_BPS, "Protocol fee too high");
        require(_protocolFeeRecipient != address(0), "Invalid protocol fee recipient");
        
        stakingToken = IERC20(_stakingToken);
        miningContract = IMiningContract(_miningContract);
        operator = _operator;
        feeBps = _feeBps;
        protocolFeeRecipient = _protocolFeeRecipient;
        protocolFeeBps = _protocolFeeBps;
        maxStake = _maxStake;
    }

    modifier updateState(address account) {
        uint64 currentEpoch = miningContract.epochId();

        // 1. Process Global Pending -> Active transition if needed?
        // Actually, we process USER transitions here because rewards depend on userActiveStake.
        // But for rewardPerToken calculation, we need accurate totalActiveStake.
        
        // This is tricky. If we rely on lazy updates, totalActiveStake might be stale when rewards come in.
        // Constraint: We can't iterate all users.
        // Solution: We don't move pending to active globally until interactions happen.
        // BUT `rewardPerToken` uses `totalActiveStake`.
        // If pending stake from last epoch isn't moved to active yet, `rewardPerToken` will be calculated with OLD active stake.
        // This favors old stakers (higher reward per token) and hurts new stakers (who aren't active yet?).
        // WAIT. If I deposited in Epoch 99, I expect to be active in Epoch 100.
        // If rewards for Epoch 100 arrive, they are divided by `totalActiveStake`.
        // My stake SHOULD be in there.
        
        // Revised Approach:
        // We track `totalPendingStake` and `lastPendingUpdateEpoch`.
        // If `currentEpoch > lastPendingUpdateEpoch`:
        //    `totalActiveStake += totalPendingStake`
        //    `totalPendingStake = 0` (But this is wrong, because new checks come in for current epoch)
        
        // We need 2 buckets: `stakeNextEpoch` and `stakeCurrent`.
        // Actually, simplest model is:
        // Deposit -> `pending[user]`, recording epoch.
        // Withdraw -> check logic.
        // Distribute Rewards -> The difficulty is knowing the PRECISE denominator for the epoch being rewarded.
        // If we assume `claimRewards` is called for a specific Past Verify epoch, we can perhaps just use the snapshot?
        // No, standard `rewardPerToken` (Synthetix style) updates strictly on interaction.
        
        // Let's stick to the prompt's implied requirement: "Deposits separate from Active until next epoch".
        // To make `totalActiveStake` correct without iteration, we can't easily do it unless we force an update or use a different mechanism.
        // TRADEOFF: We will move `userPending` to `userActive` only when the USER interacts.
        // IMPLICATION: `totalActiveStake` will effectively Lag. This is a known issue in lazy accounting.
        // FIX: We can track `totalPending` and `pendingEpoch`.
        // If `currentEpoch > pendingEpoch`, we know ALL that pending is now active.
        // So `effectiveTotalActive = totalActive + (currentEpoch > pendingEpoch ? totalPending : 0)`.
        // But if we have multiple epochs of pending... we need a queue? No, just one pending bucket is usually enough if we clear it.
        
        // Let's use the `effective` strategy for `rewardPerToken`.
        // But we have strictly 2 states: 
        // 1. Amount locked for NEXT epoch.
        // 2. Amount active NOW.
        
        _updateUser(account, currentEpoch);
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "Caller is not the operator");
        _;
    }

    // Helper to update user and global state
    uint64 public globalLastUpdateEpoch;
    uint256 public globalPendingStake; 
    
    function _updateUser(address account, uint64 currentEpoch) internal {
        // First, update global state if epoch advanced
        // If we have pending stake from an OLD epoch, it is now active.
        if (currentEpoch > globalLastUpdateEpoch) {
             if (globalPendingStake > 0) {
                 totalActiveStake += globalPendingStake;
                 globalPendingStake = 0;
             }
             globalLastUpdateEpoch = currentEpoch;
        }

        // Calculate rewards for user based on their OLD active stake before we potentially add more
        rewardPerTokenStored = _rewardPerToken();
        
        if (account != address(0)) {
            rewards[account] = _earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
            
            // Now move User Pending -> Active if eligible
            if (userPendingStake[account] > 0 && currentEpoch > lastDepositEpoch[account]) {
                userActiveStake[account] += userPendingStake[account];
                userPendingStake[account] = 0;
            }
        }
    }
    
    // Simplify: We don't use time-based accrual. We only accrue when REWARDS are added.
    // So `rewardPerTokenStored` doesn't change just by reading it. It changes in `triggerClaim`.

    function _rewardPerToken() internal view returns (uint256) {
        return rewardPerTokenStored;
    }

    function _earned(address account) internal view returns (uint256) {
        return rewards[account] + ((userActiveStake[account] * (rewardPerTokenStored - userRewardPerTokenPaid[account])) / 1e18);
    }

    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot deposit 0");
        uint64 currentEpoch = miningContract.epochId();
        
        _updateUser(msg.sender, currentEpoch);

        // Enforce pool cap (0 = unlimited)
        if (maxStake > 0) {
            uint256 effectiveTotal = totalActiveStake + globalPendingStake + amount;
            require(effectiveTotal <= maxStake, "Pool cap reached");
        }

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Add to pending
        userPendingStake[msg.sender] += amount;
        lastDepositEpoch[msg.sender] = currentEpoch;
        
        // Add to global pending (for next epoch)
        // Note: If we just advanced epoch in _updateUser, globalPendingStake is 0.
        // But wait, if I deposit in Epoch 100, and someone else deposits in Epoch 100, we aggregate.
        // Correct.
        globalPendingStake += amount;
        // Ensure global epoch tracks this batch
        if (globalLastUpdateEpoch < currentEpoch) {
             // Should have been handled by _updateUser, but strictly:
             globalLastUpdateEpoch = currentEpoch;
        }

        emit Staked(msg.sender, amount, currentEpoch, true);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot withdraw 0");
        uint64 currentEpoch = miningContract.epochId();
        
        _updateUser(msg.sender, currentEpoch);
        
        // Can only withdraw ACTIVE stake? 
        // Tweet implies strict locking. Usually you can withdraw, but you forfeit rewards? 
        // Or you strictly wait. "Locked until active".
        // Let's allow withdrawing ACTIVE stake.
        // What about pending? If I deposit by mistake, can I withdraw?
        // Let's assume Pending is locked until next epoch to prevent flash loan attacks or gaming.
        
        require(userActiveStake[msg.sender] >= amount, "Insufficient active stake");
        
        userActiveStake[msg.sender] -= amount;
        totalActiveStake -= amount;
        
        stakingToken.safeTransfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount, currentEpoch);
    }

    function claimReward() external nonReentrant {
        uint64 currentEpoch = miningContract.epochId();
        _updateUser(msg.sender, currentEpoch);
        
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            stakingToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    // --- Public Trustless Claiming ---

    // Anyone can trigger a claim, but ONLY whitelisted function selectors are allowed.
    // This prevents arbitrary call abuse while satisfying the trustless claiming requirement.
    function triggerClaim(bytes calldata data) external nonReentrant {
        require(data.length >= 4, "Calldata too short");
        bytes4 selector = bytes4(data[:4]);
        require(allowedClaimSelectors[selector], "Selector not whitelisted");

        // 1. Calculate how much we gained
        uint256 balanceBefore = stakingToken.balanceOf(address(this));
        
        // 2. Call mining contract with the whitelisted function
        (bool success, ) = address(miningContract).call(data);
        require(success, "Claim failed");
        
        uint256 balanceAfter = stakingToken.balanceOf(address(this));
        
        if (balanceAfter > balanceBefore) {
            uint256 claimedAmount = balanceAfter - balanceBefore;

            // Protocol fee first (platform revenue)
            uint256 protocolFee = (claimedAmount * protocolFeeBps) / 10000;
            if (protocolFee > 0) {
                stakingToken.safeTransfer(protocolFeeRecipient, protocolFee);
            }

            uint256 afterProtocol = claimedAmount - protocolFee;
            uint256 operatorFee = (afterProtocol * feeBps) / 10000;
            uint256 rewardsToDistribute = afterProtocol - operatorFee;
            
            // Send fee to operator
            if (operatorFee > 0) {
                 stakingToken.safeTransfer(operator, operatorFee);
            }
            
            // Distribute rest
            // IMPORTANT: We must update global state BEFORE distributing to ensure denominator is correct.
            uint64 currentEpoch = miningContract.epochId();
            
            // We can't call _updateUser(msg.sender) because that updates msg.sender.
            // We need to update Global State specifically.
            if (currentEpoch > globalLastUpdateEpoch) {
                 if (globalPendingStake > 0) {
                     totalActiveStake += globalPendingStake;
                     globalPendingStake = 0;
                 }
                 globalLastUpdateEpoch = currentEpoch;
            }

            if (totalActiveStake > 0) {
                rewardPerTokenStored += (rewardsToDistribute * 1e18) / totalActiveStake;
                emit RewardsDistributed(rewardsToDistribute);
            }
        }
    }

    // Operator Logic for solver
    function setOperator(address _newOperator) external onlyOwner {
        require(_newOperator != address(0), "Invalid operator");
        address oldOperator = operator;
        operator = _newOperator;
        emit OperatorChanged(oldOperator, _newOperator);
    }
    
    function setFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps < feeBps, "Fee can only decrease");
        feeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    /// @notice Owner adds or removes a function selector that `triggerClaim` is allowed to call.
    /// @param selector The 4-byte function selector (e.g. bytes4(keccak256("claim()")))
    /// @param allowed  Whether the selector is permitted
    function setAllowedClaimSelector(bytes4 selector, bool allowed) external onlyOwner {
        allowedClaimSelectors[selector] = allowed;
        emit ClaimSelectorUpdated(selector, allowed);
    }

    function submitToMiningContract(bytes calldata data) external onlyOperator nonReentrant {
        (bool success, bytes memory result) = address(miningContract).call(data);
        require(success, "Transaction failed");
        emit Submitted(address(miningContract), success, result);
    }

    function isValidSignature(bytes32 _hash, bytes memory _signature) external view override returns (bytes4) {
        address recovered = ECDSA.recover(_hash, _signature);
        if (recovered == operator) {
            return MAGIC_VALUE;
        }
        return 0xffffffff;
    }

    // View helpers for UI
    function getStakeInfo(address user) external view returns (uint256 active, uint256 pending, uint64 lastEpoch) {
        return (userActiveStake[user], userPendingStake[user], lastDepositEpoch[user]);
    }
}
