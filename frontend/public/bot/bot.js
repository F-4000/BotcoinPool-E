#!/usr/bin/env node
// scripts/operator/bot.js — BotcoinPool Operator Mining Bot
//
// Usage:
//   node scripts/operator/bot.js              # run mining loop
//   node scripts/operator/bot.js --status     # check wallet/epoch/credits
//   node scripts/operator/bot.js --claim      # claim rewards for ended epochs
//   node scripts/operator/bot.js --stake       # stake pool deposits into mining (pool mode)
//   node scripts/operator/bot.js --stake <amount>  # stake BOTCOIN (whole tokens, direct mode)
//   node scripts/operator/bot.js --unstake    # trigger unstake from mining (pool mode)
//
// Set POOL_ADDRESS in .env to enable pool-as-miner mode.
// Env vars: see .env.operator.example

import { config, validateConfig } from "./config.js";
import { log } from "./logger.js";
import * as bankr from "./bankr.js";
import * as coordinator from "./coordinator.js";
import { solveChallenge } from "./solver.js";
import * as pool from "./pool.js";

// ─── CLI Parsing ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const MODE_STATUS = args.includes("--status");
const MODE_CLAIM = args.includes("--claim");
const MODE_STAKE = args.includes("--stake");
const MODE_UNSTAKE = args.includes("--unstake");
const STAKE_AMOUNT = MODE_STAKE
  ? args[args.indexOf("--stake") + 1]
  : null;

// ─── Graceful Shutdown ────────────────────────────────────────────
let running = true;
process.on("SIGINT", () => {
  log.info("SIGINT received — shutting down after current loop...");
  running = false;
});
process.on("SIGTERM", () => {
  log.info("SIGTERM received — shutting down...");
  running = false;
});

// ─── Stats ────────────────────────────────────────────────────────
const stats = {
  started: Date.now(),
  loops: 0,
  solves: 0,
  failures: 0,
  receiptsPosted: 0,
  creditsEarned: 0,
  consecutiveFailures: 0,
  epochs: new Set(),
};

function printStats() {
  const uptime = ((Date.now() - stats.started) / 60000).toFixed(1);
  log.info("--- Mining Stats ---");
  log.info(`Uptime: ${uptime} min | Loops: ${stats.loops}`);
  log.info(
    `Solves: ${stats.solves} | Failures: ${stats.failures} | Receipts: ${stats.receiptsPosted}`
  );
  log.info(
    `Credits earned: ${stats.creditsEarned} | Epochs mined: [${[...stats.epochs].join(", ")}]`
  );
}

// ─── Status Command ───────────────────────────────────────────────
async function showStatus() {
  const bankrAddress = await bankr.getWalletAddress();
  const minerAddress = pool.isPoolMode() ? config.poolAddress : bankrAddress;

  console.log(`\nOperator wallet (Bankr): ${bankrAddress}`);
  if (pool.isPoolMode()) {
    console.log(`Pool contract (miner):  ${minerAddress}`);
    console.log(`Mode: pool-as-miner (EIP-1271)`);
  } else {
    console.log(`Mode: direct EOA miner`);
  }

  const epoch = await coordinator.getEpoch();
  console.log(`\nCurrent epoch: ${epoch.epochId}`);
  console.log(`Epoch duration: ${epoch.epochDurationSeconds}s`);
  console.log(
    `Next epoch starts: ${new Date(epoch.nextEpochStartTimestamp * 1000).toISOString()}`
  );
  if (epoch.prevEpochId) console.log(`Previous epoch: ${epoch.prevEpochId}`);

  try {
    const balances = await bankr.checkBalances();
    console.log(`\nBalances:\n${balances}`);
  } catch (e) {
    console.log(`\nBalance check: ${e.message}`);
  }

  try {
    const credits = await coordinator.getCredits(minerAddress);
    console.log(`\nCredits:`, JSON.stringify(credits, null, 2));
  } catch (e) {
    console.log(`\nCredits check: ${e.message}`);
  }
}

// ─── Claim Command ────────────────────────────────────────────────
async function claimRewards() {
  const epoch = await coordinator.getEpoch();

  // Try to claim the previous epoch
  const prevEpoch = epoch.prevEpochId;
  if (!prevEpoch) {
    log.info("No previous epoch available for claiming");
    return;
  }

  log.info(`Attempting to claim epoch ${prevEpoch}...`);

  if (pool.isPoolMode()) {
    // ── Pool mode: call pool.triggerBonusClaim / pool.triggerClaim ──
    // These are permissionless — anyone can call them to distribute rewards.

    // Check bonus first
    try {
      const bonusStatus = await coordinator.getBonusStatus(prevEpoch);
      if (bonusStatus.isBonusEpoch && bonusStatus.claimsOpen) {
        log.info(
          `Epoch ${prevEpoch} is a bonus epoch (reward: ${bonusStatus.reward} BOTCOIN)`
        );
        const tx = pool.encodeTriggerBonusClaim([prevEpoch]);
        const result = await bankr.submitTransaction(
          tx,
          `Pool: trigger bonus claim for epoch ${prevEpoch}`
        );
        log.info(`Bonus claim TX: ${result.transactionHash}`);
      }
    } catch (e) {
      log.debug(`Bonus check failed (non-fatal): ${e.message}`);
    }

    // Regular claim through pool
    try {
      const tx = pool.encodeTriggerClaim([prevEpoch]);
      const result = await bankr.submitTransaction(
        tx,
        `Pool: trigger claim for epoch ${prevEpoch}`
      );
      log.info(`Claim TX: ${result.transactionHash} (${result.status})`);
    } catch (e) {
      log.error(`Pool claim failed: ${e.message}`);
    }
  } else {
    // ── Direct mode: use coordinator calldata directly ──

    // Check bonus first
    try {
      const bonusStatus = await coordinator.getBonusStatus(prevEpoch);
      if (bonusStatus.isBonusEpoch && bonusStatus.claimsOpen) {
        log.info(
          `Epoch ${prevEpoch} is a bonus epoch (reward: ${bonusStatus.reward} BOTCOIN)`
        );
        const bonusCalldata = await coordinator.getBonusClaimCalldata(prevEpoch);
        if (bonusCalldata.transaction) {
          const result = await bankr.submitTransaction(
            bonusCalldata.transaction,
            `Claim bonus for epoch ${prevEpoch}`
          );
          log.info(`Bonus claim TX: ${result.transactionHash}`);
        }
      }
    } catch (e) {
      log.debug(`Bonus check failed (non-fatal): ${e.message}`);
    }

    // Regular claim
    try {
      const claimData = await coordinator.getClaimCalldata(prevEpoch);
      if (claimData.transaction) {
        const result = await bankr.submitTransaction(
          claimData.transaction,
          `Claim rewards for epoch ${prevEpoch}`
        );
        log.info(`Claim TX: ${result.transactionHash} (${result.status})`);
      } else {
        log.warn(`No claim calldata for epoch ${prevEpoch}`);
      }
    } catch (e) {
      log.error(`Claim failed: ${e.message}`);
    }
  }
}

// ─── Stake Command ────────────────────────────────────────────────
async function stakeTokens(amountWholeTokens) {
  if (pool.isPoolMode()) {
    // Pool mode: call pool.stakeIntoMining() — operator only.
    // Stakes all deposited tokens from pool contract into the mining contract.
    // No amount needed — the pool stakes its entire deposit balance.
    log.info("Pool mode: calling pool.stakeIntoMining()...");
    const tx = pool.encodeStakeIntoMining();
    const result = await bankr.submitTransaction(
      tx,
      "Pool: stake deposits into mining"
    );
    log.info(`Stake TX: ${result.transactionHash}`);
    log.info("Pool staking complete! State transitioned Idle → Active.");
    return;
  }

  // Direct mode: approve + stake via coordinator calldata
  const amount = BigInt(amountWholeTokens) * 10n ** 18n;
  const amountWei = amount.toString();

  log.info(
    `Staking ${amountWholeTokens} BOTCOIN (${amountWei} wei)...`
  );

  // Step 1: Approve
  log.info("Getting approve calldata...");
  const approveData = await coordinator.getStakeApproveCalldata(amountWei);
  if (approveData.transaction) {
    const approveResult = await bankr.submitTransaction(
      approveData.transaction,
      `Approve ${amountWholeTokens} BOTCOIN for staking`
    );
    log.info(`Approve TX: ${approveResult.transactionHash}`);
  }

  // Step 2: Stake
  log.info("Getting stake calldata...");
  const stakeData = await coordinator.getStakeCalldata(amountWei);
  if (stakeData.transaction) {
    const stakeResult = await bankr.submitTransaction(
      stakeData.transaction,
      `Stake ${amountWholeTokens} BOTCOIN`
    );
    log.info(`Stake TX: ${stakeResult.transactionHash}`);
  }

  log.info("Staking complete!");
}

// ─── Unstake Command (pool mode) ─────────────────────────────────
async function unstakeTokens() {
  if (!pool.isPoolMode()) {
    log.error("--unstake is only available in pool mode (set POOL_ADDRESS)");
    process.exit(1);
  }

  // Two-step unstake: requestUnstake (queues at current epoch) then
  // executeUnstake (after epoch ends). If a request is already pending,
  // skip straight to execute.
  log.info("Pool mode: requesting unstake...");
  try {
    const reqTx = pool.encodeRequestUnstake();
    const reqResult = await bankr.submitTransaction(
      reqTx,
      "Pool: request unstake from mining"
    );
    log.info(`Request unstake TX: ${reqResult.transactionHash}`);
    log.info("Unstake requested — waiting for epoch to end before executing.");
    log.info("Run --unstake again after the epoch advances to execute.");
  } catch (err) {
    if (err.message?.includes("already requested")) {
      log.info("Unstake already requested — attempting execute...");
      const execTx = pool.encodeExecuteUnstake();
      const execResult = await bankr.submitTransaction(
        execTx,
        "Pool: execute unstake from mining"
      );
      log.info(`Execute unstake TX: ${execResult.transactionHash}`);
      log.info("Unstake executed! State transitioned Active → Unstaking.");
    } else {
      throw err;
    }
  }
}

// ─── Single Mine Iteration ────────────────────────────────────────
async function mineOnce(minerAddress) {
  // Step A: Get challenge
  let challenge = await coordinator.getChallenge(minerAddress);

  // Handle 401 → re-auth → retry
  if (challenge._needsAuth) {
    await coordinator.authenticate(minerAddress);
    challenge = await coordinator.getChallenge(minerAddress);
    if (challenge._needsAuth) {
      throw new Error("Still getting 401 after re-auth");
    }
  }

  const { challengeId, _nonce: nonce, epochId, creditsPerSolve } = challenge;
  stats.epochs.add(epochId);

  // Step B: Solve with LLM
  const artifact = await solveChallenge(challenge);

  // Step C: Submit to coordinator
  let result = await coordinator.submitSolve(
    minerAddress,
    challengeId,
    artifact,
    nonce
  );

  // Handle 401 on submit → re-auth → retry same solve
  if (result._needsAuth) {
    await coordinator.authenticate(minerAddress);
    result = await coordinator.submitSolve(
      minerAddress,
      challengeId,
      artifact,
      nonce
    );
  }

  if (!result.pass) {
    stats.failures++;
    stats.consecutiveFailures++;
    log.warn(
      `Solve failed (consecutive: ${stats.consecutiveFailures}/${config.maxConsecutiveFailures})`
    );
    if (result.failedConstraintIndices) {
      log.debug(
        `Failed constraints: ${JSON.stringify(result.failedConstraintIndices)}`
      );
    }
    return false;
  }

  // Step D: Post receipt on-chain via Bankr
  stats.solves++;
  stats.consecutiveFailures = 0;

  if (result.transaction) {
    try {
      // In pool mode: wrap the coordinator's calldata through pool.submitToMining()
      // In direct mode: submit coordinator's calldata directly
      const tx = pool.isPoolMode()
        ? pool.wrapReceipt(result.transaction)
        : result.transaction;

      const txResult = await bankr.submitTransaction(
        tx,
        `Mining receipt (epoch ${epochId})${pool.isPoolMode() ? " via pool" : ""}`
      );
      stats.receiptsPosted++;
      stats.creditsEarned += creditsPerSolve || 1;
      log.info(
        `Receipt posted! TX: ${txResult.transactionHash} (+${creditsPerSolve || 1} credits)`
      );
    } catch (err) {
      log.error(`Failed to post receipt on-chain: ${err.message}`);
      // Receipt is lost — this is a solve wasted. Continue to next challenge.
      return false;
    }
  } else {
    log.warn("No transaction in solve response — receipt not posted");
  }

  return true;
}

// ─── Main Mining Loop ─────────────────────────────────────────────
async function miningLoop() {
  const bankrAddress = await bankr.getWalletAddress();

  // In pool mode, the miner identity is the pool contract address.
  // The Bankr EOA signs on behalf of the pool via EIP-1271.
  const minerAddress = pool.isPoolMode() ? config.poolAddress : bankrAddress;

  if (pool.isPoolMode()) {
    log.info(`Pool mode: miner = ${minerAddress} (pool contract)`);
    log.info(`Operator: ${bankrAddress} (Bankr EOA, signs via EIP-1271)`);
  } else {
    log.info(`Direct mode: miner = ${minerAddress}`);
  }

  // Show epoch info
  const epoch = await coordinator.getEpoch();
  log.info(
    `Epoch ${epoch.epochId} — next epoch at ${new Date(epoch.nextEpochStartTimestamp * 1000).toISOString()}`
  );

  // Authenticate — coordinator detects bytecode at minerAddress and
  // uses EIP-1271 isValidSignature() for pool contracts.
  await coordinator.authenticate(minerAddress);

  log.info("Starting mining loop... (Ctrl+C to stop)");

  while (running) {
    stats.loops++;
    try {
      // Ensure auth is fresh
      await coordinator.ensureAuth(minerAddress);

      const success = await mineOnce(minerAddress);

      if (
        stats.consecutiveFailures >= config.maxConsecutiveFailures
      ) {
        log.error(
          `Hit ${config.maxConsecutiveFailures} consecutive failures — stopping. Check LLM model/config.`
        );
        break;
      }

      // Brief stats every 10 loops
      if (stats.loops % 10 === 0) printStats();
    } catch (err) {
      log.error(`Mining loop error: ${err.message}`);
      // LLM auth/budget errors are fatal
      if (
        err.message.includes("auth error") ||
        err.message.includes("billing") ||
        err.message.includes("usage limits")
      ) {
        log.error("Fatal LLM error — stopping bot");
        break;
      }
      // Back off on other errors
      await sleep(10000);
    }

    // Delay between loops
    if (running) {
      await sleep(config.loopDelayMs);
    }
  }

  printStats();
  log.info("Bot stopped.");
}

// ─── Entry Point ──────────────────────────────────────────────────
async function main() {
  validateConfig();
  log.info("BotcoinPool Operator Bot starting...");
  log.info(`LLM: ${config.llmProvider} | Coordinator: ${config.coordinatorUrl}`);
  if (pool.isPoolMode()) {
    log.info(`Pool mode: ${config.poolAddress}`);
  }

  try {
    if (MODE_STATUS) {
      await showStatus();
    } else if (MODE_CLAIM) {
      await claimRewards();
    } else if (MODE_UNSTAKE) {
      await unstakeTokens();
    } else if (MODE_STAKE) {
      if (!pool.isPoolMode() && !STAKE_AMOUNT) {
        console.error("Usage: node bot.js --stake <amount_in_whole_tokens>");
        console.error("  (In pool mode, --stake requires no amount — stakes all pool deposits)");
        process.exit(1);
      }
      await stakeTokens(STAKE_AMOUNT);
    } else {
      await miningLoop();
    }
  } catch (err) {
    log.error(`Fatal: ${err.message}`);
    if (config.logLevel === "debug") console.error(err);
    process.exit(1);
  }
}

main();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
