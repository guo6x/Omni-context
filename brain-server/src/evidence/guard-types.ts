/**
 * Goal24 Checkpoint 6 (Lane B) - Evidence Surface Guard control types.
 *
 * The guard is a deterministic control runtime, not another agent. It uses
 * the existing EvidenceRequirement / EvidenceCoverageSnapshot /
 * CoverageAssessment contracts verbatim and never redefines coverage
 * satisfaction policy: assessEvidenceCoverage() is the single source of
 * truth. The guard only decides the next control action.
 */

import { z } from 'zod';
import { JsonObjectSchema } from '../contracts/json-safe.js';
import { EvidenceRequirementSchema, type EvidenceRequirement } from '../capabilities/contracts.js';
import {
  EVIDENCE_CLASS_PATTERN,
} from '../capabilities/contracts.js';
import {
  EvidenceCoverageSnapshotSchema,
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
  type CoverageAssessment,
  type EvidenceCoverageSnapshot,
} from '../execution/contracts.js';

// ---------------------------------------------------------------------------
// Canonical guard actions
// ---------------------------------------------------------------------------

export const GUARD_ACTIONS = ['proceed', 'retrieve_more', 'clarify', 'defer', 'block'] as const;
export type GuardAction = (typeof GUARD_ACTIONS)[number];

/** Structured provider outcome taxonomy. English error text is never parsed. */
export const PROVIDER_OUTCOME_KINDS = [
  'collected',
  'not_found',
  'temporary_unavailable',
  'permanent_unavailable',
  'user_context_required',
  'provider_error',
  'collection_limit_exceeded',
] as const;
export type ProviderOutcomeKind = (typeof PROVIDER_OUTCOME_KINDS)[number];

/** Machine-judgeable reason codes (superset of the CP6 minimum list). */
export const GUARD_REASON_CODES = [
  'EVIDENCE_SATISFIED',
  'EVIDENCE_MISSING',
  'EVIDENCE_STALE',
  'EVIDENCE_UNVERIFIED',
  'EVIDENCE_CONFLICT',
  'RETRIEVAL_AVAILABLE',
  'RETRIEVAL_EXHAUSTED',
  'USER_CONTEXT_REQUIRED',
  'PROVIDER_TEMPORARY_UNAVAILABLE',
  'PROVIDER_PERMANENT_UNAVAILABLE',
  'PROVIDER_ERROR',
  'COLLECTION_LIMIT_EXCEEDED',
  'COVERAGE_REGRESSION',
  'GUARD_ABORTED',
] as const;
export type GuardReasonCode = (typeof GUARD_REASON_CODES)[number];

// ---------------------------------------------------------------------------
// Provider outcome metadata
// ---------------------------------------------------------------------------

/**
 * Outcome metadata serves the control decision only. No raw evidence
 * payload, no credentials, and no natural-language triage lives here.
 */
export const ProviderOutcomeSchema = z.strictObject({
  evidence_class: z.string().regex(EVIDENCE_CLASS_PATTERN, 'evidence_class must be a dotted identifier'),
  kind: z.enum(PROVIDER_OUTCOME_KINDS),
  /** True when another retrieval attempt is structurally possible. */
  retryable: z.boolean().optional(),
  /** True when an alternate provider/source exists that has not been tried. */
  alternate_provider_available: z.boolean().optional(),
  /** Structured clarification need key; never a generated question. */
  clarification_key: z.string().trim().min(1).max(200).optional(),
  /** Optional JSON-safe diagnostic metadata. */
  note: z.string().max(2000).optional(),
});
export type ProviderOutcome = z.infer<typeof ProviderOutcomeSchema>;

// ---------------------------------------------------------------------------
// Guard request
// ---------------------------------------------------------------------------

export const MAX_RETRIEVAL_ROUNDS = 10;

/**
 * Bounded, JSON-safe guard request. No shell, command, or execution
 * arguments may appear anywhere in this request.
 */
export const EvidenceGuardRequestSchema = z
  .strictObject({
    requirements: z.array(EvidenceRequirementSchema).max(100),
    initial_coverage: EvidenceCoverageSnapshotSchema.optional(),
    /** Explicit caller/config bound: 0..10. Never an unbounded retry loop. */
    max_retrieval_rounds: z.number().int().min(0).max(MAX_RETRIEVAL_ROUNDS),
    per_round_timeout_ms: z.number().int().min(TIMEOUT_MIN_MS).max(TIMEOUT_MAX_MS),
    correlation_id: z.string().trim().min(1).max(200).optional(),
    /** Optional JSON-safe context metadata. */
    context: JsonObjectSchema.optional(),
  })
  .superRefine((request, ctx) => {
    if (request.context) {
      const keys = Object.keys(request.context);
      for (const key of keys) {
        if (FORBIDDEN_CONTEXT_KEYS.includes(key)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `context key '${key}' is not allowed in a guard request`, path: ['context', key] });
        }
      }
    }
  });
export type EvidenceGuardRequest = z.infer<typeof EvidenceGuardRequestSchema>;

const FORBIDDEN_CONTEXT_KEYS = ['shell', 'command', 'exec', 'bash', 'powershell', 'cmd', 'cmdline', 'script'];

/** External cancellation signal carried alongside the validated request. */
export interface EvidenceGuardRequestWithSignal extends EvidenceGuardRequest {
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Collection callback abstraction (Lane A independent)
// ---------------------------------------------------------------------------

export interface CollectCoverageParams {
  requirements: EvidenceRequirement[];
  previousCoverage: EvidenceCoverageSnapshot;
  requestedClasses: string[];
  round: number;
  signal: AbortSignal;
}

export interface CollectCoverageResult {
  coverage: EvidenceCoverageSnapshot;
  outcomes: ProviderOutcome[];
}

export type CollectCoverage = (
  params: CollectCoverageParams,
) => CollectCoverageResult | Promise<CollectCoverageResult>;

// ---------------------------------------------------------------------------
// Guard result
// ---------------------------------------------------------------------------

export interface GuardTraceRound {
  round: number;
  checked_at: string | null;
  requested_classes: string[];
  assessment_summary: {
    mandatory_satisfied: boolean;
    missing_mandatory: string[];
    blocking_reasons: string[];
  };
  chosen_action: GuardAction;
  reason_codes: GuardReasonCode[];
}

export interface ClarificationNeed {
  evidence_class: string;
  clarification_key: string;
}

export interface EvidenceGuardResult {
  action: GuardAction;
  rounds_used: number;
  final_coverage: EvidenceCoverageSnapshot;
  final_assessment: CoverageAssessment;
  requested_classes: string[];
  remaining_mandatory: string[];
  reason_codes: GuardReasonCode[];
  provider_outcomes: ProviderOutcome[];
  warnings: string[];
  non_blocking_findings: string[];
  clarification_needs: ClarificationNeed[];
  trace: GuardTraceRound[];
  aborted: boolean;
  correlation_id: string | null;
}