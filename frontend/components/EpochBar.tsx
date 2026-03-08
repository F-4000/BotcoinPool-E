"use client";

import { useEffect, useMemo, useRef } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { factoryAbi, miningAbi } from "@/lib/contracts";
import { FACTORY_ADDRESS, MINING_ADDRESS } from "@/lib/config";

const EPOCH_DURATION = 86_400;

/** Compact number display */
function compactNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

export default function EpochBar() {
  // ── Factory: get all pool addresses ──
  const { data: pools } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "getPools",
  });

  // ── Mining: current epoch + genesis ──
  const { data: miningBase } = useReadContracts({
    contracts: [
      { address: MINING_ADDRESS, abi: miningAbi, functionName: "currentEpoch" },
      { address: MINING_ADDRESS, abi: miningAbi, functionName: "genesisTimestamp" },
    ],
    query: { refetchInterval: 25_000 },
  });

  const currentEpoch = miningBase?.[0]?.result as bigint | undefined;
  const genesisTs = miningBase?.[1]?.result as bigint | undefined;
  const epochNum = currentEpoch !== undefined ? Number(currentEpoch) : undefined;

  // ── Per-pool credits this epoch ──
  const creditQueries = useMemo(() => {
    if (!pools || pools.length === 0 || epochNum === undefined) return [];
    return pools.map((addr) => ({
      address: MINING_ADDRESS,
      abi: miningAbi,
      functionName: "credits" as const,
      args: [BigInt(epochNum), addr] as const,
    }));
  }, [pools, epochNum]);

  const { data: creditResults } = useReadContracts({
    contracts: creditQueries,
    query: { enabled: creditQueries.length > 0, refetchInterval: 25_000 },
  });

  // ── Total credits this epoch ──
  const { data: totalCreditsData } = useReadContract({
    address: MINING_ADDRESS,
    abi: miningAbi,
    functionName: "totalCredits",
    args: epochNum !== undefined ? [BigInt(epochNum)] : undefined,
    query: { enabled: epochNum !== undefined, refetchInterval: 25_000 },
  });
  const totalCredits = totalCreditsData as bigint | undefined;

  const epochActive = epochNum !== undefined && epochNum > 0;

  // ── Credit delta tracking: detect who is solving right now ──
  const prevCreditsRef = useRef<Map<string, bigint>>(new Map());
  const solvingSetRef = useRef<Set<string>>(new Set());

  // Build current credits map
  const currentCredits = useMemo(() => {
    const map = new Map<string, bigint>();
    if (!pools || !creditResults) return map;
    pools.forEach((addr, i) => {
      const c = creditResults[i]?.result as bigint | undefined;
      if (c !== undefined) map.set(addr, c);
    });
    return map;
  }, [pools, creditResults]);

  // Compare with previous snapshot to find who is actively solving
  useEffect(() => {
    if (currentCredits.size === 0) return;
    const prev = prevCreditsRef.current;
    const solving = new Set<string>();
    for (const [addr, credits] of currentCredits) {
      const old = prev.get(addr);
      // Credits increased since last poll = actively solving
      if (old !== undefined && credits > old) solving.add(addr);
    }
    solvingSetRef.current = solving;
    prevCreditsRef.current = new Map(currentCredits);
  }, [currentCredits]);

  // Count pools that have credits > 0 this epoch
  const activeSolvers = useMemo(() => {
    if (!creditResults) return 0;
    return creditResults.filter((r) => {
      const c = r?.result as bigint | undefined;
      return c !== undefined && c > 0n;
    }).length;
  }, [creditResults]);

  const solvingNow = solvingSetRef.current.size;

  // ── Epoch timing ──
  const epochProgress = useMemo(() => {
    if (genesisTs === undefined || currentEpoch === undefined) return 0;
    const now = Math.floor(Date.now() / 1000);
    const epochStart = Number(genesisTs) + Number(currentEpoch) * EPOCH_DURATION;
    const elapsed = now - epochStart;
    return Math.min(100, Math.max(0, (elapsed / EPOCH_DURATION) * 100));
  }, [genesisTs, currentEpoch]);

  // Don't render until data is ready
  if (epochNum === undefined) return null;

  return (
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
          {solvingNow > 0 && (
            <span className="flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
              </span>
              <span className="text-success font-semibold">{solvingNow}</span> solving now
            </span>
          )}
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
  );
}
