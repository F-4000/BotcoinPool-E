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

// Official BotcoinMining contract on Base
export const MINING_ADDRESS =
  "0xd572e61e1B627d4105832C815Ccd722B5baD9233" as `0x${string}`;

// BOTCOIN token on Base
export const BOTCOIN_ADDRESS =
  "0xA601877977340862Ca67f816eb079958E5bd0BA3" as `0x${string}`;
