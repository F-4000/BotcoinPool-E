import { formatUnits } from "viem";

/** Format a bigint token amount to a human-readable string */
export function fmtToken(value: bigint | undefined, decimals = 18, dp = 2): string {
  if (value === undefined) return "—";
  const formatted = formatUnits(value, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return "0";
  if (num < 0.01) return "<0.01";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** Shorten an address to 0x1234…abcd */
export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
