import { z } from "zod";

// binary_accuracy must be exactly 0 or 1 — no partial credit.
// Partial correctness is expressed by factual_score.
const binaryAccuracy = z.union([z.literal(0), z.literal(1)]);

export const JudgeMetricsSchema = z.object({
  binary_accuracy: binaryAccuracy,
  factual_score: z.number().min(0).max(1),
  temporal_score: z.number().min(0).max(1),
  contextual_score: z.number().min(0).max(1),
  abstention_accuracy: z.number().min(0).max(1),
  evidence_precision: z.number().min(0).max(1),
  stale_memory_leakage: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

export const ClaimEvaluationSchema = z.object({
  claim_index: z.number().int().min(0),
  evidence_id: z.string().min(1),
  verdict: z.enum(['supports', 'irrelevant', 'contradicts']),
  used_in_answer: z.boolean(),
}).strict();

// The LLM judge scores semantic answer quality and classifies cited support.
// evidence_precision and stale_memory_leakage are intentionally absent: the
// runner computes them deterministically from citations, validity and adoption.
export const JudgeOutputSchema = z.object({
  binary_accuracy: binaryAccuracy,
  factual_score: z.number().min(0).max(1),
  temporal_score: z.number().min(0).max(1),
  contextual_score: z.number().min(0).max(1),
  abstention_accuracy: z.number().min(0).max(1),
  claim_evaluations: z.array(ClaimEvaluationSchema),
  rationale: z.string().min(1),
}).strict();

export function validateJudgeOutput(raw) {
  const parsed = JudgeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map(
      (issue) => issue.path.join(".") + ": " + issue.message
    ).join("; ");
    throw new Error("Judge output schema validation failed: " + details);
  }
  return parsed.data;
}

export function computeComposite(metrics) {
  const keys = [
    "factual_score", "temporal_score", "contextual_score",
    "abstention_accuracy", "evidence_precision",
  ];
  for (const key of keys) {
    if (metrics[key] === undefined || metrics[key] === null) {
      throw new Error("Missing required metric: " + key);
    }
    if (metrics[key] < 0 || metrics[key] > 1) {
      throw new Error("Metric " + key + " out of [0,1] range: " + metrics[key]);
    }
  }
  const stale = metrics.stale_memory_leakage;
  if (stale === undefined || stale === null) {
    throw new Error("stale_memory_leakage is required for composite");
  }
  if (stale < 0 || stale > 1) {
    throw new Error("stale_memory_leakage out of [0,1] range: " + stale);
  }
  const sum =
    metrics.factual_score +
    metrics.temporal_score +
    metrics.contextual_score +
    metrics.abstention_accuracy +
    metrics.evidence_precision +
    (1 - stale);
  return sum / 6;
}

export function validateAllMetricsPresent(metrics) {
  const required = [
    "binary_accuracy", "factual_score", "temporal_score",
    "contextual_score", "abstention_accuracy", "evidence_precision",
    "stale_memory_leakage",
  ];
  const missing = required.filter((k) => metrics[k] === undefined || metrics[k] === null);
  if (missing.length > 0) {
    throw new Error("Missing required judge metrics: " + missing.join(", "));
  }
  // binary_accuracy must be exactly 0 or 1
  if (metrics.binary_accuracy !== 0 && metrics.binary_accuracy !== 1) {
    throw new Error("binary_accuracy must be exactly 0 or 1, got: " + metrics.binary_accuracy);
  }
  for (const key of required) {
    if (key === "binary_accuracy") continue;
    if (typeof metrics[key] !== "number" || metrics[key] < 0 || metrics[key] > 1) {
      throw new Error("Metric " + key + " out of [0,1] range: " + metrics[key]);
    }
  }
}

/**
 * Compute 95% confidence interval using Wilson score interval.
 * Works for proportions (0-1) and binary accuracy.
 */
export function wilsonCI(proportion, n, z = 1.96) {
  if (n === 0) return { lower: 0, upper: 0 };
  const p = proportion;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denominator;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

/**
 * Compute statistics for a set of records, including:
 * - per-metric means
 * - composite score
 * - answerable/adversarial breakdowns
 * - category micro/macro
 * - conversation micro/macro
 * - confidence intervals
 * - error rate
 * - fallback count (must be 0)
 */
export function computeStatistics(records) {
  const retryRecords = records.filter((r) => r.status === "retry").length;
  const latestByQuestion = new Map();
  records.forEach((record, index) => {
    // Legacy/unit fixtures without question IDs remain distinct records. Real
    // runs are reduced to the latest state for each stable question ID so a
    // repaired error does not inflate the denominator or remain an error.
    latestByQuestion.set(record.question_id ?? `__record_${index}`, record);
  });
  const latestRecords = [...latestByQuestion.values()].filter((record) => record.status !== "retry");
  const completed = latestRecords.filter((r) => r.status === "completed" && r.metrics);
  const errors = latestRecords.filter((r) => r.status === "error");
  const total = latestRecords.length;

  if (completed.length === 0) {
    return {
      questions_total: total,
      questions_completed: 0,
      questions_error: errors.length,
      retry_records: retryRecords,
      error_rate: total > 0 ? errors.length / total : 0,
      fallback_count: 0,
      composite: null,
      metrics: {},
      subsets: {},
      categories: {},
      conversations: {},
    };
  }

  const metricKeys = [
    "binary_accuracy", "factual_score", "temporal_score",
    "contextual_score", "abstention_accuracy", "evidence_precision",
    "stale_memory_leakage",
  ];

  const mean = (vals) => vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  const vals = (key) => completed.map((r) => r.metrics[key]).filter((v) => typeof v === "number");

  const metricsSummary = {};
  for (const key of metricKeys) {
    const values = vals(key);
    const m = mean(values);
    metricsSummary[key] = {
      mean: m,
      ci95: m !== null ? wilsonCI(m, values.length) : null,
      n: values.length,
    };
  }

  const compositeValues = completed.map((r) => computeComposite(r.metrics));
  const compositeMean = mean(compositeValues);

  // Subset breakdown
  const subsets = {};
  for (const subset of ["answerable", "adversarial"]) {
    const subsetRecords = completed.filter((r) => r.subset === subset);
    if (subsetRecords.length > 0) {
      const acc = mean(subsetRecords.map((r) => r.metrics.binary_accuracy));
      subsets[subset] = {
        count: subsetRecords.length,
        binary_accuracy: acc,
        ci95: acc !== null ? wilsonCI(acc, subsetRecords.length) : null,
      };
    }
  }

  // Category micro/macro
  const categories = {};
  const categoryGroups = {};
  for (const rec of completed) {
    const cat = rec.category_name || rec.category || "unknown";
    if (!categoryGroups[cat]) categoryGroups[cat] = [];
    categoryGroups[cat].push(rec);
  }
  for (const [cat, recs] of Object.entries(categoryGroups)) {
    const acc = mean(recs.map((r) => r.metrics.binary_accuracy));
    const comp = mean(recs.map((r) => computeComposite(r.metrics)));
    categories[cat] = {
      count: recs.length,
      binary_accuracy: acc,
      composite: comp,
    };
  }

  // Conversation micro/macro
  const conversations = {};
  const convGroups = {};
  for (const rec of completed) {
    const cid = rec.conversation_id;
    if (!convGroups[cid]) convGroups[cid] = [];
    convGroups[cid].push(rec);
  }
  for (const [cid, recs] of Object.entries(convGroups)) {
    const acc = mean(recs.map((r) => r.metrics.binary_accuracy));
    conversations[cid] = {
      count: recs.length,
      binary_accuracy: acc,
      ci95: acc !== null ? wilsonCI(acc, recs.length) : null,
    };
  }

  // Check for fallback scores (hash-based or default 0.5)
  const fallbackCount = completed.filter((r) =>
    r.metrics.contextual_score === 0.5 && r.judge_raw?.includes("cannot assess")
  ).length;

  return {
    questions_total: total,
    questions_completed: completed.length,
    questions_error: errors.length,
    retry_records: retryRecords,
    error_rate: total > 0 ? errors.length / total : 0,
    fallback_count: fallbackCount,
    composite: compositeMean,
    composite_ci95: compositeMean !== null ? wilsonCI(compositeMean, compositeValues.length) : null,
    metrics: metricsSummary,
    binary_accuracy: mean(vals("binary_accuracy")),
    binary_accuracy_ci95: (() => {
      const m = mean(vals("binary_accuracy"));
      return m !== null ? wilsonCI(m, vals("binary_accuracy").length) : null;
    })(),
    subsets,
    categories,
    conversations,
  };
}
