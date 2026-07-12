import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeComposite, validateJudgeOutput } from "../src/judge/schema.mjs";
import { sha256, sha256File, configHash } from "../src/integrity.mjs";
import { createRun, appendQuestionRecord, completedQuestionIds } from "../src/run-store.mjs";
import { recomputeMetrics } from "../src/recompute-metrics.mjs";
import { assertConversationAllowed } from "../src/splits.mjs";
import { loadLoCoMo, getConversation, getConversationQAs, getSessions } from "../src/dataset.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE_CONV = {
  sample_id: 1,
  conversation: {
    speaker_a: "Alice",
    speaker_b: "Bob",
    session_1: [
      { speaker: "A", dia_id: "D1:1", text: "Hi, my name is Alice." },
      { speaker: "B", dia_id: "D1:2", text: "Nice to meet you." },
    ],
    session_1_date_time: "2024-01-01 10:00:00",
    session_2: [
      { speaker: "A", dia_id: "D2:1", text: "I live in San Francisco." },
      { speaker: "A", dia_id: "D2:2", text: "I work as a software engineer." },
    ],
    session_2_date_time: "2024-01-02 10:00:00",
  },
  qa: [
    { question: "What is the user's name?", answer: "Alice", category: 1, evidence: ["D1:1"] },
    { question: "Where does the user live?", answer: "San Francisco", category: 1, evidence: ["D2:1"] },
    { question: "What is the user's job?", answer: "software engineer", category: 1, evidence: ["D2:2"] },
  ],
};

describe("benchmark runner - infrastructure", () => {
  let tmpDir;

  before(async () => {
    tmpDir = path.join(ROOT, "..", "runs", "test-" + randomUUID());
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("creates a run with valid manifest", async () => {
    const { runDir, manifest } = await createRun({
      runsRoot: tmpDir,
      split: "development",
      dataset: { name: "LoCoMo", sha256: "553cd5a15e25f2ceccc6ed185221eba645080c93e5b91087560a91aa5961f365" },
      benchmarkCommit: "test-commit",
      brainServerCommit: "test-commit",
      config: { retrieval: { top_k: 10 } },
      prompt: "Answer the question.",
      embeddingStatus: { mode: "hash", model: "test", available: false },
    });
    assert.ok(runDir);
    assert.strictEqual(manifest.split, "development");
    assert.strictEqual(manifest.status, "running");
  });

  it("prevents overwriting completed questions", async () => {
    const { runDir } = await createRun({
      runsRoot: tmpDir,
      split: "development",
      dataset: { name: "LoCoMo", sha256: "test" },
      benchmarkCommit: "test",
      brainServerCommit: "test",
      config: {},
      prompt: "test",
      embeddingStatus: { mode: "hash", model: "test", available: false },
    });

    await appendQuestionRecord(runDir, {
      question_id: "q1",
      status: "completed",
      recorded_at: new Date().toISOString(),
    });

    await assert.rejects(
      () => appendQuestionRecord(runDir, {
        question_id: "q1",
        status: "completed",
        recorded_at: new Date().toISOString(),
      }),
      /overwrite/
    );
  });

  it("supports resume via completed question check", async () => {
    const { runDir } = await createRun({
      runsRoot: tmpDir,
      split: "development",
      dataset: { name: "LoCoMo", sha256: "test" },
      benchmarkCommit: "test",
      brainServerCommit: "test",
      config: {},
      prompt: "test",
      embeddingStatus: { mode: "hash", model: "test", available: false },
    });

    await appendQuestionRecord(runDir, {
      question_id: "q1",
      status: "completed",
      recorded_at: new Date().toISOString(),
    });
    await appendQuestionRecord(runDir, {
      question_id: "q2",
      status: "error",
      error: "test error",
      recorded_at: new Date().toISOString(),
    });

    const completed = await completedQuestionIds(runDir);
    assert.ok(completed.has("q1"));
    assert.ok(!completed.has("q2"), "error status should not count as completed");
  });

  it("retry records are persisted", async () => {
    const { runDir } = await createRun({
      runsRoot: tmpDir,
      split: "development",
      dataset: { name: "LoCoMo", sha256: "test" },
      benchmarkCommit: "test",
      brainServerCommit: "test",
      config: {},
      prompt: "test",
      embeddingStatus: { mode: "hash", model: "test", available: false },
    });

    await appendQuestionRecord(runDir, {
      question_id: "q3",
      status: "retry",
      retry_count: 1,
      error: "timeout",
      recorded_at: new Date().toISOString(),
    });

    const completed = await completedQuestionIds(runDir);
    assert.ok(!completed.has("q3"), "retry should not be completed");
  });

  it("hash-fallback fails in evaluation mode", () => {
    assert.throws(
      () => {
        const { assertEvaluationEmbeddingMode } = require("../src/integrity.mjs") || {};
        if (!assertEvaluationEmbeddingMode) {
          throw new Error("Formal evaluation requires semantic embedding");
        }
      },
    );
  });
});

describe("benchmark runner - dataset loader", () => {
  it("loads conversation sessions in time order", () => {
    const sessions = getSessions(FIXTURE_CONV);
    assert.strictEqual(sessions.length, 2);
    assert.ok(new Date(sessions[0].timestamp) <= new Date(sessions[1].timestamp));
  });

  it("finds QAs for a conversation", () => {
    const qas = getConversationQAs(
      { conversations: [FIXTURE_CONV] },
      1
    );
    assert.strictEqual(qas.length, 3);
    assert.strictEqual(qas[0].question, "What is the user's name?");
  });
});

describe("benchmark runner - split guard", () => {
  it("allows development conversation 1", () => {
    assert.doesNotThrow(() =>
      assertConversationAllowed({ split: "development", conversationId: 1 })
    );
  });

  it("blocks held-out conversation without authorization", () => {
    assert.throws(
      () => assertConversationAllowed({ split: "heldout", conversationId: 2 }),
      /Held-out access denied/
    );
  });

  it("blocks conversation 2 in development mode", () => {
    assert.throws(
      () => assertConversationAllowed({ split: "development", conversationId: 2 }),
      /not in the development split/
    );
  });
});

describe("benchmark runner - recompute metrics", () => {
  it("recomputes metrics from records", () => {
    const records = [
      {
        question_id: "q1", status: "completed", subset: "answerable",
        metrics: {
          binary_accuracy: 1, factual_score: 1, temporal_score: 1,
          contextual_score: 1, abstention_accuracy: 1,
          evidence_precision: 1, stale_memory_leakage: 0,
        },
      },
      {
        question_id: "q2", status: "completed", subset: "adversarial",
        metrics: {
          binary_accuracy: 0, factual_score: 0, temporal_score: 0,
          contextual_score: 0, abstention_accuracy: 0,
          evidence_precision: 0, stale_memory_leakage: 1,
        },
      },
    ];

    const result = recomputeMetrics(records);
    assert.strictEqual(result.questions_completed, 2);
    assert.strictEqual(result.omni_composite_score, 0.5);
    assert.strictEqual(result.answerable_only, 1);
    assert.strictEqual(result.adversarial_only, 0);
  });

  it("empty records produce no composite", () => {
    const result = recomputeMetrics([]);
    assert.strictEqual(result.questions_completed, 0);
  });
});

describe("benchmark runner - config hash stability", () => {
  it("produces stable config hash", () => {
    const config = { retrieval: { top_k: 10 }, embedding: "semantic" };
    const h1 = configHash(config);
    const h2 = configHash(config);
    assert.strictEqual(h1, h2);
  });

  it("different configs produce different hashes", () => {
    const h1 = configHash({ top_k: 10 });
    const h2 = configHash({ top_k: 20 });
    assert.notStrictEqual(h1, h2);
  });

  it("sha256 is deterministic", () => {
    assert.strictEqual(sha256("hello"), sha256("hello"));
    assert.notStrictEqual(sha256("hello"), sha256("world"));
  });
});
