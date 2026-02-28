import { http } from "wagmi";
import { base } from "wagmi/chains";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";

export const config = getDefaultConfig({
  appName: "Botcoin Mining Pool",
  projectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "demo",
  chains: [base],
  transports: {
    [base.id]: http(),
  },
  ssr: true,
});

// Update this after deploying via the Factory
export const FACTORY_ADDRESS =
  (process.env.NEXT_PUBLIC_FACTORY_ADDRESS as `0x${string}`) ||
  ("0x0000000000000000000000000000000000000000" as `0x${string}`);

// Official BotcoinMiningV2 contract on Base
export const MINING_ADDRESS =
  "0xcF5F2D541EEb0fb4cA35F1973DE5f2B02dfC3716" as `0x${string}`;

// BonusEpoch contract on Base
export const BONUS_EPOCH_ADDRESS =
  "0xA185fE194A7F603b7287BC0abAeBA1b896a36Ba8" as `0x${string}`;

// BOTCOIN token on Base
export const BOTCOIN_ADDRESS =
  "0xA601877977340862Ca67f816eb079958E5bd0BA3" as `0x${string}`;
