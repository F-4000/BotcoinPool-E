"use client";

import { useMemo } from "react";
import { useReadContract, useReadContracts, useAccount } from "wagmi";
import { factoryAbi, poolAbi } from "@/lib/contracts";
import { FACTORY_ADDRESS } from "@/lib/config";
import PoolRow from "@/components/PoolCard";

export default function PoolList() {
  const { isConnected } = useAccount();
  const { data: pools, isLoading, isError } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "getPools",
  });

  // Batch-read totalActiveStake + globalPendingStake for every pool (multicall)
  const stakeQueries = useMemo(() => {
    if (!pools || pools.length === 0) return [];
    return pools.flatMap((addr) => [
      { address: addr, abi: poolAbi, functionName: "totalActiveStake" as const },
      { address: addr, abi: poolAbi, functionName: "globalPendingStake" as const },
    ]);
  }, [pools]);

  const { data: stakeResults } = useReadContracts({ contracts: stakeQueries });

  // Sort pools by total stake (active + pending) descending
  const sortedPools = useMemo(() => {
    if (!pools || pools.length === 0) return [];
    if (!stakeResults) return [...pools]; // Unsorted until data arrives

    const withStake = pools.map((addr, i) => {
      const active = (stakeResults[i * 2]?.result as bigint) ?? 0n;
      const pending = (stakeResults[i * 2 + 1]?.result as bigint) ?? 0n;
      return { addr, total: active + pending };
    });

    return withStake
      .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
      .map((p) => p.addr);
  }, [pools, stakeResults]);

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
        <p className="text-text-dim text-sm mb-2">No pools found</p>
        <p className="text-xs text-muted">
          {isConnected
            ? "Use the \"+ Create Pool\" button above to deploy the first pool."
            : "Connect your wallet and create the first pool."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted mb-2">
        {pools.length} pool{pools.length !== 1 ? "s" : ""} · sorted by stake
      </p>

      {/* Column headers */}
      <div className="flex items-center gap-3 px-4 py-2 text-[10px] text-muted uppercase tracking-wider border-b border-border">
        <span className="w-1.5" />
        <span className="w-28">Pool</span>
        <span className="min-w-20 hidden sm:block">Staked</span>
        <span className="w-16 text-right hidden sm:block">Fee</span>
        <span className="flex-1 max-w-50 hidden md:block">Capacity</span>
        <span className="ml-auto w-10" />
      </div>

      {/* Rows */}
      <div className="glass-card overflow-hidden">
        {sortedPools.map((addr) => (
          <PoolRow key={addr} address={addr} />
        ))}
      </div>
    </div>
  );
}
