"use client";

import Scoreboard from "@/components/Scoreboard";
import MiningStats from "@/components/MiningStats";

export default function ScoreboardPage() {
  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Compact header */}
      <div className="gradient-border p-5">
        <h1 className="text-xl font-bold text-text">
          Live <span className="glow-blue">Scoreboard</span>
        </h1>
        <p className="text-sm text-text-dim mt-1">
          Real-time solver activity &amp; credits per pool · on-chain data
        </p>
      </div>

      {/* Mining dashboard */}
      <MiningStats />

      {/* Scoreboard */}
      <Scoreboard />
    </div>
  );
}
