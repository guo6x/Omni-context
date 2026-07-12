#!/usr/bin/env node
/**
 * Benchmark CLI for Omni-Context LoCoMo evaluation.
 *
 * Usage:
 *   npm run benchmark:dev -- --dataset <path-to-locomo10.json>
 *   npm run benchmark:dev -- --dataset <path> --brain-server-url http://127.0.0.1:3001
 *
 * Required env vars:
 *   LLM_API_URL   — OpenAI-compatible API base URL (e.g., https://api.deepseek.com/v1)
 *   LLM_API_KEY   — API key for the LLM
 *   LLM_MODEL     — Model name for answer generation (e.g., deepseek-chat)
 *   JUDGE_MODEL   — Model name for judge (optional, defaults to LLM_MODEL)
 *
 * Optional env vars:
 *   BRAIN_SERVER_URL   — Brain Server URL (default: http://127.0.0.1:3001)
 *   LOCAL_API_TOKEN    — Brain Server auth token
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark } from "./runner/index.mjs";
import { BrainServerClient } from "./brain-server-client.mjs";
import { LLMClient } from "./llm-client.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function usage() {
  console.error("Usage: node src/cli.mjs <dev|heldout> [--dataset <path>] [--brain-server-url <url>] [--runs <dir>]");
  console.error("");
  console.error("  dev                     Run development conversation 1 only.");
  console.error("  heldout                 Run held-out conversations (requires freeze authorization).");
  console.error("  --dataset <path>        Path to official locomo10.json (default: data/locomo10.json).");
  console.error("  --brain-server-url <url> Brain Server URL (default: http://127.0.0.1:3001).");
  console.error("  --runs <dir>            Directory for run results (default: runs/).");
  console.error("  --config <path>         Benchmark config file (default: config/default.json).");
  console.error("");
  console.error("Required env vars: LLM_API_URL, LLM_API_KEY, LLM_MODEL");
  console.error("Optional env vars: JUDGE_MODEL, BRAIN_SERVER_URL, LOCAL_API_TOKEN");
  process.exit(1);
}

async function loadConfig(configPath) {
  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw);
}

async function loadPrompt(promptPath) {
  return readFile(promptPath, "utf8");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const mode = args[0];
  if (mode !== "dev" && mode !== "heldout") usage();

  // Parse flags
  const getFlag = (name) => {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const datasetPath = getFlag("--dataset") || path.join(ROOT, "data", "locomo10.json");
  const brainServerUrl = getFlag("--brain-server-url") || process.env.BRAIN_SERVER_URL || "http://127.0.0.1:3001";
  const runsRoot = getFlag("--runs") || path.join(ROOT, "runs");
  const configPath = getFlag("--config") || path.join(ROOT, "config", "default.json");

  // Validate env vars
  if (!process.env.LLM_API_URL && !process.env.LLM_API_KEY && !process.env.LLM_MODEL) {
    console.error("ERROR: LLM env vars not set.");
    console.error("Required: LLM_API_URL, LLM_API_KEY, LLM_MODEL");
    console.error("Optional: JUDGE_MODEL (defaults to LLM_MODEL)");
    process.exit(1);
  }

  const [config, datasetManifest, answerPrompt, judgePrompt] = await Promise.all([
    loadConfig(configPath),
    loadConfig(path.join(ROOT, "dataset_manifest.json")),
    loadPrompt(path.join(ROOT, "prompts", "answer-v1.txt")),
    loadPrompt(path.join(ROOT, "prompts", "judge-v2.txt")),
  ]);

  const split = mode === "dev" ? "development" : "heldout";
  const conversationIds = mode === "dev"
    ? [1]
    : datasetManifest.heldout_conversations;

  // Create real Brain Server client
  const brainServerClient = new BrainServerClient({
    baseUrl: brainServerUrl,
    token: process.env.LOCAL_API_TOKEN || "",
  });

  // Create real LLM client (never null)
  const llmClient = new LLMClient();

  console.log(`[benchmark] Mode: ${mode}`);
  console.log(`[benchmark] Dataset: ${datasetPath}`);
  console.log(`[benchmark] Brain Server: ${brainServerUrl}`);
  console.log(`[benchmark] Answer model: ${llmClient.answerConfig.model}`);
  console.log(`[benchmark] Judge model: ${llmClient.judgeConfig.model}`);
  console.log(`[benchmark] Conversations: ${conversationIds.join(", ")}`);
  console.log("");

  const result = await runBenchmark({
    brainServerClient,
    llmClient,
    datasetPath,
    config,
    answerPrompt,
    judgePrompt,
    datasetManifest,
    split,
    conversationIds,
    runsRoot,
  });

  console.log("");
  console.log("[benchmark] === Run Complete ===");
  console.log(`  Run ID: ${result.manifest.run_id}`);
  console.log(`  Run dir: ${result.runDir}`);
  console.log(`  Total questions: ${result.stats.total}`);
  console.log(`  Completed: ${result.stats.done}`);
  console.log(`  Errors: ${result.stats.errors}`);
  console.log(`  Skipped (already done): ${result.stats.skipped}`);
  console.log(`  Status: ${result.manifest.status}`);
  console.log("");
  console.log(`  Results: ${path.join(result.runDir, "results.jsonl")}`);
  console.log(`  Manifest: ${path.join(result.runDir, "manifest.json")}`);
  console.log("");
  console.log("To recompute metrics:");
  console.log(`  npm run recompute -- ${result.runDir}`);
}

main().catch((err) => {
  console.error("Benchmark runner failed:", err);
  process.exit(1);
});
