"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { factoryAbi, poolAbi, miningAbi } from "@/lib/contracts";
import { FACTORY_ADDRESS, MINING_ADDRESS } from "@/lib/config";
import { shortAddr } from "@/lib/utils";
import Link from "next/link";

const SCOREBOARD_POLL_MS = 10_000;
const EPOCH_DURATION = 86_400;

function compactNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

function fmtCompact(value: bigint | undefined): string {
  if (value === undefined || value === 0n) return "0";
  return compactNum(Number(formatUnits(value, 18)));
}

const RANK_STYLES: Record<number, { card: string; accent: string; badge: string; text: string }> = {
  0: { card: "bg-yellow-400/[0.04] border-yellow-400/15", accent: "bg-yellow-400", badge: "text-yellow-300 bg-yellow-400/15", text: "text-yellow-200" },
  1: { card: "bg-slate-300/[0.03] border-slate-300/10", accent: "bg-slate-300", badge: "text-slate-300 bg-slate-300/10", text: "text-slate-200" },
  2: { card: "bg-amber-600/[0.03] border-amber-600/10", accent: "bg-amber-600", badge: "text-amber-500 bg-amber-600/10", text: "text-amber-300" },
};

export default function Scoreboard() {
  const { data: pools } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "getPools",
  });

  const { data: currentEpoch } = useReadContract({
    address: MINING_ADDRESS,
    abi: miningAbi,
    functionName: "currentEpoch",
    query: { refetchInterval: SCOREBOARD_POLL_MS },
  });
  const { data: genesisTs } = useReadContract({
    address: MINING_ADDRESS,
    abi: miningAbi,
    functionName: "genesisTimestamp",
    query: { refetchInterval: SCOREBOARD_POLL_MS },
  });
  const epochNum = currentEpoch !== undefined ? Number(currentEpoch as bigint) : undefined;

  const poolQueries = useMemo(() => {
    if (!pools || pools.length === 0 || epochNum === undefined) return [];
    return pools.flatMap((addr) => [
      { address: MINING_ADDRESS, abi: miningAbi, functionName: "credits" as const, args: [BigInt(epochNum), addr] as const },
      { address: MINING_ADDRESS, abi: miningAbi, functionName: "nextIndex" as const, args: [addr] as const },
      { address: addr, abi: poolAbi, functionName: "getPoolInfo" as const },
    ]);
  }, [pools, epochNum]);

  const { data: poolResults } = useReadContracts({
    contracts: poolQueries,
    query: { enabled: poolQueries.length > 0, refetchInterval: SCOREBOARD_POLL_MS },
  });

  const { data: totalCreditsData } = useReadContract({
    address: MINING_ADDRESS,
    abi: miningAbi,
    functionName: "totalCredits",
    args: epochNum !== undefined ? [BigInt(epochNum)] : undefined,
    query: { enabled: epochNum !== undefined, refetchInterval: SCOREBOARD_POLL_MS },
  });
  const totalCredits = totalCreditsData as bigint | undefined;

  // Credit delta tracking
  const prevCreditsRef = useRef<Map<string, bigint>>(new Map());
  const solvingSetRef = useRef<Set<string>>(new Set());

  const currentCredits = useMemo(() => {
    const map = new Map<string, bigint>();
    if (!pools || !poolResults) return map;
    pools.forEach((addr, i) => {
      const c = poolResults[i * 3]?.result as bigint | undefined;
      if (c !== undefined) map.set(addr, c);
    });
    return map;
  }, [pools, poolResults]);

  useEffect(() => {
    if (currentCredits.size === 0) return;
    const prev = prevCreditsRef.current;
    const solving = new Set<string>();
    for (const [addr, credits] of currentCredits) {
      const old = prev.get(addr);
      if (old !== undefined && credits > old) solving.add(addr);
    }
    solvingSetRef.current = solving;
    prevCreditsRef.current = new Map(currentCredits);
  }, [currentCredits]);

  // Epoch progress
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const epochProgress = useMemo(() => {
    if (genesisTs === undefined || epochNum === undefined) return 0;
    const epochStart = Number(genesisTs) + epochNum * EPOCH_DURATION;
    return Math.min(100, Math.max(0, ((now - epochStart) / EPOCH_DURATION) * 100));
  }, [genesisTs, epochNum, now]);

  // Build rows
  const rows = useMemo(() => {
    if (!pools || !poolResults || epochNum === undefined) return [];
    return pools
      .map((addr, i) => {
        const credits = (poolResults[i * 3]?.result as bigint) ?? 0n;
        const solveCount = (poolResults[i * 3 + 1]?.result as bigint) ?? 0n;
        const poolInfoResult = poolResults[i * 3 + 2]?.result as readonly [number, bigint, bigint, bigint, bigint, boolean, bigint, bigint, bigint, bigint] | undefined;
        const activeStake = poolInfoResult?.[1] ?? 0n;
        const creditsNum = Number(credits);
        const totalNum = totalCredits ? Number(totalCredits) : 0;
        const sharePercent = totalNum > 0 ? (creditsNum / totalNum) * 100 : 0;
        const isActive = credits > 0n;
        const isSolvingNow = solvingSetRef.current.has(addr);
        return { addr, credits, solveCount: Number(solveCount), activeStake, sharePercent, isActive, isSolvingNow };
      })
      .sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return Number(b.credits - a.credits);
      });
  }, [pools, poolResults, epochNum, totalCredits]);

  const activeSolvers = rows.filter((r) => r.isActive).length;
  const solvingNow = solvingSetRef.current.size;

  // Loading states
  if (FACTORY_ADDRESS === "0x0000000000000000000000000000000000000000") {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-warn text-sm font-medium mb-2">Factory address not set</p>
        <p className="text-xs text-muted">Deploy and configure factory first.</p>
      </div>
    );
  }

  if (!pools || epochNum === undefined) {
    return (
      <div className="space-y-3">
        <div className="loading-bar" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="shimmer h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Hero header ── */}
      <div className="dashboard-card">
        <div className="px-6 pt-6 pb-0 sm:px-8 sm:pt-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-text tracking-tight">
                <span className="glow-blue">Leaderboard</span>
              </h1>
              <p className="text-sm text-muted mt-1.5">
                Real-time solver rankings &middot; epoch {epochNum}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted shrink-0">
              {solvingNow > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
                  </span>
                  <span className="text-success font-semibold">{solvingNow}</span> solving
                </span>
              )}
              <span><span className="text-text font-semibold">{activeSolvers}</span> active</span>
              <span className="font-tabular"><span className="text-text font-semibold">{totalCredits ? compactNum(Number(totalCredits)) : "0"}</span> credits</span>
            </div>
          </div>
        </div>

        {/* Epoch progress */}
        <div className="px-6 sm:px-8 py-5">
          <div className="flex items-center justify-between mb-2 text-[11px] text-muted">
            <span>Epoch {epochNum} progress</span>
            <span className="font-tabular">{epochProgress.toFixed(0)}%</span>
          </div>
          <div className="h-1 rounded-full bg-border/50 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-linear"
              style={{
                width: `${epochProgress}%`,
                background: "linear-gradient(90deg, #0052FF, #6366F1, #8B5CF6)",
                boxShadow: "0 0 12px rgba(99, 102, 241, 0.5), 0 0 4px rgba(99, 102, 241, 0.3)",
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Pool rankings ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-muted">
            {pools.length} pool{pools.length !== 1 ? "s" : ""} &middot; ranked by credits
          </p>
          <p className="text-[10px] text-muted">Updates every 10s</p>
        </div>

        <div className="space-y-2">
          {rows.length === 0 ? (
            <div className="glass-card p-8 text-center text-sm text-muted">
              No pools deployed yet
            </div>
          ) : (
            rows.map((row, idx) => {
              const rankStyle = row.isActive ? RANK_STYLES[idx] : undefined;
              const isTop3 = idx < 3 && row.isActive;

              return (
                <Link
                  key={row.addr}
                  href={`/pool/${row.addr}`}
                  className={`block rounded-xl border transition-all overflow-hidden ${
                    isTop3
                      ? `${rankStyle!.card} hover:brightness-110`
                      : row.isActive
                        ? "border-border bg-card hover:border-indigo/20 hover:bg-card-hover"
                        : "border-border/50 bg-card/50 opacity-50"
                  }`}
                >
                  <div className="flex items-center gap-4 px-5 py-4 relative">
                    {/* Left accent bar for top 3 */}
                    {isTop3 && (
                      <div className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full ${rankStyle!.accent}`} />
                    )}
                    {/* Rank */}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold font-tabular shrink-0 ${
                      isTop3
                        ? rankStyle!.badge
                        : "text-muted bg-surface"
                    }`}>
                      {idx + 1}
                    </div>

                    {/* Status dot + Pool address */}
                    <div className="flex items-center gap-3 min-w-0 w-32 shrink-0">
                      <div className="relative h-2 w-2 shrink-0">
                        {row.isSolvingNow && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                        )}
                        <div className={`relative h-2 w-2 rounded-full ${
                          row.isSolvingNow ? "bg-success" : row.isActive ? "bg-success" : "bg-muted"
                        }`} />
                      </div>
                      <span className={`text-sm font-semibold font-tabular truncate ${
                        isTop3 ? rankStyle!.text : "text-base-blue-light"
                      }`}>
                        {shortAddr(row.addr)}
                      </span>
                    </div>

                    {/* Credits */}
                    <div className="hidden sm:block min-w-[5rem]">
                      <p className="text-[10px] text-muted uppercase tracking-wider">Credits</p>
                      <p className="text-sm text-text font-bold font-tabular">
                        {row.credits > 0n ? compactNum(Number(row.credits)) : "-"}
                      </p>
                    </div>

                    {/* Share */}
                    <div className="hidden sm:block w-16">
                      <p className="text-[10px] text-muted uppercase tracking-wider">Share</p>
                      <p className={`text-sm font-tabular font-semibold ${
                        row.sharePercent > 0 ? "text-success" : "text-muted"
                      }`}>
                        {row.sharePercent > 0 ? `${row.sharePercent.toFixed(1)}%` : "-"}
                      </p>
                    </div>

                    {/* Solves */}
                    <div className="hidden md:block w-16">
                      <p className="text-[10px] text-muted uppercase tracking-wider">Solves</p>
                      <p className="text-sm text-text-dim font-tabular">
                        {row.solveCount > 0 ? compactNum(row.solveCount) : "0"}
                      </p>
                    </div>

                    {/* Stake */}
                    <div className="hidden lg:block flex-1 max-w-40">
                      <p className="text-[10px] text-muted uppercase tracking-wider">Staked</p>
                      <p className="text-sm text-text-dim font-tabular">
                        {fmtCompact(row.activeStake)}
                      </p>
                    </div>

                    {/* Status */}
                    <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md shrink-0 ${
                      row.isSolvingNow
                        ? "text-success bg-success/10"
                        : row.isActive
                          ? "text-base-blue-light bg-base-blue/10"
                          : "text-muted bg-surface"
                    }`}>
                      {row.isSolvingNow ? "Solving" : row.isActive ? "Active" : "Idle"}
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex flex-wrap items-center gap-5 text-[10px] text-muted px-1">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
          </span>
          Solving now
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-success" />
          Earned credits
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-muted" />
          No credits yet
        </div>
        <span className="ml-auto">All data from Base mainnet</span>
      </div>
    </div>
  );
}
