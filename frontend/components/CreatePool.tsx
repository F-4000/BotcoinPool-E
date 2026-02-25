"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { factoryAbi } from "@/lib/contracts";
import { FACTORY_ADDRESS } from "@/lib/config";

interface CreatePoolProps {
  onCreated?: () => void;
}

export default function CreatePool({ onCreated }: CreatePoolProps) {
  const { address: userAddress } = useAccount();
  const [operatorAddr, setOperatorAddr] = useState(userAddress ?? "");
  const [feeBps, setFeeBps] = useState("50"); // 0.5% default
  const [maxStakeM, setMaxStakeM] = useState("100"); // 100M default

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  function handleCreate() {
    if (!operatorAddr) return;
    const cap = maxStakeM ? parseEther((Number(maxStakeM) * 1_000_000).toString()) : 0n;
    writeContract({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: "createPool",
      args: [operatorAddr as `0x${string}`, BigInt(feeBps), cap],
    });
  }

  if (isSuccess) {
    return (
      <div className="gradient-border p-5">
        <p className="glow-success text-sm font-medium mb-2">Pool deployed successfully</p>
        <p className="text-xs text-muted">
          TX:{" "}
          <a
            href={`https://basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-base-blue-light hover:underline"
          >
            {txHash?.slice(0, 20)}...
          </a>
        </p>
        <button onClick={onCreated} className="btn-ghost px-4 py-1.5 text-xs mt-3">
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="gradient-border p-5 space-y-4">
      <h3 className="text-sm font-semibold text-text">Create New Pool</h3>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="text-xs text-muted block mb-1.5">Operator Address</label>
          <input
            type="text"
            placeholder="0x..."
            value={operatorAddr}
            onChange={(e) => setOperatorAddr(e.target.value)}
            className="pool-input w-full px-3 py-2.5 text-sm"
          />
          <p className="mt-1 text-[11px] text-muted">Solver wallet that signs challenges</p>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1.5">Fee (basis points)</label>
          <input
            type="number"
            min="0"
            max="1000"
            placeholder="50"
            value={feeBps}
            onChange={(e) => setFeeBps(e.target.value)}
            className="pool-input w-full px-3 py-2.5 text-sm"
          />
          <p className="mt-1 text-[11px] text-muted">
            {feeBps ? `${Number(feeBps) / 100}%` : "0%"} of rewards · Max 1000 bps (10%)
          </p>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1.5">Pool Cap (millions)</label>
          <input
            type="number"
            min="0"
            placeholder="75"
            value={maxStakeM}
            onChange={(e) => setMaxStakeM(e.target.value)}
            className="pool-input w-full px-3 py-2.5 text-sm"
          />
          <p className="mt-1 text-[11px] text-muted">
            {maxStakeM ? `${Number(maxStakeM)}M BOTCOIN` : "Unlimited"} · 3x bonus caps at 75M
          </p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-danger">
          {(error as Error).message?.slice(0, 120) ?? "Transaction failed"}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleCreate}
          disabled={isPending || isConfirming || !operatorAddr}
          className="btn-primary px-5 py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isPending ? "Confirm in Wallet..." : isConfirming ? "Deploying..." : "Deploy Pool"}
        </button>
        <button onClick={onCreated} className="text-sm text-muted hover:text-text transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
