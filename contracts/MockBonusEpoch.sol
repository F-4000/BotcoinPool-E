// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockBonusEpoch
/// @notice Test double for BonusEpoch contract — simulates bonus claiming.
contract MockBonusEpoch {
    using SafeERC20 for IERC20;

    IERC20 public token;

    mapping(uint64 => bool) public isBonusEpoch;
    mapping(uint64 => uint256) public bonusReward;
    mapping(uint64 => mapping(address => bool)) public bonusClaimed;
    mapping(uint64 => uint256) public totalBonusCredits;
    mapping(uint64 => mapping(address => uint256)) public bonusCredits;

    constructor(address _token) {
        token = IERC20(_token);
    }

    function claimBonus(uint64[] calldata epochIds) external {
        uint256 total = 0;
        for (uint256 i = 0; i < epochIds.length; i++) {
            uint64 eid = epochIds[i];
            require(isBonusEpoch[eid], "Not bonus epoch");
            require(!bonusClaimed[eid][msg.sender], "Already claimed");
            uint256 tc = totalBonusCredits[eid];
            if (tc > 0 && bonusCredits[eid][msg.sender] > 0) {
                uint256 share = (bonusReward[eid] * bonusCredits[eid][msg.sender]) / tc;
                total += share;
            }
            bonusClaimed[eid][msg.sender] = true;
        }
        if (total > 0) {
            token.safeTransfer(msg.sender, total);
        }
    }

    // ── Test helpers ─────────────────────────────────────────────────

    function setBonusEpoch(uint64 epochId, bool isBonus) external {
        isBonusEpoch[epochId] = isBonus;
    }

    function fundBonusReward(uint64 epochId, uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
        bonusReward[epochId] += amount;
    }

    function setBonusCredits(uint64 epochId, address miner, uint256 amount) external {
        totalBonusCredits[epochId] = totalBonusCredits[epochId] - bonusCredits[epochId][miner] + amount;
        bonusCredits[epochId][miner] = amount;
    }
}
