"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { factoryAbi, poolAbi, miningAbi } from "@/lib/contracts";
import { FACTORY_ADDRESS, MINING_ADDRESS } from "@/lib/config";
import { shortAddr } from "@/lib/utils";

const EPOCH_DURATION = 86_400;

/** Compact number display */
function compactNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

/** Format token bigint compactly */
function fmtCompact(value: bigint | undefined): string {
  if (value === undefined || value === 0n) return "0";
  const num = Number(formatUnits(value, 18));
  return compactNum(num);
}

export default function Scoreboard() {
  // ── Factory: get all pool addresses ──
  const { data: pools } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "getPools",
  });

  // ── Mining: current epoch + genesis + totalCredits ──
  const { data: miningBase } = useReadContracts({
    contracts: [
      { address: MINING_ADDRESS, abi: miningAbi, functionName: "currentEpoch" },
      { address: MINING_ADDRESS, abi: miningAbi, functionName: "genesisTimestamp" },
    ],
    query: { refetchInterval: 15_000 },
  });

  const currentEpoch = miningBase?.[0]?.result as bigint | undefined;
  const genesisTs = miningBase?.[1]?.result as bigint | undefined;
  const epochNum = currentEpoch !== undefined ? Number(currentEpoch) : undefined;

  // ── Per-pool queries: credits, nextIndex, totalActiveStake, epochCommit ──
  const poolQueries = useMemo(() => {
    if (!pools || pools.length === 0 || epochNum === undefined) return [];
    return pools.flatMap((addr) => [
      {
        address: MINING_ADDRESS,
        abi: miningAbi,
        functionName: "credits" as const,
        args: [BigInt(epochNum), addr] as const,
      },
      {
        address: MINING_ADDRESS,
        abi: miningAbi,
        functionName: "nextIndex" as const,
        args: [addr] as const,
      },
      {
        address: addr,
        abi: poolAbi,
        functionName: "getPoolInfo" as const,
      },
    ]);
  }, [pools, epochNum]);

  const { data: poolResults } = useReadContracts({
    contracts: poolQueries,
    query: { enabled: poolQueries.length > 0, refetchInterval: 10_000 },
  });

  // ── Total credits this epoch ──
  const { data: totalCreditsData } = useReadContract({
    address: MINING_ADDRESS,
    abi: miningAbi,
    functionName: "totalCredits",
    args: epochNum !== undefined ? [BigInt(epochNum)] : undefined,
    query: { enabled: epochNum !== undefined, refetchInterval: 10_000 },
  });
  const totalCredits = totalCreditsData as bigint | undefined;

  // Epoch is active if we have a valid epoch number
  const epochActive = epochNum !== undefined && epochNum > 0;

  // ── Build sorted pool rows ──
  const rows = useMemo(() => {
    if (!pools || !poolResults || epochNum === undefined) return [];

    return pools
      .map((addr, i) => {
        const credits = (poolResults[i * 3]?.result as bigint) ?? 0n;
        const solveCount = (poolResults[i * 3 + 1]?.result as bigint) ?? 0n;
        const poolInfoResult = poolResults[i * 3 + 2]?.result as readonly [number, bigint, bigint, bigint, bigint, boolean, bigint, bigint] | undefined;
        const activeStake = poolInfoResult?.[1] ?? 0n; // stakedInMining from getPoolInfo
        const creditsNum = Number(credits);
        const totalNum = totalCredits ? Number(totalCredits) : 0;
        const sharePercent = totalNum > 0 ? (creditsNum / totalNum) * 100 : 0;
        const isActive = credits > 0n;

        return {
          addr,
          credits,
          solveCount: Number(solveCount),
          activeStake,
          sharePercent,
          isActive,
        };
      })
      .sort((a, b) => {
        // Active solvers first, then by credits desc
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return Number(b.credits - a.credits);
      });
  }, [pools, poolResults, epochNum, totalCredits]);

  // ── Epoch timing ──
  const epochProgress = useMemo(() => {
    if (genesisTs === undefined || currentEpoch === undefined) return 0;
    const now = Math.floor(Date.now() / 1000);
    const epochStart = Number(genesisTs) + Number(currentEpoch) * EPOCH_DURATION;
    const elapsed = now - epochStart;
    return Math.min(100, Math.max(0, (elapsed / EPOCH_DURATION) * 100));
  }, [genesisTs, currentEpoch]);

  // ── Loading / unset states ──
  if (FACTORY_ADDRESS === "0x0000000000000000000000000000000000000000") {
    return (
      <div className="glass-card p-6 text-center">
        <p className="text-warn text-sm font-medium mb-2">Factory address not set</p>
        <p className="text-xs text-muted">Deploy and configure factory first.</p>
      </div>
    );
  }

  if (!pools || epochNum === undefined) {
    return (
      <div className="space-y-3">
        <div className="loading-bar" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  const activeSolvers = rows.filter((r) => r.isActive).length;

  return (
    <div className="space-y-4">
      {/* Epoch status bar */}
      <div className="gradient-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${epochActive ? "bg-success pulse-dot" : "bg-warn"}`} />
            <span className="text-sm font-semibold text-text">
              Epoch {epochNum}
            </span>
            <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${
              epochActive ? "text-success bg-success/10" : "text-warn bg-warn/10"
            }`}>
              {epochActive ? "Active" : "Pending"}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted">
            <span>
              <span className="text-text font-semibold">{activeSolvers}</span> active solver{activeSolvers !== 1 ? "s" : ""}
            </span>
            <span>
              Total credits: <span className="text-text font-semibold font-tabular">{totalCredits ? compactNum(Number(totalCredits)) : "0"}</span>
            </span>
          </div>
        </div>

        {/* Epoch progress bar */}
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full bg-linear-to-r from-base-blue to-indigo transition-all"
            style={{ width: `${epochProgress}%` }}
          />
        </div>
        <p className="text-[10px] text-muted mt-1 text-right font-tabular">
          {epochProgress.toFixed(0)}% elapsed
        </p>
      </div>

      {/* Pool scoreboard */}
      <div>
        <p className="text-xs text-muted mb-2">
          {pools.length} pool{pools.length !== 1 ? "s" : ""} · sorted by credits
        </p>

        {/* Column headers */}
        <div className="flex items-center gap-3 px-4 py-2 text-[10px] text-muted uppercase tracking-wider border-b border-border">
          <span className="w-6 text-center">#</span>
          <span className="w-6" />
          <span className="w-28">Pool</span>
          <span className="min-w-20 hidden sm:block">Credits</span>
          <span className="w-16 text-right hidden sm:block">Share</span>
          <span className="min-w-16 text-right hidden md:block">Solves</span>
          <span className="flex-1 max-w-40 hidden lg:block">Stake</span>
          <span className="ml-auto w-20 text-right">Status</span>
        </div>

        {/* Rows */}
        <div className="glass-card overflow-hidden">
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted">
              No pools deployed yet
            </div>
          ) : (
            rows.map((row, idx) => (
              <div
                key={row.addr}
                className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 transition-colors ${
                  row.isActive ? "hover:bg-card-hover/50" : "opacity-50"
                }`}
              >
                {/* Rank */}
                <span className={`w-6 text-center text-xs font-bold font-tabular ${
                  idx === 0 && row.isActive ? "text-warn" : idx === 1 && row.isActive ? "text-text-dim" : idx === 2 && row.isActive ? "text-warn/60" : "text-muted"
                }`}>
                  {idx + 1}
                </span>

                {/* Status dot */}
                <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  row.isActive ? "bg-success pulse-dot" : "bg-muted"
                }`} />

                {/* Pool address */}
                <span className="text-sm font-semibold text-base-blue-light font-tabular w-28 shrink-0">
                  {shortAddr(row.addr)}
                </span>

                {/* Credits this epoch */}
                <span className="text-sm text-text font-tabular min-w-20 hidden sm:block">
                  {row.credits > 0n ? compactNum(Number(row.credits)) : "-"}
                </span>

                {/* Share % */}
                <span className={`text-xs font-tabular w-16 text-right hidden sm:block ${
                  row.sharePercent > 0 ? "text-success font-semibold" : "text-muted"
                }`}>
                  {row.sharePercent > 0 ? `${row.sharePercent.toFixed(1)}%` : "-"}
                </span>

                {/* Total solves */}
                <span className="text-xs text-text-dim font-tabular min-w-16 text-right hidden md:block">
                  {row.solveCount > 0 ? compactNum(row.solveCount) : "0"}
                </span>

                {/* Stake */}
                <span className="text-xs text-text-dim font-tabular flex-1 max-w-40 hidden lg:block">
                  {fmtCompact(row.activeStake)} BOTCOIN
                </span>

                {/* Status badge */}
                <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded w-20 text-center ${
                  row.isActive
                    ? "text-success bg-success/10"
                    : "text-muted bg-white/5"
                }`}>
                  {row.isActive ? "Solving" : "Idle"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-[10px] text-muted px-1">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
          <span>Solving: earned credits this epoch</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-muted" />
          <span>Idle: no credits yet</span>
        </div>
        <span>Updates every 10s · all data from Base mainnet</span>
      </div>
    </div>
  );
}
