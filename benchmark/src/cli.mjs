#!/usr/bin/env node
/**
 * Benchmark CLI for Omni-Context LoCoMo evaluation.
 *
 * Usage:
 *   npm run benchmark:dev -- --dataset <path-to-locomo10.json>
 *   npm run benchmark:resume -- --run-id <run_id>
 *   npm run benchmark:retry-errors -- --run-id <run_id>
 *
 * Required env vars:
 *   LLM_API_URL   — OpenAI-compatible API base URL (e.g., https://api.deepseek.com/v1)
 *   LLM_API_KEY   — API key for the LLM
 *   LLM_MODEL     — Model name for answer generation (e.g., deepseek-chat)
 *   JUDGE_MODEL   — Model name for judge (optional, defaults to LLM_MODEL)
 *
 * Optional env vars:
 *   LOCAL_API_TOKEN    — Token inherited by each isolated Brain Server
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runBenchmark,
  resumeBenchmark,
  retryErrors,
  requestShutdown,
} from "./runner/index.mjs";
import { LLMClient } from "./llm-client.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function usage() {
  console.error("Usage:");
  console.error("  node src/cli.mjs dev [--dataset <path>] [--brain-server-root <dir>]");
  console.error("  node src/cli.mjs resume --run-id <run_id> [--dataset <path>]");
  console.error("  node src/cli.mjs retry-errors --run-id <run_id> [--dataset <path>]");
  console.error("");
  console.error("  dev                       Run development conversation 1 (new run).");
  console.error("  resume                    Resume an existing run by run-id.");
  console.error("  retry-errors              Retry only error questions from an existing run.");
  console.error("  --dataset <path>          Path to official locomo10.json (default: data/locomo10.json).");
  console.error("  --brain-server-root <dir> Root containing dist/api-server.js (default: ../brain-server).");
  console.error("  --runs <dir>              Directory for run results (default: runs/).");
  console.error("  --config <path>           Benchmark config file (default: config/default.json).");
  console.error("  --run-id <id>             Run ID to resume or retry (required for resume/retry-errors).");
  console.error("");
  console.error("Required env vars: LLM_API_URL, LLM_API_KEY, LLM_MODEL");
  console.error("Optional env vars: JUDGE_MODEL, LOCAL_API_TOKEN");
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
  if (mode !== "dev" && mode !== "heldout" && mode !== "resume" && mode !== "retry-errors") {
    usage();
  }

  // Parse flags
  const getFlag = (name) => {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const datasetPath = getFlag("--dataset") || path.join(ROOT, "data", "locomo10.json");
  const brainServerRoot = path.resolve(getFlag("--brain-server-root") || path.join(ROOT, "..", "brain-server"));
  const runsRoot = getFlag("--runs") || path.join(ROOT, "runs");
  const configPath = getFlag("--config") || path.join(ROOT, "config", "default.json");
  const runId = getFlag("--run-id");

  // Validate env vars
  if (!process.env.LLM_API_URL && !process.env.LLM_API_KEY && !process.env.LLM_MODEL) {
    console.error("ERROR: LLM env vars not set.");
    console.error("Required: LLM_API_URL, LLM_API_KEY, LLM_MODEL");
    console.error("Optional: JUDGE_MODEL (defaults to LLM_MODEL)");
    process.exit(1);
  }

  // Validate run-id for resume/retry-errors
  if ((mode === "resume" || mode === "retry-errors") && !runId) {
    console.error(`ERROR: --run-id is required for ${mode} mode.`);
    usage();
  }

  // SIGINT/SIGTERM safe shutdown
  const shutdownHandler = (signal) => {
    console.error(`\n[benchmark] ${signal} received, requesting safe shutdown...`);
    requestShutdown();
  };
  process.on("SIGINT", () => shutdownHandler("SIGINT"));
  process.on("SIGTERM", () => shutdownHandler("SIGTERM"));

  const [config, datasetManifest, answerPrompt, judgePrompt] = await Promise.all([
    loadConfig(configPath),
    loadConfig(path.join(ROOT, "dataset_manifest.json")),
    loadPrompt(path.join(ROOT, "prompts", "answer-v1.txt")),
    loadPrompt(path.join(ROOT, "prompts", "judge-v2.txt")),
  ]);

  // Create real LLM client (never null)
  const llmClient = new LLMClient();

  console.log(`[benchmark] Mode: ${mode}`);
  console.log(`[benchmark] Dataset: ${datasetPath}`);
  console.log(`[benchmark] Brain Server root: ${brainServerRoot}`);
  console.log("[benchmark] Runtime: isolated process and database per conversation");
  console.log(`[benchmark] Answer model: ${llmClient.answerConfig.model}`);
  console.log(`[benchmark] Judge model: ${llmClient.judgeConfig.model}`);

  let result;

  if (mode === "dev" || mode === "heldout") {
    const split = mode === "dev" ? "development" : "heldout";
    const conversationIds = mode === "dev"
      ? [1]
      : datasetManifest.heldout_conversations;

    console.log(`[benchmark] Conversations: ${conversationIds.join(", ")}`);
    console.log("");

    result = await runBenchmark({
      llmClient,
      datasetPath,
      config,
      answerPrompt,
      judgePrompt,
      datasetManifest,
      split,
      conversationIds,
      runsRoot,
      brainServerRoot,
    });
  } else if (mode === "resume") {
    console.log(`[benchmark] Resuming run: ${runId}`);
    console.log("");

    result = await resumeBenchmark({
      llmClient,
      datasetPath,
      config,
      answerPrompt,
      judgePrompt,
      datasetManifest,
      runsRoot,
      runId,
      brainServerRoot,
    });
  } else if (mode === "retry-errors") {
    console.log(`[benchmark] Retrying errors from run: ${runId}`);
    console.log("");

    result = await retryErrors({
      llmClient,
      datasetPath,
      config,
      answerPrompt,
      judgePrompt,
      datasetManifest,
      runsRoot,
      runId,
      brainServerRoot,
    });
  }

  console.log("");
  console.log("[benchmark] === Run Complete ===");
  console.log(`  Run ID: ${result.manifest.run_id || runId}`);
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
  console.log("");
  console.log("To resume:");
  console.log(`  npm run benchmark:resume -- --run-id ${result.manifest.run_id || runId}`);
  console.log("To retry errors:");
  console.log(`  npm run benchmark:retry-errors -- --run-id ${result.manifest.run_id || runId}`);
}

main().catch((err) => {
  console.error("Benchmark runner failed:", err);
  process.exit(1);
});
