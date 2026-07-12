import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { sha256, sha256File, configHash, stableStringify, assertEvaluationEmbeddingMode } from "../integrity.mjs";
import { loadLoCoMo, verifyDatasetHash, getConversation, getConversationQAs, getSessions } from "../dataset.mjs";
import { assertConversationAllowed } from "../splits.mjs";
import { createRun, completedQuestionIds, appendQuestionRecord } from "../run-store.mjs";
import { validateJudgeOutput, computeComposite, validateAllMetricsPresent } from "./judge/schema.mjs";

const MANIFEST_REQUIRED_FIELDS = [
  "dataset_hash", "dataset_source_commit", "benchmark_commit", "brain_server_commit",
  "answer_model", "judge_model", "embedding_model", "embedding_status",
  "prompt_hash", "config_hash", "node_version", "os", "split",
  "conversation_ids", "run_id", "started_at", "completed_at",
];

export async function buildManifest({
  datasetPath, config, answerPrompt, judgePrompt, datasetManifest,
  split, conversationIds, runId, embeddingStatus,
}) {
  const datasetHash = await verifyDatasetHash(datasetPath, datasetManifest.sha256);
  return {
    dataset_hash: datasetHash,
    dataset_source_commit: datasetManifest.source_commit,
    benchmark_commit: config.benchmark_commit || "unknown",
    brain_server_commit: config.brain_server_commit || "unknown",
    answer_model: config.answer_model || "unknown",
    judge_model: config.judge_model || "unknown",
    embedding_model: embeddingStatus.model || "unknown",
    embedding_status: embeddingStatus,
    prompt_hash: sha256(answerPrompt),
    config_hash: configHash(config),
    node_version: process.version,
    os: process.platform + " " + (process.arch || ""),
    split,
    conversation_ids: conversationIds,
    run_id: runId,
    started_at: new Date().toISOString(),
    completed_at: null,
  };
}

export function validateManifest(manifest) {
  const missing = MANIFEST_REQUIRED_FIELDS.filter((f) => manifest[f] === undefined || manifest[f] === null);
  if (missing.length > 0) {
    throw new Error("Manifest missing required fields: " + missing.join(", "));
  }
}

export async function ingestConversationIntoSandbox(brainServerModule, conv, dbPath) {
  const sessions = getSessions(conv);

  const result = { total_sessions: sessions.length, ingested: 0, failed: 0, errors: [] };

  for (const session of sessions) {
    try {
      const text = session.text || session.content || session.message || "";
      if (!text) continue;

      const entity = await brainServerModule.db.addEntity({
        name: "Session_" + (session.id || session.session_id || ""),
        type: "capture_snapshot",
        description: text.substring(0, 500),
        tags: ["benchmark_ingest", "session"],
        metadata: {
          source: "locomo",
          platform: "benchmark",
          conversation_id: conv.id || conv.conversation_id,
          session_id: session.id || session.session_id,
          original_timestamp: session.timestamp || session.created_at,
          import_batch_id: conv.id || conv.conversation_id,
        },
      });
      result.ingested++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        session_id: session.id || session.session_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

export async function runBenchmark({
  datasetPath,
  config,
  answerPrompt,
  judgePrompt,
  datasetManifest,
  split,
  conversationIds,
  runsRoot,
  llmClient,
  embeddingStatus,
  brainServerFactory,
}) {
  const dataset = await loadLoCoMo(datasetPath);
  const runId = randomUUID();
  const runDir = path.join(runsRoot, runId);
  await mkdir(runDir, { recursive: true });

  const manifest = await buildManifest({
    datasetPath, config, answerPrompt, judgePrompt,
    datasetManifest, split, conversationIds, runId, embeddingStatus,
  });
  validateManifest(manifest);

  await writeFile(
    path.join(runDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" }
  );
  await writeFile(path.join(runDir, "results.jsonl"), "", { flag: "wx" });

  const completed = new Set();
  let total = 0;
  let done = 0;
  let errors = 0;
  let retries = 0;
  let skipped = 0;

  for (const convId of conversationIds) {
    assertConversationAllowed({ split, conversationId: convId });

    const brainServer = await brainServerFactory(convId);
    const conv = getConversation(dataset, convId);
    const ingestResult = await ingestConversationIntoSandbox(brainServer, conv, brainServer.dbPath);
    const qas = getConversationQAs(dataset, convId);

    total += qas.length;

    for (const qa of qas) {
      const qid = String(qa.id || qa.question_id || (convId + "_" + conv.session_id));

      if (completed.has(qid)) {
        skipped++;
        continue;
      }

      try {
        const retrieval = await brainServer.retrieve(qa.question);
        const answer = llmClient
          ? await llmClient.answer(qa.question, retrieval, answerPrompt)
          : "unknown";

        const judgeInput = {
          question: qa.question,
          reference_answer: qa.answer || qa.reference_answer || "",
          candidate_answer: answer,
          evidence: retrieval.ranked,
          subset: qa.answer === "unknown" || qa.unanswerable ? "adversarial" : "answerable",
        };

        let judgeResult;
        try {
          const rawJudge = llmClient
            ? await llmClient.judge(judgeInput, judgePrompt)
            : null;
          judgeResult = rawJudge ? validateJudgeOutput(rawJudge) : null;
        } catch (judgeErr) {
          console.error("Judge failed for question " + qid + ":", judgeErr.message);
          judgeResult = null;
        }

        const record = {
          question_id: qid,
          conversation_id: convId,
          status: "completed",
          subset: qa.answer === "unknown" || qa.unanswerable ? "adversarial" : "answerable",
          question: qa.question,
          reference_answer: qa.answer || qa.reference_answer,
          candidate_answer: answer,
          retrieval_count: retrieval.ranked?.length || 0,
          evidence_ids: retrieval.ranked?.map((e) => e.id) || [],
          judge_raw: judgeResult,
          metrics: judgeResult || {},
          latency_ms: 0,
          retry_count: 0,
        };

        await appendQuestionRecord(runDir, record);
        completed.add(qid);
        done++;
      } catch (err) {
        errors++;
        const record = {
          question_id: qid,
          conversation_id: convId,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          retry_count: 0,
          recorded_at: new Date().toISOString(),
        };
        const line = JSON.stringify(record) + "\n";
        const handle = await (await import("node:fs/promises")).open(
          path.join(runDir, "results.jsonl"), "a"
        );
        await handle.write(line);
        await handle.sync();
        await handle.close();
      }
    }
  }

  manifest.completed_at = new Date().toISOString();
  await writeFile(
    path.join(runDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );

  return { runDir, manifest, stats: { total, done, errors, retries, skipped } };
}
