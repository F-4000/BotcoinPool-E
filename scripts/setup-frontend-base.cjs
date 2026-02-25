const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = path.join(__dirname, '../artifacts/contracts');
const FRONTEND_DIR = path.join(__dirname, '../frontend');
const ABI_DIR = path.join(FRONTEND_DIR, 'abis');

if (!fs.existsSync(ABI_DIR)) {
  fs.mkdirSync(ABI_DIR, { recursive: true });
}

// 1. Copy ABIs
const contracts = ['BotcoinPool.sol/BotcoinPool.json', 'BotcoinPoolFactory.sol/BotcoinPoolFactory.json'];
contracts.forEach(contractPath => {
  const artifactPath = path.join(ARTIFACTS_DIR, contractPath);
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const abiPath = path.join(ABI_DIR, path.basename(contractPath));
    const finalAbi = {
        abi: artifact.abi
    };
    fs.writeFileSync(abiPath, JSON.stringify(finalAbi, null, 2));
    console.log(`Copied ABI for ${contractPath}`);
  } else {
    console.warn(`Artifact not found: ${contractPath}`);
  }
});

// 2. Create Config
const configContent = `
import { http, createConfig } from 'wagmi';
import { base, baseSepolia, hardhat } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

export const config = getDefaultConfig({
  appName: 'Botcoin Mining Pool',
  projectId: 'YOUR_PROJECT_ID', // Get one from WalletConnect Cloud
  chains: [base, baseSepolia, hardhat],
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
    [hardhat.id]: http(),
  },
  ssr: true,
});

export const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || "0x_YOUR_FACTORY_ADDRESS"; // Update with deployed address
`;

const libDir = path.join(FRONTEND_DIR, 'lib');
if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });
fs.writeFileSync(path.join(libDir, 'config.ts'), configContent);
console.log('Created frontend/lib/config.ts');

// 3. Create Providers
const providersContent = `
'use client';

import * as React from 'react';
import {
  RainbowKitProvider,
} from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { config } from '../lib/config';

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
`;

fs.writeFileSync(path.join(FRONTEND_DIR, 'app/providers.tsx'), providersContent);
console.log('Created frontend/app/providers.tsx');

// 4. Update Layout
const layoutContent = `
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import '@rainbow-me/rainbowkit/styles.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Botcoin Mining Pool',
  description: 'Combined Mining for Botcoin',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
`;

const layoutPath = path.join(FRONTEND_DIR, 'app/layout.tsx');
fs.writeFileSync(layoutPath, layoutContent);
console.log(`Updated ${layoutPath}`);
