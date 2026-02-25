"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, encodeFunctionData } from "viem";
import { poolAbi, erc20Abi } from "@/lib/contracts";
import { fmtToken, shortAddr } from "@/lib/utils";
import Link from "next/link";

// The whitelisted claim selector: claim(uint64[]) = 0x35442c43

export default function PoolPage() {
  const params = useParams();
  const address = params.address as `0x${string}`;
  const { address: userAddress, isConnected } = useAccount();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");

  // ── Pool reads ──
  const { data: totalActive, refetch: refetchActive } = useReadContract({
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
  const { data: stakingTokenAddr } = useReadContract({
    address, abi: poolAbi, functionName: "stakingToken",
  });

  // ── User reads ──
  const { data: stakeInfo, refetch: refetchStakeInfo } = useReadContract({
    address, abi: poolAbi, functionName: "getStakeInfo",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress },
  });
  const { data: pendingReward, refetch: refetchReward } = useReadContract({
    address, abi: poolAbi, functionName: "rewards",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress },
  });
  const { data: tokenBalance, refetch: refetchBalance } = useReadContract({
    address: stakingTokenAddr, abi: erc20Abi, functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress && !!stakingTokenAddr },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: stakingTokenAddr, abi: erc20Abi, functionName: "allowance",
    args: userAddress ? [userAddress, address] : undefined,
    query: { enabled: !!userAddress && !!stakingTokenAddr },
  });

  // ── Writes ──
  const { writeContract: approve, data: approveTx, isPending: isApproving } = useWriteContract();
  const { writeContract: deposit, data: depositTx, isPending: isDepositing } = useWriteContract();
  const { writeContract: withdraw, data: withdrawTx, isPending: isWithdrawing } = useWriteContract();
  const { writeContract: claim, data: claimTx, isPending: isClaiming } = useWriteContract();
  const { writeContract: triggerClaim, data: triggerTx, isPending: isTriggering } = useWriteContract();

  const { isSuccess: approveOk } = useWaitForTransactionReceipt({ hash: approveTx });
  const { isSuccess: depositOk } = useWaitForTransactionReceipt({ hash: depositTx });
  const { isSuccess: withdrawOk } = useWaitForTransactionReceipt({ hash: withdrawTx });
  const { isSuccess: claimOk } = useWaitForTransactionReceipt({ hash: claimTx });
  const { isSuccess: triggerOk } = useWaitForTransactionReceipt({ hash: triggerTx });

  useEffect(() => {
    if (approveOk || depositOk || withdrawOk || claimOk || triggerOk) {
      refetchActive(); refetchStakeInfo(); refetchReward();
      refetchBalance(); refetchAllowance();
      setDepositAmount(""); setWithdrawAmount("");
    }
  }, [approveOk, depositOk, withdrawOk, claimOk, triggerOk, refetchActive, refetchStakeInfo, refetchReward, refetchBalance, refetchAllowance]);

  // ── Derived ──
  const userActive = stakeInfo?.[0] ?? 0n;
  const userPending = stakeInfo?.[1] ?? 0n;
  const feePercent = feeBps !== undefined ? Number(feeBps) / 100 : 0;

  const depositWei = (() => {
    try { return depositAmount ? parseEther(depositAmount) : 0n; }
    catch { return 0n; }
  })();
  const needsApproval = allowance !== undefined && depositWei > 0n && allowance < depositWei;

  // ── Handlers ──
  function handleApprove() {
    if (!stakingTokenAddr) return;
    approve({ address: stakingTokenAddr, abi: erc20Abi, functionName: "approve", args: [address, depositWei] });
  }
  function handleDeposit() {
    deposit({ address, abi: poolAbi, functionName: "deposit", args: [depositWei] });
  }
  function handleWithdraw() {
    try {
      withdraw({ address, abi: poolAbi, functionName: "withdraw", args: [parseEther(withdrawAmount)] });
    } catch { /* invalid */ }
  }
  function handleClaim() {
    claim({ address, abi: poolAbi, functionName: "claimReward" });
  }
  function handleTriggerClaim() {
    const claimCalldata = encodeFunctionData({
      abi: [{ name: "claim", type: "function", inputs: [{ name: "ids", type: "uint64[]" }], outputs: [], stateMutability: "nonpayable" }],
      functionName: "claim",
      args: [[]],
    });
    triggerClaim({ address, abi: poolAbi, functionName: "triggerClaim", args: [claimCalldata] });
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Navigation */}
      <div className="flex items-center justify-between text-xs">
        <Link href="/" className="text-muted hover:text-base-blue-light transition-colors">
          ← Back to Pools
        </Link>
        <a
          href={`https://basescan.org/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-base-blue-light hover:underline"
        >
          BaseScan ↗
        </a>
      </div>

      {/* Pool Header Panel */}
      <div className="gradient-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
          <span className="text-xs text-muted uppercase tracking-wide">Pool Details</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-muted text-xs">Address</span>
            <p className="text-base-blue-light font-semibold font-tabular mt-0.5">{shortAddr(address)}</p>
          </div>
          <div>
            <span className="text-muted text-xs">Operator</span>
            <p className="text-text font-medium mt-0.5">{operator ? shortAddr(operator) : "—"}</p>
          </div>
          <div>
            <span className="text-muted text-xs">Fee</span>
            <p className="text-warn font-semibold mt-0.5">{feePercent}%</p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatBlock label="Total Staked" value={fmtToken(totalActive)} accent />
          <StatBlock label="Pending" value={fmtToken(totalPending)} />
          <StatBlock label="Your Active" value={fmtToken(userActive)} accent />
          <StatBlock label="Your Pending" value={fmtToken(userPending)} />
        </div>
      </div>

      {/* Action Panels */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Deposit / Withdraw */}
        <div className="glass-card p-5">
          {/* Tab bar */}
          <div className="flex gap-1 mb-5 bg-black/20 rounded-lg p-1">
            <button
              onClick={() => setActiveTab("deposit")}
              className={`flex-1 py-2 text-sm rounded-md transition-all font-medium ${
                activeTab === "deposit"
                  ? "bg-base-blue/15 text-base-blue-light shadow-sm"
                  : "text-muted hover:text-text"
              }`}
            >
              Deposit
            </button>
            <button
              onClick={() => setActiveTab("withdraw")}
              className={`flex-1 py-2 text-sm rounded-md transition-all font-medium ${
                activeTab === "withdraw"
                  ? "bg-base-blue/15 text-base-blue-light shadow-sm"
                  : "text-muted hover:text-text"
              }`}
            >
              Withdraw
            </button>
          </div>

          {activeTab === "deposit" ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-xs text-muted mb-1.5">
                  <span>Amount</span>
                  <span>Balance: <span className="text-text font-tabular">{fmtToken(tokenBalance)}</span></span>
                </div>
                <div className="relative">
                  <input
                    type="text" placeholder="0.00" value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="pool-input w-full px-3 py-3 text-sm pr-14"
                  />
                  <button
                    onClick={() => tokenBalance && setDepositAmount((Number(tokenBalance) / 1e18).toString())}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-accent hover:text-base-blue-light cursor-pointer font-medium"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {!isConnected ? (
                <p className="text-center text-xs text-muted">Connect wallet to deposit</p>
              ) : needsApproval ? (
                <button onClick={handleApprove} disabled={isApproving || depositWei === 0n}
                  className="btn-warn w-full py-3 text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed">
                  {isApproving ? "Approving..." : "Approve BOTCOIN"}
                </button>
              ) : (
                <button onClick={handleDeposit} disabled={isDepositing || depositWei === 0n}
                  className="btn-primary w-full py-3 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                  {isDepositing ? "Depositing..." : "Deposit"}
                </button>
              )}
              <p className="text-center text-[11px] text-muted">Deposits activate next epoch</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-xs text-muted mb-1.5">
                  <span>Amount</span>
                  <span>Active: <span className="text-text font-tabular">{fmtToken(userActive)}</span></span>
                </div>
                <div className="relative">
                  <input
                    type="text" placeholder="0.00" value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="pool-input w-full px-3 py-3 text-sm pr-14"
                  />
                  <button
                    onClick={() => setWithdrawAmount((Number(userActive) / 1e18).toString())}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-accent hover:text-base-blue-light cursor-pointer font-medium"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {!isConnected ? (
                <p className="text-center text-xs text-muted">Connect wallet to withdraw</p>
              ) : (
                <button onClick={handleWithdraw} disabled={isWithdrawing || !withdrawAmount}
                  className="btn-primary w-full py-3 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                  {isWithdrawing ? "Withdrawing..." : "Withdraw"}
                </button>
              )}
              <p className="text-center text-[11px] text-muted">Only active stake can be withdrawn</p>
            </div>
          )}
        </div>

        {/* Right column: Rewards + Trigger */}
        <div className="space-y-5">
          {/* Rewards */}
          <div className="glass-card p-5">
            <p className="text-xs text-muted uppercase tracking-wide mb-3">Your Rewards</p>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-2xl font-bold glow-blue font-tabular">{fmtToken(pendingReward)}</p>
                <p className="text-xs text-muted mt-1">BOTCOIN claimable</p>
              </div>
              <button onClick={handleClaim} disabled={isClaiming || !isConnected || pendingReward === 0n}
                className="btn-primary px-5 py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                {isClaiming ? "Claiming..." : "Claim"}
              </button>
            </div>
            {totalActive && totalActive > 0n && (
              <div className="mt-3 pt-3 border-t border-border text-xs text-muted">
                Pool share: <span className="text-base-blue-light font-medium">{((Number(userActive) / Number(totalActive)) * 100).toFixed(2)}%</span>
              </div>
            )}
          </div>

          {/* Trustless Trigger */}
          <div className="gradient-border p-5">
            <p className="text-xs text-muted uppercase tracking-wide mb-2">Trigger Claim</p>
            <p className="text-sm text-text-dim mb-4 leading-relaxed">
              Anyone can trigger this to distribute mining rewards.
              No admin keys needed. <span className="text-success font-medium">Fully trustless.</span>
            </p>
            <button onClick={handleTriggerClaim} disabled={isTriggering || !isConnected}
              className="btn-ghost w-full py-3 text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed">
              {isTriggering ? "Triggering..." : "Trigger Mining Claim →"}
            </button>
            {triggerOk && (
              <p className="mt-3 text-xs glow-success">✓ Rewards distributed to pool stakers</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBlock({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-muted uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold font-tabular mt-0.5 ${accent ? "text-text" : "text-text-dim"}`}>{value}</p>
    </div>
  );
}
