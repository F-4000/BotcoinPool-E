import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import Header from "@/components/Header";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://botcoinpool.com";

export const metadata: Metadata = {
  title: {
    default: "Botcoin Pool - Trustless Mining on Base",
    template: "%s - Botcoin Pool",
  },
  description:
    "Trustless, permissionless mining pool for BOTCOIN on Base. Stake any amount, earn proportional rewards with on-chain transparency and O(1) gas claims.",
  keywords: [
    "Botcoin",
    "BOTCOIN",
    "mining pool",
    "Base",
    "DeFi",
    "staking",
    "AI mining",
    "crypto pool",
    "permissionless",
    "EIP-1271",
  ],
  authors: [{ name: "Botcoin Pool" }],
  creator: "Botcoin Pool",
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Botcoin Pool",
    title: "Botcoin Pool - Trustless Mining on Base",
    description:
      "Stake BOTCOIN into trustless mining pools on Base. Permissionless deposits, on-chain reward distribution, and O(1) gas claims.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Botcoin Pool - Trustless Mining on Base",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Botcoin Pool - Trustless Mining on Base",
    description:
      "Stake BOTCOIN into trustless mining pools on Base. Permissionless deposits, on-chain reward distribution, and O(1) gas claims.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} font-sans bg-surface text-text antialiased min-h-screen`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Botcoin Pool",
              url: SITE_URL,
              description:
                "Trustless, permissionless mining pool for BOTCOIN on Base. Stake any amount, earn proportional rewards.",
              applicationCategory: "DeFi",
              operatingSystem: "Web",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              creator: {
                "@type": "Organization",
                name: "Botcoin Pool",
                url: SITE_URL,
              },
            }),
          }}
        />
        <Providers>
          <div className="hero-gradient" />
          <div className="dot-pattern" />
          <div className="min-h-screen flex flex-col relative">
            <Header />
            <main className="flex-1 px-4 sm:px-6 py-6">
              {children}
            </main>
            <footer className="border-t border-border px-4 sm:px-6 py-3 text-xs text-muted flex justify-between">
              <span>Botcoin Pool · Base Mainnet</span>
              <a href="https://agentmoney.net" target="_blank" rel="noopener noreferrer" className="hover:text-base-blue-light transition-colors">AgentMoney</a>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
