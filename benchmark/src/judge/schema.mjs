import { z } from "zod";

export const JudgeMetricsSchema = z.object({
  binary_accuracy: z.number().min(0).max(1),
  factual_score: z.number().min(0).max(1),
  temporal_score: z.number().min(0).max(1),
  contextual_score: z.number().min(0).max(1),
  abstention_accuracy: z.number().min(0).max(1),
  evidence_precision: z.number().min(0).max(1),
  stale_memory_leakage: z.number().min(0).max(1),
  rationale: z.string().min(1),
});

export const JudgeOutputSchema = z.object({
  binary_accuracy: z.number().min(0).max(1),
  factual_score: z.number().min(0).max(1),
  temporal_score: z.number().min(0).max(1),
  contextual_score: z.number().min(0).max(1),
  abstention_accuracy: z.number().min(0).max(1),
  evidence_precision: z.number().min(0).max(1),
  stale_memory_leakage: z.number().min(0).max(1),
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
  for (const key of required) {
    if (metrics[key] < 0 || metrics[key] > 1) {
      throw new Error("Metric " + key + " out of [0,1] range: " + metrics[key]);
    }
  }
}
