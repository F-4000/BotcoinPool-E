// scripts/operator/pool.js — Pool-as-Miner ABI encoding helpers
//
// Wraps coordinator calldata through the BotcoinPoolV2 contract so
// that the pool contract (not the Bankr EOA) is the on-chain miner.

import { ethers } from "ethers";
import { config } from "./config.js";
import { log } from "./logger.js";

// ─── Pool V2 ABI (only the functions the bot needs) ──────────────
const POOL_ABI = [
  "function submitToMining(bytes data)",
  "function triggerClaim(uint64[] epochIds)",
  "function triggerBonusClaim(uint64[] epochIds)",
  "function stakeIntoMining()",
  "function requestUnstake()",
  "function executeUnstake()",
  "function getPoolInfo() view returns (uint8 state, uint256 stakedInMining, uint256 totalDep, uint256 rewardable, uint64 currentEpoch, bool eligible, uint256 cooldownEnd, uint256 pending)",
];

const iface = new ethers.Interface(POOL_ABI);

// ─── Helpers ──────────────────────────────────────────────────────

function poolAddr() {
  const addr = config.poolAddress;
  if (!addr) throw new Error("POOL_ADDRESS not configured");
  return addr;
}

/**
 * Wrap a coordinator receipt transaction through pool.submitToMining().
 *
 * The coordinator returns: { to: miningContract, data: "0x8b3e05f8..." }
 * We need to call:        pool.submitToMining(coordinatorData)
 *
 * @param {{ to: string, data: string, value?: string }} coordinatorTx
 * @returns {{ to: string, data: string }} transaction for Bankr
 */
export function wrapReceipt(coordinatorTx) {
  const encoded = iface.encodeFunctionData("submitToMining", [
    coordinatorTx.data,
  ]);
  log.debug(
    `Wrapped receipt: pool.submitToMining(${coordinatorTx.data.slice(0, 18)}...)`
  );
  return {
    to: poolAddr(),
    data: encoded,
    value: "0",
  };
}

/**
 * Encode pool.triggerClaim(epochs).
 * This is permissionless — anyone can call it.
 *
 * @param {number[]} epochs
 * @returns {{ to: string, data: string }}
 */
export function encodeTriggerClaim(epochs) {
  const encoded = iface.encodeFunctionData("triggerClaim", [epochs]);
  return { to: poolAddr(), data: encoded, value: "0" };
}

/**
 * Encode pool.triggerBonusClaim(epochs).
 *
 * @param {number[]} epochs
 * @returns {{ to: string, data: string }}
 */
export function encodeTriggerBonusClaim(epochs) {
  const encoded = iface.encodeFunctionData("triggerBonusClaim", [epochs]);
  return { to: poolAddr(), data: encoded, value: "0" };
}

/**
 * Encode pool.stakeIntoMining() — operator only.
 *
 * @returns {{ to: string, data: string }}
 */
export function encodeStakeIntoMining() {
  const encoded = iface.encodeFunctionData("stakeIntoMining", []);
  return { to: poolAddr(), data: encoded, value: "0" };
}

/**
 * Encode pool.requestUnstake() — permissionless.
 * Queues an unstake request for the current epoch.
 *
 * @returns {{ to: string, data: string }}
 */
export function encodeRequestUnstake() {
  const encoded = iface.encodeFunctionData("requestUnstake", []);
  return { to: poolAddr(), data: encoded, value: "0" };
}

/**
 * Encode pool.executeUnstake() — permissionless.
 * Executes a pending unstake after the epoch has ended.
 *
 * @returns {{ to: string, data: string }}
 */
export function encodeExecuteUnstake() {
  const encoded = iface.encodeFunctionData("executeUnstake", []);
  return { to: poolAddr(), data: encoded, value: "0" };
}

/**
 * Check if pool mode is enabled.
 */
export function isPoolMode() {
  return !!config.poolAddress;
}
