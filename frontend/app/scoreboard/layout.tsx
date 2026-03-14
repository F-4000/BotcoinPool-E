import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Real-time solver activity, credits, and reward shares across all Botcoin mining pools on Base.",
  alternates: { canonical: "/scoreboard" },
  openGraph: {
    title: "Botcoin Pool - Leaderboard",
    description:
      "Real-time solver activity, credits, and reward shares across all Botcoin mining pools on Base.",
  },
};

export default function ScoreboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
