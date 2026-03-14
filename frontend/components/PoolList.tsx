"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReadContract, useReadContracts, useAccount } from "wagmi";
import { factoryAbi, poolAbi, miningAbi } from "@/lib/contracts";
import { FACTORY_ADDRESS, MINING_ADDRESS } from "@/lib/config";
import PoolRow from "@/components/PoolCard";

const LIST_POLL_MS = 10_000;

type PoolInfoTuple = readonly [
  number,
  bigint,
  bigint,
  bigint,
  bigint,
  boolean,
  bigint,
  bigint,
  bigint,
  bigint,
];

type CompactBotState = "live" | "active" | "idle" | "offline";

export default function PoolList({ refreshKey }: { refreshKey?: number }) {
  const { isConnected } = useAccount();
  const { data: pools, isLoading, isError } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: factoryAbi,
    functionName: "getPools",
    query: { refetchInterval: refreshKey ? 3000 : false, retry: 3 },
  });

  // ── Mining: current epoch + genesis timestamp ──
  // Individual reads so TanStack deduplicates across EpochBar / MiningStats / PoolList
  const { data: currentEpoch } = useReadContract({
    address: MINING_ADDRESS, abi: miningAbi, functionName: "currentEpoch",
    query: { refetchInterval: LIST_POLL_MS },
  });
  const { data: genesisTs } = useReadContract({
    address: MINING_ADDRESS, abi: miningAbi, functionName: "genesisTimestamp",
    query: { refetchInterval: LIST_POLL_MS },
  });
  const epochNum = currentEpoch !== undefined ? Number(currentEpoch as bigint) : undefined;
  const genesisTsNum = genesisTs !== undefined ? Number(genesisTs as bigint) : undefined;

  // ── Single combined multicall: pool data + mining credits + totalCredits ──
  const prevEpochNum = epochNum !== undefined && epochNum > 0 ? epochNum - 1 : undefined;

  // Layout per pool: [getPoolInfo, feeBps, operator, owner, maxStake, credits(cur), credits(prev)?]
  const POOL_FIELDS = 5; // getPoolInfo, feeBps, operator, owner, maxStake
  const hasPrev = prevEpochNum !== undefined;
  const MINING_FIELDS = epochNum !== undefined ? (hasPrev ? 2 : 1) : 0;
  const FIELDS_PER_POOL = POOL_FIELDS + MINING_FIELDS;

  const combinedQueries = useMemo(() => {
    // Wait for BOTH pools and epochNum before firing — avoids offset misalignment
    if (!pools || pools.length === 0 || epochNum === undefined) return [];

    type Q = { address: `0x${string}`; abi: typeof poolAbi | typeof miningAbi; functionName: string; args?: readonly unknown[] };
    const q: Q[] = [];

    for (const addr of pools) {
      q.push({ address: addr, abi: poolAbi, functionName: "getPoolInfo" });
      q.push({ address: addr, abi: poolAbi, functionName: "feeBps" });
      q.push({ address: addr, abi: poolAbi, functionName: "operator" });
      q.push({ address: addr, abi: poolAbi, functionName: "owner" });
      q.push({ address: addr, abi: poolAbi, functionName: "maxStake" });
      q.push({ address: MINING_ADDRESS, abi: miningAbi, functionName: "credits", args: [BigInt(epochNum), addr] });
      if (hasPrev) {
        q.push({ address: MINING_ADDRESS, abi: miningAbi, functionName: "credits", args: [BigInt(prevEpochNum!), addr] });
      }
    }
    q.push({ address: MINING_ADDRESS, abi: miningAbi, functionName: "totalCredits", args: [BigInt(epochNum)] });
    return q;
  }, [pools, epochNum, prevEpochNum, hasPrev]);

  const { data: combinedResults } = useReadContracts({
    contracts: combinedQueries,
    query: { enabled: combinedQueries.length > 0, refetchInterval: LIST_POLL_MS },
  });

  // totalCredits is the last element (if epoch is known)
  const totalCredits = (epochNum !== undefined && combinedResults)
    ? (combinedResults[combinedResults.length - 1]?.result as bigint | undefined)
    : undefined;

  // ── Detect live solving by observing credits increase across polls ──
  const prevCreditsRef = useRef<Map<string, bigint>>(new Map());
  const [solvingNow, setSolvingNow] = useState<Set<string>>(new Set());

  const currentCreditsMap = useMemo(() => {
    const map = new Map<string, bigint>();
    if (!pools || !combinedResults || epochNum === undefined) return map;
    pools.forEach((addr, i) => {
      const offset = i * FIELDS_PER_POOL + POOL_FIELDS; // skip pool data fields
      const current = (combinedResults[offset]?.result as bigint) ?? 0n;
      map.set(addr.toLowerCase(), current);
    });
    return map;
  }, [pools, combinedResults, epochNum, FIELDS_PER_POOL]);

  useEffect(() => {
    if (currentCreditsMap.size === 0) return;
    const nextSolving = new Set<string>();
    for (const [addr, credits] of currentCreditsMap) {
      const prev = prevCreditsRef.current.get(addr);
      if (prev !== undefined && credits > prev) nextSolving.add(addr);
    }
    setSolvingNow(nextSolving);
    prevCreditsRef.current = new Map(currentCreditsMap);
  }, [currentCreditsMap]);

  // ── Build per-pool mining map ──
  const miningMap = useMemo(() => {
    const map = new Map<string, { credits: bigint; prevCredits: bigint; sharePercent: number; status: CompactBotState }>();
    if (!pools || !combinedResults || epochNum === undefined) return map;
    pools.forEach((addr, i) => {
      const offset = i * FIELDS_PER_POOL + POOL_FIELDS;
      const credits = (combinedResults[offset]?.result as bigint) ?? 0n;
      const prevCredits = hasPrev
        ? ((combinedResults[offset + 1]?.result as bigint) ?? 0n)
        : 0n;
      const totalNum = totalCredits ? Number(totalCredits) : 0;
      const sharePercent = totalNum > 0 ? (Number(credits) / totalNum) * 100 : 0;
      let status: CompactBotState = "offline";
      const key = addr.toLowerCase();
      if (solvingNow.has(key)) status = "live";
      else if (credits > 0n) status = "active";
      else if (prevCredits > 0n) status = "idle";
      map.set(key, { credits, prevCredits, sharePercent, status });
    });
    return map;
  }, [pools, combinedResults, epochNum, FIELDS_PER_POOL, hasPrev, totalCredits, solvingNow]);

  // ── Build per-pool data map ──
  const poolDataMap = useMemo(() => {
    const map = new Map<string, {
      poolInfo?: PoolInfoTuple;
      feeBps?: bigint;
      operator?: `0x${string}`;
      owner?: `0x${string}`;
      maxStake?: bigint;
    }>();
    if (!pools || !combinedResults) return map;
    pools.forEach((addr, i) => {
      const offset = i * FIELDS_PER_POOL;
      map.set(addr.toLowerCase(), {
        poolInfo: combinedResults[offset]?.result as PoolInfoTuple | undefined,
        feeBps: combinedResults[offset + 1]?.result as bigint | undefined,
        operator: combinedResults[offset + 2]?.result as `0x${string}` | undefined,
        owner: combinedResults[offset + 3]?.result as `0x${string}` | undefined,
        maxStake: combinedResults[offset + 4]?.result as bigint | undefined,
      });
    });
    return map;
  }, [pools, combinedResults, FIELDS_PER_POOL]);

  // ── Sort pools by deposits descending ──
  const sortedPools = useMemo(() => {
    if (!pools || pools.length === 0) return [];
    if (!poolDataMap.size) return [...pools];
    const withStake = pools.map((addr) => {
      const result = poolDataMap.get(addr.toLowerCase())?.poolInfo;
      const deposits = result?.[2] ?? 0n;
      return { addr, total: deposits };
    });
    return withStake
      .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0))
      .map((p) => p.addr);
  }, [pools, poolDataMap]);

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
      <div className="grid items-center gap-x-3 px-4 py-2 text-[10px] text-muted uppercase tracking-wider border-b border-border grid-cols-[6px_1fr_2rem] sm:grid-cols-[6px_7rem_8rem_6rem_3rem_2.5rem_3.5rem_4rem_2rem] md:grid-cols-[6px_7rem_8rem_6rem_3rem_2.5rem_3.5rem_4rem_1fr_2rem]">
        <span />
        <span>Pool</span>
        <span className="hidden sm:block">State</span>
        <span className="hidden sm:block">Staked</span>
        <span className="hidden sm:block text-right">Fee</span>
        <span className="hidden sm:block text-right">Tier</span>
        <span className="hidden sm:block text-right">Lock</span>
        <span className="hidden sm:block text-right">Credits</span>
        <span className="hidden md:block">Capacity</span>
        <span />
      </div>

      <div className="glass-card overflow-hidden">
        {sortedPools.map((addr) => {
          const key = addr.toLowerCase();
          const poolData = poolDataMap.get(key);
          const mining = miningMap.get(key);
          return (
            <PoolRow
              key={addr}
              address={addr}
              poolStateNum={poolData?.poolInfo?.[0]}
              stakedInMiningWei={poolData?.poolInfo?.[1]?.toString()}
              totalDepWei={poolData?.poolInfo?.[2]?.toString()}
              eligible={poolData?.poolInfo?.[5]}
              minActiveEpochs={poolData?.poolInfo?.[8] !== undefined ? Number(poolData.poolInfo[8]) : undefined}
              stakedAtEpoch={poolData?.poolInfo?.[9] !== undefined ? Number(poolData.poolInfo[9]) : undefined}
              feeBps={poolData?.feeBps !== undefined ? Number(poolData.feeBps) : undefined}
              operator={poolData?.operator}
              owner={poolData?.owner}
              maxStakeWei={poolData?.maxStake?.toString()}
              creditsWei={mining?.credits?.toString()}
              sharePercent={mining?.sharePercent}
              botStatus={mining?.status}
              currentEpoch={epochNum}
              genesisTs={genesisTsNum}
            />
          );
        })}
      </div>
    </div>
  );
}
