# BotcoinPool V2 — Task Plan

**Spec:** [IPFS](https://ipfs.io/ipfs/bafkreic3grzc5dok6niszy6otfwmoesnanf73sgfqyonbwevxr353sbsoa)

---

## Production Contract Addresses (Base Mainnet)

| Contract | Address |
|----------|---------|
| BotcoinMiningV2 | `0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716` |
| BonusEpoch | `0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8` |
| BOTCOIN token | `0xA601877977340862Ca67f816eb079958E5bd0BA3` |

## MiningV2 On-Chain Config

| Parameter | Value |
|-----------|-------|
| Tier 1 | 25,000,000 BOTCOIN |
| Tier 2 | 50,000,000 BOTCOIN |
| Tier 3 | 100,000,000 BOTCOIN |
| Unstake cooldown | 1 day (86400s) |
| Current epoch | 8 |

---

## Phase 1: Contract — BotcoinPoolV2.sol (rewrite)

### 1.1 — Core staking lifecycle
Pool contract must stake BOTCOIN into MiningV2 — not hold it in balance.

- [ ] **Deposit flow**: User calls `deposit(amount)` → pool holds BOTCOIN in balance until operator/anyone triggers staking.
- [ ] **Stake into mining**: Permissionless `stakeIntoMining()` function that calls `miningV2.stake(amount)` with the pool's accumulated deposits. Pool becomes the staker, `stakedAmount(pool)` reflects tier.
- [ ] **Track user shares**: Each user's principal contribution tracked on-chain (shares or exact amounts). Must be deterministic — no operator discretion.
- [ ] Stake persists across epochs — no per-epoch recommit.

### 1.2 — Trustless unstake at epoch boundary
No single depositor can force unstake mid-epoch. No operator can block exits.

- [ ] **`unstakeAtEpochEnd()`**: Permissionless function callable by anyone, but ONLY at/after the current epoch boundary. Calls `miningV2.unstake()`.
- [ ] **Epoch boundary enforcement**: Use `miningV2.currentEpoch()` to gate. Define the pool's allowed unstake window (e.g., epoch end or every N epochs).
- [ ] **`cancelUnstake()`**: Owner/operator can cancel unstake if still in cooldown (calls `miningV2.cancelUnstake()`), so pool stays eligible for mining if unstake was triggered prematurely.
- [ ] **No mid-epoch unstake**: Enforce that unstake can only happen at defined boundaries.

### 1.3 — Cooldown + finalize withdraw
After unstake, tokens are locked in MiningV2 cooldown. Then anyone can complete.

- [ ] **Pool state machine**: Track pool lifecycle: `Active` → `Unstaking` → `Cooldown` → `Withdrawable` → `Active` (re-stake).
- [ ] **`finalizeWithdraw()`**: Permissionless. Calls `miningV2.withdraw()` when `block.timestamp >= withdrawableAt(pool)`. BOTCOIN returns to pool contract.
- [ ] **Re-staking**: After finalize, BOTCOIN is in the pool. Deposits can accumulate and `stakeIntoMining()` re-enters the mining cycle.

### 1.4 — User principal withdrawal
Once BOTCOIN is back in the pool (post-cooldown), depositors withdraw their share.

- [ ] **`withdrawShare(amount)`**: Depositor withdraws their principal. Only from pool balance (not from staked funds). Permissionless — no operator approval.
- [ ] **Cannot exceed share**: User can only withdraw up to their tracked principal.
- [ ] **No withdrawal while staked**: If pool's BOTCOIN is staked in mining, user cannot withdraw (funds aren't in the pool contract). UI must clearly communicate this.

### 1.5 — Regular epoch rewards (claim from MiningV2)
- [ ] **`triggerClaim(uint64[] epochIds)`**: Permissionless. Calls `miningV2.claim(epochIds)`. BOTCOIN rewards sent to pool contract.
- [ ] **Pro-rata distribution**: Rewards distributed to depositors based on their share of active stake at time of claim.
- [ ] **Protocol fee**: Taken first (immutable, set by factory).
- [ ] **Operator fee**: Taken second (bps, can only decrease).
- [ ] **`claimReward()`**: Depositors claim their accumulated reward share. No operator approval.

### 1.6 — Bonus epoch rewards (claim from BonusEpoch)
- [ ] **`triggerBonusClaim(uint64[] epochIds)`**: Permissionless. Calls `bonusEpoch.claimBonus(epochIds)` as the pool contract (msg.sender = pool). BOTCOIN rewards sent to pool.
- [ ] **Pro-rata distribution**: Same mechanism as regular rewards — distributed to depositors proportionally.
- [ ] Both regular and bonus rewards use the same `rewardPerToken` accumulator (or separate accumulators summed at claim time).

### 1.7 — Operator solver integration
- [ ] **`submitReceiptToMining(bytes calldata)`**: Operator-only. Forwards `submitReceipt(...)` calldata to MiningV2 so `msg.sender = pool`. Credits accrue to pool.
- [ ] **Operator selector whitelist**: Only whitelisted function selectors allowed (prevents arbitrary calls).
- [ ] **EIP-1271 `isValidSignature`**: Returns `0x1626ba7e` when operator EOA signed the hash. Coordinator uses this for auth.

### 1.8 — Anti-custody invariants
- [ ] No operator-only path for principal return (unstake, cooldown completion, pool-side withdrawal all permissionless).
- [ ] No perpetual lock via role abuse (operator cannot prevent exits).
- [ ] Deterministic accounting (on-chain shares/principal tracking).
- [ ] No mid-cycle principal drain (no arbitrary transfer functions).
- [ ] No bonus-claim custody trap (bonus rewards follow same permissionless claim + distribute logic).

### 1.9 — Security hardening
- [ ] `ReentrancyGuard` on all state-changing functions.
- [ ] Fee can only decrease (owner cannot raise it after deployment).
- [ ] Immutable pool cap (set at deployment, enforced on deposits).
- [ ] 100M BOTCOIN hard cap (Tier 3 max).
- [ ] All `external` calls to MiningV2/BonusEpoch use `SafeERC20` and check return values.

---

## Phase 2: Contract — BotcoinPoolFactoryV2.sol

- [ ] **Constructor**: Takes `stakingToken`, `miningV2`, `bonusEpoch`, `protocolFeeRecipient`, `protocolFeeBps`.
- [ ] **`createPool(operator, feeBps, maxStake)`**: Deploys `BotcoinPoolV2`, transfers ownership to caller. Enforces `maxStake <= 100M`.
- [ ] **Pool registry**: `allPools[]`, `isPool[]`, `getPools()`, `getPoolCount()`.
- [ ] **Immutable protocol fee**: Set once at factory deploy, passed to every pool.

---

## Phase 3: Tests

- [ ] **Unit tests**: Deposit, stake, unstake lifecycle, cooldown, finalize, withdraw shares.
- [ ] **Reward tests**: Regular claim, bonus claim, pro-rata distribution, fee deductions.
- [ ] **Security tests**: Mid-epoch unstake rejection, operator cannot drain, reentrancy checks.
- [ ] **Integration test with MockMiningV2 + MockBonusEpoch**: Full lifecycle simulation.

---

## Phase 4: Frontend Updates

### 4.1 — Config updates
- [ ] Update `MINING_ADDRESS` → `0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716`
- [ ] Add `BONUS_EPOCH_ADDRESS` → `0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8`
- [ ] Update contract ABIs for new pool, miningV2, bonusEpoch.
- [ ] Deploy new factory, update `FACTORY_ADDRESS`.

### 4.2 — Pool detail page
- [ ] **Pool lifecycle status**: Show Active / Unstaking / Cooldown / Withdrawable state.
- [ ] **Staking info**: `stakedAmount(pool)`, current tier, `isEligible(pool)`.
- [ ] **Cooldown timer**: If unstaking, show time remaining until `withdrawableAt`.
- [ ] **Deposit panel**: Deposit BOTCOIN → pool balance (pending next stake cycle).
- [ ] **Withdraw panel**: Only available when pool has withdrawable balance (post-cooldown). Show user's claimable share.
- [ ] **Claim rewards**: Show regular + bonus rewards separately or combined.
- [ ] **Trigger Claim**: Permissionless trigger for `claim(epochIds)`.
- [ ] **Trigger Bonus Claim**: Permissionless trigger for `claimBonus(epochIds)`.
- [ ] **Trigger Unstake**: Permissionless unstake at epoch boundary.
- [ ] **Finalize Withdraw**: Permissionless after cooldown expires.

### 4.3 — Pool list / cards
- [ ] Show tier (1/2/3) based on `stakedAmount`.
- [ ] Show pool lifecycle state.
- [ ] Show mining credits + reward share %.
- [ ] Show bonus epoch status (if current/recent epoch is bonus).

### 4.4 — Create pool form
- [ ] Fee input (0-10%, clamped).
- [ ] Pool cap (0-100M, clamped).
- [ ] No change to create flow — factory deploys.

---

## Phase 5: Deploy + Verify

- [ ] Compile with Solidity 0.8.28, cancun EVM target (match MiningV2).
- [ ] Deploy factory to Base mainnet.
- [ ] Verify factory + first pool on Basescan.
- [ ] Test full lifecycle: deposit → stake → mine → claim → unstake → cooldown → finalize → withdraw.
- [ ] Update frontend env, push, verify Vercel deploy.

---

## MiningV2 Interface Reference (from on-chain ABI)

```solidity
// Staking
function stake(uint256 amount) external;
function unstake() external;
function cancelUnstake() external;
function withdraw() external;

// Reads
function stakedAmount(address) external view returns (uint256);
function withdrawableAt(address) external view returns (uint256);
function isEligible(address) external view returns (bool);
function currentEpoch() external view returns (uint64);
function totalStaked() external view returns (uint256);
function genesisTimestamp() external view returns (uint256);
function unstakeCooldown() external view returns (uint256);

// Tiers
function tier1Balance() external view returns (uint256);
function tier2Balance() external view returns (uint256);
function tier3Balance() external view returns (uint256);

// Mining
function submitReceipt(uint64 epochId, uint64 solveIndex, bytes32 prevReceiptHash, bytes32 challengeId, bytes32 commit, bytes32 docHash, bytes32 questionsHash, bytes32 constraintsHash, bytes32 answersHash, uint128 worldSeed, uint32 rulesVersion, bytes signature) external;
function credits(uint64 epochId, address miner) external view returns (uint256);
function totalCredits(uint64 epochId) external view returns (uint256);

// Rewards
function claim(uint64[] epochIds) external;
function claimed(uint64 epochId, address miner) external view returns (bool);
function epochReward(uint64 epochId) external view returns (uint256);
```

## BonusEpoch Interface Reference (from on-chain ABI)

```solidity
function claimBonus(uint64[] epochIds) external;
function isBonusEpoch(uint64 epochId) external view returns (bool);
function openBonusClaims(uint64 epochId) external;
function epochBonusBlock(uint64 epochId) external view returns (uint256);
function epochBonusHash(uint64 epochId) external view returns (bytes32);
function rewardBalance() external view returns (uint256);
```
