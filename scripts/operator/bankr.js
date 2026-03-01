// scripts/operator/bankr.js — Bankr Agent API client
import { config } from "./config.js";
import { log } from "./logger.js";

const BANKR = config.bankrUrl;
const headers = () => ({
  "Content-Type": "application/json",
  "X-API-Key": config.bankrApiKey,
});

// ─── Wallet Identity ──────────────────────────────────────────────
/**
 * Resolve the Bankr EVM wallet address.
 * @returns {Promise<string>} checksummed 0x address
 */
export async function getWalletAddress() {
  const res = await fetch(`${BANKR}/agent/me`, { headers: headers() });
  const data = await res.json();
  if (!data.success) {
    throw new Error(`Bankr /agent/me failed: ${data.error || JSON.stringify(data)}`);
  }
  const evmWallet = data.wallets?.find((w) => w.chain === "evm");
  if (!evmWallet) {
    throw new Error("No EVM wallet found on Bankr account");
  }
  log.info(`Bankr EVM wallet: ${evmWallet.address}`);
  return evmWallet.address;
}

// ─── Signing ──────────────────────────────────────────────────────
/**
 * Sign a message using personal_sign via Bankr.
 * @param {string} message — The message to sign (exact text)
 * @returns {Promise<{signature: string, signer: string}>}
 */
export async function signMessage(message) {
  log.debug("Bankr signMessage — requesting personal_sign");
  const res = await fetch(`${BANKR}/agent/sign`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      signatureType: "personal_sign",
      message,
    }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(
      `Bankr sign failed: ${data.error || data.message || JSON.stringify(data)}`
    );
  }
  log.debug(`Bankr signed by ${data.signer}`);
  return { signature: data.signature, signer: data.signer };
}

// ─── Transaction Submission ───────────────────────────────────────
/**
 * Submit a raw transaction to the blockchain via Bankr.
 * @param {{ to: string, chainId: number, value: string, data: string }} tx
 * @param {string} description — Human-readable label
 * @returns {Promise<{ transactionHash: string, status: string, blockNumber?: string, gasUsed?: string }>}
 */
export async function submitTransaction(tx, description = "") {
  log.info(`Bankr submitTransaction → ${tx.to} (${description})`);
  const res = await fetch(`${BANKR}/agent/submit`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      transaction: {
        to: tx.to,
        chainId: tx.chainId,
        value: tx.value || "0",
        data: tx.data,
      },
      description,
      waitForConfirmation: true,
    }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(
      `Bankr submit failed: ${data.error || data.message || JSON.stringify(data)}`
    );
  }
  log.info(
    `TX confirmed: ${data.transactionHash} (block ${data.blockNumber}, gas ${data.gasUsed})`
  );
  return data;
}

// ─── Balance Check (natural language, async) ──────────────────────
/**
 * Check balances via Bankr prompt (async job).
 * @returns {Promise<string>} natural language balance response
 */
export async function checkBalances() {
  log.info("Checking balances via Bankr prompt...");
  // Start job
  const startRes = await fetch(`${BANKR}/agent/prompt`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ prompt: "what are my balances on base?" }),
  });
  const startData = await startRes.json();
  if (!startData.success || !startData.jobId) {
    throw new Error(
      `Bankr prompt failed: ${startData.error || JSON.stringify(startData)}`
    );
  }

  // Poll for completion
  const jobId = startData.jobId;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const pollRes = await fetch(`${BANKR}/agent/job/${jobId}`, {
      headers: { "X-API-Key": config.bankrApiKey },
    });
    const pollData = await pollRes.json();
    if (pollData.status === "completed") {
      return pollData.response || JSON.stringify(pollData);
    }
    if (pollData.status === "failed") {
      throw new Error(`Balance check failed: ${pollData.error || "unknown"}`);
    }
  }
  throw new Error("Balance check timed out after 120s");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
