// scripts/operator/config.js — Configuration & env validation
import "dotenv/config";

export const config = {
  // Bankr
  bankrApiKey: process.env.BANKR_API_KEY || "",
  bankrUrl: process.env.BANKR_URL || "https://api.bankr.bot",

  // Coordinator
  coordinatorUrl:
    process.env.COORDINATOR_URL || "https://coordinator.agentmoney.net",

  // LLM — supports "openai" or "anthropic"
  llmProvider: (process.env.LLM_PROVIDER || "openai").toLowerCase(),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  // Model override (default picked per provider)
  llmModel: process.env.LLM_MODEL || "",
  // Max tokens for solver response
  llmMaxTokens: parseInt(process.env.LLM_MAX_TOKENS || "4096", 10),

  // Mining
  // How long to pause between mining loops (ms)
  loopDelayMs: parseInt(process.env.LOOP_DELAY_MS || "5000", 10),
  // Max consecutive solve failures before stopping
  maxConsecutiveFailures: parseInt(
    process.env.MAX_CONSECUTIVE_FAILURES || "5",
    10
  ),
  // Auth token refresh buffer (seconds before expiry)
  authRefreshBuffer: parseInt(process.env.AUTH_REFRESH_BUFFER || "60", 10),

  // Pool-as-Miner mode — set POOL_ADDRESS to enable
  // When set, the pool contract is the on-chain miner and receipts are
  // wrapped through pool.submitToMining(). The Bankr EOA signs for
  // EIP-1271 validation but the pool is the miner identity.
  poolAddress: process.env.POOL_ADDRESS || "",

  // Logging
  logLevel: (process.env.LOG_LEVEL || "info").toLowerCase(),
};

/** Default models per provider */
const DEFAULT_MODELS = {
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
};

export function getModel() {
  return config.llmModel || DEFAULT_MODELS[config.llmProvider] || "gpt-4o";
}

/** Validate that all required env vars are set */
export function validateConfig() {
  const errors = [];

  if (!config.bankrApiKey) {
    errors.push("BANKR_API_KEY is required");
  }

  if (config.llmProvider === "openai" && !config.openaiApiKey) {
    errors.push("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
  }
  if (config.llmProvider === "anthropic" && !config.anthropicApiKey) {
    errors.push("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
  }
  if (!["openai", "anthropic"].includes(config.llmProvider)) {
    errors.push('LLM_PROVIDER must be "openai" or "anthropic"');
  }

  // Pool mode validation
  if (config.poolAddress && !/^0x[0-9a-fA-F]{40}$/.test(config.poolAddress)) {
    errors.push("POOL_ADDRESS must be a valid Ethereum address (0x + 40 hex chars)");
  }

  if (errors.length > 0) {
    console.error("Configuration errors:");
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
}
