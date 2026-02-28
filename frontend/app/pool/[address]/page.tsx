"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, encodeFunctionData } from "viem";
import { poolAbi, erc20Abi, miningAbi } from "@/lib/contracts";
import { MINING_ADDRESS } from "@/lib/config";
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
  const [newFeeBps, setNewFeeBps] = useState("");
  const [newOperator, setNewOperator] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [opSelectorInput, setOpSelectorInput] = useState("");

  // ── Pool reads ──
  const { data: totalActive, refetch: refetchActive } = useReadContract({
    address, abi: poolAbi, functionName: "totalActiveStake",
  });
  const { data: totalPending } = useReadContract({
    address, abi: poolAbi, functionName: "globalPendingStake",
  });
  const { data: globalLastUpdateEpoch } = useReadContract({
    address, abi: poolAbi, functionName: "globalLastUpdateEpoch",
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
  const { data: owner } = useReadContract({
    address, abi: poolAbi, functionName: "owner",
  });
  const { data: maxStake } = useReadContract({
    address, abi: poolAbi, functionName: "maxStake",
  });

  // ── Mining epoch (to detect lazy pending→active transition) ──
  const { data: currentEpoch } = useReadContract({
    address: MINING_ADDRESS,
    abi: miningAbi,
    functionName: "currentEpoch",
    query: { refetchInterval: 30_000 },
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
  const { writeContract: setFeeCall, data: setFeeTx, isPending: isSettingFee } = useWriteContract();
  const { writeContract: setOperatorCall, data: setOperatorTx, isPending: isSettingOperator } = useWriteContract();
  const { writeContract: transferOwnershipCall, data: transferOwnershipTx, isPending: isTransferring } = useWriteContract();
  const { writeContract: setOperatorSelectorCall, data: setOperatorSelectorTx, isPending: isSettingOpSelector } = useWriteContract();

  const { isSuccess: approveOk } = useWaitForTransactionReceipt({ hash: approveTx });
  const { isSuccess: depositOk } = useWaitForTransactionReceipt({ hash: depositTx });
  const { isSuccess: withdrawOk } = useWaitForTransactionReceipt({ hash: withdrawTx });
  const { isSuccess: claimOk } = useWaitForTransactionReceipt({ hash: claimTx });
  const { isSuccess: triggerOk } = useWaitForTransactionReceipt({ hash: triggerTx });
  const { isSuccess: setFeeOk } = useWaitForTransactionReceipt({ hash: setFeeTx });
  const { isSuccess: setOperatorOk } = useWaitForTransactionReceipt({ hash: setOperatorTx });
  const { isSuccess: transferOwnershipOk } = useWaitForTransactionReceipt({ hash: transferOwnershipTx });
  const { isSuccess: setOpSelectorOk } = useWaitForTransactionReceipt({ hash: setOperatorSelectorTx });

  useEffect(() => {
    if (approveOk) {
      refetchAllowance();
    }
  }, [approveOk, refetchAllowance]);

  useEffect(() => {
    if (depositOk) {
      refetchActive(); refetchStakeInfo(); refetchReward();
      refetchBalance(); refetchAllowance();
      setDepositAmount("");
    }
  }, [depositOk, refetchActive, refetchStakeInfo, refetchReward, refetchBalance, refetchAllowance]);

  useEffect(() => {
    if (withdrawOk) {
      refetchActive(); refetchStakeInfo(); refetchReward();
      refetchBalance();
      setWithdrawAmount("");
    }
  }, [withdrawOk, refetchActive, refetchStakeInfo, refetchReward, refetchBalance]);

  useEffect(() => {
    if (claimOk) {
      refetchReward(); refetchBalance();
    }
  }, [claimOk, refetchReward, refetchBalance]);

  useEffect(() => {
    if (triggerOk) {
      refetchActive(); refetchStakeInfo(); refetchReward();
    }
  }, [triggerOk, refetchActive, refetchStakeInfo, refetchReward]);

  useEffect(() => {
    if (setFeeOk || setOperatorOk || transferOwnershipOk) {
      refetchActive();
    }
  }, [setFeeOk, setOperatorOk, transferOwnershipOk, refetchActive]);

  // ── Derived ──
  const rawActive = stakeInfo?.[0] ?? 0n;
  const rawPending = stakeInfo?.[1] ?? 0n;
  const lastDepositEpoch = stakeInfo?.[2] ?? 0n;

  // Pool-level: if currentEpoch > globalLastUpdateEpoch, all global pending is effectively active
  const poolEpochAdvanced =
    currentEpoch !== undefined &&
    globalLastUpdateEpoch !== undefined &&
    (totalPending ?? 0n) > 0n &&
    BigInt(currentEpoch) > BigInt(globalLastUpdateEpoch);

  const effectiveTotalActive = (totalActive ?? 0n) + (poolEpochAdvanced ? (totalPending ?? 0n) : 0n);
  const effectiveTotalPending = poolEpochAdvanced ? 0n : (totalPending ?? 0n);

  // User-level: if currentEpoch > lastDepositEpoch, user's pending is effectively active
  const userEpochAdvanced =
    currentEpoch !== undefined &&
    lastDepositEpoch > 0n &&
    rawPending > 0n &&
    BigInt(currentEpoch) > BigInt(lastDepositEpoch);

  const userActive = userEpochAdvanced ? rawActive + rawPending : rawActive;
  const userPending = userEpochAdvanced ? 0n : rawPending;

  const feePercent = feeBps !== undefined ? Number(feeBps) / 100 : 0;
  const isOwner = userAddress && owner && userAddress.toLowerCase() === owner.toLowerCase();

  const depositWei = (() => {
    try { return depositAmount ? parseEther(depositAmount) : 0n; }
    catch { return 0n; }
  })();
  // Default to needing approval when allowance hasn't loaded yet to prevent failed deposits
  const needsApproval = depositWei > 0n && (allowance === undefined || allowance < depositWei);

  // Pool cap validation
  const currentTotal = (totalActive ?? 0n) + (totalPending ?? 0n);
  const isCapped = maxStake !== undefined && maxStake > 0n;
  const remaining = isCapped ? (maxStake > currentTotal ? maxStake - currentTotal : 0n) : 0n;
  const overCap = isCapped && depositWei > 0n && depositWei > remaining;
  const poolFull = isCapped && remaining === 0n;

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
  function handleSetFee() {
    const bps = parseInt(newFeeBps);
    if (!isNaN(bps) && bps >= 0) {
      setFeeCall({ address, abi: poolAbi, functionName: "setFee", args: [BigInt(bps)] });
    }
  }
  function handleSetOperator() {
    if (newOperator && newOperator.startsWith("0x")) {
      setOperatorCall({ address, abi: poolAbi, functionName: "setOperator", args: [newOperator as `0x${string}`] });
    }
  }
  function handleTransferOwnership() {
    if (newOwner && newOwner.startsWith("0x")) {
      transferOwnershipCall({ address, abi: poolAbi, functionName: "transferOwnership", args: [newOwner as `0x${string}`] });
    }
  }
  function handleSetOperatorSelector(allowed: boolean) {
    const sel = opSelectorInput.trim();
    if (sel && sel.startsWith("0x") && sel.length === 10) {
      setOperatorSelectorCall({ address, abi: poolAbi, functionName: "setAllowedOperatorSelector", args: [sel as `0x${string}`, allowed] });
    }
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
          <div>
            <span className="text-muted text-xs">Max Stake Cap</span>
            <p className="text-text font-semibold mt-0.5">{maxStake ? fmtToken(maxStake) : "—"}</p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatBlock label="Total Staked" value={fmtToken(effectiveTotalActive)} accent />
          <StatBlock label="Pending" value={fmtToken(effectiveTotalPending)} />
          <StatBlock label="Your Active" value={fmtToken(userActive)} accent />
          <StatBlock label="Your Pending" value={fmtToken(userPending)} />
        </div>
        {(poolEpochAdvanced || userEpochAdvanced) && (
          <p className="mt-2 text-xs text-success">Epoch advanced — pending stake is now withdrawable</p>
        )}
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
                    onClick={() => {
                      if (!tokenBalance) return;
                      const bal = tokenBalance;
                      const max = isCapped && remaining < bal ? remaining : bal;
                      setDepositAmount((Number(max) / 1e18).toString());
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-accent hover:text-base-blue-light cursor-pointer font-medium"
                  >
                    MAX
                  </button>
                </div>

                {/* Quick-pick percentage buttons */}
                {tokenBalance && tokenBalance > 0n && (
                  <div className="flex gap-2 mt-2">
                    {[25, 50, 75, 100].map((pct) => (
                      <button
                        key={pct}
                        onClick={() => {
                          const bal = tokenBalance;
                          const raw = (bal * BigInt(pct)) / 100n;
                          const max = isCapped && remaining < raw ? remaining : raw;
                          setDepositAmount((Number(max) / 1e18).toString());
                        }}
                        className="flex-1 py-1 text-[11px] font-medium text-muted hover:text-text bg-white/5 hover:bg-white/10 rounded transition-colors cursor-pointer"
                      >
                        {pct === 100 ? "MAX" : `${pct}%`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {overCap && (
                <p className="text-xs text-danger">Exceeds pool capacity — max {fmtToken(remaining)} remaining</p>
              )}
              {poolFull && !overCap && (
                <p className="text-xs text-danger">Pool is full</p>
              )}

              {!isConnected ? (
                <p className="text-center text-xs text-muted">Connect wallet to deposit</p>
              ) : needsApproval ? (
                <button onClick={handleApprove} disabled={isApproving || depositWei === 0n || overCap || poolFull}
                  className="btn-warn w-full py-3 text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed">
                  {isApproving ? "Approving..." : "Approve BOTCOIN"}
                </button>
              ) : (
                <button onClick={handleDeposit} disabled={isDepositing || depositWei === 0n || overCap || poolFull}
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
            {effectiveTotalActive > 0n && (
              <div className="mt-3 pt-3 border-t border-border text-xs text-muted">
                Pool share: <span className="text-base-blue-light font-medium">{((Number(userActive) / Number(effectiveTotalActive)) * 100).toFixed(2)}%</span>
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

      {/* Admin Panel - only visible to owner */}
      {isOwner && (
        <div className="gradient-border p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-1.5 w-1.5 rounded-full bg-warn pulse-dot" />
            <span className="text-xs text-warn uppercase tracking-wide">Admin Panel</span>
          </div>

          <div className="space-y-5">
            {/* Decrease Fee */}
            <div>
              <label className="text-xs text-muted block mb-1.5">Decrease Operator Fee</label>
              <p className="text-[11px] text-text-dim mb-2">Current: {feePercent}% ({String(feeBps ?? 0)} bps) — can only decrease</p>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="New fee in bps (e.g. 500 = 5%)"
                  value={newFeeBps}
                  onChange={(e) => setNewFeeBps(e.target.value)}
                  className="pool-input flex-1 px-3 py-2.5 text-sm"
                />
                <button
                  onClick={handleSetFee}
                  disabled={isSettingFee || !newFeeBps}
                  className="btn-warn px-5 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSettingFee ? "Updating..." : "Set Fee"}
                </button>
              </div>
              {setFeeOk && (
                <p className="text-xs glow-success mt-2">✓ Fee decreased successfully</p>
              )}
            </div>

            <div className="border-t border-border" />

            {/* Set Operator */}
            <div>
              <label className="text-xs text-muted block mb-1.5">Change Operator</label>
              <p className="text-[11px] text-text-dim mb-2">Current: {operator ? shortAddr(operator) : "—"}</p>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="New operator address (0x...)"
                  value={newOperator}
                  onChange={(e) => setNewOperator(e.target.value)}
                  className="pool-input flex-1 px-3 py-2.5 text-sm"
                />
                <button
                  onClick={handleSetOperator}
                  disabled={isSettingOperator || !newOperator}
                  className="btn-warn px-5 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSettingOperator ? "Updating..." : "Set Operator"}
                </button>
              </div>
              {setOperatorOk && (
                <p className="text-xs glow-success mt-2">✓ Operator updated successfully</p>
              )}
            </div>

            <div className="border-t border-border" />

            {/* Operator Selector Whitelist */}
            <div>
              <label className="text-xs text-muted block mb-1.5">Operator Selector Whitelist</label>
              <p className="text-[11px] text-text-dim mb-2">Controls which mining contract functions the operator can call. Enter a 4-byte selector (e.g. 0x12345678).</p>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="0x12345678"
                  value={opSelectorInput}
                  onChange={(e) => setOpSelectorInput(e.target.value)}
                  className="pool-input flex-1 px-3 py-2.5 text-sm font-tabular"
                />
                <button
                  onClick={() => handleSetOperatorSelector(true)}
                  disabled={isSettingOpSelector || !opSelectorInput}
                  className="btn-ghost px-4 py-2.5 text-sm font-medium text-success border-success/30 hover:bg-success/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSettingOpSelector ? "..." : "Allow"}
                </button>
                <button
                  onClick={() => handleSetOperatorSelector(false)}
                  disabled={isSettingOpSelector || !opSelectorInput}
                  className="btn-ghost px-4 py-2.5 text-sm font-medium text-danger border-danger/30 hover:bg-danger/10 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isSettingOpSelector ? "..." : "Revoke"}
                </button>
              </div>
              {setOpSelectorOk && (
                <p className="text-xs glow-success mt-2">✓ Operator selector updated</p>
              )}
            </div>

            <div className="border-t border-border" />

            {/* Transfer Ownership */}
            <div>
              <label className="text-xs text-muted block mb-1.5">Transfer Ownership</label>
              <p className="text-[11px] text-error mb-2">⚠ This action is irreversible. You will lose admin access.</p>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="New owner address (0x...)"
                  value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                  className="pool-input flex-1 px-3 py-2.5 text-sm"
                />
                <button
                  onClick={handleTransferOwnership}
                  disabled={isTransferring || !newOwner}
                  className="btn-primary px-5 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed bg-error/20 hover:bg-error/30 border-error/50"
                >
                  {isTransferring ? "Transferring..." : "Transfer"}
                </button>
              </div>
              {transferOwnershipOk && (
                <p className="text-xs glow-success mt-2">✓ Ownership transferred</p>
              )}
            </div>
          </div>
        </div>
      )}
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
