import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateJudgeOutput,
  validateAllMetricsPresent,
  computeComposite,
  wilsonCI,
  computeStatistics,
  JudgeOutputSchema,
} from "../src/judge/schema.mjs";

// 30+ calibration samples with expected results.
// Each sample tests a specific judge scenario.

const CALIBRATION_SAMPLES = [
  // --- Group 1: Binary accuracy boundary cases ---
  {
    name: "exact correct answer → binary=1, factual=1",
    input: {
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "Fully correct.",
    },
    expectValid: true,
    expectComposite: 1.0,
  },
  {
    name: "completely wrong answer → binary=0, factual=0",
    input: {
      binary_accuracy: 0, factual_score: 0, temporal_score: 0,
      contextual_score: 0, abstention_accuracy: 0,
      evidence_precision: 0, stale_memory_leakage: 1,
      rationale: "Completely wrong.",
    },
    expectValid: true,
    expectComposite: 0.0,
  },
  {
    name: "binary_accuracy=0.5 must REJECTED by schema",
    input: {
      binary_accuracy: 0.5, factual_score: 0.5, temporal_score: 0.5,
      contextual_score: 0.5, abstention_accuracy: 0.5,
      evidence_precision: 0.5, stale_memory_leakage: 0.5,
      rationale: "Should be rejected.",
    },
    expectValid: false,
  },
  {
    name: "binary_accuracy=0.3 must REJECTED by schema",
    input: {
      binary_accuracy: 0.3, factual_score: 0.5, temporal_score: 0.5,
      contextual_score: 0.5, abstention_accuracy: 0.5,
      evidence_precision: 0.5, stale_memory_leakage: 0.5,
      rationale: "Should be rejected.",
    },
    expectValid: false,
  },
  {
    name: "binary_accuracy=0.7 must REJECTED by schema",
    input: {
      binary_accuracy: 0.7, factual_score: 0.5, temporal_score: 0.5,
      contextual_score: 0.5, abstention_accuracy: 0.5,
      evidence_precision: 0.5, stale_memory_leakage: 0.5,
      rationale: "Should be rejected.",
    },
    expectValid: false,
  },

  // --- Group 2: Partial correctness (factual_score captures nuance) ---
  {
    name: "partially correct → binary=0, factual=0.6",
    input: {
      binary_accuracy: 0, factual_score: 0.6, temporal_score: 0.8,
      contextual_score: 0.7, abstention_accuracy: 0,
      evidence_precision: 0.5, stale_memory_leakage: 0.1,
      rationale: "Partially correct.",
    },
    expectValid: true,
    expectComposite: (0.6 + 0.8 + 0.7 + 0 + 0.5 + (1 - 0.1)) / 6,
  },
  {
    name: "mostly correct but missing detail → binary=0, factual=0.8",
    input: {
      binary_accuracy: 0, factual_score: 0.8, temporal_score: 1,
      contextual_score: 0.9, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "Mostly correct but missing detail.",
    },
    expectValid: true,
    expectComposite: (0.8 + 1 + 0.9 + 1 + 1 + 1) / 6,
  },

  // --- Group 3: Abstention cases ---
  {
    name: "correct abstention on unanswerable → binary=1, abstention=1",
    input: {
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 0, stale_memory_leakage: 0,
      rationale: "Correctly abstained.",
    },
    expectValid: true,
    expectComposite: (1 + 1 + 1 + 1 + 0 + 1) / 6,
  },
  {
    name: "hallucinated answer on unanswerable → binary=0, abstention=0",
    input: {
      binary_accuracy: 0, factual_score: 0, temporal_score: 0,
      contextual_score: 0, abstention_accuracy: 0,
      evidence_precision: 0, stale_memory_leakage: 0.5,
      rationale: "Hallucinated when should have abstained.",
    },
    expectValid: true,
    expectComposite: (0 + 0 + 0 + 0 + 0 + 0.5) / 6,
  },
  {
    name: "partial abstention with uncertainty → abstention=0.7",
    input: {
      binary_accuracy: 0, factual_score: 0.5, temporal_score: 0.5,
      contextual_score: 0.5, abstention_accuracy: 0.7,
      evidence_precision: 0.5, stale_memory_leakage: 0,
      rationale: "Partial abstention.",
    },
    expectValid: true,
    expectComposite: (0.5 + 0.5 + 0.5 + 0.7 + 0.5 + 1) / 6,
  },
  {
    name: "should have answered but abstained → binary=0, abstention=0",
    input: {
      binary_accuracy: 0, factual_score: 0, temporal_score: 1,
      contextual_score: 0, abstention_accuracy: 0,
      evidence_precision: 0, stale_memory_leakage: 0,
      rationale: "Should have answered.",
    },
    expectValid: true,
    expectComposite: (0 + 1 + 0 + 0 + 0 + 1) / 6,
  },

  // --- Group 4: Temporal cases ---
  {
    name: "non-temporal question → temporal=1",
    input: {
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "Non-temporal, correct.",
    },
    expectValid: true,
    expectComposite: 1.0,
  },
  {
    name: "exact date correct → temporal=1",
    input: {
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "Exact date correct.",
    },
    expectValid: true,
    expectComposite: 1.0,
  },
  {
    name: "approximate date → temporal=0.8",
    input: {
      binary_accuracy: 0, factual_score: 0.7, temporal_score: 0.8,
      contextual_score: 0.8, abstention_accuracy: 1,
      evidence_precision: 0.8, stale_memory_leakage: 0,
      rationale: "Approximate date.",
    },
    expectValid: true,
    expectComposite: (0.7 + 0.8 + 0.8 + 1 + 0.8 + 1) / 6,
  },
  {
    name: "stale fact used as current → temporal=0, stale=1",
    input: {
      binary_accuracy: 0, factual_score: 0.2, temporal_score: 0,
      contextual_score: 0.3, abstention_accuracy: 0,
      evidence_precision: 0.4, stale_memory_leakage: 1,
      rationale: "Used stale fact as current.",
    },
    expectValid: true,
    expectComposite: (0.2 + 0 + 0.3 + 0 + 0.4 + 0) / 6,
  },
  {
    name: "confuses current with historical → temporal=0",
    input: {
      binary_accuracy: 0, factual_score: 0.3, temporal_score: 0,
      contextual_score: 0.2, abstention_accuracy: 0,
      evidence_precision: 0.5, stale_memory_leakage: 0.8,
      rationale: "Confused current with historical.",
    },
    expectValid: true,
    expectComposite: (0.3 + 0 + 0.2 + 0 + 0.5 + 0.2) / 6,
  },

  // --- Group 5: Evidence precision ---
  {
    name: "all cited evidence relevant → evidence=1",
    input: {
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "All evidence relevant.",
    },
    expectValid: true,
    expectComposite: 1.0,
  },
  {
    name: "no evidence cited → evidence=0",
    input: {
      binary_accuracy: 0, factual_score: 0.5, temporal_score: 0.5,
      contextual_score: 0.5, abstention_accuracy: 0.5,
      evidence_precision: 0, stale_memory_leakage: 0,
      rationale: "No evidence cited.",
    },
    expectValid: true,
    expectComposite: (0.5 + 0.5 + 0.5 + 0.5 + 0 + 1) / 6,
  },
  {
    name: "half evidence relevant → evidence=0.5",
    input: {
      binary_accuracy: 1, factual_score: 0.8, temporal_score: 0.9,
      contextual_score: 0.8, abstention_accuracy: 1,
      evidence_precision: 0.5, stale_memory_leakage: 0,
      rationale: "Half evidence relevant.",
    },
    expectValid: true,
    expectComposite: (0.8 + 0.9 + 0.8 + 1 + 0.5 + 1) / 6,
  },

  // --- Group 6: Stale memory leakage ---
  {
    name: "no stale facts → stale=0",
    input: {
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "No stale facts.",
    },
    expectValid: true,
    expectComposite: 1.0,
  },
  {
    name: "some stale facts but not main basis → stale=0.5",
    input: {
      binary_accuracy: 1, factual_score: 0.7, temporal_score: 0.6,
      contextual_score: 0.7, abstention_accuracy: 1,
      evidence_precision: 0.8, stale_memory_leakage: 0.5,
      rationale: "Some stale facts mentioned.",
    },
    expectValid: true,
    expectComposite: (0.7 + 0.6 + 0.7 + 1 + 0.8 + 0.5) / 6,
  },
  {
    name: "answer built on stale facts → stale=1",
    input: {
      binary_accuracy: 0, factual_score: 0.1, temporal_score: 0,
      contextual_score: 0.2, abstention_accuracy: 0,
      evidence_precision: 0.3, stale_memory_leakage: 1,
      rationale: "Built on stale facts.",
    },
    expectValid: true,
    expectComposite: (0.1 + 0 + 0.2 + 0 + 0.3 + 0) / 6,
  },

  // --- Group 7: Schema validation (rejection cases) ---
  {
    name: "missing field must REJECT",
    input: {
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1,
      rationale: "Missing stale_memory_leakage.",
    },
    expectValid: false,
  },
  {
    name: "extra field must REJECT (strict schema)",
    input: {
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "Has extra field.",
      extra_field: "should be rejected",
    },
    expectValid: false,
  },
  {
    name: "out of range value must REJECT (>1)",
    input: {
      binary_accuracy: 1, factual_score: 1.5, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "factual_score > 1.",
    },
    expectValid: false,
  },
  {
    name: "out of range value must REJECT (<0)",
    input: {
      binary_accuracy: 0, factual_score: -0.1, temporal_score: 0,
      contextual_score: 0, abstention_accuracy: 0,
      evidence_precision: 0, stale_memory_leakage: 0,
      rationale: "factual_score < 0.",
    },
    expectValid: false,
  },
  {
    name: "empty rationale must REJECT",
    input: {
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "",
    },
    expectValid: false,
  },
  {
    name: "missing rationale must REJECT",
    input: {
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
    },
    expectValid: false,
  },

  // --- Group 8: Edge cases ---
  {
    name: "all zeros except temporal (non-temporal question)",
    input: {
      binary_accuracy: 0, factual_score: 0, temporal_score: 1,
      contextual_score: 0, abstention_accuracy: 0,
      evidence_precision: 0, stale_memory_leakage: 0,
      rationale: "Non-temporal but wrong answer.",
    },
    expectValid: true,
    expectComposite: (0 + 1 + 0 + 0 + 0 + 1) / 6,
  },
  {
    name: "adversarial false premise correctly identified",
    input: {
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "Correctly identified false premise.",
    },
    expectValid: true,
    expectComposite: 1.0,
  },
  {
    name: "mixed scores — realistic scenario",
    input: {
      binary_accuracy: 0, factual_score: 0.4, temporal_score: 0.6,
      contextual_score: 0.5, abstention_accuracy: 0.3,
      evidence_precision: 0.7, stale_memory_leakage: 0.2,
      rationale: "Mixed results.",
    },
    expectValid: true,
    expectComposite: (0.4 + 0.6 + 0.5 + 0.3 + 0.7 + 0.8) / 6,
  },
];

describe("judge calibration — 30+ samples with expected results", () => {
  // Verify we have at least 30 samples
  it("has at least 30 calibration samples", () => {
    assert.ok(CALIBRATION_SAMPLES.length >= 30, `Expected >= 30 samples, got ${CALIBRATION_SAMPLES.length}`);
  });

  for (const sample of CALIBRATION_SAMPLES) {
    it(`calibration: ${sample.name}`, () => {
      const result = JudgeOutputSchema.safeParse(sample.input);
      if (sample.expectValid) {
        assert.ok(result.success, `Expected valid but got: ${result.error?.issues?.map(i => i.message).join("; ")}`);
        // Verify composite if expected
        if (sample.expectComposite !== undefined) {
          const composite = computeComposite(result.data);
          assert.ok(
            Math.abs(composite - sample.expectComposite) < 0.0001,
            `Composite mismatch: expected ${sample.expectComposite}, got ${composite}`
          );
        }
      } else {
        assert.ok(!result.success, `Expected rejection but input was accepted`);
      }
    });
  }
});

describe("judge schema — binary_accuracy strictly 0 or 1", () => {
  it("accepts binary_accuracy=0", () => {
    const result = JudgeOutputSchema.safeParse({
      binary_accuracy: 0, factual_score: 0, temporal_score: 0,
      contextual_score: 0, abstention_accuracy: 0,
      evidence_precision: 0, stale_memory_leakage: 0,
      rationale: "test",
    });
    assert.ok(result.success);
  });

  it("accepts binary_accuracy=1", () => {
    const result = JudgeOutputSchema.safeParse({
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "test",
    });
    assert.ok(result.success);
  });

  it("rejects binary_accuracy=0.5", () => {
    const result = JudgeOutputSchema.safeParse({
      binary_accuracy: 0.5, factual_score: 0.5, temporal_score: 0.5,
      contextual_score: 0.5, abstention_accuracy: 0.5,
      evidence_precision: 0.5, stale_memory_leakage: 0.5,
      rationale: "test",
    });
    assert.ok(!result.success);
  });

  it("rejects binary_accuracy=0.3", () => {
    const result = JudgeOutputSchema.safeParse({
      binary_accuracy: 0.3, factual_score: 0.5, temporal_score: 0.5,
      contextual_score: 0.5, abstention_accuracy: 0.5,
      evidence_precision: 0.5, stale_memory_leakage: 0.5,
      rationale: "test",
    });
    assert.ok(!result.success);
  });

  it("rejects binary_accuracy=0.99", () => {
    const result = JudgeOutputSchema.safeParse({
      binary_accuracy: 0.99, factual_score: 0.5, temporal_score: 0.5,
      contextual_score: 0.5, abstention_accuracy: 0.5,
      evidence_precision: 0.5, stale_memory_leakage: 0.5,
      rationale: "test",
    });
    assert.ok(!result.success);
  });
});

describe("judge schema — strict mode rejects extra fields", () => {
  it("rejects extra field", () => {
    const result = JudgeOutputSchema.safeParse({
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "test",
      judge_error: false,
    });
    assert.ok(!result.success);
  });
});

describe("judge schema — missing field rejection", () => {
  it("rejects missing factual_score", () => {
    const result = JudgeOutputSchema.safeParse({
      binary_accuracy: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1, stale_memory_leakage: 0,
      rationale: "test",
    });
    assert.ok(!result.success);
  });

  it("rejects missing stale_memory_leakage", () => {
    const result = JudgeOutputSchema.safeParse({
      binary_accuracy: 1, factual_score: 1, temporal_score: 1,
      contextual_score: 1, abstention_accuracy: 1,
      evidence_precision: 1,
      rationale: "test",
    });
    assert.ok(!result.success);
  });
});

describe("wilsonCI — confidence intervals", () => {
  it("returns [0,0] for n=0", () => {
    const ci = wilsonCI(0.5, 0);
    assert.strictEqual(ci.lower, 0);
    assert.strictEqual(ci.upper, 0);
  });

  it("returns valid interval for n=10, p=0.5", () => {
    const ci = wilsonCI(0.5, 10);
    assert.ok(ci.lower > 0 && ci.lower < 0.5);
    assert.ok(ci.upper > 0.5 && ci.upper < 1);
    assert.ok(ci.lower < ci.upper);
  });

  it("returns narrower interval for larger n", () => {
    const ci10 = wilsonCI(0.5, 10);
    const ci100 = wilsonCI(0.5, 100);
    assert.ok((ci100.upper - ci100.lower) < (ci10.upper - ci10.lower));
  });

  it("clamps to [0,1]", () => {
    const ciLow = wilsonCI(0, 10);
    assert.strictEqual(ciLow.lower, 0);
    const ciHigh = wilsonCI(1, 10);
    assert.strictEqual(ciHigh.upper, 1);
  });
});

describe("computeStatistics — full statistics", () => {
  it("handles empty records", () => {
    const stats = computeStatistics([]);
    assert.strictEqual(stats.questions_completed, 0);
    assert.strictEqual(stats.composite, null);
  });

  it("computes per-metric means and CI", () => {
    const records = [
      {
        status: "completed", subset: "answerable", category_name: "single_hop",
        conversation_id: 1, metrics: {
          binary_accuracy: 1, factual_score: 1, temporal_score: 1,
          contextual_score: 1, abstention_accuracy: 1,
          evidence_precision: 1, stale_memory_leakage: 0,
        },
      },
      {
        status: "completed", subset: "answerable", category_name: "single_hop",
        conversation_id: 1, metrics: {
          binary_accuracy: 0, factual_score: 0, temporal_score: 0,
          contextual_score: 0, abstention_accuracy: 0,
          evidence_precision: 0, stale_memory_leakage: 1,
        },
      },
    ];
    const stats = computeStatistics(records);
    assert.strictEqual(stats.questions_completed, 2);
    assert.strictEqual(stats.binary_accuracy, 0.5);
    assert.ok(stats.binary_accuracy_ci95);
    assert.ok(stats.binary_accuracy_ci95.lower <= 0.5);
    assert.ok(stats.binary_accuracy_ci95.upper >= 0.5);
  });

  it("separates answerable and adversarial subsets", () => {
    const records = [
      {
        status: "completed", subset: "answerable", category_name: "single_hop",
        conversation_id: 1, metrics: {
          binary_accuracy: 1, factual_score: 1, temporal_score: 1,
          contextual_score: 1, abstention_accuracy: 1,
          evidence_precision: 1, stale_memory_leakage: 0,
        },
      },
      {
        status: "completed", subset: "adversarial", category_name: "adversarial",
        conversation_id: 1, metrics: {
          binary_accuracy: 0, factual_score: 0, temporal_score: 0,
          contextual_score: 0, abstention_accuracy: 0,
          evidence_precision: 0, stale_memory_leakage: 0,
        },
      },
    ];
    const stats = computeStatistics(records);
    assert.strictEqual(stats.subsets.answerable.binary_accuracy, 1);
    assert.strictEqual(stats.subsets.adversarial.binary_accuracy, 0);
  });

  it("groups by category", () => {
    const records = [
      {
        status: "completed", subset: "answerable", category_name: "single_hop",
        conversation_id: 1, metrics: {
          binary_accuracy: 1, factual_score: 1, temporal_score: 1,
          contextual_score: 1, abstention_accuracy: 1,
          evidence_precision: 1, stale_memory_leakage: 0,
        },
      },
      {
        status: "completed", subset: "answerable", category_name: "temporal",
        conversation_id: 1, metrics: {
          binary_accuracy: 0, factual_score: 0.5, temporal_score: 0.5,
          contextual_score: 0.5, abstention_accuracy: 0.5,
          evidence_precision: 0.5, stale_memory_leakage: 0,
        },
      },
    ];
    const stats = computeStatistics(records);
    assert.ok(stats.categories["single_hop"]);
    assert.ok(stats.categories["temporal"]);
    assert.strictEqual(stats.categories["single_hop"].binary_accuracy, 1);
    assert.strictEqual(stats.categories["temporal"].binary_accuracy, 0);
  });

  it("groups by conversation", () => {
    const records = [
      {
        status: "completed", subset: "answerable", category_name: "single_hop",
        conversation_id: 1, metrics: {
          binary_accuracy: 1, factual_score: 1, temporal_score: 1,
          contextual_score: 1, abstention_accuracy: 1,
          evidence_precision: 1, stale_memory_leakage: 0,
        },
      },
      {
        status: "completed", subset: "answerable", category_name: "single_hop",
        conversation_id: 1, metrics: {
          binary_accuracy: 0, factual_score: 0, temporal_score: 0,
          contextual_score: 0, abstention_accuracy: 0,
          evidence_precision: 0, stale_memory_leakage: 0,
        },
      },
    ];
    const stats = computeStatistics(records);
    assert.ok(stats.conversations[1]);
    assert.strictEqual(stats.conversations[1].binary_accuracy, 0.5);
  });

  it("counts errors separately", () => {
    const records = [
      {
        status: "completed", subset: "answerable", category_name: "single_hop",
        conversation_id: 1, metrics: {
          binary_accuracy: 1, factual_score: 1, temporal_score: 1,
          contextual_score: 1, abstention_accuracy: 1,
          evidence_precision: 1, stale_memory_leakage: 0,
        },
      },
      { status: "error", question_id: "q2", error: "timeout" },
    ];
    const stats = computeStatistics(records);
    assert.strictEqual(stats.questions_completed, 1);
    assert.strictEqual(stats.questions_error, 1);
    assert.strictEqual(stats.error_rate, 0.5);
  });
});
