// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./BotcoinPoolV3.sol";

/// @title BotcoinPoolFactoryV3
/// @notice Deploys BotcoinPoolV3 instances with immutable protocol fee
///         and shared MiningV2 + BonusEpoch addresses.
contract BotcoinPoolFactoryV3 {
    // ── Immutables ───────────────────────────────────────────────────
    address public immutable stakingToken;
    address public immutable mining;
    address public immutable bonusEpoch;
    address public immutable protocolFeeRecipient;
    uint256 public immutable protocolFeeBps;

    // ── Pool registry ────────────────────────────────────────────────
    address[] public allPools;
    mapping(address => bool) public isPool;

    // ── Events ───────────────────────────────────────────────────────
    event PoolCreated(
        address indexed pool,
        address indexed operator,
        uint256 feeBps,
        uint256 maxStake,
        uint64  minActiveEpochs
    );

    // ── Constructor ──────────────────────────────────────────────────
    constructor(
        address _stakingToken,
        address _mining,
        address _bonusEpoch,
        address _protocolFeeRecipient,
        uint256 _protocolFeeBps
    ) {
        require(_stakingToken != address(0), "Zero token");
        require(_mining != address(0), "Zero mining");
        require(_bonusEpoch != address(0), "Zero bonus");
        require(_protocolFeeRecipient != address(0), "Zero fee recipient");
        require(_protocolFeeBps <= 500, "Protocol fee > 5%");

        stakingToken         = _stakingToken;
        mining               = _mining;
        bonusEpoch           = _bonusEpoch;
        protocolFeeRecipient = _protocolFeeRecipient;
        protocolFeeBps       = _protocolFeeBps;
    }

    // ── Create pool ──────────────────────────────────────────────────

    /// @notice Deploy a new BotcoinPoolV3. Ownership transfers to caller.
    /// @param _operator  Solver/signing EOA for this pool
    /// @param _feeBps    Operator fee (≤ 10 %)
    /// @param _maxStake  Pool cap (0 = no pool-level cap, still capped at 100M)
    /// @param _minActiveEpochs  Min epochs before unstake allowed (0–10)
    function createPool(
        address _operator,
        uint256 _feeBps,
        uint256 _maxStake,
        uint64  _minActiveEpochs
    ) external returns (address) {
        uint256 miningMax = 100_000_000 * 1e18;
        require(_maxStake == 0 || _maxStake <= miningMax, "Exceeds mining max");

        BotcoinPoolV3 pool = new BotcoinPoolV3(
            stakingToken,
            mining,
            bonusEpoch,
            _operator,
            _feeBps,
            protocolFeeRecipient,
            protocolFeeBps,
            _maxStake,
            _minActiveEpochs
        );

        pool.transferOwnership(msg.sender);

        address poolAddr = address(pool);
        allPools.push(poolAddr);
        isPool[poolAddr] = true;

        emit PoolCreated(poolAddr, _operator, _feeBps, _maxStake, _minActiveEpochs);
        return poolAddr;
    }

    // ── View helpers ─────────────────────────────────────────────────

    function getPools() external view returns (address[] memory) {
        return allPools;
    }

    function getPoolCount() external view returns (uint256) {
        return allPools.length;
    }
}
