"use client";

import { useState, useEffect, useMemo } from "react";
import { useAccount } from "wagmi";
import { fmtToken, shortAddr } from "@/lib/utils";
import Link from "next/link";
import BotStatus from "@/components/BotStatus";

const POOL_STATES = ["Idle", "Active", "Unstaking", "Finalized"] as const;
const EPOCH_DURATION = 86_400; // 24 hours in seconds

const STATE_BADGES: Record<string, { color: string; bg: string }> = {
  Idle: { color: "text-muted", bg: "bg-muted/10" },
  Active: { color: "text-success", bg: "bg-success/10" },
  Unstaking: { color: "text-warn", bg: "bg-warn/10" },
  Finalized: { color: "text-base-blue-light", bg: "bg-base-blue/10" },
};

function compactNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

function fmtTime(seconds: number): string {
  if (seconds <= 0) return "0m";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtTimeLong(seconds: number): string {
  if (seconds <= 0) return "0m";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

interface PoolRowProps {
  address: `0x${string}`;
  poolStateNum?: number;
  stakedInMiningWei?: string;
  totalDepWei?: string;
  eligible?: boolean;
  minActiveEpochs?: number;
  stakedAtEpoch?: number;
  feeBps?: number;
  operator?: `0x${string}`;
  owner?: `0x${string}`;
  maxStakeWei?: string;
  creditsWei?: string;
  sharePercent?: number;
  currentEpoch?: number;
  genesisTs?: number;
  botStatus?: "live" | "active" | "idle" | "offline";
}

export default function PoolRow({
  address,
  poolStateNum,
  stakedInMiningWei,
  totalDepWei,
  eligible,
  minActiveEpochs,
  stakedAtEpoch,
  feeBps,
  operator,
  owner,
  maxStakeWei,
  creditsWei,
  sharePercent,
  currentEpoch,
  genesisTs,
  botStatus,
}: PoolRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { address: walletAddr } = useAccount();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const stateName = POOL_STATES[poolStateNum ?? 0] ?? "Idle";
  const stakedInMining = stakedInMiningWei ? BigInt(stakedInMiningWei) : 0n;
  const totalDep = totalDepWei ? BigInt(totalDepWei) : 0n;
  const maxStake = maxStakeWei ? BigInt(maxStakeWei) : undefined;
  const credits = creditsWei ? BigInt(creditsWei) : undefined;

  const feePercent = feeBps !== undefined ? feeBps / 100 : undefined;
  const totalStake = totalDep;

  const lockEpochs = minActiveEpochs ?? 0;
  const stakedAt = stakedAtEpoch ?? 0;
  const unlockEpoch = stakedAt > 0 && lockEpochs > 0 ? stakedAt + lockEpochs : 0;
  const epochsLeft = currentEpoch !== undefined && unlockEpoch > 0
    ? Math.max(0, unlockEpoch - currentEpoch + 1)
    : 0;

  useEffect(() => {
    if (epochsLeft <= 0 || genesisTs === undefined) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [epochsLeft, genesisTs]);

  const lockSecondsLeft = useMemo(() => {
    if (genesisTs === undefined || epochsLeft <= 0 || unlockEpoch <= 0) return 0;
    const lockExpiresAt = genesisTs + (unlockEpoch + 1) * EPOCH_DURATION;
    return Math.max(0, lockExpiresAt - now);
  }, [genesisTs, unlockEpoch, epochsLeft, now]);

  const isCapped = maxStake !== undefined && maxStake > 0n;
  const capPercent = isCapped && maxStake > 0n ? Number((totalStake * 100n) / maxStake) : 0;
  const isFull = isCapped && totalStake >= maxStake;

  const tier = stakedInMining >= 100_000_000n * 10n ** 18n ? 3
    : stakedInMining >= 50_000_000n * 10n ** 18n ? 2
    : stakedInMining >= 25_000_000n * 10n ** 18n ? 1
    : 0;

  const badge = STATE_BADGES[stateName] ?? STATE_BADGES.Idle;
  const isOwner = !!(walletAddr && (
    (operator && walletAddr.toLowerCase() === operator.toLowerCase()) ||
    (owner && walletAddr.toLowerCase() === owner.toLowerCase())
  ));

  // Grid class shared between header and rows
  const gridCols = "grid-cols-[1fr_2rem] sm:grid-cols-[10rem_7rem_5rem_1fr_3.5rem_3.5rem_7rem_2rem]";

  return (
    <div className={`border-l-[3px] ${isOwner ? "border-l-yellow-400 bg-yellow-400/[0.04]" : "border-l-transparent"}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full grid items-center gap-x-4 px-5 py-3 hover:bg-card-hover transition-colors text-left cursor-pointer ${gridCols}`}
      >
        {/* Pool: dot + address + You badge */}
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${
            stateName === "Active" ? "bg-success pulse-dot" :
            stateName === "Unstaking" ? "bg-warn pulse-dot" :
            stateName === "Finalized" ? "bg-base-blue-light" :
            isFull ? "bg-danger" : "bg-muted"
          }`} />
          <span className="text-sm font-semibold text-base-blue-light font-tabular truncate">
            {shortAddr(address)}
          </span>
          {isOwner && (
            <span className="text-[9px] font-semibold uppercase tracking-wider text-yellow-300 bg-yellow-400/10 px-1.5 py-0.5 rounded shrink-0">
              You
            </span>
          )}
        </div>

        {/* Status: state badge only */}
        <div className="hidden sm:flex items-center">
          <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${badge.color} ${badge.bg}`}>
            {stateName}
          </span>
        </div>

        {/* Agent: bot status */}
        <div className="hidden sm:flex items-center">
          {stateName === "Active" && currentEpoch !== undefined && (
            <BotStatus
              poolAddress={address}
              currentEpoch={currentEpoch}
              compact
              statusOverride={botStatus}
            />
          )}
        </div>

        {/* Staked */}
        <span className="text-sm text-text font-tabular text-right hidden sm:block ml-auto">
          {fmtToken(stakedInMining)}
        </span>

        {/* Fee */}
        <span className="text-xs font-tabular text-right hidden sm:block">
          {feePercent !== undefined && feePercent > 0
            ? <span className="text-warn font-medium">{feePercent}%</span>
            : <span className="text-muted">0%</span>}
        </span>

        {/* Share */}
        <span className="text-xs font-tabular text-right hidden sm:block">
          {credits && credits > 0n && sharePercent !== undefined && sharePercent > 0
            ? <span className="text-success font-semibold">{sharePercent.toFixed(1)}%</span>
            : <span className="text-muted">-</span>}
        </span>

        {/* Capacity bar */}
        <div className="hidden sm:flex items-center gap-2">
          {isCapped ? (
            <>
              <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    isFull ? "bg-danger" : capPercent > 80 ? "bg-warn" : "bg-success"
                  }`}
                  style={{ width: `${Math.min(capPercent, 100)}%` }}
                />
              </div>
              <span className={`text-[10px] font-tabular shrink-0 ${isFull ? "text-danger" : "text-muted"}`}>
                {capPercent}%
              </span>
            </>
          ) : (
            <span className="text-[10px] text-muted ml-auto">-</span>
          )}
        </div>

        {/* Chevron */}
        <div className="flex items-center justify-end">
          <svg
            className={`w-3.5 h-3.5 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div className="px-5 pb-4 pt-3 bg-surface space-y-3">
          {/* Stake info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Staked in Mining</p>
              <p className="text-text font-semibold font-tabular">{fmtToken(stakedInMining)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Total Deposits</p>
              <p className="text-text font-semibold font-tabular">{fmtToken(totalDep)}</p>
            </div>
            {isCapped && (
              <div>
                <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Pool Cap</p>
                <p className="text-text-dim font-semibold font-tabular">
                  {fmtToken(totalStake)} / {fmtToken(maxStake)}
                </p>
              </div>
            )}
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Eligible</p>
              <p className={`font-semibold font-tabular ${eligible ? "text-success" : "text-muted"}`}>
                {eligible ? "Yes" : "No"}
              </p>
            </div>
          </div>

          {/* Mining performance */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Credits</p>
              <p className="text-text font-semibold font-tabular">
                {credits && credits > 0n ? Number(credits).toLocaleString() : "0"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Reward Share</p>
              <p className={`font-semibold font-tabular ${sharePercent && sharePercent > 0 ? "text-success" : "text-muted"}`}>
                {sharePercent && sharePercent > 0 ? `${sharePercent.toFixed(2)}%` : "-"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Tier</p>
              <p className={`font-semibold font-tabular ${tier > 0 ? "text-success" : "text-muted"}`}>
                {tier > 0 ? `Tier ${tier}` : "-"}
              </p>
            </div>
            {currentEpoch !== undefined && (
              <div>
                <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Bot</p>
                <BotStatus
                  poolAddress={address}
                  currentEpoch={currentEpoch}
                  compact
                  statusOverride={botStatus}
                />
              </div>
            )}
          </div>

          {/* Lock status bar */}
          {lockEpochs > 0 && stateName === "Active" && (
            <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-surface border border-border">
              <span className="text-[10px] text-muted uppercase tracking-wide shrink-0">Lock</span>
              {lockSecondsLeft > 0 ? (
                <>
                  <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full rounded-full bg-warn"
                      style={{ width: `${Math.min(100, ((lockEpochs * EPOCH_DURATION - lockSecondsLeft) / (lockEpochs * EPOCH_DURATION)) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-warn font-tabular font-semibold shrink-0">
                    {fmtTimeLong(lockSecondsLeft)}
                  </span>
                </>
              ) : (
                <span className="text-xs text-success font-semibold">Unlocked</span>
              )}
            </div>
          )}

          {/* Operator + full address */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3">
              {operator && (
                <p className="text-xs text-muted">
                  Operator: <span className="text-text-dim font-tabular">{shortAddr(operator)}</span>
                </p>
              )}
              <p className="text-[10px] text-muted font-tabular break-all hidden sm:block">{address}</p>
            </div>
            <Link href={`/pool/${address}`} className="shrink-0 btn-ghost px-3 py-1.5 text-xs">
              Open Pool &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
