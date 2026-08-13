/**
 * Goal24 Checkpoint 6 (Lane A) - evidence qualification runtime.
 *
 * Qualification is deterministic, pure core logic (no Date.now(), no
 * retrieval, no LLM): it validates candidate structure, class binding,
 * subject binding, the provider's verification cap, observation timestamps
 * and claim integrity, and computes age-based staleness against the
 * requirement's freshness_policy using the injected clock.
 *
 * Fail-closed rules:
 * - a candidate claiming a verification level above its provider's
 *   max_verification_level is rejected (EVIDENCE_PROVIDER_VERIFICATION_ESCALATION),
 *   never silently self-promoted;
 * - a candidate for an undeclared class or subject is rejected
 *   (EVIDENCE_PROVIDER_CLASS_MISMATCH);
 * - a future observed_at is rejected (EVIDENCE_TIMESTAMP_INVALID) so it can
 *   never achieve permanent freshness through a negative age;
 * - age == max_age_ms is fresh; age > max_age_ms is stale;
 * - without a freshness_policy, age alone never makes evidence stale.
 *
 * verification_level=none is a legal qualified state: it means the evidence
 * is structurally/provenance-valid but unverified-by-design. Only candidates
 * that fail qualification (provider legitimacy, provenance binding, claim
 * integrity) become status=unverified.
 */

import {
  type EvidenceRequirement,
  type VerificationRequirement,
} from '../capabilities/contracts.js';
import {
  buildEvidenceId,
  claimDigest,
  encodeEvidenceIdTuple,
  EvidenceCandidateSchema,
  parseEvidenceTimestamp,
  type EvidenceCandidate,
  type QualifiedEvidence,
  VERIFICATION_RANK,
} from './model.js';
import type { EvidenceProviderV1Metadata } from './provider.js';
import { createHash } from 'node:crypto';

export const QUALIFICATION_ISSUE_CODES = [
  'invalid_candidate_schema',
  'class_mismatch',
  'subject_mismatch',
  'verification_escalation',
  'invalid_observed_at',
  'future_observed_at',
  'claim_invalid',
  'invalid_identity_component',
  'stale',
] as const;
export type QualificationIssueCode = (typeof QUALIFICATION_ISSUE_CODES)[number];

export interface QualificationIssue {
  code: QualificationIssueCode;
  message: string;
}

export interface QualificationContext {
  /** The provider that returned the candidate. */
  provider: EvidenceProviderV1Metadata;
  /** The class the Guard requested (candidates must match it). */
  evidenceClass: string;
  /** The subject the Guard requested (candidates must match it). */
  subjectKey: string;
  /** Requirement used for freshness; undefined means no age-based staleness. */
  requirement: EvidenceRequirement | undefined;
  /** Injected clock; never Date.now() inside qualification. */
  now: Date;
}

export type CandidateQualification =
  | { kind: 'qualified'; evidence: QualifiedEvidence; stale: boolean; issues: QualificationIssue[] }
  | { kind: 'rejected'; issues: QualificationIssue[]; referenceId: string };

function pickStringField(value: unknown, key: string): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'string' ? field.slice(0, 300) : '';
  }
  return '';
}

/**
 * Deterministic diagnostic reference for candidates that fail the strict
 * candidate schema (their fields cannot be trusted, so a real evidence id is
 * not generated). The reference is a stable `ref:<sha256>` string that can
 * still populate the evidence_ids of an unverified coverage entry.
 */
export function diagnosticEvidenceReference(
  providerId: string,
  requestedClass: string,
  requestedSubject: string,
  rawCandidate: unknown,
): string {
  const fields = [
    providerId,
    requestedClass,
    requestedSubject,
    pickStringField(rawCandidate, 'evidence_class'),
    pickStringField(rawCandidate, 'subject_key'),
    pickStringField(rawCandidate, 'claim_key'),
    pickStringField(rawCandidate, 'source_item_id'),
    'schema-invalid',
  ].map((field) => field.replace(/[\u0000-\u001f\u007f]/g, '\uFFFD'));
  return `ref:${createHash('sha256').update(encodeEvidenceIdTuple(fields)).digest('hex')}`;
}

/**
 * Qualify one raw provider candidate. Pure and deterministic: same
 * provider/request/requirement/now/candidate always produces the same result.
 */
export function qualifyCandidate(
  rawCandidate: unknown,
  context: QualificationContext,
): CandidateQualification {
  const issues: QualificationIssue[] = [];

  const parsed = EvidenceCandidateSchema.safeParse(rawCandidate);
  if (!parsed.success) {
    issues.push({
      code: 'invalid_candidate_schema',
      message: `candidate failed strict schema validation: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    });
    return {
      kind: 'rejected',
      issues,
      referenceId: diagnosticEvidenceReference(
        context.provider.provider_id,
        context.evidenceClass,
        context.subjectKey,
        rawCandidate,
      ),
    };
  }
  const candidate: EvidenceCandidate = parsed.data;

  // Class binding: the candidate must be for the requested class, and the
  // provider must declare that class. A provider can never smuggle a
  // different (possibly higher-value) evidence class through collect.
  if (candidate.evidence_class !== context.evidenceClass) {
    issues.push({
      code: 'class_mismatch',
      message: `candidate class '${candidate.evidence_class}' does not match requested class '${context.evidenceClass}'`,
    });
    return { kind: 'rejected', issues, referenceId: buildRejectedReference(candidate, context) };
  }
  if (!context.provider.supported_classes.includes(candidate.evidence_class)) {
    issues.push({
      code: 'class_mismatch',
      message: `provider '${context.provider.provider_id}' does not declare support for class '${candidate.evidence_class}'`,
    });
    return { kind: 'rejected', issues, referenceId: buildRejectedReference(candidate, context) };
  }

  // Subject binding: evidence collected for another subject cannot satisfy
  // this requirement.
  if (candidate.subject_key !== context.subjectKey) {
    issues.push({
      code: 'subject_mismatch',
      message: `candidate subject '${candidate.subject_key}' does not match requested subject '${context.subjectKey}'`,
    });
    return { kind: 'rejected', issues, referenceId: buildRejectedReference(candidate, context) };
  }

  // Verification cap: the candidate may never claim more than its provider
  // is allowed to assert.
  const candidateVerification: VerificationRequirement = candidate.verification_level;
  if (VERIFICATION_RANK[candidateVerification] > VERIFICATION_RANK[context.provider.max_verification_level]) {
    issues.push({
      code: 'verification_escalation',
      message:
        `candidate verification_level '${candidateVerification}' exceeds provider ` +
        `'${context.provider.provider_id}' max_verification_level '${context.provider.max_verification_level}'`,
    });
    return { kind: 'rejected', issues, referenceId: buildRejectedReference(candidate, context) };
  }

  // Timestamp validity. observed_at is produced by the trusted runtime at
  // collection time; a future timestamp is rejected instead of producing a
  // negative age.
  let observedAtMs: number;
  try {
    observedAtMs = parseEvidenceTimestamp(candidate.observed_at);
  } catch (error) {
    issues.push({
      code: 'invalid_observed_at',
      message: (error as Error).message,
    });
    return { kind: 'rejected', issues, referenceId: buildRejectedReference(candidate, context) };
  }
  if (observedAtMs > context.now.getTime()) {
    issues.push({
      code: 'future_observed_at',
      message: `observed_at '${candidate.observed_at}' is in the future relative to qualification time '${context.now.toISOString()}'`,
    });
    return { kind: 'rejected', issues, referenceId: buildRejectedReference(candidate, context) };
  }

  // Claim integrity: the core computes the digest; the provider never
  // announces it.
  let digest: string;
  try {
    digest = claimDigest(candidate.claim_value);
  } catch (error) {
    issues.push({
      code: 'claim_invalid',
      message: (error as Error).message,
    });
    return { kind: 'rejected', issues, referenceId: buildRejectedReference(candidate, context) };
  }

  // Freshness uses observed_at (provider observation time), never
  // source_updated_at. Boundary: age == max_age_ms is fresh; only
  // age > max_age_ms is stale. No freshness_policy -> never age-stale.
  let stale = false;
  if (context.requirement?.freshness_policy) {
    const maxAgeMs = context.requirement.freshness_policy.max_age_ms;
    const ageMs = context.now.getTime() - observedAtMs;
    if (ageMs > maxAgeMs) {
      stale = true;
      issues.push({
        code: 'stale',
        message:
          `evidence age ${ageMs}ms exceeds freshness_policy max_age_ms ${maxAgeMs}ms ` +
          `(observed_at '${candidate.observed_at}')`,
      });
    }
  }

  let evidenceId: string;
  try {
    evidenceId = buildEvidenceId({
      provider_id: context.provider.provider_id,
      evidence_class: candidate.evidence_class,
      subject_key: candidate.subject_key,
      source_item_id: candidate.source_item_id,
      claim_digest: digest,
    });
  } catch (error) {
    issues.push({
      code: 'invalid_identity_component',
      message: `candidate identity fields must be unambiguous: ${(error as Error).message}`,
    });
    return {
      kind: 'rejected',
      issues,
      referenceId: diagnosticEvidenceReference(
        context.provider.provider_id,
        context.evidenceClass,
        context.subjectKey,
        candidate,
      ),
    };
  }

  const evidence: QualifiedEvidence = {
    evidence_id: evidenceId,
    provider_id: context.provider.provider_id,
    evidence_class: candidate.evidence_class,
    subject_key: candidate.subject_key,
    claim_key: candidate.claim_key,
    claim_value: candidate.claim_value,
    claim_digest: digest,
    source_item_id: candidate.source_item_id,
    source_reference: candidate.source_reference,
    observed_at: candidate.observed_at,
    ...(candidate.source_updated_at !== undefined ? { source_updated_at: candidate.source_updated_at } : {}),
    verification_level: candidate.verification_level,
    qualified_at: context.now.toISOString(),
    ...(candidate.note !== undefined ? { note: candidate.note } : {}),
  };

  return { kind: 'qualified', evidence, stale, issues };
}

function buildRejectedReference(
  candidate: EvidenceCandidate,
  context: QualificationContext,
): string {
  try {
    return buildEvidenceId({
      provider_id: context.provider.provider_id,
      evidence_class: candidate.evidence_class,
      subject_key: candidate.subject_key,
      source_item_id: candidate.source_item_id,
      claim_digest: claimDigest(candidate.claim_value),
    });
  } catch {
    return diagnosticEvidenceReference(
      context.provider.provider_id,
      context.evidenceClass,
      context.subjectKey,
      candidate,
    );
  }
}