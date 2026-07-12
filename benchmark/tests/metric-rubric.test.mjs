import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeComposite, validateJudgeOutput, validateAllMetricsPresent } from "../src/judge/schema.mjs";

describe("metric rubric - composite score", () => {
  it("all 1 -> composite 1", () => {
    const result = computeComposite({
      factual_score: 1, temporal_score: 1, contextual_score: 1,
      abstention_accuracy: 1, evidence_precision: 1, stale_memory_leakage: 0,
    });
    assert.strictEqual(result, 1);
  });

  it("all 0 and stale=1 -> composite 0", () => {
    const result = computeComposite({
      factual_score: 0, temporal_score: 0, contextual_score: 0,
      abstention_accuracy: 0, evidence_precision: 0, stale_memory_leakage: 1,
    });
    assert.strictEqual(result, 0);
  });

  it("mixed values produce correct composite", () => {
    const result = computeComposite({
      factual_score: 0.5, temporal_score: 0.5, contextual_score: 0.5,
      abstention_accuracy: 0.5, evidence_precision: 0.5, stale_memory_leakage: 0.5,
    });
    assert.strictEqual(result, 0.5);
  });

  it("stale leakage reduces composite correctly", () => {
    const clean = computeComposite({
      factual_score: 1, temporal_score: 1, contextual_score: 1,
      abstention_accuracy: 1, evidence_precision: 1, stale_memory_leakage: 0,
    });
    const leaky = computeComposite({
      factual_score: 1, temporal_score: 1, contextual_score: 1,
      abstention_accuracy: 1, evidence_precision: 1, stale_memory_leakage: 1,
    });
    assert.ok(leaky < clean, "stale leakage should reduce composite");
  });
});

describe("metric rubric - validation", () => {
  it("rejects metrics out of [0,1] range", () => {
    assert.throws(() => computeComposite({
      factual_score: 1.5, temporal_score: 0.5, contextual_score: 0.5,
      abstention_accuracy: 0.5, evidence_precision: 0.5, stale_memory_leakage: 0.1,
    }), /out of/);
  });

  it("rejects missing metrics", () => {
    assert.throws(() => computeComposite({
      factual_score: 0.5, temporal_score: 0.5, contextual_score: 0.5,
      abstention_accuracy: 0.5, evidence_precision: 0.5,
    }), /stale_memory_leakage is required/);
  });

  it("rejects negative metrics", () => {
    assert.throws(() => computeComposite({
      factual_score: -0.1, temporal_score: 0.5, contextual_score: 0.5,
      abstention_accuracy: 0.5, evidence_precision: 0.5, stale_memory_leakage: 0.1,
    }), /out of/);
  });

  it("rejects stale_leakage > 1", () => {
    assert.throws(() => computeComposite({
      factual_score: 0.5, temporal_score: 0.5, contextual_score: 0.5,
      abstention_accuracy: 0.5, evidence_precision: 0.5, stale_memory_leakage: 1.5,
    }), /out of/);
  });
});

describe("metric rubric - judge output validation", () => {
  const valid = {
    binary_accuracy: 1, factual_score: 0.7, temporal_score: 0.9,
    contextual_score: 0.6, abstention_accuracy: 1.0,
    evidence_precision: 0.5, stale_memory_leakage: 0.1,
    rationale: "Correct answer",
  };

  it("accepts valid judge output", () => {
    const result = validateJudgeOutput(valid);
    assert.strictEqual(result.binary_accuracy, 1);
  });

  it("rejects judge output with missing fields", () => {
    const missing = { ...valid };
    delete missing.rationale;
    assert.throws(() => validateJudgeOutput(missing), /schema validation/);
  });

  it("rejects judge output with extra fields", () => {
    const extra = { ...valid, bogus_field: 999 };
    assert.throws(() => validateJudgeOutput(extra), /schema validation/);
  });

  it("rejects non-numeric metric", () => {
    assert.throws(() => validateJudgeOutput({
      ...valid, factual_score: "high",
    }), /schema validation/);
  });

  it("validateAllMetricsPresent catches all issues", () => {
    assert.doesNotThrow(() => validateAllMetricsPresent(valid));
    assert.throws(() => validateAllMetricsPresent({}), /Missing/);
    assert.throws(() => validateAllMetricsPresent({
      binary_accuracy: 2, factual_score: 0, temporal_score: 0,
      contextual_score: 0, abstention_accuracy: 0,
      evidence_precision: 0, stale_memory_leakage: 0,
    }), /must be exactly 0 or 1/);
  });
});

describe("metric rubric - subset independence", () => {
  it("answerable and adversarial can be independently computed", () => {
    const records = [
      { metrics: { binary_accuracy: 1, factual_score: 1, temporal_score: 1, contextual_score: 1, abstention_accuracy: 1, evidence_precision: 1, stale_memory_leakage: 0 }, subset: "answerable" },
      { metrics: { binary_accuracy: 0, factual_score: 0, temporal_score: 0, contextual_score: 0, abstention_accuracy: 0, evidence_precision: 0, stale_memory_leakage: 1 }, subset: "adversarial" },
    ];

    const answerable = records.filter((r) => r.subset === "answerable");
    const adversarial = records.filter((r) => r.subset === "adversarial");

    const answerableComp = computeComposite(answerable[0].metrics);
    const adversarialComp = computeComposite(adversarial[0].metrics);

    assert.strictEqual(answerableComp, 1);
    assert.strictEqual(adversarialComp, 0);
  });
});
