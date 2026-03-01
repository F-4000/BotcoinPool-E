// scripts/operator/logger.js — Structured logging utility
import { config } from "./config.js";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function ts() {
  return new Date().toISOString();
}

function shouldLog(level) {
  return (LEVELS[level] ?? 1) >= (LEVELS[config.logLevel] ?? 1);
}

export const log = {
  debug(...args) {
    if (shouldLog("debug")) console.log(`[${ts()}] [DEBUG]`, ...args);
  },
  info(...args) {
    if (shouldLog("info")) console.log(`[${ts()}] [INFO]`, ...args);
  },
  warn(...args) {
    if (shouldLog("warn")) console.warn(`[${ts()}] [WARN]`, ...args);
  },
  error(...args) {
    if (shouldLog("error")) console.error(`[${ts()}] [ERROR]`, ...args);
  },
};
