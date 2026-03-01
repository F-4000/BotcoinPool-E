# BotcoinPool

Trustless mining pool for [Botcoin](https://agentmoney.net/) on Base. Pool BOTCOIN tokens to meet mining tier thresholds (25M / 50M / 100M) and earn proportional rewards.

- [Botcoin Wirepaper](https://agentmoney.net/wirepaper.md)
- [Twitter / X](https://x.com/MineBotcoin)
- [Pool Builder Spec (IPFS)](https://ipfs.io/ipfs/bafkreic3grzc5dok6niszy6otfwmoesnanf73sgfqyonbwevxr353sbsoa)
- [Bankr Wallet](https://bankr.bot/terminal)

## Deployments (Base Mainnet)

| Contract | Address |
|---|---|
| **BotcoinPoolFactoryV2** | [`0xD1ac58B8c59B92e7AC247873774C53F88Fb1A5df`](https://basescan.org/address/0xD1ac58B8c59B92e7AC247873774C53F88Fb1A5df#code) |
| BotcoinMiningV2 | [`0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716`](https://basescan.org/address/0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716) |
| BonusEpoch | [`0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8`](https://basescan.org/address/0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8) |
| BOTCOIN Token | [`0xA601877977340862Ca67f816eb079958E5bd0BA3`](https://basescan.org/token/0xA601877977340862Ca67f816eb079958E5bd0BA3) |

## Project Structure

```
contracts/
  BotcoinPoolV2.sol          # Core pool contract
  BotcoinPoolFactoryV2.sol   # Pool deployer
scripts/
  deployFactoryV2.js         # Factory deployment script
  operator/                  # Mining bot source
    bot.js                   # Main loop
    config.js                # Env loader
    coordinator.js           # Challenge API client
    solver.js                # LLM solver (GPT-4 / Claude)
    bankr.js                 # Bankr wallet client
    pool.js                  # Contract helpers
    logger.js                # Logging
frontend/
  app/                       # Next.js routes
    page.tsx                 # Homepage — dashboard, pool list, create pool
    pool/[address]/page.tsx  # Pool detail — deposit, withdraw, lifecycle, admin
    scoreboard/page.tsx      # Epoch scoreboard
    docs/page.tsx            # Documentation
  components/
    Header.tsx               # Nav bar (Pools, Scoreboard, Docs, Bankr, GitHub)
    PoolList.tsx             # Pool table with sorting + epoch data
    PoolCard.tsx             # Expandable pool row with stats
    CreatePool.tsx           # Pool creation form
    OperatorSetup.tsx        # 6-step bot setup wizard
    BotStatus.tsx            # Live bot status indicator (on-chain credit polling)
    MiningStats.tsx          # Global mining stats
    Scoreboard.tsx           # Per-pool credit rankings
  lib/
    contracts.ts             # ABIs
    config.ts                # Contract addresses + wagmi config
    utils.ts                 # Formatting helpers
  public/bot/                # Bot files served as static assets for zip download
test/
  BotcoinPoolV2.cjs          # 43 tests
```

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

## Operator Mining Bot

Each pool needs a running bot to compete in Proof-of-Inference challenges and earn credits. The bot source lives in `scripts/operator/`.

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
cd scripts/operator
cp .env.example .env   # Fill in your keys
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

The frontend includes a guided **Bot Setup Wizard** on each pool's detail page that walks operators through:

1. Creating/connecting an operator wallet (Bankr or any wallet)
2. Choosing an LLM provider (OpenAI or Anthropic)
3. Generating a `.env` config template (pool address pre-filled)
4. Whitelisting the `submitReceipt` selector on-chain
5. Downloading bot files (one-click zip or git sparse-checkout)

The pool detail page also shows a live **Bot Status** indicator that polls on-chain credits to detect whether the bot is running (Live / Active / Idle / Offline).

## Tech Stack

- **Contracts**: Solidity 0.8.28, Hardhat 2.22, OpenZeppelin 5.4
- **Frontend**: Next.js 16, TypeScript, Tailwind CSS v4, wagmi v2, viem, RainbowKit
- **Bot**: Node.js, ethers v6, dotenv
- **Chain**: Base (L2)

## Getting Started

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Run tests
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
| `/pool/[address]` | Pool detail: deposit, withdraw, lifecycle, rewards, bot status, admin panel |
| `/scoreboard` | Live epoch scoreboard with per-pool credits and ranking |
| `/docs` | Documentation — how pools work, lifecycle, fees, FAQ |

## License

MIT
