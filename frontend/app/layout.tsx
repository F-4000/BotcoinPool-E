import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import Header from "@/components/Header";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Botcoin Pool | Trustless Mining on Base",
  description: "Trustless mining pool for Botcoin on Base",
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
