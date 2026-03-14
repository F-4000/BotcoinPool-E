"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { MINING_ADDRESS, BOTCOIN_ADDRESS, FACTORY_ADDRESS } from "@/lib/config";
import { miningAbi, erc20Abi, factoryAbi } from "@/lib/contracts";

const EPOCH_DURATION = 86_400;
const POLL_MS = 10_000;

function compactNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

function fmtCountdown(secs: number): string {
  if (secs <= 0) return "0h 00m 00s";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export default function Dashboard() {
  // ── Data: epoch + genesis ──
  const { data: currentEpoch, isLoading, refetch } = useReadContract({
    address: MINING_ADDRESS, abi: miningAbi, functionName: "currentEpoch",
    query: { refetchInterval: POLL_MS },
  });
  const { data: genesisTs } = useReadContract({
    address: MINING_ADDRESS, abi: miningAbi, functionName: "genesisTimestamp",
    query: { refetchInterval: POLL_MS },
  });

  const epochNum = currentEpoch !== undefined ? Number(currentEpoch as bigint) : undefined;

  // ── Rewards ──
  const { data: rewardData } = useReadContracts({
    contracts: epochNum !== undefined
      ? [{ address: MINING_ADDRESS, abi: miningAbi, functionName: "epochReward", args: [BigInt(epochNum)] }]
      : [],
    query: { enabled: epochNum !== undefined, refetchInterval: POLL_MS },
  });

  const { data: pastRewards } = useReadContracts({
    contracts: epochNum !== undefined && epochNum > 0
      ? Array.from({ length: epochNum }, (_, i) => ({
          address: MINING_ADDRESS, abi: miningAbi,
          functionName: "epochReward" as const, args: [BigInt(i)] as const,
        }))
      : [],
    query: { enabled: epochNum !== undefined && epochNum > 0, refetchInterval: POLL_MS },
  });

  const currentReward = rewardData?.[0]?.result as bigint | undefined;

  const { data: miningBotcoinBalance } = useReadContract({
    address: BOTCOIN_ADDRESS, abi: erc20Abi, functionName: "balanceOf",
    args: [MINING_ADDRESS],
    query: { refetchInterval: POLL_MS },
  });

  const estimatedReward = currentReward && currentReward > 0n
    ? currentReward
    : (miningBotcoinBalance as bigint | undefined);

  const totalMined = useMemo(() => {
    if (epochNum === undefined) return undefined;
    let sum = 0n;
    if (pastRewards) {
      for (let i = 0; i < pastRewards.length; i++) {
        const val = pastRewards[i]?.result as bigint | undefined;
        if (val) sum += val;
      }
    }
    if (estimatedReward) sum += estimatedReward;
    return sum;
  }, [pastRewards, epochNum, estimatedReward]);

  // ── Pools + credits ──
  const { data: pools } = useReadContract({
    address: FACTORY_ADDRESS, abi: factoryAbi, functionName: "getPools",
  });

  const creditQueries = useMemo(() => {
    if (!pools || pools.length === 0 || epochNum === undefined) return [];
    return pools.map((addr) => ({
      address: MINING_ADDRESS, abi: miningAbi,
      functionName: "credits" as const, args: [BigInt(epochNum), addr] as const,
    }));
  }, [pools, epochNum]);

  const { data: creditResults } = useReadContracts({
    contracts: creditQueries,
    query: { enabled: creditQueries.length > 0, refetchInterval: POLL_MS },
  });

  const { data: totalCreditsData } = useReadContract({
    address: MINING_ADDRESS, abi: miningAbi, functionName: "totalCredits",
    args: epochNum !== undefined ? [BigInt(epochNum)] : undefined,
    query: { enabled: epochNum !== undefined, refetchInterval: POLL_MS },
  });
  const totalCredits = totalCreditsData as bigint | undefined;

  // ── Solver detection ──
  const prevCreditsRef = useRef<Map<string, bigint>>(new Map());
  const solvingSetRef = useRef<Set<string>>(new Set());

  const currentCredits = useMemo(() => {
    const map = new Map<string, bigint>();
    if (!pools || !creditResults) return map;
    pools.forEach((addr, i) => {
      const c = creditResults[i]?.result as bigint | undefined;
      if (c !== undefined) map.set(addr, c);
    });
    return map;
  }, [pools, creditResults]);

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

  const activeSolvers = useMemo(() => {
    if (!creditResults) return 0;
    return creditResults.filter((r) => {
      const c = r?.result as bigint | undefined;
      return c !== undefined && c > 0n;
    }).length;
  }, [creditResults]);

  const solvingNow = solvingSetRef.current.size;

  // ── Timing ──
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const epochEnd = useMemo(() => {
    if (genesisTs === undefined || currentEpoch === undefined) return undefined;
    return Number(genesisTs) + (Number(currentEpoch) + 1) * EPOCH_DURATION;
  }, [genesisTs, currentEpoch]);

  const countdown = epochEnd ? Math.max(0, epochEnd - now) : undefined;

  const epochProgress = useMemo(() => {
    if (genesisTs === undefined || epochNum === undefined) return 0;
    const epochStart = Number(genesisTs) + epochNum * EPOCH_DURATION;
    return Math.min(100, Math.max(0, ((now - epochStart) / EPOCH_DURATION) * 100));
  }, [genesisTs, epochNum, now]);

  // Refresh on epoch boundary
  useEffect(() => {
    if (countdown === 0) {
      const t = setTimeout(() => refetch(), 2000);
      return () => clearTimeout(t);
    }
  }, [countdown, refetch]);

  const rewardNum = estimatedReward ? Number(formatUnits(estimatedReward, 18)) : 0;
  const totalNum = totalMined ? Number(formatUnits(totalMined, 18)) : 0;
  const epochActive = epochNum !== undefined && epochNum > 0;

  // ── Loading state ──
  if (isLoading || epochNum === undefined) {
    return (
      <div className="dashboard-card p-8">
        <div className="flex items-center gap-3">
          <div className="shimmer w-5 h-5 rounded-full" />
          <span className="text-sm text-text-dim">Connecting to Base…</span>
          <div className="loading-bar flex-1 h-1 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-card">
      {/* ── Top: Title + Network badges ── */}
      <div className="px-6 pt-6 pb-0 sm:px-8 sm:pt-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-text tracking-tight">
              Botcoin <span className="glow-blue">Pool</span>
            </h1>
            <p className="text-sm text-muted mt-1.5">
              Trustless pooled mining on Base
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] shrink-0">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/8 text-success border border-success/15">
              <span className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
              Base Mainnet
            </span>
            <span className="px-2.5 py-1 rounded-full bg-surface text-text-dim border border-border">
              EIP-1271
            </span>
            <span className="px-2.5 py-1 rounded-full bg-surface text-text-dim border border-border">
              O(1) Gas
            </span>
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="px-6 sm:px-8 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
          <StatBlock
            label="Next Epoch"
            value={countdown !== undefined ? fmtCountdown(countdown) : "-"}
            sub={countdown !== undefined && countdown > 0 ? "countdown" : "transitioning"}
            accent="blue"
            pulse={countdown !== undefined && countdown <= 300}
          />
          <StatBlock
            label="Current Epoch"
            value={epochNum.toString()}
            sub={epochActive ? "active" : "pending"}
            accent="indigo"
          />
          <StatBlock
            label="Epoch Rewards"
            value={rewardNum > 0 ? compactNum(rewardNum) : "-"}
            sub="BOTCOIN est."
            accent="violet"
          />
          <StatBlock
            label="Total Mined"
            value={totalNum > 0 ? compactNum(totalNum) : "-"}
            sub="BOTCOIN"
            accent="green"
          />
        </div>
      </div>

      {/* ── Epoch progress ── */}
      <div className="px-6 sm:px-8 pb-5">
        <div className="flex items-center justify-between mb-2 text-[11px] text-muted">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${epochActive ? "bg-success pulse-dot" : "bg-warn"}`} />
              Epoch {epochNum}
              <span className={`uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded text-[9px] ${
                epochActive ? "text-success bg-success/10" : "text-warn bg-warn/10"
              }`}>
                {epochActive ? "Active" : "Pending"}
              </span>
            </span>
            {solvingNow > 0 && (
              <span className="flex items-center gap-1">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
                </span>
                <span className="text-success font-semibold">{solvingNow}</span> solving
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span>
              <span className="text-text font-semibold">{activeSolvers}</span> solver{activeSolvers !== 1 ? "s" : ""}
            </span>
            <span className="h-2.5 w-px bg-border" />
            <span>
              <span className="text-text font-semibold font-tabular">{totalCredits ? compactNum(Number(totalCredits)) : "0"}</span> credits
            </span>
            <span className="h-2.5 w-px bg-border" />
            <span className="font-tabular">{epochProgress.toFixed(0)}%</span>
          </div>
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
  );
}

function StatBlock({
  label,
  value,
  sub,
  accent,
  pulse,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "blue" | "indigo" | "violet" | "green";
  pulse?: boolean;
}) {
  const colors = {
    blue:   { dot: "bg-base-blue-light", text: "text-text" },
    indigo: { dot: "bg-indigo",          text: "text-text" },
    violet: { dot: "bg-violet",          text: "text-text" },
    green:  { dot: "bg-success",         text: "text-text" },
  }[accent];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className={`w-1 h-1 rounded-full ${colors.dot} ${pulse ? "pulse-dot" : ""}`} />
        <span className="text-[10px] text-muted uppercase tracking-wider font-medium">{label}</span>
      </div>
      <p className={`text-xl sm:text-2xl font-bold font-tabular ${colors.text} tracking-tight leading-none`}>
        {value}
      </p>
      <p className="text-[10px] text-muted">{sub}</p>
    </div>
  );
}
