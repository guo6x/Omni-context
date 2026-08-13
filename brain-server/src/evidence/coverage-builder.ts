/**
 * Goal24 Checkpoint 6 (Lane A) - EvidenceCoverageSnapshot builder.
 *
 * Builds a machine-readable EvidenceCoverageSnapshot (the CP2.2 wire shape
 * consumed unchanged by assessEvidenceCoverage) from requirements plus
 * provider collection results, applying deterministic qualification,
 * freshness, verification-cap, conflict-partition and collection-bounds
 * rules.
 *
 * Determinism: the same (requirements, providerResults, now, limits) input
 * always produces the same snapshot. Providers are processed in canonical
 * order (priority desc, provider_id asc), conflict partitions use that same
 * order plus lexical evidence ids, and id lists are emitted sorted.
 *
 * Status precedence (fixed semantics):
 *   A. no candidate at all                              -> missing
 *   B. candidates exist but none qualify                -> unverified
 *   C. qualified candidates exist but all are stale     -> stale
 *   D. fresh qualified candidates disagree on a claim   -> conflicted
 *   E. fresh qualified candidates agree                 -> present
 *
 * Stale candidates never override fresh candidates, and rejected candidates
 * can never satisfy a requirement. This module does not decide
 * PROCEED / RETRIEVE_MORE / CLARIFY / DEFER / BLOCK (Lane B).
 */

import {
  EVIDENCE_CLASS_PATTERN,
  EvidenceRequirementSchema,
  type EvidenceRequirement,
  type VerificationRequirement,
} from '../capabilities/contracts.js';
import { z } from 'zod';
import {
  EvidenceCoverageSnapshotSchema,
  type EvidenceCoverageEntry,
  type EvidenceCoverageSnapshot,
} from '../execution/contracts.js';
import {
  buildEvidenceId,
  canonicalJson,
  claimDigest,
  EvidenceCandidateSchema,
  VERIFICATION_RANK,
  type QualifiedEvidence,
} from './model.js';
import {
  EVIDENCE_PROVIDER_OUTCOMES,
  EvidenceProviderDiagnosticSchema,
  EvidenceProviderV1MetadataSchema,
  type EvidenceProviderResult,
  type EvidenceProviderV1Metadata,
} from './provider.js';
import {
  diagnosticEvidenceReference,
  qualifyCandidate,
  type QualificationIssue,
} from './qualification.js';
import { EvidenceError } from './errors.js';

// ---------------------------------------------------------------------------
// Collection bounds
// ---------------------------------------------------------------------------

export interface EvidenceCollectionLimits {
  maxProvidersPerClass: number;
  maxCandidatesPerProviderClass: number;
  maxCandidatesTotal: number;
  maxClaimJsonBytes: number;
  maxDiagnostics: number;
}

export const DEFAULT_EVIDENCE_COLLECTION_LIMITS: EvidenceCollectionLimits = {
  maxProvidersPerClass: 16,
  maxCandidatesPerProviderClass: 100,
  maxCandidatesTotal: 500,
  maxClaimJsonBytes: 16 * 1024,
  maxDiagnostics: 100,
};

const LIMIT_KEYS = [
  'maxProvidersPerClass',
  'maxCandidatesPerProviderClass',
  'maxCandidatesTotal',
  'maxClaimJsonBytes',
  'maxDiagnostics',
] as const;

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

/**
 * Loose structural result shape: candidates are `unknown[]` here because a
 * malformed candidate is a per-candidate qualification rejection (producing
 * status=unverified), not a build failure. `collectFromProvider` already
 * normalizes structurally invalid provider results at the collection edge.
 */
const EvidenceProviderResultShapeSchema = z.strictObject({
  outcome: z.enum(EVIDENCE_PROVIDER_OUTCOMES),
  candidates: z.array(z.unknown()).max(10_000),
  diagnostics: z.array(z.unknown()).max(1000),
});


/** One provider collection for one (class, subject) request. */
export interface ProviderCollectionBatch {
  provider: EvidenceProviderV1Metadata;
  request: { evidence_class: string; subject_key: string };
  result: EvidenceProviderResult;
}

export interface EvidenceBuildDiagnostic {
  code: string;
  message: string;
  evidence_class?: string;
  provider_id?: string;
}

export interface BuildEvidenceCoverageResult {
  snapshot: EvidenceCoverageSnapshot;
  diagnostics: EvidenceBuildDiagnostic[];
  /** True when diagnostics were truncated at limits.maxDiagnostics. */
  diagnostics_truncated: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : 1));
}

function parseNow(now: Date | string): Date {
  if (now instanceof Date) {
    if (!Number.isFinite(now.getTime())) {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', 'now must be a valid date');
    }
    return new Date(now.getTime());
  }
  const millis = Date.parse(now);
  if (!Number.isFinite(millis)) {
    throw new EvidenceError('EVIDENCE_INPUT_INVALID', `now '${now}' is not a parseable timestamp`);
  }
  return new Date(millis);
}

function resolveLimits(partial: Partial<EvidenceCollectionLimits> | undefined): EvidenceCollectionLimits {
  const limits: EvidenceCollectionLimits = { ...DEFAULT_EVIDENCE_COLLECTION_LIMITS };
  if (partial) {
    for (const key of LIMIT_KEYS) {
      const value = partial[key];
      if (value === undefined) continue;
      if (!Number.isInteger(value) || value <= 0) {
        throw new EvidenceError('EVIDENCE_INPUT_INVALID', `collection limit '${key}' must be a positive integer`);
      }
      limits[key] = value;
    }
  }
  return limits;
}

function validateBatches(
  batches: readonly ProviderCollectionBatch[],
): ProviderCollectionBatch[] {
  return batches.map((batch) => {
    const provider = EvidenceProviderV1MetadataSchema.safeParse(batch.provider);
    if (!provider.success) {
      throw new EvidenceError(
        'EVIDENCE_INPUT_INVALID',
        `provider metadata is invalid: ${provider.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    if (!EVIDENCE_CLASS_PATTERN.test(batch.request.evidence_class)) {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', `invalid requested evidence class '${batch.request.evidence_class}'`);
    }
    if (typeof batch.request.subject_key !== 'string' || batch.request.subject_key.trim().length === 0) {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', 'request subject_key must be a non-empty string');
    }
    // Structural result validation only: outcome + array shapes. Candidate
    // payloads are validated one-by-one during qualification so a single
    // malformed candidate rejects just that candidate (unverified), never
    // the whole class build.
    const result = EvidenceProviderResultShapeSchema.safeParse(batch.result);
    if (!result.success) {
      throw new EvidenceError(
        'EVIDENCE_INPUT_INVALID',
        `provider '${provider.data.provider_id}' returned an invalid result shape: ${result.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return { provider: provider.data, request: batch.request, result: result.data };
  });
}

function compareProviders(a: EvidenceProviderV1Metadata, b: EvidenceProviderV1Metadata): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.provider_id < b.provider_id ? -1 : 1;
}

/** Canonical batch order: provider priority desc, then provider_id asc. */
function sortBatches(batches: readonly ProviderCollectionBatch[]): ProviderCollectionBatch[] {
  return [...batches].sort((a, b) => compareProviders(a.provider, b.provider));
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildEvidenceCoverage(
  requirements: readonly EvidenceRequirement[],
  providerResults: readonly ProviderCollectionBatch[],
  now: Date | string,
  options: { limits?: Partial<EvidenceCollectionLimits> } = {},
): BuildEvidenceCoverageResult {
  const requirementParse = EvidenceRequirementSchema.array().safeParse(requirements);
  if (!requirementParse.success) {
    throw new EvidenceError(
      'EVIDENCE_INPUT_INVALID',
      `requirements are invalid: ${requirementParse.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const classIds = requirementParse.data.map((requirement) => requirement.class_id);
  if (new Set(classIds).size !== classIds.length) {
    throw new EvidenceError('EVIDENCE_INPUT_INVALID', 'requirements must be unique by class_id');
  }

  const clock = parseNow(now);
  const limits = resolveLimits(options.limits);
  const batches = validateBatches(providerResults);

  const diagnostics: EvidenceBuildDiagnostic[] = [];
  const entries: EvidenceCoverageEntry[] = [];

  for (const requirement of requirementParse.data) {
    const classId = requirement.class_id;
    const classBatches = sortBatches(
      batches.filter((batch) => batch.request.evidence_class === classId),
    );

    // Deterministic class subject: the first batch (canonical provider
    // order) defines the requested subject; batches for other subjects are
    // reported and their candidates fail subject binding.
    const subjectKey = classBatches.length > 0 ? classBatches[0].request.subject_key : '';
    for (const batch of classBatches) {
      if (batch.request.subject_key !== subjectKey) {
        diagnostics.push({
          code: 'subject_mismatch',
          message:
            `provider '${batch.provider.provider_id}' collected class '${classId}' for subject ` +
            `'${batch.request.subject_key}' but the class subject is '${subjectKey}'`,
          evidence_class: classId,
          provider_id: batch.provider.provider_id,
        });
      }
    }

    // -----------------------------------------------------------------
    // Collection bounds (fail closed, before qualification)
    // -----------------------------------------------------------------
    const limitViolation = findLimitViolation(classId, classBatches, limits);
    if (limitViolation) {
      const entry = limitExceededEntry(classId, subjectKey, classBatches, clock, limitViolation);
      diagnostics.push({
        code: 'EVIDENCE_COLLECTION_LIMIT_EXCEEDED',
        message: `${limitViolation} for evidence class '${classId}'`,
        evidence_class: classId,
      });
      entries.push(entry);
      continue;
    }

    // -----------------------------------------------------------------
    // Qualification
    // -----------------------------------------------------------------
    const qualified: QualifiedEvidence[] = [];
    const rejected: Array<{ issues: QualificationIssue[]; referenceId: string; providerId: string }> = [];

    for (const batch of classBatches) {
      for (const candidate of batch.result.candidates) {
        const qualification = qualifyCandidate(candidate, {
          provider: batch.provider,
          evidenceClass: classId,
          subjectKey,
          requirement,
          now: clock,
        });
        if (qualification.kind === 'qualified') {
          if (!qualified.some((existing) => existing.evidence_id === qualification.evidence.evidence_id)) {
            qualified.push(qualification.evidence);
          }
          if (qualification.stale) {
            for (const issue of qualification.issues) {
              diagnostics.push({
                code: issue.code,
                message: issue.message,
                evidence_class: classId,
                provider_id: batch.provider.provider_id,
              });
            }
          }
        } else {
          rejected.push({
            issues: qualification.issues,
            referenceId: qualification.referenceId,
            providerId: batch.provider.provider_id,
          });
          for (const issue of qualification.issues) {
            diagnostics.push({
              code: issue.code,
              message: issue.message,
              evidence_class: classId,
              provider_id: batch.provider.provider_id,
            });
          }
        }
      }
      if (batch.result.outcome !== 'collected') {
        diagnostics.push({
          code: batch.result.outcome,
          message: `provider '${batch.provider.provider_id}' reported outcome '${batch.result.outcome}' for class '${classId}'`,
          evidence_class: classId,
          provider_id: batch.provider.provider_id,
        });
      }
      for (const providerDiagnostic of batch.result.diagnostics) {
        const parsedDiagnostic = EvidenceProviderDiagnosticSchema.safeParse(providerDiagnostic);
        if (!parsedDiagnostic.success) continue;
        diagnostics.push({
          code: parsedDiagnostic.data.code,
          message: parsedDiagnostic.data.message,
          evidence_class: classId,
          provider_id: batch.provider.provider_id,
        });
      }
    }

    entries.push(
      buildEntry({
        classId,
        qualified,
        rejected,
        batches: classBatches,
        clock,
        requirement,
      }),
    );
  }

  const truncatedDiagnostics = diagnostics.length > limits.maxDiagnostics;
  const finalDiagnostics = truncatedDiagnostics ? diagnostics.slice(0, limits.maxDiagnostics) : diagnostics;

  const snapshot = EvidenceCoverageSnapshotSchema.parse({ entries });

  return {
    snapshot,
    diagnostics: finalDiagnostics,
    diagnostics_truncated: truncatedDiagnostics,
  };
}

function findLimitViolation(
  classId: string,
  batches: readonly ProviderCollectionBatch[],
  limits: EvidenceCollectionLimits,
): string | undefined {
  if (batches.length > limits.maxProvidersPerClass) {
    return `maxProvidersPerClass exceeded (${batches.length} > ${limits.maxProvidersPerClass})`;
  }
  let totalCandidates = 0;
  for (const batch of batches) {
    if (batch.result.candidates.length > limits.maxCandidatesPerProviderClass) {
      return (
        `maxCandidatesPerProviderClass exceeded for provider '${batch.provider.provider_id}' ` +
        `(${batch.result.candidates.length} > ${limits.maxCandidatesPerProviderClass})`
      );
    }
    totalCandidates += batch.result.candidates.length;
  }
  if (totalCandidates > limits.maxCandidatesTotal) {
    return `maxCandidatesTotal exceeded (${totalCandidates} > ${limits.maxCandidatesTotal})`;
  }
  for (const batch of batches) {
    for (const candidate of batch.result.candidates) {
      const parsed = EvidenceCandidateSchema.safeParse(candidate);
      if (!parsed.success) continue;
      const bytes = Buffer.byteLength(canonicalJson(parsed.data.claim_value), 'utf8');
      if (bytes > limits.maxClaimJsonBytes) {
        return `maxClaimJsonBytes exceeded (${bytes} > ${limits.maxClaimJsonBytes})`;
      }
    }
  }
  return undefined;
}

function limitExceededEntry(
  classId: string,
  subjectKey: string,
  batches: readonly ProviderCollectionBatch[],
  clock: Date,
  reason: string,
): EvidenceCoverageEntry {
  const ids: string[] = [];
  for (const batch of batches) {
    for (const candidate of batch.result.candidates) {
      const parsed = EvidenceCandidateSchema.safeParse(candidate);
      if (parsed.success) {
        try {
          ids.push(
            buildEvidenceId({
              provider_id: batch.provider.provider_id,
              evidence_class: parsed.data.evidence_class,
              subject_key: parsed.data.subject_key,
              source_item_id: parsed.data.source_item_id,
              claim_digest: claimDigest(parsed.data.claim_value),
            }),
          );
        } catch {
          ids.push(diagnosticEvidenceReference(batch.provider.provider_id, classId, subjectKey, candidate));
        }
      } else {
        ids.push(diagnosticEvidenceReference(batch.provider.provider_id, classId, subjectKey, candidate));
      }
    }
  }
  if (ids.length === 0) {
    ids.push(diagnosticEvidenceReference('collection-limits', classId, subjectKey, { subject_key: subjectKey }));
  }
  return {
    evidence_class: classId,
    status: 'unverified',
    verification_level: 'none',
    evidence_ids: sortStrings(ids),
    checked_at: clock.toISOString(),
    note: `EVIDENCE_COLLECTION_LIMIT_EXCEEDED: ${reason}`.slice(0, 2000),
  };
}

// ---------------------------------------------------------------------------
// Status construction
// ---------------------------------------------------------------------------

interface EntryInputs {
  requirement: EvidenceRequirement;
  classId: string;
  qualified: QualifiedEvidence[];
  rejected: Array<{ issues: QualificationIssue[]; referenceId: string; providerId: string }>;
  batches: readonly ProviderCollectionBatch[];
  clock: Date;
}

function buildEntry(inputs: EntryInputs): EvidenceCoverageEntry {
  const { requirement, classId, qualified, rejected, clock } = inputs;
  const base = {
    evidence_class: classId,
    checked_at: clock.toISOString(),
  };

  // A. no candidates at all
  if (qualified.length === 0 && rejected.length === 0) {
    return { ...base, status: 'missing', verification_level: 'none', evidence_ids: [] };
  }

  // B. candidates exist but none qualified
  if (qualified.length === 0) {
    const codes = [...new Set(rejected.flatMap((entry) => entry.issues.map((issue) => issue.code)))].sort();
    return {
      ...base,
      status: 'unverified',
      verification_level: 'none',
      evidence_ids: sortStrings(rejected.map((entry) => entry.referenceId)),
      note: `${rejected.length} candidate(s) rejected by qualification: ${codes.join(', ')}`.slice(0, 2000),
    };
  }

  const fresh = qualified.filter((evidence) => !isStale(evidence, requirement, clock));
  const stale = qualified.filter((evidence) => isStale(evidence, requirement, clock));

  // C. all qualified candidates stale
  if (fresh.length === 0) {
    const staleSince = staleSinceTimestamp(stale, requirement, clock);
    return {
      ...base,
      status: 'stale',
      verification_level: highestVerification(stale),
      evidence_ids: sortStrings(stale.map((evidence) => evidence.evidence_id)),
      stale_since: staleSince,
      note: `${stale.length} qualified candidate(s) exceeded freshness_policy`.slice(0, 2000),
    };
  }

  // D/E. fresh candidates: agree -> present, disagree -> conflicted
  const priorityByProvider = new Map<string, number>(
    inputs.batches.map((batch) => [batch.provider.provider_id, batch.provider.priority]),
  );
  const byClaimKey = groupByClaimKey(fresh);
  const conflictedKeys = [...byClaimKey.keys()]
    .filter((claimKey) => {
      const digests = new Set((byClaimKey.get(claimKey) ?? []).map((evidence) => evidence.claim_digest));
      return digests.size > 1;
    })
    .sort();

  if (conflictedKeys.length > 0) {
    const agreeingIds: string[] = [];
    const conflictingIds: string[] = [];
    for (const [, candidates] of byClaimKey) {
      const primary = pickPrimary(candidates, priorityByProvider);
      for (const candidate of candidates) {
        if (candidate.claim_digest === primary.claim_digest) {
          agreeingIds.push(candidate.evidence_id);
        } else {
          conflictingIds.push(candidate.evidence_id);
        }
      }
    }
    const agreeing = fresh.filter((evidence) => agreeingIds.includes(evidence.evidence_id));
    return {
      ...base,
      status: 'conflicted',
      verification_level: highestVerification(agreeing),
      evidence_ids: sortStrings(agreeingIds),
      conflict_evidence_ids: sortStrings(conflictingIds),
      note: `conflicted claim_key(s) for class ${classId}: ${conflictedKeys.length} of ${byClaimKey.size} claim keys disagree`.slice(0, 2000),
    };
  }

  return {
    ...base,
    status: 'present',
    verification_level: highestVerification(fresh),
    evidence_ids: sortStrings(fresh.map((evidence) => evidence.evidence_id)),
  };
}

function isStale(evidence: QualifiedEvidence, requirement: EvidenceRequirement, clock: Date): boolean {
  if (!requirement.freshness_policy) return false;
  const observedAt = Date.parse(evidence.observed_at);
  const ageMs = clock.getTime() - observedAt;
  return ageMs > requirement.freshness_policy.max_age_ms;
}

function staleSinceTimestamp(
  stale: QualifiedEvidence[],
  requirement: EvidenceRequirement,
  clock: Date,
): string {
  let earliest = Number.POSITIVE_INFINITY;
  for (const evidence of stale) {
    if (!requirement.freshness_policy) break;
    const observedAt = Date.parse(evidence.observed_at);
    const becameStaleAt = observedAt + requirement.freshness_policy.max_age_ms;
    if (becameStaleAt < earliest) earliest = becameStaleAt;
  }
  return new Date(Number.isFinite(earliest) ? earliest : clock.getTime()).toISOString();
}

function highestVerification(evidence: QualifiedEvidence[]): VerificationRequirement {
  let best: VerificationRequirement = 'none';
  for (const item of evidence) {
    if (VERIFICATION_RANK[item.verification_level] > VERIFICATION_RANK[best]) {
      best = item.verification_level;
    }
  }
  return best;
}

function groupByClaimKey(evidence: QualifiedEvidence[]): Map<string, QualifiedEvidence[]> {
  const grouped = new Map<string, QualifiedEvidence[]>();
  for (const item of evidence) {
    const list = grouped.get(item.claim_key);
    if (list) {
      list.push(item);
    } else {
      grouped.set(item.claim_key, [item]);
    }
  }
  return grouped;
}

function pickPrimary(
  candidates: QualifiedEvidence[],
  priorityByProvider: Map<string, number>,
): QualifiedEvidence {
  return [...candidates].sort((a, b) => {
    const priorityA = priorityByProvider.get(a.provider_id) ?? 0;
    const priorityB = priorityByProvider.get(b.provider_id) ?? 0;
    if (priorityA !== priorityB) return priorityB - priorityA;
    return a.evidence_id < b.evidence_id ? -1 : 1;
  })[0];
}