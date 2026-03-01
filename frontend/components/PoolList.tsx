"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts, useAccount } from "wagmi";
import { factoryAbi, poolAbi, miningAbi } from "@/lib/contracts";
import { FACTORY_ADDRESS, MINING_ADDRESS } from "@/lib/config";
import PoolRow from "@/components/PoolCard";

export default function PoolList({ refreshKey }: { refreshKey?: number }) {
  const { isConnected } = useAccount();
  const { data: pools, isLoading, isError } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "getPools",
    query: { refetchInterval: refreshKey ? 3000 : false },
  });

  // ── Mining: current epoch ──
  const { data: currentEpoch } = useReadContract({
    address: MINING_ADDRESS,
    abi: miningAbi,
    functionName: "currentEpoch",
    query: { refetchInterval: 15_000 },
  });
  const epochNum = currentEpoch !== undefined ? Number(currentEpoch as bigint) : undefined;

  // Batch-read getPoolInfo for every pool (multicall)
  const poolInfoQueries = useMemo(() => {
    if (!pools || pools.length === 0) return [];
    return pools.map((addr) => ({
      address: addr,
      abi: poolAbi,
      functionName: "getPoolInfo" as const,
    }));
  }, [pools]);

  const { data: poolInfoResults } = useReadContracts({ contracts: poolInfoQueries });

  // ── Per-pool mining reads: credits(epoch, pool) ──
  const miningQueries = useMemo(() => {
    if (!pools || pools.length === 0 || epochNum === undefined) return [];
    return pools.map((addr) => ({
      address: MINING_ADDRESS,
      abi: miningAbi,
      functionName: "credits" as const,
      args: [BigInt(epochNum), addr] as const,
    }));
  }, [pools, epochNum]);

  const { data: miningResults } = useReadContracts({
    contracts: miningQueries,
    query: { enabled: miningQueries.length > 0, refetchInterval: 10_000 },
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

  // ── Build per-pool mining map ──
  const miningMap = useMemo(() => {
    const map = new Map<string, { credits: bigint; sharePercent: number }>();
    if (!pools || !miningResults) return map;
    pools.forEach((addr, i) => {
      const credits = (miningResults[i]?.result as bigint) ?? 0n;
      const totalNum = totalCredits ? Number(totalCredits) : 0;
      const sharePercent = totalNum > 0 ? (Number(credits) / totalNum) * 100 : 0;
      map.set(addr.toLowerCase(), { credits, sharePercent });
    });
    return map;
  }, [pools, miningResults, totalCredits]);

  // Sort pools by staked-in-mining (from getPoolInfo[1]) descending
  const sortedPools = useMemo(() => {
    if (!pools || pools.length === 0) return [];
    if (!poolInfoResults) return [...pools];

    const withStake = pools.map((addr, i) => {
      const result = poolInfoResults[i]?.result as readonly [number, bigint, bigint, bigint, bigint, boolean, bigint, bigint] | undefined;
      const deposits = result?.[2] ?? 0n; // totalDeposits already includes staked + pending
      return { addr, total: deposits };
    });

    return withStake
      .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
      .map((p) => p.addr);
  }, [pools, poolInfoResults]);

  if (FACTORY_ADDRESS === "0x0000000000000000000000000000000000000000") {
    return (
      <div className="glass-card p-6 text-center">
        <p className="text-warn text-sm font-medium mb-2">Factory address not set</p>
        <p className="text-xs text-muted">
          Set <code className="text-base-blue-light">NEXT_PUBLIC_FACTORY_ADDRESS</code> in{" "}
          <code className="text-base-blue-light">.env.local</code>
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="loading-bar" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="glass-card p-6">
        <p className="text-danger text-sm font-medium mb-1">Failed to load pools</p>
        <p className="text-xs text-muted">
          Check network connection. Factory may not be deployed at this address.
        </p>
      </div>
    );
  }

  if (!pools || pools.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="text-3xl mb-3 opacity-30">⛏</div>
        <p className="text-text-dim text-sm mb-1">No pools yet</p>
        <p className="text-xs text-muted">
          {isConnected
            ? "Deploy the first pool using the button above."
            : "Connect wallet to create a pool."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted mb-2">
        {pools.length} pool{pools.length !== 1 ? "s" : ""} · sorted by stake
        {epochNum !== undefined && <span className="ml-1">· epoch {epochNum}</span>}
      </p>

      {/* Column headers */}
      <div className="grid items-center gap-x-3 px-4 py-2 text-[10px] text-muted uppercase tracking-wider border-b border-border grid-cols-[6px_1fr_2rem] sm:grid-cols-[6px_7rem_5rem_6rem_3rem_2.5rem_4rem_2rem] md:grid-cols-[6px_7rem_5rem_6rem_3rem_2.5rem_4rem_1fr_2rem]">
        <span />
        <span>Pool</span>
        <span className="hidden sm:block">State</span>
        <span className="hidden sm:block">Staked</span>
        <span className="hidden sm:block text-right">Fee</span>
        <span className="hidden sm:block text-right">Tier</span>
        <span className="hidden sm:block text-right">Credits</span>
        <span className="hidden md:block">Capacity</span>
        <span />
      </div>

      <div className="glass-card overflow-hidden">
        {sortedPools.map((addr) => {
          const mining = miningMap.get(addr.toLowerCase());
          return (
            <PoolRow
              key={addr}
              address={addr}
              credits={mining?.credits}
              sharePercent={mining?.sharePercent}
              currentEpoch={epochNum}
            />
          );
        })}
      </div>
    </div>
  );
}
