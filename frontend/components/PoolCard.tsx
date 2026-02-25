"use client";

import { useState } from "react";
import { useReadContract } from "wagmi";
import { poolAbi } from "@/lib/contracts";
import { fmtToken, shortAddr } from "@/lib/utils";
import Link from "next/link";

/** Compact number display */
function compactNum(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
}

interface PoolRowProps {
  address: `0x${string}`;
  credits?: bigint;
  sharePercent?: number;
}

export default function PoolRow({ address, credits, sharePercent }: PoolRowProps) {
  const [expanded, setExpanded] = useState(false);

  const { data: totalActive } = useReadContract({
    address, abi: poolAbi, functionName: "totalActiveStake",
  });
  const { data: totalPending } = useReadContract({
    address, abi: poolAbi, functionName: "globalPendingStake",
  });
  const { data: feeBps } = useReadContract({
    address, abi: poolAbi, functionName: "feeBps",
  });
  const { data: operator } = useReadContract({
    address, abi: poolAbi, functionName: "operator",
  });
  const { data: maxStake } = useReadContract({
    address, abi: poolAbi, functionName: "maxStake",
  });

  const feePercent = feeBps !== undefined ? Number(feeBps) / 100 : undefined;
  const totalStake = (totalActive ?? 0n) + (totalPending ?? 0n);
  const isCapped = maxStake !== undefined && maxStake > 0n;
  const isFull = isCapped && totalStake >= maxStake;
  const capPercent = isCapped ? Number((totalStake * 100n) / maxStake) : 0;

  return (
    <div className="border-b border-border last:border-b-0">
      {/* Main row — clickable to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-card-hover/50 transition-colors text-left cursor-pointer"
      >
        {/* Status dot */}
        <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${isFull ? "bg-danger" : "bg-success pulse-dot"}`} />

        {/* Address */}
        <span className="text-sm font-semibold text-base-blue-light font-tabular w-28 shrink-0">
          {shortAddr(address)}
        </span>

        {/* Staked */}
        <span className="text-sm text-text font-tabular min-w-20 hidden sm:block">
          {fmtToken(totalActive)}
        </span>

        {/* Fee */}
        <span className="text-xs text-warn font-medium w-16 text-right hidden sm:block">
          {feePercent !== undefined ? `${feePercent}%` : "—"}
        </span>

        {/* Credits / Share */}
        <span className={`text-xs font-tabular w-16 text-right hidden sm:block ${
          credits && credits > 0n ? "text-success font-semibold" : "text-muted"
        }`}>
          {credits && credits > 0n
            ? sharePercent !== undefined && sharePercent > 0
              ? `${sharePercent.toFixed(1)}%`
              : compactNum(Number(credits))
            : "—"}
        </span>

        {/* Cap bar (inline, compact) */}
        <div className="flex-1 hidden md:flex items-center gap-2 max-w-50">
          {isCapped ? (
            <>
              <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    isFull ? "bg-danger" : capPercent > 80 ? "bg-warn" : "bg-success"
                  }`}
                  style={{ width: `${Math.min(capPercent, 100)}%` }}
                />
              </div>
              <span className={`text-[10px] font-tabular w-8 text-right ${isFull ? "text-danger" : "text-muted"}`}>
                {capPercent}%
              </span>
            </>
          ) : (
            <span className="text-[10px] text-muted">No cap</span>
          )}
        </div>

        {/* Status badge + chevron */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {isFull && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-danger bg-danger/10 px-1.5 py-0.5 rounded">
              Full
            </span>
          )}
          <svg
            className={`w-3.5 h-3.5 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-card/30">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Active Stake</p>
              <p className="text-text font-semibold font-tabular">{fmtToken(totalActive)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Pending</p>
              <p className="text-warn font-semibold font-tabular">{fmtToken(totalPending)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Operator Fee</p>
              <p className="text-text font-semibold font-tabular">{feePercent !== undefined ? `${feePercent}%` : "—"}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Credits (epoch)</p>
              <p className="text-text font-semibold font-tabular">
                {credits && credits > 0n ? compactNum(Number(credits)) : "0"}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Reward Share</p>
              <p className={`font-semibold font-tabular ${sharePercent && sharePercent > 0 ? "text-success" : "text-muted"}`}>
                {sharePercent && sharePercent > 0 ? `${sharePercent.toFixed(1)}%` : "—"}
              </p>
            </div>
            {isCapped && (
              <div>
                <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">Pool Cap</p>
                <p className="text-text-dim font-semibold font-tabular">
                  {fmtToken(totalStake)} / {fmtToken(maxStake)}
                </p>
              </div>
            )}
          </div>

          {/* Operator */}
          {operator && (
            <p className="text-xs text-muted mb-3">
              Operator: <span className="text-text-dim font-tabular">{shortAddr(operator)}</span>
            </p>
          )}

          {/* Contract address + link */}
          <div className="flex items-center gap-3">
            <p className="text-[10px] text-muted font-tabular break-all">{address}</p>
            <Link
              href={`/pool/${address}`}
              className="shrink-0 btn-ghost px-3 py-1.5 text-xs"
            >
              Open Pool →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
