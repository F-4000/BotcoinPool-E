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
    function currentEpoch() external view returns (uint256);
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
    mapping(address => uint256) public userPendingStake;
    mapping(address => uint64) public lastDepositEpoch; // Track when pending was added

    // --- Reward State ---
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    // --- Selector Whitelists ---
    mapping(bytes4 => bool) public allowedClaimSelectors;    // for triggerClaim
    mapping(bytes4 => bool) public allowedOperatorSelectors;  // for submitToMiningContract

    // Track the epoch when user stake became active (for withdrawal lock)
    mapping(address => uint64) public userActivatedEpoch;

    // Mining contract max stake (100M BOTCOIN)
    uint256 public constant MINING_MAX_STAKE = 100_000_000 * 1e18;

    // EIP-1271 Magic Value
    bytes4 internal constant MAGIC_VALUE = 0x1626ba7e;

    event Staked(address indexed user, uint256 amount, uint64 epoch, bool isPending);
    event Withdrawn(address indexed user, uint256 amount, uint64 epoch);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardsDistributed(uint256 amount);
    event OperatorChanged(address indexed previousOperator, address indexed newOperator);
    event FeeUpdated(uint256 newFeeBps);
    event Submitted(address indexed target, bool success, bytes data);
    event ClaimSelectorUpdated(bytes4 indexed selector, bool allowed);
    event OperatorSelectorUpdated(bytes4 indexed selector, bool allowed);

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
        uint64 currentEpoch = uint64(miningContract.currentEpoch());
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
                // Record when this stake became active (for withdrawal lock)
                userActivatedEpoch[account] = currentEpoch;
            }
        }
    }
    
    // Reward calculation — only accrues when rewards are added via triggerClaim.
    function _rewardPerToken() internal view returns (uint256) {
        return rewardPerTokenStored;
    }

    function _earned(address account) internal view returns (uint256) {
        return rewards[account] + ((userActiveStake[account] * (rewardPerTokenStored - userRewardPerTokenPaid[account])) / 1e18);
    }

    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot deposit 0");
        uint64 currentEpoch = uint64(miningContract.currentEpoch());
        
        _updateUser(msg.sender, currentEpoch);

        // Enforce pool cap (0 = unlimited), also hard-capped at mining contract limit
        uint256 effectiveTotal = totalActiveStake + globalPendingStake + amount;
        require(effectiveTotal <= MINING_MAX_STAKE, "Exceeds mining contract limit");
        if (maxStake > 0) {
            require(effectiveTotal <= maxStake, "Pool cap reached");
        }

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Add to pending — locked until next epoch
        userPendingStake[msg.sender] += amount;
        lastDepositEpoch[msg.sender] = currentEpoch;
        globalPendingStake += amount;

        emit Staked(msg.sender, amount, currentEpoch, true);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot withdraw 0");
        uint64 currentEpoch = uint64(miningContract.currentEpoch());
        
        _updateUser(msg.sender, currentEpoch);
        
        // Withdrawal lock: stake deposited in epoch N becomes active in epoch N+1,
        // and is locked through that active epoch. Withdrawable starting epoch N+2.
        // This ensures deposits are locked for the full epoch they are "deposited for" per spec.
        require(currentEpoch > userActivatedEpoch[msg.sender], "Stake locked through active epoch");
        require(userActiveStake[msg.sender] >= amount, "Insufficient active stake");
        
        userActiveStake[msg.sender] -= amount;
        totalActiveStake -= amount;
        
        stakingToken.safeTransfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount, currentEpoch);
    }

    function claimReward() external nonReentrant {
        uint64 currentEpoch = uint64(miningContract.currentEpoch());
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
            uint64 currentEpoch = uint64(miningContract.currentEpoch());
            
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
        require(data.length >= 4, "Calldata too short");
        bytes4 selector = bytes4(data[:4]);
        require(allowedOperatorSelectors[selector], "Selector not whitelisted");

        (bool success, bytes memory result) = address(miningContract).call(data);
        require(success, "Transaction failed");
        emit Submitted(address(miningContract), success, result);
    }

    /// @notice Owner adds or removes a function selector that the operator can call on the mining contract.
    /// @param selector The 4-byte function selector
    /// @param allowed  Whether the selector is permitted
    function setAllowedOperatorSelector(bytes4 selector, bool allowed) external onlyOwner {
        allowedOperatorSelectors[selector] = allowed;
        emit OperatorSelectorUpdated(selector, allowed);
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
