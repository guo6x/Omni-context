/**
 * Goal24 Checkpoint 6 (Integration) - deterministic trust-boundary digests.
 *
 * Digests are NOT authorization. They are deterministic fingerprints the
 * Evidence Surface Runtime records on server-owned GuardRunRecords so a later
 * Eligibility materialization can prove the run was computed from the same
 * capability policy and the same normalized inputs, and that the coverage
 * object was not mutated afterwards.
 *
 * All digests use canonical JSON (stable key sort, array order preserved) +
 * SHA-256 lowercase hex, the same primitives as claim digests. A caller can
 * compute any of these digests itself - that proves nothing. Authority lives
 * in the server-owned GuardRunStore record, never in a digest.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  EvidenceRequirementSchema,
  type EvidenceRequirement,
} from '../capabilities/contracts.js';
import { JsonObjectSchema, type JsonObject } from '../contracts/json-safe.js';
import {
  EvidenceCoverageSnapshotSchema,
  type EvidenceCoverageSnapshot,
} from '../execution/contracts.js';
import { EvidenceError } from './errors.js';
import { canonicalJson } from './model.js';

export function sha256Hex(payload: string | Buffer): string {
  return createHash('sha256').update(payload).digest('hex');
}

/** Deterministic digest of a capability's exact required_evidence policy. */
export function requirementsDigest(requirements: readonly EvidenceRequirement[]): string {
  const parsed = z.array(EvidenceRequirementSchema).max(100).safeParse(requirements);
  if (!parsed.success) {
    throw new EvidenceError(
      'EVIDENCE_INPUT_INVALID',
      `requirements are invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return sha256Hex(canonicalJson(parsed.data));
}

/** Deterministic digest of capability normalized inputs (subject binding proof). */
export function normalizedInputsDigest(normalizedInputs: JsonObject): string {
  const parsed = JsonObjectSchema.safeParse(normalizedInputs);
  if (!parsed.success) {
    throw new EvidenceError('EVIDENCE_INPUT_INVALID', 'normalized_inputs must be a JSON-safe plain object');
  }
  return sha256Hex(canonicalJson(parsed.data));
}

/** Deterministic digest of an EvidenceCoverageSnapshot (mutation detection). */
export function coverageDigest(snapshot: EvidenceCoverageSnapshot): string {
  const parsed = EvidenceCoverageSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new EvidenceError(
      'EVIDENCE_INPUT_INVALID',
      `coverage snapshot is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return sha256Hex(canonicalJson(parsed.data));
}
