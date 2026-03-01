"use client";

import { useState } from "react";

interface OperatorSetupProps {
  poolAddress: string;
  operatorAddress?: string;
}

const SUBMIT_RECEIPT_SELECTOR = "0x8b3e05f8";

const BOT_FILES = [
  "bot.js", "config.js", "coordinator.js", "solver.js",
  "bankr.js", "pool.js", "logger.js", "package.json",
];

/** Fetch all bot files from /bot/ and zip them into a downloadable blob */
async function downloadBotZip(envContent: string) {
  // Fetch all bot source files
  const files: { name: string; data: Uint8Array }[] = [];

  for (const name of BOT_FILES) {
    const res = await fetch(`/bot/${name}`);
    if (!res.ok) throw new Error(`Failed to fetch ${name}`);
    const buf = await res.arrayBuffer();
    files.push({ name, data: new Uint8Array(buf) });
  }

  // Add .env template
  files.push({ name: ".env", data: new TextEncoder().encode(envContent) });

  // Build a simple uncompressed zip
  const zip = buildZip(files);
  const blob = new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "botcoinpool-bot.zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Minimal uncompressed zip encoder (no external deps) */
function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);

    // Local file header (30 + name + data)
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);  // signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0, true);            // flags
    lv.setUint16(8, 0, true);            // compression (store)
    lv.setUint16(10, 0, true);           // mod time
    lv.setUint16(12, 0, true);           // mod date
    lv.setUint32(14, crc, true);         // crc32
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);           // extra length
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    parts.push(local);

    // Central directory entry
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0x20, true);  // external attrs
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    centralDir.push(cd);

    offset += local.length;
  }

  // End of central directory
  const cdSize = centralDir.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total = offset + cdSize + 22;
  const result = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  for (const c of centralDir) { result.set(c, pos); pos += c.length; }
  result.set(eocd, pos);
  return result;
}

/** CRC-32 (standard zip) */
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** Generate .env template (no real keys — just placeholders) */
function envTemplate(poolAddress: string, llmProvider: string): string {
  return [
    "# BotcoinPool Operator Bot — Configuration Template",
    `# Pool: ${poolAddress}`,
    "",
    "# ── Bankr API ──",
    "# Get your API key from https://bankr.bot/terminal",
    "BANKR_API_KEY=<your-bankr-api-key>",
    "",
    "# ── Pool Address ──",
    `POOL_ADDRESS=${poolAddress}`,
    "",
    "# ── LLM ──",
    `LLM_PROVIDER=${llmProvider}`,
    llmProvider === "openai"
      ? "OPENAI_API_KEY=<your-openai-api-key>"
      : "ANTHROPIC_API_KEY=<your-anthropic-api-key>",
    "",
    "# ── Optional Tuning ──",
    "# LOOP_DELAY_MS=5000",
    "# MAX_CONSECUTIVE_FAILURES=5",
    "# LOG_LEVEL=info",
    "",
  ].join("\n");
}

export default function OperatorSetup({ poolAddress, operatorAddress }: OperatorSetupProps) {
  const [step, setStep] = useState(0);
  const [llmProvider, setLlmProvider] = useState<"openai" | "anthropic">("openai");
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [dlMethod, setDlMethod] = useState<"zip" | "git">("zip");
  const [gitCopied, setGitCopied] = useState(false);

  const totalSteps = 6;

  function handleCopyTemplate() {
    navigator.clipboard.writeText(envTemplate(poolAddress, llmProvider));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDownloadBot() {
    setDownloading(true);
    setDownloadError("");
    try {
      await downloadBotZip(envTemplate(poolAddress, llmProvider));
    } catch (e) {
      setDownloadError((e as Error).message || "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  const GIT_REPO = "https://github.com/F-4000/BotcoinPool-E.git";
  const gitCommands = `git clone --no-checkout --depth 1 --filter=blob:none ${GIT_REPO} botcoinpool-bot
cd botcoinpool-bot
git sparse-checkout set scripts/operator
git checkout
mv scripts/operator/* .
rm -rf scripts .git`;

  function handleCopyGit() {
    navigator.clipboard.writeText(gitCommands);
    setGitCopied(true);
    setTimeout(() => setGitCopied(false), 2000);
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-full border border-danger/40 bg-danger/5 rounded-xl p-4 text-left hover:bg-danger/10 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-danger pulse-dot shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-bold text-danger">Action Required — Bot Not Configured</p>
            <p className="text-xs text-text-dim mt-0.5">
              Your pool <span className="text-text font-semibold">cannot earn rewards</span> without a running mining bot.
              Click to set it up.
            </p>
          </div>
          <svg className="w-5 h-5 text-danger shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
    );
  }

  return (
    <div className="gradient-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span className="text-xs text-muted uppercase tracking-wide">Operator Bot Setup</span>
        </div>
        <button onClick={() => setCollapsed(true)} className="text-xs text-muted hover:text-text cursor-pointer">
          Collapse ↑
        </button>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1 mb-5">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= step ? "bg-base-blue" : "bg-border"
            }`}
          />
        ))}
      </div>

      {/* Step 0: What is this? Overview */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="bg-danger/5 border border-danger/30 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-danger pulse-dot shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-danger">Your pool will not mine without this</p>
                <p className="text-xs text-text-dim leading-relaxed mt-1">
                  Botcoin pools earn rewards by solving AI challenges on-chain. This requires an <span className="text-text font-semibold">operator bot</span> — a program that runs 24/7, fetches challenges, solves them with an LLM (like GPT-4 or Claude), and submits proofs through your pool contract.
                </p>
                <p className="text-xs text-danger/80 font-medium mt-2">
                  Without the bot running, your pool sits idle and earns zero credits — even if people deposit into it.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-black/20 rounded-lg p-4 space-y-3">
            <p className="text-[11px] text-muted uppercase tracking-wide font-semibold mb-1">What you&apos;ll need</p>
            <div className="flex items-start gap-3">
              <span className="text-xs font-bold text-base-blue-light bg-base-blue/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">1</span>
              <div>
                <p className="text-xs text-text font-medium">Bankr wallet</p>
                <p className="text-[11px] text-muted">A custodial wallet that signs transactions for your bot. Free to create at <span className="text-base-blue-light">bankr.bot/terminal</span></p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xs font-bold text-base-blue-light bg-base-blue/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">2</span>
              <div>
                <p className="text-xs text-text font-medium">LLM API key</p>
                <p className="text-[11px] text-muted">OpenAI or Anthropic — used to solve mining challenges</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xs font-bold text-base-blue-light bg-base-blue/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">3</span>
              <div>
                <p className="text-xs text-text font-medium">A machine that stays online</p>
                <p className="text-[11px] text-muted">The bot runs as a Node.js script — any VPS, server, or always-on laptop works</p>
              </div>
            </div>
          </div>

          <button onClick={() => setStep(1)} className="btn-primary w-full py-3 text-sm font-semibold">
            I understand — let&apos;s set up the bot →
          </button>
        </div>
      )}

      {/* Step 1: Create Bankr wallet */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-text mb-1">Step 1: Create a Bankr Wallet</h4>
            <p className="text-xs text-text-dim leading-relaxed">
              <a href="https://bankr.bot/terminal" target="_blank" rel="noopener noreferrer" className="text-base-blue-light hover:underline font-medium">Bankr</a> is a custodial wallet service that lets your bot sign and submit transactions on Base. Your Bankr wallet address is the <span className="text-text font-medium">operator</span> of this pool.
            </p>
          </div>

          <div className="bg-black/20 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-xs font-bold text-base-blue-light bg-base-blue/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">1</span>
              <div>
                <p className="text-xs text-text">Go to <a href="https://bankr.bot/terminal" target="_blank" rel="noopener noreferrer" className="text-base-blue-light hover:underline font-medium">bankr.bot/terminal →</a> and create an agent</p>
                <p className="text-[11px] text-muted">Free signup — you&apos;ll get a wallet address (0x…) and an API key</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xs font-bold text-base-blue-light bg-base-blue/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">2</span>
              <div>
                <p className="text-xs text-text">Copy your <span className="text-base-blue-light font-medium">Bankr API key</span></p>
                <p className="text-[11px] text-muted">Go to <a href="https://bankr.bot/terminal" target="_blank" rel="noopener noreferrer" className="text-base-blue-light hover:underline font-medium">bankr.bot/terminal →</a> — make sure read-only mode is <span className="text-warn font-medium">disabled</span></p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xs font-bold text-base-blue-light bg-base-blue/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">3</span>
              <div>
                <p className="text-xs text-text">Fund the wallet with a small amount of <span className="text-text font-medium">ETH on Base</span></p>
                <p className="text-[11px] text-muted">Needed for gas when posting receipts (~$0.01 per tx). Send ETH to your Bankr wallet address.</p>
              </div>
            </div>
          </div>

          {operatorAddress && (
            <div className="bg-black/20 rounded-lg p-3">
              <p className="text-[11px] text-muted">Current operator:</p>
              <p className="text-xs text-text font-tabular break-all mt-1">{operatorAddress}</p>
            </div>
          )}

          <div className="bg-warn/5 border border-warn/20 rounded-lg p-3">
            <p className="text-[11px] text-warn font-medium">Important: The Bankr wallet address must match your pool&apos;s operator address.</p>
            <p className="text-[11px] text-muted mt-0.5">If they don&apos;t match, you can change the operator in the Admin Panel below.</p>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(0)} className="btn-ghost px-4 py-3 text-sm cursor-pointer">← Back</button>
            <button onClick={() => setStep(2)} className="btn-primary flex-1 py-3 text-sm">
              I have my Bankr wallet &amp; API key → Next
            </button>
          </div>
        </div>
      )}

      {/* Step 2: LLM key */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-text mb-1">Step 2: Choose Your LLM</h4>
            <p className="text-xs text-text-dim leading-relaxed">
              The bot solves mining challenges using an AI model. You need an API key from <span className="text-base-blue-light">OpenAI</span> or <span className="text-base-blue-light">Anthropic</span>.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setLlmProvider("openai")}
              className={`flex-1 py-3 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                llmProvider === "openai"
                  ? "bg-base-blue/15 text-base-blue-light border border-base-blue/30"
                  : "bg-black/20 text-muted border border-border hover:text-text"
              }`}
            >
              OpenAI (GPT-4o)
            </button>
            <button
              onClick={() => setLlmProvider("anthropic")}
              className={`flex-1 py-3 rounded-lg text-sm font-medium transition-all cursor-pointer ${
                llmProvider === "anthropic"
                  ? "bg-base-blue/15 text-base-blue-light border border-base-blue/30"
                  : "bg-black/20 text-muted border border-border hover:text-text"
              }`}
            >
              Anthropic (Claude)
            </button>
          </div>

          <p className="text-[11px] text-muted">
            Get a key from{" "}
            {llmProvider === "openai" ? (
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-base-blue-light hover:underline">platform.openai.com →</a>
            ) : (
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-base-blue-light hover:underline">console.anthropic.com →</a>
            )}
          </p>

          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="btn-ghost px-4 py-3 text-sm cursor-pointer">← Back</button>
            <button onClick={() => setStep(3)} className="btn-primary flex-1 py-3 text-sm">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: .env template */}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-text mb-1">Step 3: Create Your .env Config</h4>
            <p className="text-xs text-text-dim leading-relaxed">
              Create a file named <code className="text-base-blue-light">.env</code> in the bot project root with the following contents.
              Replace the <code className="text-warn">&lt;placeholders&gt;</code> with your actual keys.
            </p>
          </div>

          <div className="bg-black/30 rounded-lg p-4 relative">
            <button
              onClick={handleCopyTemplate}
              className="absolute top-2 right-2 text-[10px] text-muted hover:text-text cursor-pointer bg-black/40 px-2 py-1 rounded"
            >
              {copied ? "✓ Copied" : "Copy"}
            </button>
            <pre className="text-[11px] text-text font-tabular leading-relaxed overflow-x-auto whitespace-pre-wrap">
{envTemplate(poolAddress, llmProvider)}
            </pre>
          </div>

          <div className="bg-black/20 rounded-lg p-3 space-y-2">
            <p className="text-[11px] text-muted font-semibold uppercase tracking-wide">Where to get your keys:</p>
            <p className="text-[11px] text-text-dim">
              <span className="text-base-blue-light font-medium">BANKR_API_KEY</span> → <a href="https://bankr.bot/terminal" target="_blank" rel="noopener noreferrer" className="text-base-blue-light hover:underline">bankr.bot/terminal</a> (the same agent you used as operator)
            </p>
            <p className="text-[11px] text-text-dim">
              <span className="text-base-blue-light font-medium">{llmProvider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"}</span> → {llmProvider === "openai" ? (
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-base-blue-light hover:underline">platform.openai.com</a>
              ) : (
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-base-blue-light hover:underline">console.anthropic.com</a>
              )}
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="btn-ghost px-4 py-3 text-sm cursor-pointer">← Back</button>
            <button onClick={() => setStep(4)} className="btn-primary flex-1 py-3 text-sm">
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Whitelist selector */}
      {step === 4 && (
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-text mb-1">Step 4: Whitelist submitReceipt</h4>
            <p className="text-xs text-text-dim leading-relaxed">
              Your pool needs to allow the bot to forward mining receipts.
              Go to the <span className="text-base-blue-light font-medium">Admin Panel</span> below and whitelist the selector.
            </p>
          </div>

          <div className="bg-black/20 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-xs font-bold text-base-blue-light bg-base-blue/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">1</span>
              <div>
                <p className="text-xs text-text">Scroll down to <span className="text-warn font-medium">Admin Panel → Operator Selector Whitelist</span></p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xs font-bold text-base-blue-light bg-base-blue/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">2</span>
              <div>
                <p className="text-xs text-text">Paste this selector:</p>
                <div className="flex items-center gap-2 mt-1">
                  <code className="text-xs text-base-blue-light bg-base-blue/10 px-2 py-1 rounded font-tabular">{SUBMIT_RECEIPT_SELECTOR}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(SUBMIT_RECEIPT_SELECTOR)}
                    className="text-[10px] text-muted hover:text-text cursor-pointer"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-[10px] text-muted mt-1">This is the <code className="text-text-dim">submitReceipt</code> function selector on MiningV2</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-xs font-bold text-base-blue-light bg-base-blue/10 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">3</span>
              <div>
                <p className="text-xs text-text">Click <span className="text-success font-medium">Allow</span> and confirm the transaction</p>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="btn-ghost px-4 py-3 text-sm cursor-pointer">← Back</button>
            <button onClick={() => setStep(5)} className="btn-primary flex-1 py-3 text-sm">
              Done, selector whitelisted → Next
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Download bot & launch */}
      {step === 5 && (
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-text mb-1">Step 5: Download &amp; Launch the Bot</h4>
            <p className="text-xs text-text-dim leading-relaxed">
              Grab the bot files, fill in your keys, and start mining.
            </p>
          </div>

          {/* Method toggle */}
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            <button
              onClick={() => setDlMethod("zip")}
              className={`flex-1 py-2 text-xs font-medium transition-colors cursor-pointer ${
                dlMethod === "zip"
                  ? "bg-base-blue/15 text-base-blue-light border-r border-white/10"
                  : "bg-black/20 text-muted hover:text-text-dim border-r border-white/10"
              }`}
            >
              ↓ Download .zip
            </button>
            <button
              onClick={() => setDlMethod("git")}
              className={`flex-1 py-2 text-xs font-medium transition-colors cursor-pointer ${
                dlMethod === "git"
                  ? "bg-base-blue/15 text-base-blue-light"
                  : "bg-black/20 text-muted hover:text-text-dim"
              }`}
            >
              &gt;_ Clone via Git
            </button>
          </div>

          {/* ZIP option */}
          {dlMethod === "zip" && (
            <div className="space-y-4">
              <button
                onClick={handleDownloadBot}
                disabled={downloading}
                className="w-full bg-base-blue/10 border border-base-blue/30 rounded-lg p-4 hover:bg-base-blue/15 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-6 h-6 text-base-blue-light shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="text-left flex-1">
                    <p className="text-sm font-semibold text-base-blue-light">
                      {downloading ? "Downloading..." : "Download Bot Files (.zip)"}
                    </p>
                    <p className="text-[11px] text-muted mt-0.5">
                      Includes all bot scripts, package.json, and your .env template with pool address pre-filled
                    </p>
                  </div>
                </div>
              </button>
              {downloadError && <p className="text-xs text-danger">{downloadError}</p>}
            </div>
          )}

          {/* GIT option */}
          {dlMethod === "git" && (
            <div className="space-y-3">
              <p className="text-xs text-text-dim leading-relaxed">
                Run these commands to pull <span className="text-text font-medium">only the bot files</span> from the repo (requires Git):
              </p>
              <div className="relative">
                <pre className="bg-black/40 border border-white/10 rounded-lg p-4 text-xs text-text font-tabular overflow-x-auto leading-relaxed whitespace-pre">
{gitCommands}
                </pre>
                <button
                  onClick={handleCopyGit}
                  className="absolute top-2 right-2 text-[10px] text-muted hover:text-text bg-white/5 hover:bg-white/10 rounded px-2 py-1 transition-colors cursor-pointer"
                >
                  {gitCopied ? "Copied ✓" : "Copy"}
                </button>
              </div>
              <p className="text-[11px] text-text-dim">
                Then create your <code className="text-warn">.env</code> file — use the template from Step 3.
              </p>
            </div>
          )}

          {/* File manifest */}
          <div className="bg-black/20 rounded-lg p-4 space-y-2">
            <p className="text-[11px] text-muted font-semibold uppercase tracking-wide">What you get:</p>
            <div className="grid grid-cols-2 gap-1 text-[11px] font-tabular">
              <span className="text-text-dim">bot.js</span><span className="text-muted">Main mining loop</span>
              <span className="text-text-dim">config.js</span><span className="text-muted">Env config loader</span>
              <span className="text-text-dim">coordinator.js</span><span className="text-muted">Challenge API client</span>
              <span className="text-text-dim">solver.js</span><span className="text-muted">LLM solver (GPT-4 / Claude)</span>
              <span className="text-text-dim">bankr.js</span><span className="text-muted">Bankr wallet API client</span>
              <span className="text-text-dim">pool.js</span><span className="text-muted">Pool contract helpers</span>
              <span className="text-text-dim">logger.js</span><span className="text-muted">Logging utility</span>
              <span className="text-text-dim">package.json</span><span className="text-muted">Dependencies (ethers, dotenv)</span>
              {dlMethod === "zip" && (
                <><span className="text-text-dim">.env</span><span className="text-warn">← Fill in your keys</span></>
              )}
            </div>
          </div>

          <div className="bg-black/30 rounded-lg p-4 space-y-3">
            <p className="text-[11px] text-muted font-semibold uppercase tracking-wide">After {dlMethod === "zip" ? "downloading" : "cloning"}:</p>
            {dlMethod === "zip" && (
              <div>
                <p className="text-[10px] text-muted mb-1">1. Unzip and enter the folder:</p>
                <pre className="text-xs text-text font-tabular overflow-x-auto">
{`unzip botcoinpool-bot.zip -d botcoinpool-bot
cd botcoinpool-bot`}
                </pre>
              </div>
            )}
            <div>
              <p className="text-[10px] text-muted mb-1">{dlMethod === "zip" ? "2" : "1"}. Edit .env — replace the &lt;placeholders&gt; with your real keys:</p>
              <pre className="text-xs text-text font-tabular overflow-x-auto">
{`nano .env`}
              </pre>
            </div>
            <div>
              <p className="text-[10px] text-muted mb-1">{dlMethod === "zip" ? "3" : "2"}. Install dependencies:</p>
              <pre className="text-xs text-text font-tabular overflow-x-auto">
{`npm install`}
              </pre>
            </div>
            <div>
              <p className="text-[10px] text-muted mb-1">{dlMethod === "zip" ? "4" : "3"}. Start mining:</p>
              <pre className="text-xs text-base-blue-light font-tabular overflow-x-auto">
{`node bot.js`}
              </pre>
            </div>
          </div>

          <div className="bg-success/5 border border-success/20 rounded-lg p-3">
            <p className="text-xs text-success font-medium mb-1">✓ You&apos;re all set!</p>
            <p className="text-[11px] text-text-dim">
              Once the bot is running, this page will show a <span className="text-success font-semibold">Bot: Live</span> indicator
              when credits start appearing on-chain.
            </p>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(4)} className="btn-ghost px-4 py-3 text-sm cursor-pointer">← Back</button>
            <button onClick={() => setCollapsed(true)} className="btn-primary flex-1 py-3 text-sm">
              Done ✓
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
