"use client";

import { useEffect, useRef, useState } from "react";
import { useReadContract } from "wagmi";
import { miningAbi } from "@/lib/contracts";
import { MINING_ADDRESS } from "@/lib/config";

type BotState = "live" | "active" | "idle" | "offline" | "loading";

const STATUS_CONFIG: Record<BotState, { label: string; dot: string; text: string; desc: string }> = {
  live:    { label: "Live",    dot: "bg-success pulse-dot", text: "text-success", desc: "Earning credits right now" },
  active:  { label: "Active",  dot: "bg-success",           text: "text-success", desc: "Earned credits this epoch" },
  idle:    { label: "Idle",    dot: "bg-warn",              text: "text-warn",    desc: "No credits this epoch yet" },
  offline: { label: "Offline", dot: "bg-danger",            text: "text-danger",  desc: "No activity for 2+ epochs" },
  loading: { label: "...",     dot: "bg-muted",             text: "text-muted",   desc: "Checking" },
};

interface BotStatusProps {
  poolAddress: `0x${string}`;
  currentEpoch?: number;
  /** Compact mode for PoolCard (just the dot + label) */
  compact?: boolean;
}

export default function BotStatus({ poolAddress, currentEpoch, compact }: BotStatusProps) {
  const [botState, setBotState] = useState<BotState>("loading");
  const prevCreditsRef = useRef<bigint | null>(null);
  const increasedRef = useRef(false);

  const epochNum = currentEpoch;

  // Credits this epoch
  const { data: currentCredits } = useReadContract({
    address: MINING_ADDRESS,
    abi: miningAbi,
    functionName: "credits",
    args: epochNum !== undefined ? [BigInt(epochNum), poolAddress] : undefined,
    query: { enabled: epochNum !== undefined, refetchInterval: 10_000 },
  });

  // Credits previous epoch (to detect "was active recently")
  const prevEpoch = epochNum !== undefined && epochNum > 0 ? epochNum - 1 : undefined;
  const { data: prevEpochCredits } = useReadContract({
    address: MINING_ADDRESS,
    abi: miningAbi,
    functionName: "credits",
    args: prevEpoch !== undefined ? [BigInt(prevEpoch), poolAddress] : undefined,
    query: { enabled: prevEpoch !== undefined },
  });

  // Detect credit increases = bot is live right now
  useEffect(() => {
    if (currentCredits === undefined) return;

    if (prevCreditsRef.current !== null && currentCredits > prevCreditsRef.current) {
      increasedRef.current = true;
    }
    prevCreditsRef.current = currentCredits;
  }, [currentCredits]);

  // Determine state
  useEffect(() => {
    if (epochNum === undefined || currentCredits === undefined) {
      setBotState("loading");
      return;
    }

    if (increasedRef.current) {
      setBotState("live");
    } else if (currentCredits > 0n) {
      setBotState("active");
    } else if (prevEpochCredits !== undefined && prevEpochCredits > 0n) {
      setBotState("idle");
    } else {
      setBotState("offline");
    }
  }, [epochNum, currentCredits, prevEpochCredits]);

  const cfg = STATUS_CONFIG[botState];

  if (compact) {
    return (
      <div className="flex items-center gap-1.5" title={`Bot: ${cfg.label} — ${cfg.desc}`}>
        <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dot}`} />
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${cfg.text}`}>
          {cfg.label}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className={`h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />
      <div>
        <span className={`text-xs font-semibold uppercase tracking-wider ${cfg.text}`}>
          Bot: {cfg.label}
        </span>
        <p className="text-[10px] text-muted">{cfg.desc}</p>
      </div>
    </div>
  );
}
