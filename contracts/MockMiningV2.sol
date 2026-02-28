// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockMiningV2
/// @notice Test double for BotcoinMiningV2 — simulates stake/unstake/cooldown/withdraw/claim.
contract MockMiningV2 {
    using SafeERC20 for IERC20;

    IERC20 public token;
    uint64 public currentEpoch;
    uint256 public unstakeCooldown;

    uint256 public tier1Balance;
    uint256 public tier2Balance;
    uint256 public tier3Balance;

    struct StakerInfo {
        uint256 staked;
        uint256 unstakeTimestamp; // 0 = not unstaking
        bool    isUnstaking;
    }

    mapping(address => StakerInfo) public stakers;
    uint256 public totalStaked;

    // Credits: epochId => miner => amount
    mapping(uint64 => mapping(address => uint256)) public credits;
    mapping(uint64 => uint256) public totalCredits;

    // Epoch rewards (funded by test)
    mapping(uint64 => uint256) public epochReward;
    mapping(uint64 => mapping(address => bool)) public claimed;

    // Receipt tracking
    mapping(address => bytes32) public lastReceiptHash;
    mapping(address => uint64) public nextIndex;

    constructor(address _token) {
        token = IERC20(_token);
        currentEpoch = 1;
        unstakeCooldown = 86400; // 1 day default
        tier1Balance = 25_000_000 * 1e18;
        tier2Balance = 50_000_000 * 1e18;
        tier3Balance = 100_000_000 * 1e18;
    }

    // ── Staking ──────────────────────────────────────────────────────

    function stake(uint256 amount) external {
        require(amount > 0, "Zero");
        require(!stakers[msg.sender].isUnstaking, "Unstaking");
        token.safeTransferFrom(msg.sender, address(this), amount);
        stakers[msg.sender].staked += amount;
        totalStaked += amount;
    }

    function unstake() external {
        require(stakers[msg.sender].staked > 0, "Nothing staked");
        require(!stakers[msg.sender].isUnstaking, "Already unstaking");
        stakers[msg.sender].isUnstaking = true;
        stakers[msg.sender].unstakeTimestamp = block.timestamp + unstakeCooldown;
    }

    function cancelUnstake() external {
        require(stakers[msg.sender].isUnstaking, "Not unstaking");
        stakers[msg.sender].isUnstaking = false;
        stakers[msg.sender].unstakeTimestamp = 0;
    }

    function withdraw() external {
        StakerInfo storage info = stakers[msg.sender];
        require(info.isUnstaking, "Not unstaking");
        require(block.timestamp >= info.unstakeTimestamp, "Cooldown");
        uint256 amount = info.staked;
        info.staked = 0;
        info.isUnstaking = false;
        info.unstakeTimestamp = 0;
        totalStaked -= amount;
        token.safeTransfer(msg.sender, amount);
    }

    // ── Views ────────────────────────────────────────────────────────

    function stakedAmount(address miner) external view returns (uint256) {
        return stakers[miner].staked;
    }

    function withdrawableAt(address miner) external view returns (uint256) {
        return stakers[miner].unstakeTimestamp;
    }

    function isEligible(address miner) external view returns (bool) {
        return stakers[miner].staked >= tier1Balance && !stakers[miner].isUnstaking;
    }

    // ── Claiming ─────────────────────────────────────────────────────

    function claim(uint64[] calldata epochIds) external {
        uint256 total = 0;
        for (uint256 i = 0; i < epochIds.length; i++) {
            uint64 eid = epochIds[i];
            require(!claimed[eid][msg.sender], "Already claimed");
            uint256 tc = totalCredits[eid];
            if (tc > 0 && credits[eid][msg.sender] > 0) {
                uint256 share = (epochReward[eid] * credits[eid][msg.sender]) / tc;
                total += share;
            }
            claimed[eid][msg.sender] = true;
        }
        if (total > 0) {
            token.safeTransfer(msg.sender, total);
        }
    }

    // ── Receipt submission (simplified) ──────────────────────────────

    function submitReceipt(
        uint64, uint64, bytes32, bytes32, bytes32,
        bytes32, bytes32, bytes32, bytes32,
        uint128, uint32, bytes calldata
    ) external {
        // Simplified: just increment credits for caller in current epoch
        credits[currentEpoch][msg.sender] += 1;
        totalCredits[currentEpoch] += 1;
        nextIndex[msg.sender] += 1;
    }

    // ── Test helpers (not in real contract) ───────────────────────────

    function setEpoch(uint64 _epoch) external {
        currentEpoch = _epoch;
    }

    function setCooldown(uint256 _cooldown) external {
        unstakeCooldown = _cooldown;
    }

    function fundEpochReward(uint64 epochId, uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        epochReward[epochId] += amount;
    }

    function setCredits(uint64 epochId, address miner, uint256 amount) external {
        totalCredits[epochId] = totalCredits[epochId] - credits[epochId][miner] + amount;
        credits[epochId][miner] = amount;
    }
}
