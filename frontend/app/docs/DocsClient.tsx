"use client";

import { useState, useEffect, useRef } from "react";

const FACTORY_ADDRESS =
  process.env.NEXT_PUBLIC_FACTORY_ADDRESS ||
  "0x1C3aC690656c1573b1BB20446d5793F4d41967Ee";

/* ── Table of Contents definition ── */
const TOC = [
  { id: "overview", label: "Overview" },
  { id: "mining", label: "How Mining Works" },
  { id: "lifecycle", label: "Pool Lifecycle" },
  { id: "rewards", label: "Rewards" },
  { id: "fees", label: "Fees" },
  { id: "security", label: "Security" },
  { id: "operator", label: "Operator Bot" },
  { id: "contracts", label: "Contracts" },
  { id: "faq", label: "FAQ" },
] as const;

export default function DocsClient() {
  const [activeSection, setActiveSection] = useState("overview");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const sections = TOC.map((t) => document.getElementById(t.id)).filter(Boolean) as HTMLElement[];
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );
    sections.forEach((s) => observerRef.current!.observe(s));
    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex gap-8">
        {/* ── Sidebar TOC (desktop) ── */}
        <aside className="hidden lg:block w-52 shrink-0 self-start sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto">
          <nav className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-3 px-3">
              On this page
            </p>
            {TOC.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  if (item.id === "overview") {
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  } else {
                    document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" });
                  }
                }}
                className={`block text-[13px] py-1.5 px-3 rounded-md transition-colors ${
                  activeSection === item.id
                    ? "text-base-blue-light bg-base-blue/8 border-l-2 border-base-blue-light"
                    : "text-muted hover:text-text-dim hover:bg-surface"
                }`}
              >
                {item.label}
              </a>
            ))}
            <div className="h-px bg-border my-4" />
            <a
              href="https://github.com/F-4000/BotcoinPool-E"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-[12px] text-muted hover:text-text-dim px-3 py-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
              GitHub Source
            </a>
            <a
              href={`https://basescan.org/address/${FACTORY_ADDRESS}#code`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-[12px] text-muted hover:text-text-dim px-3 py-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
              BaseScan
            </a>
          </nav>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 min-w-0 space-y-8 pb-20">
          {/* Header */}
          <div className="border-b border-border pb-6" id="overview">
            <h1 className="text-2xl sm:text-3xl font-bold text-text tracking-tight">
              Documentation
            </h1>
            <p className="text-sm text-muted mt-2 max-w-xl">
              Everything you need to know about Botcoin Pool: how it works, the lifecycle,
              fees, security model, and how to run an operator bot.
            </p>
          </div>

          {/* Overview */}
          <DocSection>
            <p>
              Botcoin Pool is a <Hl>trustless, single-use pooled mining</Hl> contract on Base.
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
            <Callout type="info">
              Each pool is <strong>single-use</strong>: once finalized, it cannot be
              restaked. Depositors withdraw and join a new pool to continue mining.
              This prevents griefing where someone re-locks funds after an unstake cycle.
            </Callout>
          </DocSection>

          {/* How Mining Works */}
          <DocSection id="mining" title="How Mining Works">
            <p>
              BOTCOIN uses a <Hl>Proof-of-Inference</Hl> protocol. AI solver bots
              compete in puzzle rounds to earn credits each epoch (24 hours). The more
              credits a miner earns, the larger their share of the epoch reward.
            </p>
            <div className="grid sm:grid-cols-3 gap-3 mt-4">
              <TierCard tier={1} amount="25M" />
              <TierCard tier={2} amount="50M" />
              <TierCard tier={3} amount="100M" />
            </div>
            <p className="text-xs text-muted mt-3">
              Higher tiers may receive priority in challenge assignment. All tiers earn
              credits proportional to successful solves.
            </p>
          </DocSection>

          {/* Pool Lifecycle */}
          <DocSection id="lifecycle" title="Pool Lifecycle">
            <div className="space-y-0">
              <Step num={1} title="Deposit" tag="Idle">
                Connect your wallet and deposit BOTCOIN. Deposits are only accepted when the pool is <Badge state="Idle" />.
                Your tokens sit in the pool contract until staking is triggered.
              </Step>
              <Step num={2} title="Stake into Mining" tag="Idle → Active">
                Anyone can call <Code>Stake → Mining</Code> to push pool deposits into the
                MiningV2 contract. The pool enters <Badge state="Active" /> and begins earning credits.
              </Step>
              <Step num={3} title="Mining" tag="Active">
                The operator runs an AI solver bot that competes for credits each epoch.
                During this phase, deposits and withdrawals are locked.
              </Step>
              <Step num={4} title="Request + Execute Unstake" tag="Active → Unstaking">
                Anyone can request an unstake. The request queues until the current epoch ends.
                Then anyone can execute it, calling <Code>mining.unstake()</Code> and starting
                the cooldown period (1-3 days). Fully permissionless.
              </Step>
              <Step num={5} title="Finalize Withdraw" tag="Unstaking → Finalized">
                After cooldown, anyone can finalize the withdrawal. Tokens return
                to the pool contract. The pool enters terminal <Badge state="Finalized" />.
              </Step>
              <Step num={6} title="Withdraw" tag="Finalized" last>
                Withdraw your principal deposit. Withdrawing automatically claims
                pending rewards in the same transaction. Join a new pool to continue mining.
              </Step>
            </div>
          </DocSection>

          {/* Rewards */}
          <DocSection id="rewards" title="Rewards">
            <p>There are two types of rewards:</p>
            <div className="grid sm:grid-cols-2 gap-3 mt-4">
              <div className="rounded-lg bg-surface border border-border p-4">
                <h4 className="text-sm font-semibold text-text mb-2">Regular Rewards</h4>
                <p className="text-xs text-text-dim leading-relaxed">
                  Each epoch, BOTCOIN rewards are distributed to miners based on their
                  credit share. Anyone can trigger <Code>Regular Claim</Code> to pull
                  rewards from the mining contract into the pool.
                </p>
              </div>
              <div className="rounded-lg bg-surface border border-border p-4">
                <h4 className="text-sm font-semibold text-base-blue-light mb-2">Bonus Rewards</h4>
                <p className="text-xs text-text-dim leading-relaxed">
                  ~1 in 10 epochs are bonus epochs with extra BOTCOIN rewards.
                  Anyone can trigger <Code>Bonus Claim</Code>. Distributed the same
                  way as regular rewards.
                </p>
              </div>
            </div>
            <p className="mt-3">
              After rewards are distributed to the pool, each depositor can claim their
              share at any time via <Code>Claim</Code>. No operator approval needed.
            </p>
          </DocSection>

          {/* Fees */}
          <DocSection id="fees" title="Fees">
            <p>
              Each pool has two fee layers, both taken <Hl color="success">only from rewards</Hl>, never from principal deposits:
            </p>
            <div className="mt-4 rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider">Fee</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider">Current</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider">Max</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider hidden sm:table-cell">Rules</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-4 py-3 text-text font-medium">Protocol Fee</td>
                    <td className="px-4 py-3 font-tabular"><span className="text-base-blue-light font-semibold">1%</span></td>
                    <td className="px-4 py-3 text-text-dim font-tabular">5%</td>
                    <td className="px-4 py-3 text-xs text-text-dim hidden sm:table-cell">Immutable after factory deployment</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-text font-medium">Operator Fee</td>
                    <td className="px-4 py-3 font-tabular"><span className="text-warn font-semibold">0.5%</span> <span className="text-[10px] text-muted">(default)</span></td>
                    <td className="px-4 py-3 text-text-dim font-tabular">10%</td>
                    <td className="px-4 py-3 text-xs text-text-dim hidden sm:table-cell">Set by pool creator; can only decrease</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Callout type="info">
              The protocol fee (1%) is set at the factory contract level and cannot be changed after deployment.
              Operator fees are set per pool and can only be <em>decreased</em> by the pool owner, never increased.
              Fee percentages are visible on each pool&apos;s detail page.
            </Callout>
          </DocSection>

          {/* Security */}
          <DocSection id="security" title="Security">
            <div className="space-y-3">
              <SecurityItem title="Non-custodial">
                The operator cannot access your deposited tokens. Only you can withdraw your share.
              </SecurityItem>
              <SecurityItem title="Permissionless exits">
                All transitions needed to return your principal (unstake, cooldown, finalize, withdraw)
                can be called by anyone. The operator cannot block exits.
              </SecurityItem>
              <SecurityItem title="On-chain accounting">
                Your deposit share is tracked on-chain via deterministic math. No off-chain databases
                or admin discretion.
              </SecurityItem>
              <SecurityItem title="EIP-1271 signatures">
                The pool uses EIP-1271 smart contract signatures for coordinator auth. The operator
                signs challenges, but this only affects mining, not fund custody.
              </SecurityItem>
              <SecurityItem title="Verified contracts">
                All contracts are verified on BaseScan. Source code is public on GitHub.
              </SecurityItem>
            </div>
          </DocSection>

          {/* Operator Bot */}
          <DocSection id="operator" title="Operator Mining Bot">
            <p>
              Each pool needs a running <Hl>mining bot</Hl> to compete in Proof-of-Inference
              challenges and earn credits. Without a bot, the pool will not earn any rewards.
            </p>

            <h3 className="text-sm font-semibold text-text mt-5 mb-3">Running a Miner</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg bg-surface border border-border p-4">
                <h4 className="text-sm font-semibold text-success mb-2">🤖 AI Agent Skill</h4>
                <p className="text-xs text-text-dim leading-relaxed">
                  Install the BOTCOIN miner skill on an AI agent
                  (<a href="https://bankr.bot/terminal" target="_blank" rel="noopener noreferrer" className="text-base-blue-light hover:underline">Bankr</a>,
                  OpenClaw, or ClawHub). The agent handles challenges, solving, and on-chain submission automatically.
                </p>
                <div className="mt-3 space-y-1.5 text-[11px] font-tabular bg-card rounded-md p-3 border border-border">
                  <p className="text-muted"><span className="text-text-dim">Bankr:</span> &quot;install the botcoin-miner skill from https://agentmoney.net/skill.md&quot;</p>
                  <p className="text-muted"><span className="text-text-dim">npx:</span> npx skills add botcoinmoney/botcoin-miner-skill</p>
                  <p className="text-muted"><span className="text-text-dim">ClawHub:</span> clawhub install botcoin-miner-skill</p>
                </div>
              </div>
              <div className="rounded-lg bg-surface border border-border p-4">
                <h4 className="text-sm font-semibold text-base-blue-light mb-2">⚙️ Standalone Node.js Bot</h4>
                <p className="text-xs text-text-dim leading-relaxed">
                  Download the bot files (zip or git clone), configure your <Code>.env</Code> with
                  API keys, and run <Code>node bot.js</Code> on any always-on machine.
                  Full control over the mining loop.
                </p>
              </div>
            </div>

            <Callout type="warn">
              Both methods require a <strong>Bankr API key</strong> for on-chain transaction execution.
              The <strong>Bot Setup Wizard</strong> on each pool detail page walks you through either option.
            </Callout>

            <p className="mt-2">
              The pool detail page shows a live <Hl color="success">Bot Status</Hl> indicator
              that detects whether credits are flowing, so you can confirm your bot is working.
            </p>
          </DocSection>

          {/* Contracts */}
          <DocSection id="contracts" title="Contract Addresses">
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface text-left">
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider">Contract</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider">Address</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <AddrRow label="FactoryV3" addr={FACTORY_ADDRESS} />
                  <AddrRow label="BotcoinMiningV2" addr="0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716" />
                  <AddrRow label="BonusEpoch" addr="0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8" />
                  <AddrRow label="BOTCOIN Token" addr="0xA601877977340862Ca67f816eb079958E5bd0BA3" />
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted mt-3">
              All contracts are deployed and verified on <a href="https://basescan.org" target="_blank" rel="noopener noreferrer" className="text-base-blue-light hover:underline">Base Mainnet</a>.
            </p>
          </DocSection>

          {/* FAQ */}
          <DocSection id="faq" title="FAQ">
            <div className="space-y-0">
              <FaqItem q="Can I withdraw at any time?">
                Only when the pool is Idle (before staking) or Finalized (after the full
                unstake → cooldown → finalize cycle). If the pool is Active or Unstaking,
                you need to wait. Anyone can trigger the transitions to move toward Finalized.
              </FaqItem>
              <FaqItem q="What if the operator disappears?">
                The pool will stop earning new credits, but all fund recovery actions are
                permissionless. Anyone can trigger unstake, finalize, and you can withdraw
                your principal without the operator.
              </FaqItem>
              <FaqItem q="Can fees be increased?">
                No. Operator fees can only be decreased by the pool owner. The protocol fee (1%)
                is immutable. It was set at factory deployment and cannot be changed.
              </FaqItem>
              <FaqItem q="What happens to unclaimed rewards?">
                They stay in the pool contract indefinitely. You can claim at any time.
                When you withdraw in Finalized state, rewards are auto-claimed in the same
                transaction.
              </FaqItem>
              <FaqItem q="Can I deposit into multiple pools?">
                Yes. Each pool is an independent contract. You can spread your BOTCOIN
                across multiple pools.
              </FaqItem>
              <FaqItem q="Why is the pool single-use?">
                To prevent a griefing attack where someone re-stakes funds immediately after
                an unstake cycle completes, locking depositors out of withdrawals. Once finalized,
                depositors are guaranteed access to their funds.
              </FaqItem>
              <FaqItem q="Why is unstake a two-step process?">
                Unstaking only happens at epoch boundaries to prevent mid-epoch griefing.
                Step 1 (Request) queues the intent, step 2 (Execute) fires after the epoch ends.
                Both steps are fully permissionless.
              </FaqItem>
            </div>
          </DocSection>

        </main>
      </div>

    </div>
  );
}

/* ═══ Sub-components ═══ */

function DocSection({ id, title, children }: { id?: string; title?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      {title && (
        <h2 className="text-lg font-semibold text-text mb-4 pb-2 border-b border-border">
          {title}
        </h2>
      )}
      <div className="space-y-3 text-sm text-text-dim leading-relaxed">{children}</div>
    </section>
  );
}

function Hl({ children, color }: { children: React.ReactNode; color?: "warn" | "success" }) {
  const cls = color === "warn" ? "text-warn" : color === "success" ? "text-success" : "text-base-blue-light";
  return <span className={`${cls} font-medium`}>{children}</span>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-xs bg-surface border border-border rounded px-1.5 py-0.5 font-tabular text-base-blue-light">
      {children}
    </code>
  );
}

function Callout({ type, children }: { type: "info" | "warn"; children: React.ReactNode }) {
  const styles = {
    info: "border-l-base-blue-light/40 bg-base-blue/5",
    warn: "border-l-warn/40 bg-warn/5",
  };
  return (
    <div className={`mt-4 border-l-2 ${styles[type]} rounded-r-md py-3 px-4 text-xs text-text-dim leading-relaxed`}>
      {children}
    </div>
  );
}

function Badge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    Idle: "text-muted bg-muted/10",
    Active: "text-success bg-success/10",
    Unstaking: "text-warn bg-warn/10",
    Finalized: "text-base-blue-light bg-base-blue/10",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${colors[state] ?? ""}`}>
      {state}
    </span>
  );
}

function Step({ num, title, tag, last, children }: { num: number; title: string; tag: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg bg-surface border border-border p-4 ${!last ? "mb-2" : ""}`}>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs font-bold text-base-blue-light font-tabular bg-base-blue/10 px-2 py-0.5 rounded">
          Step {num}
        </span>
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <span className="text-[10px] text-muted font-tabular ml-auto">{tag}</span>
      </div>
      <p className="text-xs text-text-dim leading-relaxed">{children}</p>
    </div>
  );
}

function TierCard({ tier, amount }: { tier: number; amount: string }) {
  return (
    <div className="rounded-lg bg-surface border border-border p-3 text-center">
      <p className="text-[10px] text-muted uppercase tracking-wide">Tier {tier}</p>
      <p className="text-lg font-bold text-text font-tabular mt-1">{amount}</p>
      <p className="text-[10px] text-muted">BOTCOIN staked</p>
    </div>
  );
}

function SecurityItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-b-0">
      <span className="text-success mt-0.5 text-xs shrink-0">✓</span>
      <div>
        <span className="text-sm text-text font-medium">{title}</span>
        <p className="text-xs text-text-dim mt-0.5">{children}</p>
      </div>
    </div>
  );
}

function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3.5 text-left group"
      >
        <h4 className="text-sm font-medium text-text group-hover:text-base-blue-light transition-colors">{q}</h4>
        <svg
          className={`w-4 h-4 text-muted shrink-0 ml-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="pb-4 text-xs text-text-dim leading-relaxed">{children}</div>
      )}
    </div>
  );
}

function AddrRow({ label, addr }: { label: string; addr: string }) {
  return (
    <tr>
      <td className="px-4 py-3 text-text-dim">{label}</td>
      <td className="px-4 py-3">
        <a
          href={`https://basescan.org/address/${addr}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-base-blue-light font-tabular hover:underline text-xs sm:text-sm"
        >
          <span className="hidden sm:inline">{addr}</span>
          <span className="sm:hidden">{addr.slice(0, 10)}…{addr.slice(-8)}</span>
        </a>
      </td>
    </tr>
  );
}
