// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockMiningContract {
    uint64 public currentEpoch;

    function setEpoch(uint64 epoch) public {
        currentEpoch = epoch;
    }

    function epochId() external view returns (uint64) {
        return currentEpoch;
    }

    function submit(uint64, uint64) external pure returns (bool) {
        return true;
    }
}
