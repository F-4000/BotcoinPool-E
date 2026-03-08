import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pool Details",
  description:
    "View pool status, deposits, mining credits, rewards, and lifecycle actions for a Botcoin mining pool on Base.",
  openGraph: {
    title: "Botcoin Pool - Pool Details",
    description:
      "View pool status, deposits, mining credits, rewards, and lifecycle actions for a Botcoin mining pool on Base.",
  },
};

export default function PoolLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
