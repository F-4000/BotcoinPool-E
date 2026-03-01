"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { poolAbi, erc20Abi, miningAbi } from "@/lib/contracts";
import { MINING_ADDRESS } from "@/lib/config";
import { fmtToken, shortAddr } from "@/lib/utils";
import Link from "next/link";
import BotStatus from "@/components/BotStatus";
import OperatorSetup from "@/components/OperatorSetup";

// Pool states matching the Solidity enum
const POOL_STATES = ["Idle", "Active", "Unstaking"] as const;
type PoolStateName = (typeof POOL_STATES)[number];

const STATE_COLORS: Record<PoolStateName, string> = {
  Idle: "text-muted",
  Active: "text-success",
  Unstaking: "text-warn",
};

const STATE_DOTS: Record<PoolStateName, string> = {
  Idle: "bg-muted",
  Active: "bg-success pulse-dot",
  Unstaking: "bg-warn pulse-dot",
};

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

  // ── Pool info (single call for state + mining data) ──
  const { data: poolInfo, refetch: refetchPoolInfo } = useReadContract({
    address,
    abi: poolAbi,
    functionName: "getPoolInfo",
    query: { refetchInterval: 15_000 },
  });

  const { data: feeBps } = useReadContract({ address, abi: poolAbi, functionName: "feeBps" });
  const { data: operator } = useReadContract({ address, abi: poolAbi, functionName: "operator" });
  const { data: stakingTokenAddr } = useReadContract({ address, abi: poolAbi, functionName: "stakingToken" });
  const { data: owner } = useReadContract({ address, abi: poolAbi, functionName: "owner" });
  const { data: maxStake } = useReadContract({ address, abi: poolAbi, functionName: "maxStake" });
  const { data: unstakeRequestEpoch, refetch: refetchRequestEpoch } = useReadContract({
    address, abi: poolAbi, functionName: "unstakeRequestEpoch",
    query: { refetchInterval: 15_000 },
  });

  // ── User info ──
  const { data: userInfo, refetch: refetchUserInfo } = useReadContract({
    address,
    abi: poolAbi,
    functionName: "getUserInfo",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress },
  });
  const { data: tokenBalance, refetch: refetchBalance } = useReadContract({
    address: stakingTokenAddr,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress && !!stakingTokenAddr },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: stakingTokenAddr,
    abi: erc20Abi,
    functionName: "allowance",
    args: userAddress ? [userAddress, address] : undefined,
    query: { enabled: !!userAddress && !!stakingTokenAddr },
  });

  // ── Mining reads ──
  const currentEpoch = poolInfo?.[4];
  const epochNum = currentEpoch !== undefined ? Number(currentEpoch) : undefined;

  const { data: poolCredits } = useReadContract({
    address: MINING_ADDRESS,
    abi: miningAbi,
    functionName: "credits",
    args: epochNum !== undefined ? [BigInt(epochNum), address] : undefined,
    query: { enabled: epochNum !== undefined, refetchInterval: 10_000 },
  });
  const { data: totalCreditsData } = useReadContract({
    address: MINING_ADDRESS,
    abi: miningAbi,
    functionName: "totalCredits",
    args: epochNum !== undefined ? [BigInt(epochNum)] : undefined,
    query: { enabled: epochNum !== undefined, refetchInterval: 10_000 },
  });

  // ── Writes ──
  const { writeContract: approve, data: approveTx, isPending: isApproving } = useWriteContract();
  const { writeContract: depositCall, data: depositTx, isPending: isDepositing } = useWriteContract();
  const { writeContract: withdrawShareCall, data: withdrawTx, isPending: isWithdrawing } = useWriteContract();
  const { writeContract: claimCall, data: claimTx, isPending: isClaiming } = useWriteContract();
  const { writeContract: stakeCall, data: stakeTx, isPending: isStaking } = useWriteContract();
  const { writeContract: requestUnstakeCall, data: requestUnstakeTx, isPending: isRequesting } = useWriteContract();
  const { writeContract: executeUnstakeCall, data: executeUnstakeTx, isPending: isExecutingUnstake } = useWriteContract();
  const { writeContract: finalizeCall, data: finalizeTx, isPending: isFinalizing } = useWriteContract();
  const { writeContract: topUpCall, data: topUpTx, isPending: isToppingUp } = useWriteContract();
  const { writeContract: triggerClaimCall, data: triggerTx, isPending: isTriggering } = useWriteContract();
  const { writeContract: triggerBonusCall, data: triggerBonusTx, isPending: isTriggeringBonus } = useWriteContract();
  const { writeContract: setFeeCall, data: setFeeTx, isPending: isSettingFee } = useWriteContract();
  const { writeContract: setOperatorCall, data: setOperatorTx, isPending: isSettingOperator } = useWriteContract();
  const { writeContract: transferOwnershipCall, data: transferOwnershipTx, isPending: isTransferring } = useWriteContract();
  const { writeContract: setOperatorSelectorCall, data: setOperatorSelectorTx, isPending: isSettingOpSelector } = useWriteContract();

  const { isSuccess: approveOk } = useWaitForTransactionReceipt({ hash: approveTx });
  const { isSuccess: depositOk } = useWaitForTransactionReceipt({ hash: depositTx });
  const { isSuccess: withdrawOk } = useWaitForTransactionReceipt({ hash: withdrawTx });
  const { isSuccess: claimOk } = useWaitForTransactionReceipt({ hash: claimTx });
  const { isSuccess: stakeOk } = useWaitForTransactionReceipt({ hash: stakeTx });
  const { isSuccess: requestUnstakeOk } = useWaitForTransactionReceipt({ hash: requestUnstakeTx });
  const { isSuccess: executeUnstakeOk } = useWaitForTransactionReceipt({ hash: executeUnstakeTx });
  const { isSuccess: finalizeOk } = useWaitForTransactionReceipt({ hash: finalizeTx });
  const { isSuccess: topUpOk } = useWaitForTransactionReceipt({ hash: topUpTx });
  const { isSuccess: triggerOk } = useWaitForTransactionReceipt({ hash: triggerTx });
  const { isSuccess: triggerBonusOk } = useWaitForTransactionReceipt({ hash: triggerBonusTx });
  const { isSuccess: setFeeOk } = useWaitForTransactionReceipt({ hash: setFeeTx });
  const { isSuccess: setOperatorOk } = useWaitForTransactionReceipt({ hash: setOperatorTx });
  const { isSuccess: transferOwnershipOk } = useWaitForTransactionReceipt({ hash: transferOwnershipTx });
  const { isSuccess: setOpSelectorOk } = useWaitForTransactionReceipt({ hash: setOperatorSelectorTx });

  // Refetch on success
  const refetchAll = useCallback(() => {
    refetchPoolInfo();
    refetchUserInfo();
    refetchBalance();
    refetchAllowance();
    refetchRequestEpoch();
  }, [refetchPoolInfo, refetchUserInfo, refetchBalance, refetchAllowance, refetchRequestEpoch]);

  useEffect(() => { if (approveOk) refetchAllowance(); }, [approveOk, refetchAllowance]);
  useEffect(() => { if (depositOk) { refetchAll(); setDepositAmount(""); } }, [depositOk, refetchAll]);
  useEffect(() => { if (withdrawOk) { refetchAll(); setWithdrawAmount(""); } }, [withdrawOk, refetchAll]);
  useEffect(() => { if (claimOk) refetchAll(); }, [claimOk, refetchAll]);
  useEffect(() => { if (stakeOk) refetchAll(); }, [stakeOk, refetchAll]);
  useEffect(() => { if (requestUnstakeOk) refetchAll(); }, [requestUnstakeOk, refetchAll]);
  useEffect(() => { if (executeUnstakeOk) refetchAll(); }, [executeUnstakeOk, refetchAll]);
  useEffect(() => { if (finalizeOk) refetchAll(); }, [finalizeOk, refetchAll]);
  useEffect(() => { if (topUpOk) refetchAll(); }, [topUpOk, refetchAll]);
  useEffect(() => { if (triggerOk) refetchAll(); }, [triggerOk, refetchAll]);
  useEffect(() => { if (triggerBonusOk) refetchAll(); }, [triggerBonusOk, refetchAll]);
  useEffect(() => { if (setFeeOk) refetchAll(); }, [setFeeOk, refetchAll]);
  useEffect(() => { if (setOperatorOk) refetchAll(); }, [setOperatorOk, refetchAll]);
  useEffect(() => { if (transferOwnershipOk) refetchAll(); }, [transferOwnershipOk, refetchAll]);
  useEffect(() => { if (setOpSelectorOk) refetchAll(); }, [setOpSelectorOk, refetchAll]);

  // ── Derived values ──
  const poolStateNum = poolInfo?.[0] ?? 0;
  const poolStateName = POOL_STATES[poolStateNum] ?? "Idle";
  const stakedInMining = poolInfo?.[1] ?? 0n;
  const totalDep = poolInfo?.[2] ?? 0n;
  const eligible = poolInfo?.[5] ?? false;
  const cooldownEnd = poolInfo?.[6] ?? 0n;

  const userDeposit = userInfo?.[0] ?? 0n;
  const userReward = userInfo?.[1] ?? 0n;
  const userShareBps = userInfo?.[2] ?? 0n;

  const feePercent = feeBps !== undefined ? Number(feeBps) / 100 : 0;
  const isOwner = userAddress && owner && userAddress.toLowerCase() === owner.toLowerCase();

  const depositsLocked = poolStateName === "Unstaking";
  const pendingDep = poolInfo?.[7] ?? 0n;

  const depositWei = (() => {
    try { return depositAmount ? parseEther(depositAmount) : 0n; }
    catch { return 0n; }
  })();
  const needsApproval = depositWei > 0n && (allowance === undefined || allowance < depositWei);

  // Pool cap
  const isCapped = maxStake !== undefined && maxStake > 0n;
  const effectiveTotal = totalDep; // totalDeposits already includes staked + pending
  const remaining = isCapped ? (maxStake > effectiveTotal ? maxStake - effectiveTotal : 0n) : 0n;
  const overCap = isCapped && depositWei > 0n && depositWei > remaining;
  const poolFull = isCapped && remaining === 0n;

  // Cooldown countdown
  const cooldownRemaining = useMemo(() => {
    if (poolStateName !== "Unstaking" || cooldownEnd === 0n) return null;
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now >= cooldownEnd) return "Ready";
    const secs = Number(cooldownEnd - now);
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    return `${hrs}h ${mins}m`;
  }, [poolStateName, cooldownEnd]);

  // Mining stats
  const creditShare = useMemo(() => {
    if (!poolCredits || !totalCreditsData || totalCreditsData === 0n) return 0;
    return (Number(poolCredits) / Number(totalCreditsData)) * 100;
  }, [poolCredits, totalCreditsData]);

  // Tier calculation
  const tier = useMemo(() => {
    if (stakedInMining >= 100_000_000n * 10n ** 18n) return 3;
    if (stakedInMining >= 50_000_000n * 10n ** 18n) return 2;
    if (stakedInMining >= 25_000_000n * 10n ** 18n) return 1;
    return 0;
  }, [stakedInMining]);

  // ── Handlers ──
  function handleApprove() {
    if (!stakingTokenAddr) return;
    approve({ address: stakingTokenAddr, abi: erc20Abi, functionName: "approve", args: [address, depositWei] });
  }
  function handleDeposit() {
    depositCall({ address, abi: poolAbi, functionName: "deposit", args: [depositWei] });
  }
  function handleWithdraw() {
    try {
      withdrawShareCall({ address, abi: poolAbi, functionName: "withdrawShare", args: [parseEther(withdrawAmount)] });
    } catch { /* invalid */ }
  }
  function handleClaim() {
    claimCall({ address, abi: poolAbi, functionName: "claimReward" });
  }
  function handleStakeIntoMining() {
    stakeCall({ address, abi: poolAbi, functionName: "stakeIntoMining" });
  }
  function handleRequestUnstake() {
    requestUnstakeCall({ address, abi: poolAbi, functionName: "requestUnstake" });
  }
  function handleExecuteUnstake() {
    executeUnstakeCall({ address, abi: poolAbi, functionName: "executeUnstake" });
  }
  function handleFinalizeWithdraw() {
    finalizeCall({ address, abi: poolAbi, functionName: "finalizeWithdraw" });
  }
  function handleTopUpStake() {
    topUpCall({ address, abi: poolAbi, functionName: "topUpStake" });
  }
  function handleTriggerClaim() {
    if (epochNum === undefined || epochNum < 1) return;
    // Claim previous epoch — current epoch hasn't ended yet
    triggerClaimCall({ address, abi: poolAbi, functionName: "triggerClaim", args: [[BigInt(epochNum - 1)]] });
  }
  function handleTriggerBonusClaim() {
    if (epochNum === undefined || epochNum < 1) return;
    triggerBonusCall({ address, abi: poolAbi, functionName: "triggerBonusClaim", args: [[BigInt(epochNum - 1)]] });
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
          <div className={`h-1.5 w-1.5 rounded-full ${STATE_DOTS[poolStateName]}`} />
          <span className="text-xs text-muted uppercase tracking-wide">Pool Details</span>
          <span className={`ml-auto text-xs font-semibold uppercase tracking-wider ${STATE_COLORS[poolStateName]}`}>
            {poolStateName}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <span className="text-muted text-xs">Address</span>
            <p className="text-base-blue-light font-semibold font-tabular mt-0.5">{shortAddr(address)}</p>
          </div>
          <div>
            <span className="text-muted text-xs">Operator</span>
            <p className="text-text font-medium mt-0.5">{operator ? shortAddr(operator) : "-"}</p>
          </div>
          <div>
            <span className="text-muted text-xs">Fee</span>
            <p className="text-warn font-semibold mt-0.5">{feePercent}%</p>
          </div>
          <div>
            <span className="text-muted text-xs">Pool Cap</span>
            <p className="text-text font-semibold mt-0.5">{maxStake && maxStake > 0n ? fmtToken(maxStake) : "No cap"}</p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-5 gap-4">
          <StatBlock label="Staked in Mining" value={fmtToken(stakedInMining)} accent />
          <StatBlock label="Total Deposits" value={fmtToken(totalDep)} />
          {pendingDep > 0n && <StatBlock label="Pending (Unstaked)" value={fmtToken(pendingDep)} />}
          <StatBlock
            label="Tier"
            value={tier > 0 ? `Tier ${tier}` : "Below Tier 1"}
            accent={tier > 0}
          />
          <StatBlock
            label="Eligible"
            value={eligible ? "Yes" : "No"}
            accent={eligible}
          />
        </div>

        {/* Epoch + Credits */}
        {epochNum !== undefined && (
          <div className="mt-3 pt-3 border-t border-border flex items-center gap-6 text-xs text-muted">
            <span>Epoch <span className="text-text font-tabular">{epochNum}</span></span>
            <span>Credits <span className="text-text font-tabular">{poolCredits ? Number(poolCredits).toLocaleString() : "0"}</span></span>
            <span>Reward Share <span className={`font-tabular ${creditShare > 0 ? "text-success font-semibold" : "text-muted"}`}>
              {creditShare > 0 ? `${creditShare.toFixed(1)}%` : "-"}
            </span></span>
            <span className="ml-auto"><BotStatus poolAddress={address as `0x${string}`} currentEpoch={epochNum} /></span>
          </div>
        )}
      </div>

      {/* Pool Lifecycle Actions */}
      <div className="gradient-border p-5">
        <p className="text-xs text-muted uppercase tracking-wide mb-3">Pool Lifecycle</p>
        <p className="text-sm text-text-dim mb-4 leading-relaxed">
          All lifecycle actions are <span className="text-success font-medium">permissionless</span>. Anyone can trigger them.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Stake into Mining */}
          <button
            onClick={handleStakeIntoMining}
            disabled={isStaking || !isConnected || poolStateName !== "Idle" || totalDep === 0n}
            className="btn-primary py-3 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isStaking ? "Staking..." : "Stake → Mining"}
          </button>

          {/* Request Unstake (queues for epoch end) */}
          <button
            onClick={handleRequestUnstake}
            disabled={isRequesting || !isConnected || poolStateName !== "Active" || (unstakeRequestEpoch !== undefined && unstakeRequestEpoch > 0n)}
            className="btn-ghost py-3 text-sm font-medium text-warn border-warn/30 hover:bg-warn/10 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isRequesting ? "Requesting..." : unstakeRequestEpoch && unstakeRequestEpoch > 0n ? "Unstake Queued" : "Request Unstake"}
          </button>

          {/* Execute Unstake (after epoch ends) */}
          <button
            onClick={handleExecuteUnstake}
            disabled={isExecutingUnstake || !isConnected || poolStateName !== "Active" || !unstakeRequestEpoch || unstakeRequestEpoch === 0n || (epochNum !== undefined && epochNum <= Number(unstakeRequestEpoch))}
            className="btn-ghost py-3 text-sm font-medium text-warn border-warn/30 hover:bg-warn/10 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isExecutingUnstake ? "Executing..." : "Execute Unstake"}
          </button>

          {/* Finalize Withdraw */}
          <button
            onClick={handleFinalizeWithdraw}
            disabled={isFinalizing || !isConnected || poolStateName !== "Unstaking" || cooldownRemaining !== "Ready"}
            className="btn-primary py-3 text-sm disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isFinalizing ? "Finalizing..." : "Finalize Withdraw"}
          </button>

          {/* Top-Up Stake */}
          <button
            onClick={handleTopUpStake}
            disabled={isToppingUp || !isConnected || poolStateName !== "Active" || pendingDep === 0n}
            className="btn-ghost py-3 text-sm font-medium text-base-blue-light border-base-blue/30 hover:bg-base-blue/10 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {isToppingUp ? "Top-Up..." : pendingDep > 0n ? `Top-Up (${fmtToken(pendingDep)})` : "Top-Up Stake"}
          </button>
        </div>

        {/* Unstake request status */}
        {poolStateName === "Active" && unstakeRequestEpoch !== undefined && unstakeRequestEpoch > 0n && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <div className="h-1.5 w-1.5 rounded-full bg-warn pulse-dot" />
            <span className="text-muted">Unstake requested at epoch</span>
            <span className="text-warn font-semibold font-tabular">{Number(unstakeRequestEpoch)}</span>
            {epochNum !== undefined && epochNum > Number(unstakeRequestEpoch) ? (
              <span className="text-success font-medium">- Ready to execute</span>
            ) : (
              <span className="text-muted">- Waiting for epoch to end</span>
            )}
          </div>
        )}

        {/* Cooldown timer */}
        {poolStateName === "Unstaking" && cooldownRemaining && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <div className="h-1.5 w-1.5 rounded-full bg-warn pulse-dot" />
            <span className="text-muted">Cooldown:</span>
            <span className={`font-semibold font-tabular ${cooldownRemaining === "Ready" ? "text-success" : "text-warn"}`}>
              {cooldownRemaining === "Ready" ? "✓ Ready to finalize" : cooldownRemaining}
            </span>
          </div>
        )}

        {stakeOk && <p className="mt-2 text-xs glow-success">✓ Staked into mining</p>}
        {requestUnstakeOk && <p className="mt-2 text-xs glow-success">✓ Unstake requested, waiting for epoch end</p>}
        {executeUnstakeOk && <p className="mt-2 text-xs glow-success">✓ Unstake executed, cooldown started</p>}
        {finalizeOk && <p className="mt-2 text-xs glow-success">✓ Withdraw finalized, funds back in pool</p>}
        {topUpOk && <p className="mt-2 text-xs glow-success">✓ Pending deposits staked into mining</p>}
      </div>

      {/* Action Panels */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Deposit / Withdraw */}
        <div className="glass-card p-5">
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

              {overCap && <p className="text-xs text-danger">Exceeds pool capacity. Max {fmtToken(remaining)} remaining.</p>}
              {poolFull && !overCap && <p className="text-xs text-danger">Pool is full</p>}

              {!isConnected ? (
                <p className="text-center text-xs text-muted">Connect wallet to deposit</p>
              ) : needsApproval ? (
                <button onClick={handleApprove} disabled={isApproving || depositWei === 0n || overCap || poolFull || depositsLocked}
                  className="btn-warn w-full py-3 text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed">
                  {isApproving ? "Approving..." : "Approve BOTCOIN"}
                </button>
              ) : (
                <button onClick={handleDeposit} disabled={isDepositing || depositWei === 0n || overCap || poolFull || depositsLocked}
                  className="btn-primary w-full py-3 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                  {isDepositing ? "Depositing..." : depositsLocked ? "Pool Unstaking" : poolStateName === "Active" ? "Deposit (Pending)" : "Deposit"}
                </button>
              )}
              <p className="text-center text-[11px] text-muted">
                {poolStateName === "Active" ? "Deposit goes to pending — use Top-Up to stake" : "Deposits accepted when pool is Idle or Active"}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-xs text-muted mb-1.5">
                  <span>Amount</span>
                  <span>Your Deposit: <span className="text-text font-tabular">{fmtToken(userDeposit)}</span></span>
                </div>
                <div className="relative">
                  <input
                    type="text" placeholder="0.00" value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="pool-input w-full px-3 py-3 text-sm pr-14"
                  />
                  <button
                    onClick={() => setWithdrawAmount((Number(userDeposit) / 1e18).toString())}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-accent hover:text-base-blue-light cursor-pointer font-medium"
                  >
                    MAX
                  </button>
                </div>
              </div>

              {poolStateName !== "Idle" && (
                <p className="text-xs text-warn">
                  Withdrawals only available when pool is Idle (after unstake + cooldown + finalize).
                </p>
              )}

              {!isConnected ? (
                <p className="text-center text-xs text-muted">Connect wallet to withdraw</p>
              ) : (
                <button onClick={handleWithdraw}
                  disabled={isWithdrawing || !withdrawAmount || poolStateName !== "Idle"}
                  className="btn-primary w-full py-3 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                  {isWithdrawing ? "Withdrawing..." : "Withdraw"}
                </button>
              )}
              <p className="text-center text-[11px] text-muted">
                Pool must be Idle to withdraw principal
              </p>
            </div>
          )}
        </div>

        {/* Right column: Rewards + Triggers */}
        <div className="space-y-5">
          {/* Your Rewards */}
          <div className="glass-card p-5">
            <p className="text-xs text-muted uppercase tracking-wide mb-3">Your Rewards</p>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-2xl font-bold glow-blue font-tabular">{fmtToken(userReward)}</p>
                <p className="text-xs text-muted mt-1">BOTCOIN claimable</p>
              </div>
              <button onClick={handleClaim} disabled={isClaiming || !isConnected || userReward === 0n}
                className="btn-primary px-5 py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                {isClaiming ? "Claiming..." : "Claim"}
              </button>
            </div>
            {totalDep > 0n && (
              <div className="mt-3 pt-3 border-t border-border text-xs text-muted">
                Pool share: <span className="text-base-blue-light font-medium">{(Number(userShareBps) / 100).toFixed(2)}%</span>
              </div>
            )}
          </div>

          {/* Trustless Claim Triggers */}
          <div className="gradient-border p-5">
            <p className="text-xs text-muted uppercase tracking-wide mb-2">Trigger Reward Claims</p>
            <p className="text-sm text-text-dim mb-4 leading-relaxed">
              Anyone can trigger these to distribute mining rewards.
              <span className="text-success font-medium"> Fully trustless.</span>
            </p>
            <div className="flex gap-3">
              <button onClick={handleTriggerClaim} disabled={isTriggering || !isConnected || epochNum === undefined || epochNum < 1}
                className="btn-ghost flex-1 py-3 text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed">
                {isTriggering ? "Triggering..." : `Claim Epoch ${epochNum !== undefined && epochNum > 0 ? epochNum - 1 : "?"} →`}
              </button>
              <button onClick={handleTriggerBonusClaim} disabled={isTriggeringBonus || !isConnected || epochNum === undefined || epochNum < 1}
                className="btn-ghost flex-1 py-3 text-sm font-medium text-base-blue-light border-base-blue/30 hover:bg-base-blue/10 disabled:opacity-30 disabled:cursor-not-allowed">
                {isTriggeringBonus ? "Triggering..." : `Bonus Epoch ${epochNum !== undefined && epochNum > 0 ? epochNum - 1 : "?"} →`}
              </button>
            </div>
            {triggerOk && <p className="mt-3 text-xs glow-success">✓ Regular rewards distributed</p>}
            {triggerBonusOk && <p className="mt-3 text-xs glow-success">✓ Bonus rewards distributed</p>}
          </div>
        </div>
      </div>

      {/* Operator Setup Guide — shown to pool owner */}
      {isOwner && poolStateName !== "Unstaking" && (
        <OperatorSetup poolAddress={address} operatorAddress={operator as string | undefined} />
      )}

      {/* Admin Panel */}
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
              <p className="text-[11px] text-text-dim mb-2">Current: {feePercent}% ({String(feeBps ?? 0)} bps). Can only decrease.</p>
              <div className="flex gap-3">
                <input type="text" placeholder="New fee in bps" value={newFeeBps}
                  onChange={(e) => setNewFeeBps(e.target.value)}
                  className="pool-input flex-1 px-3 py-2.5 text-sm" />
                <button onClick={handleSetFee} disabled={isSettingFee || !newFeeBps}
                  className="btn-warn px-5 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                  {isSettingFee ? "Updating..." : "Set Fee"}
                </button>
              </div>
              {setFeeOk && <p className="text-xs glow-success mt-2">✓ Fee decreased</p>}
            </div>

            <div className="border-t border-border" />

            {/* Set Operator */}
            <div>
              <label className="text-xs text-muted block mb-1.5">Change Operator</label>
              <p className="text-[11px] text-text-dim mb-2">Current: {operator ? shortAddr(operator) : "-"}</p>
              <div className="flex gap-3">
                <input type="text" placeholder="New operator address (0x...)" value={newOperator}
                  onChange={(e) => setNewOperator(e.target.value)}
                  className="pool-input flex-1 px-3 py-2.5 text-sm" />
                <button onClick={handleSetOperator} disabled={isSettingOperator || !newOperator}
                  className="btn-warn px-5 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
                  {isSettingOperator ? "Updating..." : "Set Operator"}
                </button>
              </div>
              {setOperatorOk && <p className="text-xs glow-success mt-2">✓ Operator updated</p>}
            </div>

            <div className="border-t border-border" />

            {/* Operator Selector Whitelist */}
            <div>
              <label className="text-xs text-muted block mb-1.5">Operator Selector Whitelist</label>
              <p className="text-[11px] text-text-dim mb-2">4-byte function selector the operator can forward to MiningV2</p>
              <div className="flex gap-3">
                <input type="text" placeholder="0x12345678" value={opSelectorInput}
                  onChange={(e) => setOpSelectorInput(e.target.value)}
                  className="pool-input flex-1 px-3 py-2.5 text-sm font-tabular" />
                <button onClick={() => handleSetOperatorSelector(true)}
                  disabled={isSettingOpSelector || !opSelectorInput}
                  className="btn-ghost px-4 py-2.5 text-sm font-medium text-success border-success/30 hover:bg-success/10 disabled:opacity-40 disabled:cursor-not-allowed">
                  {isSettingOpSelector ? "..." : "Allow"}
                </button>
                <button onClick={() => handleSetOperatorSelector(false)}
                  disabled={isSettingOpSelector || !opSelectorInput}
                  className="btn-ghost px-4 py-2.5 text-sm font-medium text-danger border-danger/30 hover:bg-danger/10 disabled:opacity-40 disabled:cursor-not-allowed">
                  {isSettingOpSelector ? "..." : "Revoke"}
                </button>
              </div>
              {setOpSelectorOk && <p className="text-xs glow-success mt-2">✓ Selector updated</p>}
            </div>

            <div className="border-t border-border" />

            {/* Transfer Ownership */}
            <div>
              <label className="text-xs text-muted block mb-1.5">Transfer Ownership</label>
              <p className="text-[11px] text-error mb-2">⚠ Irreversible. You will lose admin access.</p>
              <div className="flex gap-3">
                <input type="text" placeholder="New owner address (0x...)" value={newOwner}
                  onChange={(e) => setNewOwner(e.target.value)}
                  className="pool-input flex-1 px-3 py-2.5 text-sm" />
                <button onClick={handleTransferOwnership} disabled={isTransferring || !newOwner}
                  className="btn-primary px-5 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed bg-error/20 hover:bg-error/30 border-error/50">
                  {isTransferring ? "Transferring..." : "Transfer"}
                </button>
              </div>
              {transferOwnershipOk && <p className="text-xs glow-success mt-2">✓ Ownership transferred</p>}
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
