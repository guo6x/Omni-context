/**
 * Goal24 Checkpoint 6 (Integration) - server-owned evidence lineage stores.
 *
 * Two in-memory stores form the CP6 V1 trust boundary:
 *
 * 1. QualifiedEvidenceStore: every evidence_id produced by Lane A
 *    qualification is recorded with full provenance (provider id + version,
 *    class, subject, claim key/digest, observation time, verification level,
 *    qualification outcome). Eligibility later proves every coverage id
 *    traces back to one of these records (EVIDENCE_LINEAGE_MISSING
 *    otherwise). Ids can be invalidated (tombstoned): tombstoned ids can
 *    never re-enter the store.
 *
 * 2. GuardRunStore: every complete Evidence Guard evaluation is recorded with
 *    its digests and coverage. It is server-owned and never populated from a
 *    request. Bounded: when full, the oldest run is evicted (an evicted run
 *    fails closed with EVIDENCE_GUARD_RUN_NOT_FOUND at materialization).
 *
 * Both stores are memory-only. A Brain Server restart clears them, so
 * Guard-run lineage is restart-invalidated in V1: after restart, eligibility
 * fails closed and evidence must be recollected. This is documented honestly;
 * there is no persistent evidence authorization in CP6.
 */

import { z } from 'zod';
import { EVIDENCE_CLASS_PATTERN, VERIFICATION_REQUIREMENTS } from '../capabilities/contracts.js';
import {
  EvidenceCoverageSnapshotSchema,
  type CoverageAssessment,
  type EvidenceCoverageSnapshot,
} from '../execution/contracts.js';
import { EvidenceError } from './errors.js';
import { EvidenceTimestampSchema, SHA256_HEX_PATTERN } from './model.js';
import {
  GUARD_ACTIONS,
  GUARD_REASON_CODES,
  ProviderOutcomeSchema,
  type ClarificationNeed,
  type GuardAction,
  type GuardReasonCode,
  type ProviderOutcome,
} from './guard-types.js';

// ---------------------------------------------------------------------------
// Qualified evidence records
// ---------------------------------------------------------------------------

export const QUALIFICATION_OUTCOMES = ['qualified', 'rejected'] as const;
export type QualificationOutcome = (typeof QUALIFICATION_OUTCOMES)[number];

export const QualifiedEvidenceRecordSchema = z.strictObject({
  evidence_id: z.string().regex(SHA256_HEX_PATTERN, 'evidence_id must be lowercase SHA-256 hex'),
  provider_id: z.string().min(1).max(200),
  provider_version: z.string().min(1).max(100),
  evidence_class: z.string().regex(EVIDENCE_CLASS_PATTERN, 'evidence_class must be a dotted identifier'),
  subject_key: z.string().trim().min(1).max(200),
  claim_key: z.string().trim().min(1).max(200),
  claim_digest: z.string().regex(SHA256_HEX_PATTERN, 'claim_digest must be lowercase SHA-256 hex'),
  observed_at: EvidenceTimestampSchema,
  verification_level: z.enum(VERIFICATION_REQUIREMENTS),
  qualification_outcome: z.enum(QUALIFICATION_OUTCOMES),
  source_item_id: z.string().trim().min(1).max(300),
  source_reference: z.string().trim().min(1).max(1000),
  qualified_at: EvidenceTimestampSchema,
});
export type QualifiedEvidenceRecord = z.infer<typeof QualifiedEvidenceRecordSchema>;

/**
 * Content equality deliberately excludes `qualified_at`: it is core
 * processing metadata, not evidence content. Re-qualifying the identical
 * evidence at a later time is idempotent (so a later evaluation can age the
 * evidence into a stale assessment); any change to identity-bound content
 * (claim digest, observed_at, verification, provenance) still fails closed
 * as EVIDENCE_LINEAGE_CONFLICT.
 */
function recordsEqual(a: QualifiedEvidenceRecord, b: QualifiedEvidenceRecord): boolean {
  return (
    a.evidence_id === b.evidence_id &&
    a.provider_id === b.provider_id &&
    a.provider_version === b.provider_version &&
    a.evidence_class === b.evidence_class &&
    a.subject_key === b.subject_key &&
    a.claim_key === b.claim_key &&
    a.claim_digest === b.claim_digest &&
    a.observed_at === b.observed_at &&
    a.verification_level === b.verification_level &&
    a.qualification_outcome === b.qualification_outcome &&
    a.source_item_id === b.source_item_id &&
    a.source_reference === b.source_reference
  );
}

export const DEFAULT_MAX_QUALIFIED_RECORDS = 2000;

/**
 * Bounded, server-owned qualified evidence ledger.
 * Duplicate id + identical content is idempotent; duplicate id + different
 * content is EVIDENCE_LINEAGE_CONFLICT; a tombstoned id can never re-enter
 * (EVIDENCE_LINEAGE_INVALIDATED); overflow fails closed with
 * EVIDENCE_COLLECTION_LIMIT_EXCEEDED.
 */
export class QualifiedEvidenceStore {
  private readonly records = new Map<string, QualifiedEvidenceRecord>();
  private readonly tombstoned = new Set<string>();
  private readonly maxRecords: number;

  constructor(maxRecords: number = DEFAULT_MAX_QUALIFIED_RECORDS) {
    if (!Number.isInteger(maxRecords) || maxRecords <= 0) {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', 'maxRecords must be a positive integer');
    }
    this.maxRecords = maxRecords;
  }

  put(record: QualifiedEvidenceRecord): void {
    const parsed = QualifiedEvidenceRecordSchema.safeParse(record);
    if (!parsed.success) {
      throw new EvidenceError(
        'EVIDENCE_INPUT_INVALID',
        `qualified evidence record is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const id = parsed.data.evidence_id;
    if (this.tombstoned.has(id)) {
      throw new EvidenceError(
        'EVIDENCE_LINEAGE_INVALIDATED',
        `evidence id '${id}' was invalidated and can never re-enter the store`,
      );
    }
    const existing = this.records.get(id);
    if (existing) {
      if (!recordsEqual(existing, parsed.data)) {
        throw new EvidenceError(
          'EVIDENCE_LINEAGE_CONFLICT',
          `evidence id '${id}' already exists with different content; id reuse is a mutation`,
        );
      }
      return;
    }
    if (this.records.size >= this.maxRecords) {
      throw new EvidenceError(
        'EVIDENCE_COLLECTION_LIMIT_EXCEEDED',
        `qualified evidence store is full (${this.maxRecords} records)`,
      );
    }
    this.records.set(id, parsed.data);
  }

  get(evidenceId: string): QualifiedEvidenceRecord | undefined {
    return this.records.get(evidenceId);
  }

  has(evidenceId: string): boolean {
    return this.records.has(evidenceId) && !this.tombstoned.has(evidenceId);
  }

  invalidate(evidenceId: string): void {
    if (this.tombstoned.has(evidenceId)) return;
    this.records.delete(evidenceId);
    this.tombstoned.add(evidenceId);
  }

  get size(): number {
    return this.records.size;
  }
}

// ---------------------------------------------------------------------------
// Guard run records
// ---------------------------------------------------------------------------

const ReasonCodesSchema = z.array(z.enum(GUARD_REASON_CODES));

export const EvidenceGuardRunRecordSchema = z
  .strictObject({
    guard_run_id: z.string().trim().min(1).max(200),
    capability_id: z.string().min(1).max(200),
    capability_version: z.string().min(1).max(100),
    subject_key: z.string().trim().min(1).max(200),
    normalized_inputs_digest: z.string().regex(SHA256_HEX_PATTERN),
    requirements_digest: z.string().regex(SHA256_HEX_PATTERN),
    started_at: EvidenceTimestampSchema,
    finished_at: EvidenceTimestampSchema,
    final_action: z.enum(GUARD_ACTIONS),
    final_coverage: EvidenceCoverageSnapshotSchema,
    coverage_digest: z.string().regex(SHA256_HEX_PATTERN),
    qualified_evidence_ids: z.array(z.string().regex(SHA256_HEX_PATTERN)).max(2000),
    rounds_used: z.number().int().min(0).max(10),
    reason_codes: ReasonCodesSchema.max(100),
    provider_outcomes: z.array(ProviderOutcomeSchema).max(1000),
    warnings: z.array(z.string().max(2000)).max(100),
    non_blocking_findings: z.array(z.string().max(2000)).max(100),
    clarification_needs: z.array(z.strictObject({
      evidence_class: z.string().regex(EVIDENCE_CLASS_PATTERN),
      clarification_key: z.string().trim().min(1).max(200),
    })).max(100),
    aborted: z.boolean(),
    correlation_id: z.string().trim().min(1).max(200).nullable(),
  });
export type EvidenceGuardRunRecord = z.infer<typeof EvidenceGuardRunRecordSchema>;

export const DEFAULT_MAX_GUARD_RUNS = 100;

/**
 * Bounded, server-owned guard run ledger (memory-only, restart-invalidated).
 * Oldest-entry eviction on overflow: an evicted run simply fails closed at
 * eligibility (EVIDENCE_GUARD_RUN_NOT_FOUND).
 */
export class GuardRunStore {
  private readonly runs = new Map<string, EvidenceGuardRunRecord>();
  private readonly maxRuns: number;

  constructor(maxRuns: number = DEFAULT_MAX_GUARD_RUNS) {
    if (!Number.isInteger(maxRuns) || maxRuns <= 0) {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', 'maxRuns must be a positive integer');
    }
    this.maxRuns = maxRuns;
  }

  put(record: EvidenceGuardRunRecord): void {
    const parsed = EvidenceGuardRunRecordSchema.safeParse(record);
    if (!parsed.success) {
      throw new EvidenceError(
        'EVIDENCE_INPUT_INVALID',
        `guard run record is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const id = parsed.data.guard_run_id;
    if (this.runs.has(id)) {
      throw new EvidenceError(
        'EVIDENCE_INPUT_INVALID',
        `guard run id '${id}' already exists; guard run ids are core-generated and unique`,
      );
    }
    while (this.runs.size >= this.maxRuns) {
      const oldest = this.runs.keys().next().value;
      if (oldest === undefined) break;
      this.runs.delete(oldest);
    }
    this.runs.set(id, parsed.data);
  }

  get(guardRunId: string): EvidenceGuardRunRecord | undefined {
    return this.runs.get(guardRunId);
  }

  has(guardRunId: string): boolean {
    return this.runs.has(guardRunId);
  }

  get size(): number {
    return this.runs.size;
  }
}

export type { ClarificationNeed, CoverageAssessment, EvidenceCoverageSnapshot, GuardAction, GuardReasonCode, ProviderOutcome };
