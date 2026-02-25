// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BotcoinPool.sol";

contract BotcoinPoolFactory {
    // Track all deployed pools
    address[] public allPools;
    
    // Mapping to check if a pool was deployed by this factory
    mapping(address => bool) public isPool;

    // Fixed dependencies for all pools on this network
    address public immutable stakingToken;
    address public immutable miningContract;

    // Protocol fee config — immutable, set at factory deployment
    address public immutable protocolFeeRecipient;
    uint256 public immutable protocolFeeBps;

    event PoolCreated(address indexed pool, address indexed operator, uint256 feeBps);

    constructor(
        address _stakingToken,
        address _miningContract,
        address _protocolFeeRecipient,
        uint256 _protocolFeeBps
    ) {
        require(_stakingToken != address(0), "Invalid token");
        require(_miningContract != address(0), "Invalid mining");
        require(_protocolFeeRecipient != address(0), "Invalid fee recipient");
        stakingToken = _stakingToken;
        miningContract = _miningContract;
        protocolFeeRecipient = _protocolFeeRecipient;
        protocolFeeBps = _protocolFeeBps;
    }

    /**
     * @notice Deploys a new BotcoinPool
     * @param _operator The address that will run the solver and sign challenges
     * @param _feeBps The fee the operator charges (basis points, e.g. 500 = 5%)
     * @param _maxStake Maximum total stake allowed in the pool (0 = unlimited)
     */
    function createPool(address _operator, uint256 _feeBps, uint256 _maxStake) external returns (address) {
        // Deploy new pool
        BotcoinPool newPool = new BotcoinPool(
            stakingToken,
            miningContract,
            _operator,
            _feeBps,
            protocolFeeRecipient,
            protocolFeeBps,
            _maxStake
        );

        // Ownership of the pool is transferred to the caller (operator or deployer)
        newPool.transferOwnership(msg.sender);

        address poolAddr = address(newPool);
        allPools.push(poolAddr);
        isPool[poolAddr] = true;

        emit PoolCreated(poolAddr, _operator, _feeBps);
        
        return poolAddr;
    }

    function getPools() external view returns (address[] memory) {
        return allPools;
    }

    function getPoolCount() external view returns (uint256) {
        return allPools.length;
    }
}
