import Link from "next/link";

export default function DocsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Header */}
      <div className="gradient-border p-6">
        <h1 className="text-2xl font-bold text-text tracking-tight">
          <span className="glow-blue">Documentation</span>
        </h1>
        <p className="text-sm text-muted mt-1">
          Everything you need to know about Botcoin Pool
        </p>
      </div>

      {/* What is Botcoin Pool */}
      <Section title="What is Botcoin Pool?">
        <p>
          Botcoin Pool is a <Hl>trustless pooled mining</Hl> contract on Base.
          BOTCOIN mining requires a minimum of <Hl color="warn">25,000,000 BOTCOIN</Hl> staked
          to participate. Most users cannot reach this threshold alone.
        </p>
        <p>
          The pool lets you deposit <Hl>any amount</Hl> of BOTCOIN. Your tokens are
          combined with other depositors to collectively reach the staking tier.
          Rewards are distributed proportionally based on your share of the pool.
        </p>
        <p>
          All critical actions (staking, unstaking, reward distribution) are
          <Hl color="success"> fully permissionless</Hl>. No admin or operator
          approval is needed to withdraw your funds or claim rewards.
        </p>
      </Section>

      {/* How Mining Works */}
      <Section title="How Mining Works">
        <p>
          BOTCOIN uses a <Hl>Proof-of-Inference</Hl> protocol. AI solver bots
          compete in puzzle rounds to earn credits each epoch (24 hours). The more
          credits a miner earns, the larger their share of the epoch reward.
        </p>
        <div className="grid sm:grid-cols-3 gap-3 mt-3">
          <TierCard tier={1} amount="25M" />
          <TierCard tier={2} amount="50M" />
          <TierCard tier={3} amount="100M" />
        </div>
        <p className="text-xs text-muted mt-2">
          Higher tiers may receive priority in challenge assignment. All tiers earn
          credits proportional to successful solves.
        </p>
      </Section>

      {/* Pool Lifecycle */}
      <Section title="Pool Lifecycle">
        <div className="space-y-4">
          <Step num={1} title="Deposit" state="Idle">
            Connect your wallet and deposit BOTCOIN into the pool. Deposits are only
            accepted when the pool is in <StateBadge state="Idle" /> state. Your tokens
            sit in the pool contract until staking is triggered.
          </Step>
          <Step num={2} title="Stake into Mining" state="Idle → Active">
            Anyone can call <Code>Stake → Mining</Code> to push pool deposits into the
            MiningV2 contract. The pool enters <StateBadge state="Active" /> state and
            begins earning credits.
          </Step>
          <Step num={3} title="Mining" state="Active">
            The operator runs an AI solver bot that competes for credits each epoch.
            Credits accrue to the pool contract address. During this phase, deposits
            and withdrawals are locked.
          </Step>
          <Step num={4} title="Request + Execute Unstake" state="Active → Unstaking">
            Anyone can request an unstake at any time. The request is queued until the
            current epoch ends. Once it ends, anyone can execute the unstake, which
            calls <Code>mining.unstake()</Code> and starts the cooldown period (1-3 days).
            This prevents mid-epoch griefing while keeping exits fully permissionless.
          </Step>
          <Step num={5} title="Finalize Withdraw" state="Unstaking → Idle">
            After cooldown expires, anyone can finalize the withdrawal. Tokens return
            from mining to the pool contract. The pool goes back to <StateBadge state="Idle" />.
          </Step>
          <Step num={6} title="Withdraw" state="Idle">
            When the pool is Idle, you can withdraw your principal deposit. Your share
            is tracked on-chain and cannot be taken by anyone else.
          </Step>
        </div>
      </Section>

      {/* Rewards */}
      <Section title="Rewards">
        <p>
          There are two types of rewards:
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <div className="glass-card p-4">
            <h4 className="text-sm font-semibold text-text mb-2">Regular Rewards</h4>
            <p className="text-xs text-text-dim leading-relaxed">
              Each epoch, BOTCOIN rewards are distributed to miners based on their
              credit share. Anyone can trigger <Code>Regular Claim</Code> to pull
              rewards from the mining contract into the pool.
            </p>
          </div>
          <div className="glass-card p-4">
            <h4 className="text-sm font-semibold text-base-blue-light mb-2">Bonus Rewards</h4>
            <p className="text-xs text-text-dim leading-relaxed">
              Approximately 1 in 10 epochs are bonus epochs with extra BOTCOIN rewards.
              Anyone can trigger <Code>Bonus Claim</Code> to claim these. The pool
              distributes them the same way as regular rewards.
            </p>
          </div>
        </div>
        <p className="mt-3">
          After rewards are distributed to the pool, each depositor can claim their
          share at any time by clicking <Code>Claim</Code>. No operator approval needed.
        </p>
      </Section>

      {/* Fees */}
      <Section title="Fees">
        <p>
          Each pool has two fee layers, both taken from rewards only (never from principal):
        </p>
        <ul className="list-none space-y-2 mt-2">
          <li className="flex items-start gap-2 text-sm text-text-dim">
            <span className="text-warn mt-0.5">&#9656;</span>
            <span><Hl color="warn">Operator Fee</Hl> (max 10%): Set by the pool creator. Can only be decreased, never increased.</span>
          </li>
          <li className="flex items-start gap-2 text-sm text-text-dim">
            <span className="text-muted mt-0.5">&#9656;</span>
            <span><Hl>Protocol Fee</Hl> (max 5%): Set at factory level. Immutable after deployment.</span>
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted">
          Fee percentages are visible on each pool&apos;s detail page. Your displayed
          claimable reward is always net of fees.
        </p>
      </Section>

      {/* Security */}
      <Section title="Security">
        <div className="space-y-2">
          <SecurityItem label="Non-custodial">
            The operator cannot access your deposited tokens. Only you can withdraw your share.
          </SecurityItem>
          <SecurityItem label="Permissionless exits">
            All transitions needed to return your principal (unstake, cooldown, finalize, withdraw) can be called by anyone. The operator cannot block exits.
          </SecurityItem>
          <SecurityItem label="On-chain accounting">
            Your deposit share is tracked on-chain via deterministic math. No off-chain databases or admin discretion.
          </SecurityItem>
          <SecurityItem label="EIP-1271 signatures">
            The pool uses EIP-1271 smart contract signatures for coordinator auth. The operator signs challenges, but this only affects mining, not fund custody.
          </SecurityItem>
          <SecurityItem label="Verified contracts">
            All contracts are verified on BaseScan. Source code is public on GitHub.
          </SecurityItem>
        </div>
      </Section>

      {/* FAQ */}
      <Section title="FAQ">
        <div className="space-y-4">
          <Faq q="Can I withdraw at any time?">
            Only when the pool is Idle (not actively staked). If the pool is Active or
            Unstaking, you need to wait for the unstake + cooldown + finalize cycle to
            complete. Anyone can trigger these transitions.
          </Faq>
          <Faq q="What if the operator disappears?">
            The pool will stop earning new credits, but all fund recovery actions are
            permissionless. Anyone can trigger unstake, finalize, and you can withdraw
            your principal without the operator.
          </Faq>
          <Faq q="Can fees be increased?">
            No. Operator fees can only be decreased by the pool owner. Protocol fees
            are immutable.
          </Faq>
          <Faq q="What happens to unclaimed rewards?">
            They stay in the pool contract indefinitely. You can claim at any time,
            there is no expiry.
          </Faq>
          <Faq q="Can I deposit into multiple pools?">
            Yes. Each pool is an independent contract. You can spread your BOTCOIN
            across multiple pools.
          </Faq>
          <Faq q="Why is unstake a two-step process?">
            The spec requires that unstaking only happens at epoch boundaries to prevent
            mid-epoch griefing. Step 1 (Request) queues the intent, step 2 (Execute) fires
            after the epoch ends. Both steps are fully permissionless - anyone can call them.
          </Faq>
        </div>
      </Section>

      {/* Operator Bot */}
      <Section title="Operator Mining Bot">
        <p>
          Each pool needs a running <Hl>mining bot</Hl> to compete in Proof-of-Inference
          challenges and earn credits. Without a bot, the pool will not earn any rewards.
        </p>
        <p>
          When you create a pool, the <Hl color="warn">Bot Setup Wizard</Hl> on the pool
          detail page walks you through everything:
        </p>
        <ul className="list-none space-y-2 mt-2">
          <li className="flex items-start gap-2 text-sm text-text-dim">
            <span className="text-base-blue-light mt-0.5">&#9656;</span>
            <span>Create or connect an operator wallet (e.g. via <a href="https://bankr.bot/terminal" target="_blank" rel="noopener noreferrer" className="text-base-blue-light hover:underline">Bankr</a>)</span>
          </li>
          <li className="flex items-start gap-2 text-sm text-text-dim">
            <span className="text-base-blue-light mt-0.5">&#9656;</span>
            <span>Choose your LLM provider (OpenAI or Anthropic)</span>
          </li>
          <li className="flex items-start gap-2 text-sm text-text-dim">
            <span className="text-base-blue-light mt-0.5">&#9656;</span>
            <span>Generate your <Code>.env</Code> config template</span>
          </li>
          <li className="flex items-start gap-2 text-sm text-text-dim">
            <span className="text-base-blue-light mt-0.5">&#9656;</span>
            <span>Whitelist the <Code>submitReceipt</Code> selector on-chain</span>
          </li>
          <li className="flex items-start gap-2 text-sm text-text-dim">
            <span className="text-base-blue-light mt-0.5">&#9656;</span>
            <span>Download bot files (zip or git clone) and launch</span>
          </li>
        </ul>
        <p className="mt-3">
          The pool detail page shows a live <Hl color="success">Bot Status</Hl> indicator
          that detects whether credits are flowing, so you can confirm the bot is working.
        </p>
      </Section>

      {/* Contract Addresses */}
      <Section title="Contract Addresses">
        <div className="space-y-2">
          <AddrRow label="FactoryV2" addr="0x61A60f14b1C5a84c370184f27445B095c02F19FA" />
          <AddrRow label="BotcoinMiningV2" addr="0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716" />
          <AddrRow label="BonusEpoch" addr="0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8" />
          <AddrRow label="BOTCOIN Token" addr="0xA601877977340862Ca67f816eb079958E5bd0BA3" />
        </div>
        <p className="text-xs text-muted mt-3">
          All contracts are deployed and verified on Base Mainnet.
        </p>
      </Section>

      {/* Links */}
      <div className="glass-card p-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4 text-xs">
          <a href="https://github.com/F-4000/BotcoinPool-E" target="_blank" rel="noopener noreferrer"
            className="text-base-blue-light hover:underline">GitHub Source</a>
          <a href="https://basescan.org/address/0x61A60f14b1C5a84c370184f27445B095c02F19FA#code" target="_blank" rel="noopener noreferrer"
            className="text-base-blue-light hover:underline">Verified on BaseScan</a>
        </div>
        <Link href="/" className="text-xs text-muted hover:text-base-blue-light transition-colors">
          &larr; Back to Pools
        </Link>
      </div>
    </div>
  );
}

/* ── Reusable sub-components ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-5">
      <h2 className="text-base font-semibold text-text mb-3">{title}</h2>
      <div className="space-y-2 text-sm text-text-dim leading-relaxed">{children}</div>
    </div>
  );
}

function Hl({ children, color }: { children: React.ReactNode; color?: "warn" | "success" }) {
  const cls = color === "warn" ? "text-warn" : color === "success" ? "text-success" : "text-base-blue-light";
  return <span className={`${cls} font-medium`}>{children}</span>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-xs bg-white/5 border border-border rounded px-1.5 py-0.5 font-tabular text-base-blue-light">
      {children}
    </code>
  );
}

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    Idle: "text-muted bg-muted/10",
    Active: "text-success bg-success/10",
    Unstaking: "text-warn bg-warn/10",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${colors[state] ?? ""}`}>
      {state}
    </span>
  );
}

function Step({ num, title, state, children }: { num: number; title: string; state: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className="w-6 h-6 rounded-full bg-base-blue/20 border border-base-blue/40 flex items-center justify-center text-xs font-bold text-base-blue-light shrink-0">
          {num}
        </div>
        {num < 6 && <div className="w-px flex-1 bg-border mt-1" />}
      </div>
      <div className="pb-4">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <span className="text-[10px] text-muted font-tabular">{state}</span>
        </div>
        <p className="text-xs text-text-dim leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

function TierCard({ tier, amount }: { tier: number; amount: string }) {
  return (
    <div className="glass-card p-3 text-center">
      <p className="text-xs text-muted uppercase tracking-wide">Tier {tier}</p>
      <p className="text-lg font-bold text-text font-tabular mt-1">{amount}</p>
      <p className="text-[10px] text-muted">BOTCOIN staked</p>
    </div>
  );
}

function SecurityItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-success mt-0.5 text-xs">&#10003;</span>
      <div>
        <span className="text-sm text-text font-medium">{label}</span>
        <p className="text-xs text-text-dim mt-0.5">{children}</p>
      </div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-text">{q}</h4>
      <p className="text-xs text-text-dim mt-1 leading-relaxed">{children}</p>
    </div>
  );
}

function AddrRow({ label, addr }: { label: string; addr: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border last:border-b-0">
      <span className="text-xs text-muted">{label}</span>
      <a
        href={`https://basescan.org/address/${addr}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-base-blue-light font-tabular hover:underline"
      >
        {addr.slice(0, 10)}...{addr.slice(-8)}
      </a>
    </div>
  );
}
