"use client";

import * as React from "react";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, keepPreviousData } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { WagmiProvider } from "wagmi";
import { config } from "@/lib/config";
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,      // data fresh for 5s → prevents redundant refetches on mount
      gcTime: 5 * 60_000,    // keep cache entries 5 min after last subscriber unmounts
      placeholderData: keepPreviousData, // when query key changes (e.g. epoch), keep old data visible while new data loads
    },
  },
});

// BigInt ↔ JSON: wagmi returns BigInt which JSON.stringify can't handle
function serialize(data: unknown): string {
  return JSON.stringify(data, (_key, value) =>
    typeof value === "bigint" ? `#bigint.${value.toString()}` : value,
  );
}
function deserialize(str: string) {
  return JSON.parse(str, (_key, value) =>
    typeof value === "string" && value.startsWith("#bigint.")
      ? BigInt(value.slice(8))
      : value,
  ) as ReturnType<typeof JSON.parse>;
}

const persister =
  typeof window !== "undefined"
    ? createSyncStoragePersister({
        storage: window.localStorage,
        serialize,
        deserialize,
      })
    : undefined;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: persister!, maxAge: 5 * 60_000 }}
      >
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#6366f1",
            accentColorForeground: "white",
            borderRadius: "medium",
          })}
        >
          {children}
        </RainbowKitProvider>
      </PersistQueryClientProvider>
    </WagmiProvider>
  );
}
