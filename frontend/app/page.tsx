"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import PoolList from "@/components/PoolList";
import CreatePool from "@/components/CreatePool";
import Dashboard from "@/components/Dashboard";
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
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Dashboard: hero + stats + epoch progress */}
      <Dashboard />

      {/* Create pool form */}
      {showCreate && <CreatePool onCreated={handleCreated} onClose={handleCloseCreate} />}

      {/* Pool list */}
      <div>
        <div className="flex items-center justify-between mb-4">
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
