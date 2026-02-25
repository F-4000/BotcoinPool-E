# BotcoinPool

Decentralized mining pool protocol for [Botcoin](https://agentmoney.net/) on Base. Pool your BOTCOIN tokens with other holders to meet mining tier thresholds (25M / 50M / 100M) and earn proportional mining rewards — no minimum required from individual stakers.

- [Botcoin Wirepaper](https://agentmoney.net/wirepaper.md)
- [Twitter / X](https://x.com/MineBotcoin)

**Live on Base Mainnet** — Factory: [`0xbD7Af59C63C64b6015fBb88fB378c98eC2AF4370`](https://basescan.org/address/0xbD7Af59C63C64b6015fBb88fB378c98eC2AF4370)

## How It Works

1. **Pool Operators** create pools via the factory, setting an operator fee (up to 10%) and an optional stake cap. Both the fee and stake cap are **immutable at creation** — the fee can only be *decreased* afterward, never raised, and the stake cap cannot be changed.
2. **Stakers** deposit BOTCOIN into any pool. Deposits are held as *pending* until the next mining epoch, preventing last-second reward sniping.
3. **Operators** run off-chain solvers to complete mining challenges. The pool contract implements **EIP-1271** (`isValidSignature`) so it can authenticate as a miner on-chain.
4. **Rewards** flow into the pool. A small protocol fee (1%, immutable) and the operator fee are deducted, then remaining rewards are distributed pro-rata to all active stakers.
5. **Withdrawals** are locked through the epoch in which deposits activate — users can withdraw starting the epoch after activation. No operator can ever block or delay withdrawals beyond this.

## Contracts

| Contract | Description |
|---|---|
| `BotcoinPoolFactory.sol` | Deploys and registers new pools. Stores immutable references to the BOTCOIN token, mining contract, and protocol fee config. |
| `BotcoinPool.sol` | Core staking pool. Manages pending/active stake accounting, epoch-based activation, reward distribution (Synthetix-style), operator submissions, and EIP-1271 signature validation. |

### Key Features

- **Epoch-gated deposits** — new stakes activate next epoch, preventing reward dilution attacks
- **Withdrawal locks** — deposits locked through their active epoch per mining contract spec, withdrawable the epoch after
- **Dual-fee model** — immutable protocol fee (1%) + operator fee (capped at 10%, can only decrease), both transparent on-chain
- **Immutable stake caps** — operators set pool size at creation (0 = unlimited), cannot be changed afterward; hard-capped at 100M BOTCOIN (mining contract limit)
- **Anti-rug protections** — fee can only decrease, stake cap is immutable, protocol fee is locked per-pool
- **Operator selector whitelist** — operator can only call owner-whitelisted functions on the mining contract, minimizing trust surface
- **Trustless claiming** — whitelisted selectors allow anyone to trigger reward claims on behalf of the pool
- **Zero additional trust** — the only trust a user places in the operator is solving inference challenges; operator cannot lock, move, or redirect deposits
- **ReentrancyGuard + SafeERC20** — standard security via OpenZeppelin

## Tech Stack

- **Contracts**: Solidity 0.8.20, Hardhat, OpenZeppelin
- **Frontend**: Next.js 15, TypeScript, Tailwind CSS, wagmi v2, viem
- **Chain**: Base (L2)

## Getting Started

### Prerequisites

- Node.js v18+
- npm

### Install & Compile

```bash
npm install
npx hardhat compile
```

### Run Tests

```bash
npx hardhat test
```

### Deploy

1. Copy `.env.example` to `.env` and fill in your private key.
2. Deploy:
   ```bash
   npx hardhat run scripts/deployFactory.js --network base
   ```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Connect your wallet to create pools, stake, and view the scoreboard.

### Environment Variables

| Variable | Where | Description |
|---|---|---|
| `PRIVATE_KEY` | Root `.env` | Deployer wallet private key (never commit) |
| `BASESCAN_API_KEY` | Root `.env` | For contract verification on BaseScan |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | `frontend/.env.local` | Deployed factory contract address |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | `frontend/.env.local` | WalletConnect Cloud project ID |

## License

MIT
