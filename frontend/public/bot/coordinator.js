// scripts/operator/coordinator.js — Coordinator API client with auth token management
import { config } from "./config.js";
import { log } from "./logger.js";
import { signMessage } from "./bankr.js";
import crypto from "crypto";

const BASE = config.coordinatorUrl;

// ─── Auth Token State ─────────────────────────────────────────────
let _token = null;
let _tokenExpiry = 0; // unix ms
let _authInFlight = false;

function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (_token) h["Authorization"] = `Bearer ${_token}`;
  return h;
}

// ─── Retry Helper ─────────────────────────────────────────────────
const BACKOFF_STEPS = [2000, 4000, 8000, 16000, 30000, 60000];

async function fetchWithRetry(url, opts = {}, maxRetries = 5) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, opts);

      // Success range
      if (res.ok) return res;

      // 401 → caller should re-auth
      if (res.status === 401) return res;

      // 429 / 5xx → retry
      if (res.status === 429 || res.status >= 500) {
        const body = await res.json().catch(() => ({}));
        const retryAfter = body.retryAfterSeconds
          ? body.retryAfterSeconds * 1000
          : 0;
        const backoff = BACKOFF_STEPS[Math.min(attempt, BACKOFF_STEPS.length - 1)];
        const wait = Math.max(retryAfter, backoff);
        const jitter = Math.floor(Math.random() * wait * 0.25);
        log.warn(
          `Coordinator ${res.status} on ${url} — retrying in ${wait + jitter}ms (attempt ${attempt + 1}/${maxRetries + 1})`
        );
        await sleep(wait + jitter);
        continue;
      }

      // Other 4xx → return as-is (caller handles)
      return res;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const backoff = BACKOFF_STEPS[Math.min(attempt, BACKOFF_STEPS.length - 1)];
      log.warn(
        `Network error on ${url}: ${err.message} — retrying in ${backoff}ms`
      );
      await sleep(backoff);
    }
  }
}

// ─── Auth Handshake ───────────────────────────────────────────────
/**
 * Perform nonce → sign → verify handshake. Caches token.
 * @param {string} minerAddress
 */
export async function authenticate(minerAddress) {
  if (_authInFlight) {
    // Wait for in-flight auth to finish
    while (_authInFlight) await sleep(200);
    if (isTokenValid()) return;
  }
  _authInFlight = true;
  try {
    log.info("Auth handshake starting...");

    // Step 1: Nonce
    const nonceRes = await fetchWithRetry(`${BASE}/v1/auth/nonce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ miner: minerAddress }),
    });
    const nonceData = await nonceRes.json();
    if (!nonceData.message) {
      throw new Error(
        `Auth nonce failed: ${JSON.stringify(nonceData)}`
      );
    }
    log.debug("Got auth nonce, message length:", nonceData.message.length);

    // Step 2: Sign via Bankr
    const { signature } = await signMessage(nonceData.message);
    log.debug("Signed auth message");

    // Step 3: Verify
    const verifyRes = await fetchWithRetry(`${BASE}/v1/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        miner: minerAddress,
        message: nonceData.message,
        signature,
      }),
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.token) {
      throw new Error(
        `Auth verify failed: ${JSON.stringify(verifyData)}`
      );
    }

    _token = verifyData.token;
    // Token TTL from nonce response (default 600s)
    const ttl = (nonceData.tokenTtlSeconds || 600) * 1000;
    _tokenExpiry = Date.now() + ttl;
    log.info(
      `Authenticated. Token expires in ${nonceData.tokenTtlSeconds || 600}s`
    );
  } finally {
    _authInFlight = false;
  }
}

function isTokenValid() {
  return (
    _token && Date.now() < _tokenExpiry - config.authRefreshBuffer * 1000
  );
}

/**
 * Ensure we have a valid auth token, refreshing if needed.
 * @param {string} minerAddress
 */
export async function ensureAuth(minerAddress) {
  if (!isTokenValid()) {
    await authenticate(minerAddress);
  }
}

// ─── Epoch Info ───────────────────────────────────────────────────
export async function getEpoch() {
  const res = await fetchWithRetry(`${BASE}/v1/epoch`);
  return res.json();
}

// ─── Challenge ────────────────────────────────────────────────────
/**
 * Request a new challenge.
 * @param {string} minerAddress
 * @returns challenge object { epochId, doc, questions, constraints, companies, challengeId, creditsPerSolve, ... }
 */
export async function getChallenge(minerAddress) {
  const nonce = crypto.randomBytes(16).toString("hex");
  log.info(`Requesting challenge (nonce: ${nonce.slice(0, 8)}...)`);

  const res = await fetchWithRetry(
    `${BASE}/v1/challenge?miner=${minerAddress}&nonce=${nonce}`,
    { headers: authHeaders() }
  );

  if (res.status === 401) {
    log.warn("Challenge returned 401 — need re-auth");
    return { _needsAuth: true };
  }
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Challenge 403 — insufficient stake or not eligible: ${JSON.stringify(body)}`
    );
  }

  const data = await res.json();
  if (!data.challengeId) {
    throw new Error(`Invalid challenge response: ${JSON.stringify(data)}`);
  }

  log.info(
    `Challenge received: ${data.challengeId} (epoch ${data.epochId}, ${data.creditsPerSolve} credits/solve)`
  );
  return { ...data, _nonce: nonce };
}

// ─── Submit Solve ─────────────────────────────────────────────────
/**
 * Submit artifact to coordinator.
 * @returns {{ pass: boolean, receipt?: object, signature?: string, transaction?: object, failedConstraintIndices?: number[] }}
 */
export async function submitSolve(minerAddress, challengeId, artifact, nonce) {
  log.info(`Submitting solve for challenge ${challengeId}`);

  const res = await fetchWithRetry(`${BASE}/v1/submit`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      miner: minerAddress,
      challengeId,
      artifact,
      nonce,
    }),
  });

  if (res.status === 401) {
    log.warn("Submit returned 401 — need re-auth");
    return { _needsAuth: true };
  }
  if (res.status === 404) {
    log.warn("Submit returned 404 — stale challenge, need new one");
    return { pass: false, _stale: true };
  }

  const data = await res.json();
  if (data.pass) {
    log.info("Solve PASSED — receipt received");
  } else {
    log.warn(
      `Solve FAILED — constraints violated: ${JSON.stringify(data.failedConstraintIndices || [])}`
    );
  }
  return data;
}

// ─── Claim Calldata ───────────────────────────────────────────────
export async function getClaimCalldata(epochs) {
  const epochStr = Array.isArray(epochs) ? epochs.join(",") : epochs;
  const res = await fetchWithRetry(
    `${BASE}/v1/claim-calldata?epochs=${epochStr}`
  );
  return res.json();
}

// ─── Bonus ────────────────────────────────────────────────────────
export async function getBonusStatus(epochs) {
  const epochStr = Array.isArray(epochs) ? epochs.join(",") : epochs;
  const res = await fetchWithRetry(
    `${BASE}/v1/bonus/status?epochs=${epochStr}`
  );
  return res.json();
}

export async function getBonusClaimCalldata(epochs) {
  const epochStr = Array.isArray(epochs) ? epochs.join(",") : epochs;
  const res = await fetchWithRetry(
    `${BASE}/v1/bonus/claim-calldata?epochs=${epochStr}`
  );
  return res.json();
}

// ─── Staking Helpers ──────────────────────────────────────────────
export async function getStakeApproveCalldata(amountWei) {
  const res = await fetchWithRetry(
    `${BASE}/v1/stake-approve-calldata?amount=${amountWei}`
  );
  return res.json();
}

export async function getStakeCalldata(amountWei) {
  const res = await fetchWithRetry(
    `${BASE}/v1/stake-calldata?amount=${amountWei}`
  );
  return res.json();
}

export async function getUnstakeCalldata() {
  const res = await fetchWithRetry(`${BASE}/v1/unstake-calldata`);
  return res.json();
}

export async function getWithdrawCalldata() {
  const res = await fetchWithRetry(`${BASE}/v1/withdraw-calldata`);
  return res.json();
}

// ─── Credits ──────────────────────────────────────────────────────
export async function getCredits(minerAddress) {
  const res = await fetchWithRetry(
    `${BASE}/v1/credits?miner=${minerAddress}`
  );
  return res.json();
}

// ─── Utility ──────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
