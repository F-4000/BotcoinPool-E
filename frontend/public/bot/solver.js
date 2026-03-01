// scripts/operator/solver.js — LLM challenge solver (OpenAI / Anthropic)
import { config, getModel } from "./config.js";
import { log } from "./logger.js";

// ─── Prompt Builder ───────────────────────────────────────────────

function buildPrompt(challenge) {
  const { doc, questions, constraints, companies, solveInstructions } = challenge;

  let prompt = `You are solving a BOTCOIN mining challenge. Read the document carefully, then produce a single-line artifact that satisfies ALL constraints exactly.

=== DOCUMENT ===
${doc}

=== QUESTIONS ===
${questions.map((q, i) => `Q${i + 1}: ${q}`).join("\n")}

=== COMPANIES (valid answer names) ===
${companies.join(", ")}

=== CONSTRAINTS ===
${constraints.map((c, i) => `C${i + 1}: ${c}`).join("\n")}
`;

  if (solveInstructions) {
    prompt += `\n=== SOLVE INSTRUCTIONS ===\n${solveInstructions}\n`;
  }

  // Check if challenge has a proposal (governance vote)
  if (challenge.proposal) {
    prompt += `
=== PROPOSAL ===
${typeof challenge.proposal === "string" ? challenge.proposal : JSON.stringify(challenge.proposal)}

After your artifact, append exactly on new lines:
VOTE: yes|no
REASONING: <100 words max>
`;
  }

  prompt += `
=== OUTPUT FORMAT (CRITICAL) ===
Your response must be exactly one line — the artifact string and nothing else. Do NOT output "Q1:", "Looking at", "Let me", "First", "Answer:", or any reasoning. Do NOT explain your process. Output ONLY the single-line artifact that satisfies all constraints. No preamble. No JSON. Just the artifact.`;

  return prompt;
}

// ─── OpenAI ───────────────────────────────────────────────────────

async function solveWithOpenAI(challenge) {
  const model = getModel();
  const prompt = buildPrompt(challenge);

  log.debug(`Calling OpenAI (${model})...`);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are an expert puzzle solver. Follow instructions exactly. Output ONLY the final artifact — no reasoning, no formatting.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: config.llmMaxTokens,
      temperature: 0,
    }),
  });

  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `OpenAI auth error (${res.status}): ${body.error?.message || JSON.stringify(body)}`
    );
  }
  if (res.status === 429) {
    log.warn("OpenAI rate limited — waiting 30s");
    await sleep(30000);
    return solveWithOpenAI(challenge); // retry once
  }
  if (res.status >= 500) {
    log.warn(`OpenAI ${res.status} — waiting 30s and retrying`);
    await sleep(30000);
    return solveWithOpenAI(challenge);
  }

  const data = await res.json();
  if (!data.choices?.[0]?.message?.content) {
    throw new Error(`OpenAI empty response: ${JSON.stringify(data)}`);
  }

  const artifact = data.choices[0].message.content.trim();
  log.info(`OpenAI response (${artifact.length} chars): ${artifact.slice(0, 120)}...`);
  return artifact;
}

// ─── Anthropic ────────────────────────────────────────────────────

async function solveWithAnthropic(challenge) {
  const model = getModel();
  const prompt = buildPrompt(challenge);

  log.debug(`Calling Anthropic (${model})...`);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: config.llmMaxTokens,
      system:
        "You are an expert puzzle solver. Follow instructions exactly. Output ONLY the final artifact — no reasoning, no formatting.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      `Anthropic auth error (${res.status}): ${body.error?.message || JSON.stringify(body)}`
    );
  }
  if (res.status === 429) {
    log.warn("Anthropic rate limited — waiting 30s");
    await sleep(30000);
    return solveWithAnthropic(challenge); // retry once
  }
  if (res.status === 529 || res.status >= 500) {
    log.warn(`Anthropic ${res.status} — waiting 30s and retrying`);
    await sleep(30000);
    return solveWithAnthropic(challenge);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error(`Anthropic empty response: ${JSON.stringify(data)}`);
  }

  const artifact = textBlock.text.trim();
  log.info(
    `Anthropic response (${artifact.length} chars): ${artifact.slice(0, 120)}...`
  );
  return artifact;
}

// ─── Public Interface ─────────────────────────────────────────────

/**
 * Solve a challenge using the configured LLM provider.
 * @param {object} challenge — from coordinator /v1/challenge
 * @returns {Promise<string>} single-line artifact
 */
export async function solveChallenge(challenge) {
  const provider = config.llmProvider;
  log.info(`Solving challenge ${challenge.challengeId} with ${provider}/${getModel()}`);

  const start = Date.now();
  let artifact;

  if (provider === "openai") {
    artifact = await solveWithOpenAI(challenge);
  } else if (provider === "anthropic") {
    artifact = await solveWithAnthropic(challenge);
  } else {
    throw new Error(`Unknown LLM provider: ${provider}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log.info(`Solve completed in ${elapsed}s`);
  return artifact;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
