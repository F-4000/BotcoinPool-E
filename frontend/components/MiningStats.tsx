"use client";

import { useState, useEffect, useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { MINING_ADDRESS, BOTCOIN_ADDRESS } from "@/lib/config";
import { miningAbi, erc20Abi } from "@/lib/contracts";

const EPOCH_DURATION = 86_400; // 24 hours in seconds

/** Compact number formatter: 1234567890 → "1.23B" */
function compactNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

/** Format a countdown in seconds → "12h 34m 56s" */
function fmtCountdown(secs: number): string {
  if (secs <= 0) return "Ended";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

export default function MiningStats() {
  const { data, isLoading, isError, refetch } = useReadContracts({
    contracts: [
      {
        address: MINING_ADDRESS,
        abi: miningAbi,
        functionName: "currentEpoch",
      },
      {
        address: MINING_ADDRESS,
        abi: miningAbi,
        functionName: "genesisTimestamp",
      },
      {
        address: MINING_ADDRESS,
        abi: miningAbi,
        functionName: "tier1Balance",
      },
      {
        address: MINING_ADDRESS,
        abi: miningAbi,
        functionName: "tier2Balance",
      },
      {
        address: MINING_ADDRESS,
        abi: miningAbi,
        functionName: "tier3Balance",
      },
    ],
    query: {
      refetchInterval: 30_000, // refresh every 30s
    },
  });

  // Extract base values
  const currentEpoch = data?.[0]?.result as bigint | undefined;
  const genesisTs = data?.[1]?.result as bigint | undefined;

  // Second batch: epoch-dependent reads
  const epochNum = currentEpoch !== undefined ? Number(currentEpoch) : undefined;

  // Current epoch reward
  const { data: rewardData } = useReadContracts({
    contracts: epochNum !== undefined
      ? [
          {
            address: MINING_ADDRESS,
            abi: miningAbi,
            functionName: "epochReward",
            args: [BigInt(epochNum)],
          },
        ]
      : [],
    query: { enabled: epochNum !== undefined, refetchInterval: 30_000 },
  });

  // All past epoch rewards for total mined calculation
  const { data: pastRewards } = useReadContracts({
    contracts: epochNum !== undefined && epochNum > 0
      ? Array.from({ length: epochNum }, (_, i) => ({
          address: MINING_ADDRESS,
          abi: miningAbi,
          functionName: "epochReward" as const,
          args: [BigInt(i)] as const,
        }))
      : [],
    query: { enabled: epochNum !== undefined && epochNum > 0, refetchInterval: 60_000 },
  });

  const currentReward = rewardData?.[0]?.result as bigint | undefined;

  // Read BOTCOIN balance of mining contract as estimated epoch reward
  // (funded rewards sitting in the contract for the current epoch)
  const { data: miningBotcoinBalance } = useReadContract({
    address: BOTCOIN_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [MINING_ADDRESS],
    query: { refetchInterval: 30_000 },
  });

  // Use epochReward if set, otherwise fall back to contract BOTCOIN balance
  const estimatedReward = currentReward && currentReward > 0n
    ? currentReward
    : (miningBotcoinBalance as bigint | undefined);

  // Total mined = sum of all past epoch rewards + current
  const totalMined = useMemo(() => {
    if (epochNum === undefined) return undefined;
    let sum = 0n;
    if (pastRewards) {
      for (let i = 0; i < pastRewards.length; i++) {
        const val = pastRewards[i]?.result as bigint | undefined;
        if (val) sum += val;
      }
    }
    // Add current epoch reward
    if (estimatedReward) sum += estimatedReward;
    return sum;
  }, [pastRewards, epochNum, estimatedReward]);

  // ── Countdown timer ──
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

  // ── Refresh on epoch boundary ──
  useEffect(() => {
    if (countdown === 0) {
      const t = setTimeout(() => refetch(), 2000);
      return () => clearTimeout(t);
    }
  }, [countdown, refetch]);

  if (isLoading) {
    return (
      <div className="gradient-border p-5">
        <div className="flex items-center gap-3">
          <div className="shimmer w-4 h-4 rounded-full" />
          <span className="text-sm text-text-dim">Loading mining data…</span>
          <div className="loading-bar flex-1 h-1 rounded" />
        </div>
      </div>
    );
  }

  if (isError || currentEpoch === undefined) {
    return (
      <div className="gradient-border p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-text">
            Mining <span className="glow-blue">Dashboard</span>
          </h2>
          <span className="text-[10px] text-muted font-tabular">Connecting...</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="shimmer h-20 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const rewardNum = estimatedReward ? Number(formatUnits(estimatedReward, 18)) : 0;
  const totalNum = totalMined ? Number(formatUnits(totalMined, 18)) : 0;

  return (
    <div className="gradient-border p-5">
      {/* Section title */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-text">
          Mining <span className="glow-blue">Dashboard</span>
        </h2>
        <span className="text-[10px] text-muted font-tabular">
          Live · Epoch {epochNum}
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Next Epoch Countdown */}
        <StatCard
          label="Next Epoch"
          value={countdown !== undefined ? fmtCountdown(countdown) : "-"}
          sub={countdown !== undefined && countdown > 0 ? "countdown" : "transitioning"}
          accent="blue"
          pulse={countdown !== undefined && countdown <= 300}
        />

        {/* Current Epoch */}
        <StatCard
          label="Current Epoch"
          value={epochNum?.toString() ?? "-"}
          sub="active"
          accent="indigo"
        />

        {/* Current Epoch Rewards */}
        <StatCard
          label="Epoch Rewards"
          value={rewardNum > 0 ? compactNum(rewardNum) : "-"}
          sub="BOTCOIN est."
          accent="violet"
        />

        {/* Total Mined */}
        <StatCard
          label="Total Mined"
          value={totalNum > 0 ? compactNum(totalNum) : "-"}
          sub="BOTCOIN"
          accent="success"
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
  pulse,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "blue" | "indigo" | "violet" | "success";
  pulse?: boolean;
}) {
  const dotColor = {
    blue: "bg-base-blue-light",
    indigo: "bg-indigo",
    violet: "bg-violet",
    success: "bg-success",
  }[accent];

  const glowClass = {
    blue: "glow-blue",
    indigo: "glow-indigo",
    violet: "text-violet",
    success: "glow-success",
  }[accent];

  return (
    <div className="glass-card px-4 py-3 group">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${pulse ? "pulse-dot" : ""}`} />
        <p className="text-[11px] text-muted uppercase tracking-wide">{label}</p>
      </div>
      <p className={`text-lg font-bold font-tabular ${glowClass}`}>
        {value}
      </p>
      <p className="text-[10px] text-muted mt-0.5">{sub}</p>
    </div>
  );
}
