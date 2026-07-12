#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark } from "./runner/index.mjs";
import { sha256 } from "./integrity.mjs";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function usage() {
  console.error("Usage: node benchmark/src/cli.mjs <dev|heldout> [--dataset <path>] [--runs <dir>]");
  console.error("  dev     Run development conversation 1 only.");
  console.error("  heldout Run held-out conversations (requires freeze authorization).");
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

  const datasetFlagIdx = args.indexOf("--dataset");
  const runsFlagIdx = args.indexOf("--runs");
  const datasetPath = datasetFlagIdx >= 0
    ? args[datasetFlagIdx + 1]
    : path.join(ROOT, "data", "locomo10.json");
  const runsRoot = runsFlagIdx >= 0
    ? args[runsFlagIdx + 1]
    : path.join(ROOT, "runs");

  const configPath = args.includes("--config")
    ? args[args.indexOf("--config") + 1]
    : path.join(ROOT, "config", "default.json");

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

  const embeddingStatus = {
    mode: "semantic",
    model: "Xenova/multilingual-e5-small",
    available: false,
  };

  const result = await runBenchmark({
    datasetPath,
    config,
    answerPrompt,
    judgePrompt,
    datasetManifest,
    split,
    conversationIds,
    runsRoot,
    llmClient: null,
    embeddingStatus,
    brainServerFactory: async (convId) => {
      throw new Error(
        "Brain server factory not configured. " +
        "Use a real brain server connection for production runs."
      );
    },
  });

  console.log(JSON.stringify(result.stats, null, 2));
}

main().catch((err) => {
  console.error("Benchmark runner failed:", err);
  process.exit(1);
});
