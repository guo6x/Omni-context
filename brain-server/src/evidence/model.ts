/**
 * Goal24 Checkpoint 6 (Lane A) - Evidence Candidate / Qualified Evidence model.
 *
 * Evidence is not memory: a Memory record is not automatically evidence.
 * Every evidence candidate must carry an evidence_class, provider-bound
 * provenance (via the collecting provider), an observation time, a
 * verification level and a claim identity (subject_key + claim_key).
 *
 * All schemas are strict Zod objects. Unknown fields - including `shell`,
 * `command`, `argv` and `executable` - are rejected at parse time and can
 * never become evidence authority. Text values may mention those words;
 * they carry no executable semantics.
 *
 * Evidence IDs and claim digests are core-generated:
 * - claim digests use canonical JSON serialization + SHA-256 (key order can
 *   never change a digest);
 * - evidence IDs bind provider_id + evidence_class + subject_key +
 *   source_item_id + claim digest, so two providers sharing a
 *   source_item_id can never collide and providers cannot spoof final IDs.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  EVIDENCE_CLASS_PATTERN,
  VERIFICATION_REQUIREMENTS,
  type VerificationRequirement,
} from '../capabilities/contracts.js';
import { JsonObjectSchema, JsonValueSchema, type JsonValue } from '../contracts/json-safe.js';
import { EvidenceError } from './errors.js';

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/** ISO-8601 timestamps with an explicit UTC offset (same wire shape as execution contracts). */
export const EvidenceTimestampSchema = z.string().datetime({ offset: true });
export type EvidenceTimestamp = z.infer<typeof EvidenceTimestampSchema>;

// ---------------------------------------------------------------------------
// Evidence candidate
// ---------------------------------------------------------------------------

/**
 * A raw candidate supplied by an EvidenceProviderV1. The final evidence_id
 * and claim_digest are core-generated; providers must not supply them and a
 * candidate carrying `evidence_id` or `claim_digest` fields is rejected by
 * the strict schema.
 */
export const EvidenceCandidateSchema = z
  .strictObject({
    evidence_class: z.string().regex(EVIDENCE_CLASS_PATTERN, 'evidence_class must be a dotted identifier'),
    subject_key: z.string().trim().min(1).max(200),
    claim_key: z.string().trim().min(1).max(200),
    claim_value: JsonValueSchema,
    source_item_id: z.string().trim().min(1).max(300),
    source_reference: z.string().trim().min(1).max(1000),
    observed_at: EvidenceTimestampSchema,
    verification_level: z.enum(VERIFICATION_REQUIREMENTS),
    /** Source object's own update time (metadata only; freshness uses observed_at). */
    source_updated_at: EvidenceTimestampSchema.optional(),
    note: z.string().max(2000).optional(),
    metadata: JsonObjectSchema.optional(),
  });
export type EvidenceCandidate = z.infer<typeof EvidenceCandidateSchema>;

// ---------------------------------------------------------------------------
// Canonical JSON + claim digest
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deterministic canonical JSON serialization for JSON-safe values:
 * - object keys are stably sorted (insertion order can never change the form);
 * - array order is preserved (order is semantic for arrays);
 * - null / boolean / finite number / string use their canonical JSON form.
 *
 * Non-JSON-safe input (Date, BigInt, function, symbol, cycle, NaN, Infinity)
 * is rejected, never serialized.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new EvidenceError('EVIDENCE_CLAIM_INVALID', 'claim_value numbers must be finite');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const parts = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    );
    return `{${parts.join(',')}}`;
  }
  throw new EvidenceError(
    'EVIDENCE_CLAIM_INVALID',
    'claim_value must be JSON-safe: null, boolean, finite number, string, array or plain object',
  );
}

/**
 * Core-computed claim digest: canonicalJson(claim_value) -> SHA-256 -> hex.
 * Providers never announce their own digest; insertion order in the claim
 * object can never change the result.
 */
export function claimDigest(value: unknown): string {
  const parsed = JsonValueSchema.safeParse(value);
  if (!parsed.success) {
    throw new EvidenceError(
      'EVIDENCE_CLAIM_INVALID',
      `claim_value is not JSON-safe: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return createHash('sha256').update(canonicalJson(parsed.data), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Core-generated evidence ID
// ---------------------------------------------------------------------------

/**
 * Deterministic, core-generated evidence ID. Binding the provider_id plus
 * the claim digest means:
 * - two providers observing the same source_item_id never collide;
 * - identical duplicate candidates deduplicate to the same ID;
 * - a provider cannot pre-choose or spoof the final ID.
 */
export function buildEvidenceId(input: {
  provider_id: string;
  evidence_class: string;
  subject_key: string;
  source_item_id: string;
  claim_digest: string;
}): string {
  const payload = [
    input.provider_id,
    input.evidence_class,
    input.subject_key,
    input.source_item_id,
    input.claim_digest,
  ].join('\u0000');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Qualified evidence
// ---------------------------------------------------------------------------

/**
 * Qualified evidence: a candidate that passed core qualification (schema,
 * class binding, verification cap, timestamp validity). Qualification adds
 * the core-generated evidence_id, claim_digest and qualified_at timestamp.
 */
export const QualifiedEvidenceSchema = z.strictObject({
  evidence_id: z.string().regex(SHA256_HEX_PATTERN, 'evidence_id must be lowercase SHA-256 hex'),
  provider_id: z.string().min(1).max(200),
  evidence_class: z.string().regex(EVIDENCE_CLASS_PATTERN, 'evidence_class must be a dotted identifier'),
  subject_key: z.string().trim().min(1).max(200),
  claim_key: z.string().trim().min(1).max(200),
  claim_value: JsonValueSchema,
  claim_digest: z.string().regex(SHA256_HEX_PATTERN, 'claim_digest must be lowercase SHA-256 hex'),
  source_item_id: z.string().trim().min(1).max(300),
  source_reference: z.string().trim().min(1).max(1000),
  observed_at: EvidenceTimestampSchema,
  source_updated_at: EvidenceTimestampSchema.optional(),
  verification_level: z.enum(VERIFICATION_REQUIREMENTS),
  /** Core qualification time (injected now); providers can never set it. */
  qualified_at: EvidenceTimestampSchema,
  note: z.string().max(2000).optional(),
});
export type QualifiedEvidence = z.infer<typeof QualifiedEvidenceSchema>;

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

/** Numeric millis of an ISO timestamp; throws EVIDENCE_TIMESTAMP_INVALID on unparseable input. */
export function parseEvidenceTimestamp(timestamp: string): number {
  const millis = Date.parse(timestamp);
  if (!Number.isFinite(millis)) {
    throw new EvidenceError('EVIDENCE_TIMESTAMP_INVALID', `timestamp '${timestamp}' is not parseable`);
  }
  return millis;
}

/** True when `timestamp` is strictly in the future relative to `now`. */
export function isFutureTimestamp(timestamp: string, now: Date): boolean {
  return parseEvidenceTimestamp(timestamp) > now.getTime();
}

// ---------------------------------------------------------------------------
// Verification rank (canonical: none < asserted < verified)
// ---------------------------------------------------------------------------

export const VERIFICATION_RANK: Record<VerificationRequirement, number> = {
  none: 0,
  asserted: 1,
  verified: 2,
};

export type { JsonValue };