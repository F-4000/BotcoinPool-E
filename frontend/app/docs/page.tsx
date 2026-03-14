import Link from "next/link";
import type { Metadata } from "next";
import DocsClient from "./DocsClient";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "How Botcoin Pool works: contracts, lifecycle, reward distribution, operator bot setup, and security model.",
  alternates: { canonical: "/docs" },
  openGraph: {
    title: "Botcoin Pool - Documentation",
    description:
      "How Botcoin Pool works: contracts, lifecycle, reward distribution, operator bot setup, and security model.",
  },
};

export default function DocsPage() {
  return <DocsClient />;
}
