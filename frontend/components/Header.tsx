"use client";

import { useState, useRef, useEffect } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useDisconnect, useBalance, useReadContract, useAccount } from "wagmi";
import { formatUnits } from "viem";
import Link from "next/link";
import { FACTORY_ADDRESS, BOTCOIN_ADDRESS } from "@/lib/config";
import { erc20Abi } from "@/lib/contracts";

/** Format a bigint token balance to a compact display string */
function fmtBalance(value: bigint | undefined, decimals: number): string {
  if (value === undefined) return "0";
  const num = Number(formatUnits(value, decimals));
  if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toFixed(4);
}

export default function Header() {
  const factorySet = FACTORY_ADDRESS !== "0x0000000000000000000000000000000000000000";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { disconnect } = useDisconnect();
  const { address, isConnected } = useAccount();

  // Fetch ETH balance
  const { data: ethBalance } = useBalance({
    address,
    query: { enabled: isConnected, refetchInterval: 15_000 },
  });

  // Fetch BOTCOIN balance
  const { data: botcoinBalance } = useReadContract({
    address: BOTCOIN_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!address, refetchInterval: 15_000 },
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur-xl sticky top-0 z-100">
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 max-w-6xl mx-auto relative">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-5">
          <Link href="/" className="text-sm font-semibold text-text hover:text-base-blue-light transition-colors">
            Botcoin
          </Link>

          <nav className="hidden sm:flex items-center gap-1 text-xs">
            <Link href="/" className="px-2.5 py-1.5 rounded-md text-text-dim hover:text-text hover:bg-white/5 transition-all">
              Pools
            </Link>
            <Link href="/scoreboard" className="px-2.5 py-1.5 rounded-md text-text-dim hover:text-text hover:bg-white/5 transition-all">
              Scoreboard
            </Link>
            <Link href="/docs" className="px-2.5 py-1.5 rounded-md text-text-dim hover:text-text hover:bg-white/5 transition-all">
              Docs
            </Link>
            {factorySet && (
              <a
                href={`https://basescan.org/address/${FACTORY_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-md text-text-dim hover:text-text hover:bg-white/5 transition-all"
              >
                Factory ↗
              </a>
            )}
            <a
              href="https://basescan.org/token/0xA601877977340862Ca67f816eb079958E5bd0BA3"
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 rounded-md text-text-dim hover:text-text hover:bg-white/5 transition-all"
            >
              Token ↗
            </a>
            <a
              href="https://github.com/F-4000/BotcoinPool-E"
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 rounded-md text-text-dim hover:text-text hover:bg-white/5 transition-all flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              GitHub
            </a>
          </nav>
        </div>

        {/* Right: Status + Wallet */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted">
            <div className="h-1.5 w-1.5 rounded-full bg-success pulse-dot" />
            <span>Base</span>
          </div>

          <ConnectButton.Custom>
            {({ account, chain, openConnectModal, mounted }) => {
              const ready = mounted;
              const connected = ready && account && chain;

              if (!connected) {
                return (
                  <button
                    onClick={openConnectModal}
                    className="btn-primary px-4 py-2 text-sm"
                  >
                    Connect Wallet
                  </button>
                );
              }

              return (
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-border hover:border-indigo/30 transition-all text-sm text-text"
                  >
                    <span className="font-tabular">{account.displayName}</span>
                    <svg className={`w-3 h-3 text-muted transition-transform ${menuOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {menuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-[rgba(17,24,39,0.85)] backdrop-blur-xl border border-indigo/15 p-2 shadow-xl shadow-black/40 z-200">
                      <div className="px-3 py-2 border-b border-border mb-1">
                        <p className="text-xs text-muted">Connected</p>
                        <p className="text-sm text-text font-tabular mt-0.5">{account.displayName}</p>
                        <div className="mt-1.5 space-y-0.5">
                          <p className="text-xs text-text-dim font-tabular">
                            {ethBalance ? fmtBalance(ethBalance.value, ethBalance.decimals) : "0"} ETH
                          </p>
                          <p className="text-xs text-base-blue-light font-tabular">
                            {fmtBalance(botcoinBalance as bigint | undefined, 18)} BOTCOIN
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(account.address);
                          setMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-text-dim hover:text-text hover:bg-white/5 transition-all"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                        </svg>
                        Copy Address
                      </button>
                      <a
                        href={`https://basescan.org/address/${account.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setMenuOpen(false)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-text-dim hover:text-text hover:bg-white/5 transition-all"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                        View on BaseScan
                      </a>
                      <button
                        onClick={() => {
                          disconnect();
                          setMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-danger hover:bg-danger/10 transition-all"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                        </svg>
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>
    </header>
  );
}
