# BotcoinPool

Trustless, single-use mining pool for [Botcoin](https://agentmoney.net/) on Base. Pool BOTCOIN tokens to meet mining tier thresholds (25M / 50M / 100M) and earn proportional rewards per epoch.

- [Botcoin Wirepaper](https://agentmoney.net/wirepaper.md)
- [Twitter / X](https://x.com/MineBotcoin)
- [Pool Builder Spec (IPFS)](https://ipfs.io/ipfs/bafkreic3grzc5dok6niszy6otfwmoesnanf73sgfqyonbwevxr353sbsoa)
- [Bankr Wallet](https://bankr.bot/terminal)

## Deployments (Base Mainnet)

| Contract | Address |
|---|---|
| **BotcoinPoolFactoryV3** | [`0x4fD02f203afc9F7f1823F4B3Fc5304e70A564712`](https://basescan.org/address/0x4fD02f203afc9F7f1823F4B3Fc5304e70A564712#code) |
| BotcoinMiningV2 | [`0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716`](https://basescan.org/address/0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716) |
| BonusEpoch | [`0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8`](https://basescan.org/address/0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8) |
| BOTCOIN Token | [`0xA601877977340862Ca67f816eb079958E5bd0BA3`](https://basescan.org/token/0xA601877977340862Ca67f816eb079958E5bd0BA3) |

## Project Structure

```
contracts/
  BotcoinPoolV3.sol          # Core pool contract
  BotcoinPoolFactoryV3.sol   # Pool deployer
scripts/
  deployFactoryV3.js         # Factory deployment script
frontend/
  app/                       # Next.js routes
    page.tsx                 # Homepage — dashboard, pool list, create pool
    pool/[address]/page.tsx  # Pool detail — deposit, withdraw, lifecycle, admin
    scoreboard/page.tsx      # Epoch scoreboard
    docs/page.tsx            # Documentation
  components/
    Header.tsx               # Nav bar
    PoolList.tsx             # Pool table with sorting + epoch data
    PoolCard.tsx             # Expandable pool row with stats
    CreatePool.tsx           # Pool creation form (operator, fee, cap, min lock)
    OperatorSetup.tsx        # 5-step bot setup wizard
    BotStatus.tsx            # Live bot status indicator
    MiningStats.tsx          # Global mining stats
    Scoreboard.tsx           # Per-pool credit rankings
  lib/
    contracts.ts             # ABIs
    config.ts                # Contract addresses + wagmi config
    utils.ts                 # Formatting helpers
  public/bot/                # Bot files (served as static assets for zip download)
test/
  BotcoinPoolV3.cjs          # 77 V3 tests
  BotcoinPoolV2.cjs          # 56 V2 tests
```

## Architecture

### Pool Lifecycle

```
Idle ──> Active ──> Unstaking ──> Finalized
  │         │           │              │
deposit  stakeInto   request/      withdraw
          Mining     execute        + auto-claim
                     Unstake
```

1. **Idle** — Deposits accepted. Tokens sit in pool contract.
2. **Active** — Staked into MiningV2. Credits accumulating. Deposits locked.
3. **Unstaking** — Cooldown running (1–3 days). Anyone can finalize after cooldown.
4. **Finalized** — Terminal. Depositors withdraw principal + rewards. No re-staking.

All state transitions are **permissionless**. Pools are **single-use** — once finalized, depositors join a new pool to continue mining.

### Contracts

| Contract | Purpose |
|---|---|
| `BotcoinPoolV3.sol` | Core pool. Single-use lifecycle, MasterChef accRewardPerShare rewards, EIP-1271 auth, hardcoded submitReceipt selector, minActiveEpochs lock, rescueTokens, post-condition checks. |
| `BotcoinPoolFactoryV3.sol` | Deploys pools with shared MiningV2/BonusEpoch refs and immutable protocol fee. `createPool(operator, feeBps, maxStake, minActiveEpochs)`. |

### Key Design Decisions

- **O(1) reward claims** — MasterChef `accRewardPerShare` pattern replaces per-epoch arrays
- **Deposits only when Idle** — No mid-cycle deposits; prevents reward dilution
- **Min active epochs** — Pool creators set a lock period (0–10 epochs) to prevent 1-epoch griefing
- **Permissionless claiming** — `triggerClaim(epochIds)` and `triggerBonusClaim(epochIds)` callable by anyone
- **Dual fee model** — Protocol fee (immutable) + operator fee (max 10%, can only decrease)
- **Immutable stake caps** — Set at creation, capped at 100M (Tier 3 max)
- **Operator selector lock** — Only `submitReceipt` can be forwarded to MiningV2 (hardcoded)
- **Post-condition checks** — `stakeIntoMining`, `executeUnstake`, `finalizeWithdraw` verify mining contract state after calls
- **Rescue tokens** — Owner can recover stuck ERC-20s without touching deposits or unclaimed rewards
- **EIP-1271** — Pool validates operator signatures for coordinator authentication

### Security

- ReentrancyGuard on all state-changing functions
- SafeERC20 for all token transfers
- No admin path can move staked principal
- `receive()` rejects accidental ETH
- Constructor validates all addresses + fee bounds + minActiveEpochs ≤ 10
- `submitToMining` bubbles revert reasons from MiningV2
- Tier-1 balance enforced before staking

## Operator Mining Bot

Each pool needs a running bot to compete in Proof-of-Inference challenges and earn credits. The bot files are in `frontend/public/bot/` and downloadable from the frontend.

### Bot Files

| File | Purpose |
|---|---|
| `bot.js` | Main mining loop — fetches challenges, solves, submits receipts |
| `config.js` | Loads `.env` configuration |
| `coordinator.js` | Coordinator API client (challenges, submissions, auth) |
| `solver.js` | LLM solver — supports OpenAI (GPT-4) and Anthropic (Claude) |
| `bankr.js` | Bankr custodial wallet API client |
| `pool.js` | Pool contract interaction helpers |
| `logger.js` | Structured logging utility |

### Running the Bot

```bash
npm install            # ethers + dotenv
node bot.js            # Start mining
```

Required `.env` variables:

| Variable | Description |
|---|---|
| `POOL_ADDRESS` | Your deployed pool contract address |
| `BANKR_API_KEY` | API key from [bankr.bot/terminal](https://bankr.bot/terminal) |
| `LLM_PROVIDER` | `openai` or `anthropic` |
| `OPENAI_API_KEY` | OpenAI key (if using GPT-4) |
| `ANTHROPIC_API_KEY` | Anthropic key (if using Claude) |

The frontend includes a **Bot Setup Wizard** on each pool's detail page that walks operators through wallet setup, LLM config, and bot download.

## Tech Stack

- **Contracts**: Solidity 0.8.28, Hardhat, OpenZeppelin 5.x
- **Frontend**: Next.js 16, TypeScript, Tailwind CSS v4, wagmi v2, viem, RainbowKit
- **Bot**: Node.js, ethers v6, dotenv
- **Chain**: Base (L2)

## Getting Started

```bash
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deployFactoryV3.js --network base
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Environment Variables

| Variable | Location | Description |
|---|---|---|
| `PRIVATE_KEY` | `.env` | Deployer wallet private key |
| `BASESCAN_API_KEY` | `.env` | For contract verification |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | `frontend/.env.local` | Deployed FactoryV3 address |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | `frontend/.env.local` | WalletConnect Cloud project ID |

## Frontend Pages

| Route | Description |
|---|---|
| `/` | Homepage — mining dashboard, pool list, create pool |
| `/pool/[address]` | Pool detail — deposit, withdraw, lifecycle, rewards, bot status, admin |
| `/scoreboard` | Live epoch scoreboard with per-pool credits and ranking |
| `/docs` | Documentation — lifecycle, fees, security, FAQ |

## License

MIT
