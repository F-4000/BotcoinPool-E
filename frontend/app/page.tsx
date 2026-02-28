"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import PoolList from "@/components/PoolList";
import CreatePool from "@/components/CreatePool";
import MiningStats from "@/components/MiningStats";
import { FACTORY_ADDRESS } from "@/lib/config";

export default function Home() {
  const [showCreate, setShowCreate] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { isConnected } = useAccount();

  const handleCreated = useCallback(() => {
    setShowCreate(false);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleCloseCreate = useCallback(() => {
    setShowCreate(false);
  }, []);

  const factoryReady = FACTORY_ADDRESS !== "0x0000000000000000000000000000000000000000";

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Hero */}
      <div className="gradient-border p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-text tracking-tight">
              Botcoin <span className="glow-blue">Pool</span>
            </h1>
            <p className="text-sm text-muted mt-1">
              Trustless pooled mining on Base. Stake any amount, earn proportional rewards.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
              Base Mainnet
            </span>
            <span className="text-border">|</span>
            <span className="text-muted">EIP-1271</span>
            <span className="text-border">|</span>
            <span className="text-muted">O(1) Gas</span>
          </div>
        </div>
      </div>

      {/* Mining stats */}
      <MiningStats />

      {/* Create pool form */}
      {showCreate && <CreatePool onCreated={handleCreated} onClose={handleCloseCreate} />}

      {/* Pool list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text">Pools</h2>
          {isConnected && factoryReady && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className={`btn-ghost px-3 py-1.5 text-xs ${showCreate ? "border-danger/40! text-danger!" : ""}`}
            >
              {showCreate ? "Cancel" : "+ Create Pool"}
            </button>
          )}
        </div>
        <PoolList refreshKey={refreshKey} />
      </div>
    </div>
  );
}
