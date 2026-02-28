# BotcoinPool

Trustless mining pool for [Botcoin](https://agentmoney.net/) on Base. Pool BOTCOIN tokens to meet mining tier thresholds (25M / 50M / 100M) and earn proportional rewards.

- [Botcoin Wirepaper](https://agentmoney.net/wirepaper.md)
- [Twitter / X](https://x.com/MineBotcoin)
- [Pool Builder Spec (IPFS)](https://ipfs.io/ipfs/bafkreic3grzc5dok6niszy6otfwmoesnanf73sgfqyonbwevxr353sbsoa)

## Deployments (Base Mainnet)

| Contract | Address |
|---|---|
| **BotcoinPoolFactoryV2** | [`0xD1ac58B8c59B92e7AC247873774C53F88Fb1A5df`](https://basescan.org/address/0xD1ac58B8c59B92e7AC247873774C53F88Fb1A5df#code) |
| BotcoinMiningV2 | [`0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716`](https://basescan.org/address/0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716) |
| BonusEpoch | [`0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8`](https://basescan.org/address/0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8) |
| BOTCOIN Token | [`0xA601877977340862Ca67f816eb079958E5bd0BA3`](https://basescan.org/token/0xA601877977340862Ca67f816eb079958E5bd0BA3) |

## Architecture

### Pool Lifecycle

```
Idle ──► Active ──► Unstaking ──► Idle
  │         │           │           │
deposit  stakeInto   triggerUn   finalize
          Mining      stake      Withdraw
```

1. **Idle** - Deposits accepted. Tokens sit in pool contract.
2. **Active** - Pool has staked into MiningV2. Mining in progress, credits accumulating.
3. **Unstaking** - Cooldown running (1-3 days). Anyone can cancel (owner/operator) or finalize after cooldown.

All state transitions are **permissionless** (except `cancelUnstake` which is owner/operator only).

### Contracts

| Contract | Purpose |
|---|---|
| `BotcoinPoolV2.sol` | Core pool. Persistent staking into MiningV2, Synthetix-style reward distribution, EIP-1271 auth, operator selector whitelist. |
| `BotcoinPoolFactoryV2.sol` | Deploys pools with shared MiningV2/BonusEpoch refs and immutable protocol fee (1%). |

### Key Design Decisions

- **Persistent staking** - Stake persists across epochs, no recommit needed
- **Deposits only when Idle** - Prevents reward dilution mid-epoch
- **Permissionless claiming** - `triggerClaim(epochIds)` and `triggerBonusClaim(epochIds)` callable by anyone
- **Dual fee model** - Protocol fee (1%, immutable) + operator fee (max 10%, can only decrease)
- **Immutable stake caps** - Set at creation, capped at 100M (Tier 3 max)
- **Operator selector whitelist** - Owner whitelists 4-byte selectors the operator can forward to MiningV2
- **EIP-1271** - Pool validates operator signatures for coordinator authentication
- **O(1) gas rewards** - Synthetix `rewardPerToken` accumulator, no loops

### Security

- ReentrancyGuard on all state-changing functions
- SafeERC20 for all token transfers
- No admin path can move staked principal
- `receive()` rejects accidental ETH
- Constructor validates zero-address operator and fee bounds
- `submitToMining` bubbles revert reasons from MiningV2

## Tech Stack

- **Contracts**: Solidity 0.8.28, Hardhat 2.22, OpenZeppelin 5.4
- **Frontend**: Next.js 16, TypeScript, Tailwind CSS v4, wagmi v2, viem, RainbowKit
- **Chain**: Base (L2)

## Getting Started

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests (35 tests)
npx hardhat test test/BotcoinPoolV2.cjs

# Deploy factory
npx hardhat run scripts/deployFactoryV2.js --network base
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Location | Description |
|---|---|---|
| `PRIVATE_KEY` | `.env` | Deployer wallet private key |
| `BASESCAN_API_KEY` | `.env` | For contract verification |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | `frontend/.env.local` | Deployed FactoryV2 address |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | `frontend/.env.local` | WalletConnect Cloud project ID |

## Frontend Pages

| Route | Description |
|---|---|
| `/` | Homepage with mining dashboard, pool list, create pool |
| `/pool/[address]` | Pool detail: deposit, withdraw, lifecycle actions, rewards, admin panel |
| `/scoreboard` | Live epoch scoreboard with per-pool credits and ranking |

## License

MIT
