/**
 * Goal24 Checkpoint 6 (Integration) - evidence subject binding.
 *
 * An evidence_class alone never identifies an object: pull_request.current_state
 * for repoA#1 is not evidence about repoB#9. The production Evidence Surface
 * Runtime derives the subject_key itself from (capability_id, normalized_inputs)
 * through a trusted CapabilityEvidenceSubjectResolver; callers never submit an
 * arbitrary subject_key detached from their capability inputs.
 *
 * Subject keys are validated (bounded, non-empty, no NUL, no control
 * characters). Provider candidates must carry exactly the Guard run subject;
 * anything else is EVIDENCE_SUBJECT_MISMATCH and can never qualify.
 */

import type { JsonObject } from '../contracts/json-safe.js';
import { CAPABILITY_ID_PATTERN } from '../capabilities/contracts.js';
import { EvidenceError } from './errors.js';

export const SUBJECT_KEY_MAX_LENGTH = 200;
const SUBJECT_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

/** Fail-closed subject key validation (core/resolver-generated keys only). */
export function assertValidSubjectKey(subjectKey: string): void {
  if (typeof subjectKey !== 'string' || subjectKey.trim().length === 0) {
    throw new EvidenceError('EVIDENCE_SUBJECT_KEY_INVALID', 'subject_key must be a non-empty string');
  }
  if (subjectKey.length > SUBJECT_KEY_MAX_LENGTH) {
    throw new EvidenceError(
      'EVIDENCE_SUBJECT_KEY_INVALID',
      `subject_key exceeds the ${SUBJECT_KEY_MAX_LENGTH}-character bound`,
    );
  }
  if (SUBJECT_CONTROL_PATTERN.test(subjectKey)) {
    throw new EvidenceError('EVIDENCE_SUBJECT_KEY_INVALID', 'subject_key must not contain NUL or control characters');
  }
}

/**
 * Trusted resolver: (capability_id, normalized_inputs) -> canonical subject key.
 * Resolvers are registered internally by application code, never by callers.
 */
export type CapabilityEvidenceSubjectResolver = (
  capabilityId: string,
  normalizedInputs: JsonObject,
) => string;

/**
 * Internal registry of subject resolvers keyed by capability id.
 * resolve() fails closed with EVIDENCE_SUBJECT_RESOLVER_NOT_FOUND when no
 * resolver is registered for the capability (no default subject synthesis).
 */
export class CapabilityEvidenceSubjectResolverRegistry {
  private readonly resolvers = new Map<string, CapabilityEvidenceSubjectResolver>();

  register(capabilityId: string, resolver: CapabilityEvidenceSubjectResolver): void {
    if (!CAPABILITY_ID_PATTERN.test(capabilityId)) {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', `invalid capability id '${capabilityId}'`);
    }
    if (typeof resolver !== 'function') {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', 'subject resolver must be a function');
    }
    if (this.resolvers.has(capabilityId)) {
      throw new EvidenceError(
        'EVIDENCE_SUBJECT_RESOLVER_DUPLICATE',
        `a subject resolver is already registered for capability '${capabilityId}'`,
      );
    }
    this.resolvers.set(capabilityId, resolver);
  }

  has(capabilityId: string): boolean {
    return this.resolvers.has(capabilityId);
  }

  /** Resolve and validate the canonical subject key (fail closed). */
  resolve(capabilityId: string, normalizedInputs: JsonObject): string {
    const resolver = this.resolvers.get(capabilityId);
    if (!resolver) {
      throw new EvidenceError(
        'EVIDENCE_SUBJECT_RESOLVER_NOT_FOUND',
        `no trusted subject resolver is registered for capability '${capabilityId}'`,
      );
    }
    let subjectKey: string;
    try {
      subjectKey = resolver(capabilityId, normalizedInputs);
    } catch (error) {
      if (error instanceof EvidenceError) throw error;
      throw new EvidenceError(
        'EVIDENCE_SUBJECT_KEY_INVALID',
        `subject resolver for '${capabilityId}' failed to produce a subject key`,
      );
    }
    assertValidSubjectKey(subjectKey);
    return subjectKey;
  }
}
