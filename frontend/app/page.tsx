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

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Compact header */}
      <div className="gradient-border p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-text">
              Botcoin <span className="glow-blue">Mining Pool</span>
            </h1>
            <p className="text-sm text-text-dim mt-1">
              Trustless staking · O(1) gas · EIP-1271 · Base Mainnet
            </p>
          </div>
        </div>
      </div>

      {/* Info strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <InfoCell label="Network" value="Base L2" />
        <InfoCell label="Architecture" value="O(1) Gas" />
        <InfoCell label="Claiming" value="Trustless" />
        <InfoCell label="Min Stake" value="25M / Pool" />
      </div>

      {/* Mining dashboard – live data from Base */}
      <MiningStats />

      {/* How it works */}
      <div className="glass-card p-5">
        <h2 className="text-sm font-semibold text-text mb-3">How it works</h2>
        <div className="grid sm:grid-cols-2 gap-2 text-sm text-text-dim">
          <p><span className="text-base-blue-light">→</span> BOTCOIN mining requires <span className="text-warn font-medium">25,000,000</span> tokens to participate</p>
          <p><span className="text-base-blue-light">→</span> This pool lets you deposit <span className="text-accent font-medium">any amount</span> and earn proportional rewards</p>
          <p><span className="text-base-blue-light">→</span> AI solver bots compete in <span className="text-indigo font-medium">60-second puzzle rounds</span></p>
          <p><span className="text-base-blue-light">→</span> Anyone can trigger reward distribution — <span className="text-success font-medium">fully trustless</span></p>
        </div>
      </div>

      {/* Create pool form */}
      {showCreate && <CreatePool onCreated={handleCreated} />}

      {/* Pool list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-text">Active Pools</h2>
          {isConnected && FACTORY_ADDRESS !== "0x0000000000000000000000000000000000000000" && (
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

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-card px-4 py-3">
      <p className="text-[11px] text-muted uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm text-text font-semibold">{value}</p>
    </div>
  );
}
