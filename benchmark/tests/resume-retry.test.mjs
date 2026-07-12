import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRun,
  appendQuestionRecord,
  completedQuestionIds,
  errorQuestionIds,
  allRecordedQuestionIds,
  verifyResumeConfig,
  findRunDir,
  updateManifest,
  readRun,
} from "../src/run-store.mjs";
import { sha256, configHash } from "../src/integrity.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

describe("resume and retry - run-store functions", () => {
  let tmpDir;

  before(async () => {
    tmpDir = path.join(ROOT, "..", "runs", "resume-test-" + randomUUID());
    await mkdir(tmpDir, { recursive: true });
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  async function makeRun(config = {}, prompt = "test prompt") {
    return createRun({
      runsRoot: tmpDir,
      split: "development",
      dataset: { name: "LoCoMo", sha256: "test" },
      benchmarkCommit: "test-commit",
      brainServerCommit: "test-commit",
      config,
      prompt,
      embeddingStatus: { mode: "local", model: "test", available: true },
    });
  }

  it("errorQuestionIds returns only questions whose latest record is error", async () => {
    const { runDir } = await makeRun();

    // q1: completed
    await appendQuestionRecord(runDir, {
      question_id: "q1",
      status: "completed",
      recorded_at: new Date().toISOString(),
    });

    // q2: error
    await appendQuestionRecord(runDir, {
      question_id: "q2",
      status: "error",
      error: "test error",
      recorded_at: new Date().toISOString(),
    });

    // q3: retry then error (latest is error)
    await appendQuestionRecord(runDir, {
      question_id: "q3",
      status: "retry",
      retry_count: 1,
      error: "timeout",
      recorded_at: new Date().toISOString(),
    });
    await appendQuestionRecord(runDir, {
      question_id: "q3",
      status: "error",
      error: "timeout exhausted",
      recorded_at: new Date().toISOString(),
    });

    // q4: retry then completed (latest is completed — NOT an error)
    await appendQuestionRecord(runDir, {
      question_id: "q4",
      status: "retry",
      retry_count: 1,
      error: "timeout",
      recorded_at: new Date().toISOString(),
    });
    await appendQuestionRecord(runDir, {
      question_id: "q4",
      status: "completed",
      recorded_at: new Date().toISOString(),
    });

    const errors = await errorQuestionIds(runDir);
    assert.ok(errors.has("q2"), "q2 should be in error set");
    assert.ok(errors.has("q3"), "q3 should be in error set (latest is error)");
    assert.ok(!errors.has("q4"), "q4 should NOT be in error set (latest is completed)");
    assert.ok(!errors.has("q1"), "q1 should NOT be in error set");
  });

  it("allRecordedQuestionIds returns every question ID ever recorded", async () => {
    const { runDir } = await makeRun();

    await appendQuestionRecord(runDir, {
      question_id: "q1",
      status: "completed",
      recorded_at: new Date().toISOString(),
    });
    await appendQuestionRecord(runDir, {
      question_id: "q2",
      status: "error",
      error: "test",
      recorded_at: new Date().toISOString(),
    });

    const all = await allRecordedQuestionIds(runDir);
    assert.ok(all.has("q1"));
    assert.ok(all.has("q2"));
    assert.strictEqual(all.size, 2);
  });

  it("verifyResumeConfig accepts matching config and prompt", async () => {
    const config = { retrieval: { top_k: 10 } };
    const prompt = "answer the question";
    const { runDir, manifest } = await makeRun(config, prompt);

    // Should not throw
    verifyResumeConfig(manifest, config, prompt);
  });

  it("verifyResumeConfig rejects mismatched config", async () => {
    const originalConfig = { retrieval: { top_k: 10 } };
    const prompt = "answer the question";
    const { manifest } = await makeRun(originalConfig, prompt);

    const changedConfig = { retrieval: { top_k: 20 } };
    assert.throws(
      () => verifyResumeConfig(manifest, changedConfig, prompt),
      /Config mismatch/
    );
  });

  it("verifyResumeConfig rejects mismatched prompt", async () => {
    const config = { retrieval: { top_k: 10 } };
    const originalPrompt = "answer the question";
    const { manifest } = await makeRun(config, originalPrompt);

    const changedPrompt = "answer differently";
    assert.throws(
      () => verifyResumeConfig(manifest, config, changedPrompt),
      /Prompt mismatch/
    );
  });

  it("findRunDir finds existing run by run-id", async () => {
    const { runDir, manifest } = await makeRun();
    const found = await findRunDir(tmpDir, manifest.run_id);
    assert.strictEqual(found, runDir);
  });

  it("findRunDir throws for non-existent run-id", async () => {
    await assert.rejects(
      () => findRunDir(tmpDir, "nonexistent-run-id"),
      /Run directory not found/
    );
  });

  it("updateManifest updates status and completed_at", async () => {
    const { runDir } = await makeRun();
    const updated = await updateManifest(runDir, {
      status: "completed",
      completed_at: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(updated.status, "completed");
    assert.strictEqual(updated.completed_at, "2026-01-01T00:00:00.000Z");

    // Verify it persisted
    const { manifest } = await readRun(runDir);
    assert.strictEqual(manifest.status, "completed");
  });

  it("resume does not re-run completed questions", async () => {
    const { runDir } = await makeRun();

    // Mark q1 and q2 as completed
    await appendQuestionRecord(runDir, {
      question_id: "q1",
      status: "completed",
      recorded_at: new Date().toISOString(),
    });
    await appendQuestionRecord(runDir, {
      question_id: "q2",
      status: "completed",
      recorded_at: new Date().toISOString(),
    });

    const completed = await completedQuestionIds(runDir);
    assert.strictEqual(completed.size, 2);
    assert.ok(completed.has("q1"));
    assert.ok(completed.has("q2"));
  });

  it("retry records are persisted and don't count as completed", async () => {
    const { runDir } = await makeRun();

    await appendQuestionRecord(runDir, {
      question_id: "q1",
      status: "retry",
      retry_count: 1,
      error: "timeout",
      recorded_at: new Date().toISOString(),
    });
    await appendQuestionRecord(runDir, {
      question_id: "q1",
      status: "retry",
      retry_count: 2,
      error: "timeout",
      recorded_at: new Date().toISOString(),
    });

    const completed = await completedQuestionIds(runDir);
    assert.strictEqual(completed.size, 0, "retry records should not count as completed");

    const { records } = await readRun(runDir);
    assert.strictEqual(records.length, 2, "both retry records should be persisted");
    assert.strictEqual(records[0].retry_count, 1);
    assert.strictEqual(records[1].retry_count, 2);
  });

  it("manifest status can be set to partial", async () => {
    const { runDir } = await makeRun();
    const updated = await updateManifest(runDir, { status: "partial" });
    assert.strictEqual(updated.status, "partial");
  });

  it("manifest status can be set to interrupted", async () => {
    const { runDir } = await makeRun();
    const updated = await updateManifest(runDir, { status: "interrupted" });
    assert.strictEqual(updated.status, "interrupted");
  });
});

describe("resume and retry - config hash stability", () => {
  it("same config produces same hash across runs", () => {
    const config = { retrieval: { top_k: 10 }, model: "test" };
    const h1 = configHash(config);
    const h2 = configHash(config);
    assert.strictEqual(h1, h2);
  });

  it("different key order produces same hash (stable stringify)", () => {
    const h1 = configHash({ a: 1, b: 2 });
    const h2 = configHash({ b: 2, a: 1 });
    assert.strictEqual(h1, h2);
  });
});
