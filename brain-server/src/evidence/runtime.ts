/**
 * Goal24 Checkpoint 6 (Integration) - Evidence Surface Runtime.
 *
 * This is the CP6 production trust boundary for evidence:
 *
 *   capability (trusted lookup) -> requirements
 *        -> subject binding (trusted resolver, from normalized inputs)
 *        -> trusted provider registry selection (caller can never choose)
 *        -> Lane A collection + qualification (trusted clock, never request
 *           time) -> coverage snapshot -> Lane B Guard -> GuardRunRecord
 *
 * The request surface is deliberately tiny:
 *
 *   evaluateForCapability({ capability_id, capability_version,
 *     normalized_inputs, correlation_id? })
 *
 * Nothing else is accepted. requirements, coverage, initial_coverage,
 * provider ids, verification_level, conflict_policy, now, checked_at and
 * evidence_ids are NOT request fields - a request carrying any of them is
 * rejected by the strict schema. Callers therefore cannot:
 * - pass requirements=[] to get PROCEED,
 * - seed fake initial coverage,
 * - select providers,
 * - move the clock into the future.
 *
 * The returned receipt is an EvidenceSurfaceEvaluation (guard_run_id + action
 * + digests). It is NOT an approval token and NOT execution authority; the
 * authoritative record lives in the server-owned GuardRunStore, and only
 * EvidenceEligibilityService may materialize executable-plan coverage from it.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  CAPABILITY_ID_PATTERN,
  SEMVER_PATTERN,
  type CapabilityDefinition,
  type EvidenceRequirement,
} from '../capabilities/contracts.js';
import { JsonObjectSchema } from '../contracts/json-safe.js';
import {
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
  assessEvidenceCoverage,
  type CoverageAssessment,
  type EvidenceCoverageSnapshot,
} from '../execution/contracts.js';
import {
  buildEvidenceCoverage,
  DEFAULT_EVIDENCE_COLLECTION_LIMITS,
  type BuildEvidenceCoverageResult,
  type EvidenceCollectionLimits,
  type ProviderCollectionBatch,
} from './coverage-builder.js';
import { coverageDigest, normalizedInputsDigest, requirementsDigest } from './digests.js';
import { EvidenceError } from './errors.js';
import { runEvidenceGuard } from './guard.js';
import {
  MAX_RETRIEVAL_ROUNDS,
  type ClarificationNeed,
  type CollectCoverage,
  type EvidenceGuardResult,
  type GuardAction,
  type GuardReasonCode,
  type ProviderOutcome,
} from './guard-types.js';
import {
  collectFromProvider,
  type EvidenceProviderResult,
  type EvidenceProviderV1,
} from './provider.js';
import { EvidenceProviderRegistry } from './provider-registry.js';
import {
  qualifyCandidate,
  type CandidateQualification,
} from './qualification.js';
import {
  GuardRunStore,
  QualifiedEvidenceStore,
  type EvidenceGuardRunRecord,
  type QualifiedEvidenceRecord,
} from './stores.js';
import { CapabilityEvidenceSubjectResolverRegistry } from './subject.js';

// ---------------------------------------------------------------------------
// Request schema (the only public evaluation input shape)
// ---------------------------------------------------------------------------

export const MAX_NORMALIZED_INPUT_KEYS = 100;
export const MAX_NORMALIZED_INPUT_BYTES = 64 * 1024;

export const EvaluateForCapabilityRequestSchema = z
  .strictObject({
    capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability_id must be a dotted identifier'),
    capability_version: z.string().regex(SEMVER_PATTERN, 'capability_version must be semantic (major.minor.patch)'),
    normalized_inputs: JsonObjectSchema,
    correlation_id: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((request, ctx) => {
    const keys = Object.keys(request.normalized_inputs);
    if (keys.length > MAX_NORMALIZED_INPUT_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `normalized_inputs must not exceed ${MAX_NORMALIZED_INPUT_KEYS} keys`,
        path: ['normalized_inputs'],
      });
    }
    if (JSON.stringify(request.normalized_inputs).length > MAX_NORMALIZED_INPUT_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `normalized_inputs must not exceed ${MAX_NORMALIZED_INPUT_BYTES} bytes serialized`,
        path: ['normalized_inputs'],
      });
    }
  });
export type EvaluateForCapabilityRequest = z.infer<typeof EvaluateForCapabilityRequestSchema>;

// ---------------------------------------------------------------------------
// Runtime options
// ---------------------------------------------------------------------------

export const DEFAULT_EVIDENCE_MAX_RETRIEVAL_ROUNDS = 3;
export const DEFAULT_EVIDENCE_PER_ROUND_TIMEOUT_MS = 5000;

export interface EvidenceSurfaceRuntimeOptions {
  /** Trusted capability catalog lookup (id -> definition). Caller-overridable requirements do not exist. */
  capabilityLookup: (capabilityId: string) => CapabilityDefinition | undefined;
  /** Trusted, internal-only provider registry. */
  providers: EvidenceProviderRegistry;
  /** Trusted subject resolver registry. */
  subjectResolvers: CapabilityEvidenceSubjectResolverRegistry;
  /** Trusted clock; defaults to the system clock. Requests can never inject time. */
  clock?: () => Date;
  limits?: Partial<EvidenceCollectionLimits>;
  /** Bounded retrieval budget (0..10). */
  maxRetrievalRounds?: number;
  /** Per-round timeout (TIMEOUT_MIN_MS..TIMEOUT_MAX_MS). */
  perRoundTimeoutMs?: number;
  guardRunStore?: GuardRunStore;
  qualifiedEvidenceStore?: QualifiedEvidenceStore;
}

export interface EvidenceSurfaceEvaluation {
  guard_run_id: string;
  capability_id: string;
  capability_version: string;
  subject_key: string;
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
  aborted: boolean;
  correlation_id: string | null;
  requirements_digest: string;
  normalized_inputs_digest: string;
  coverage_digest: string;
  qualified_evidence_ids: string[];
  started_at: string;
  finished_at: string;
}

function optionsError(message: string): EvidenceError {
  return new EvidenceError('EVIDENCE_INPUT_INVALID', message);
}

/**
 * Production Evidence Surface Runtime (CP6 V1).
 *
 * All inputs on the right-hand side of the trust boundary are server-owned:
 * capability policy, subject binding, provider selection, clock and the
 * guard-run ledger. The only caller-supplied values are capability identity
 * and normalized inputs.
 */
export class EvidenceSurfaceRuntime {
  private readonly capabilityLookup: (capabilityId: string) => CapabilityDefinition | undefined;
  private readonly providers: EvidenceProviderRegistry;
  private readonly subjectResolvers: CapabilityEvidenceSubjectResolverRegistry;
  private readonly clock: () => Date;
  private readonly limits: EvidenceCollectionLimits;
  private readonly maxRetrievalRounds: number;
  private readonly perRoundTimeoutMs: number;
  private readonly guardRunStore: GuardRunStore;
  private readonly qualifiedEvidenceStore: QualifiedEvidenceStore;

  constructor(options: EvidenceSurfaceRuntimeOptions) {
    if (typeof options.capabilityLookup !== 'function') {
      throw optionsError('capabilityLookup must be a function');
    }
    if (!(options.providers instanceof EvidenceProviderRegistry)) {
      throw optionsError('providers must be an EvidenceProviderRegistry');
    }
    if (!(options.subjectResolvers instanceof CapabilityEvidenceSubjectResolverRegistry)) {
      throw optionsError('subjectResolvers must be a CapabilityEvidenceSubjectResolverRegistry');
    }
    this.capabilityLookup = options.capabilityLookup;
    this.providers = options.providers;
    this.subjectResolvers = options.subjectResolvers;
    this.clock = options.clock ?? (() => new Date());
    if (typeof this.clock !== 'function') throw optionsError('clock must be a function');

    this.limits = { ...DEFAULT_EVIDENCE_COLLECTION_LIMITS };
    for (const [key, value] of Object.entries(options.limits ?? {}) as [keyof EvidenceCollectionLimits, number][]) {
      if (value === undefined) continue;
      if (!Number.isInteger(value) || value <= 0) {
        throw optionsError(`collection limit '${key}' must be a positive integer`);
      }
      this.limits[key] = value;
    }

    const maxRounds = options.maxRetrievalRounds ?? DEFAULT_EVIDENCE_MAX_RETRIEVAL_ROUNDS;
    if (!Number.isInteger(maxRounds) || maxRounds < 0 || maxRounds > MAX_RETRIEVAL_ROUNDS) {
      throw optionsError(`maxRetrievalRounds must be an integer in 0..${MAX_RETRIEVAL_ROUNDS}`);
    }
    this.maxRetrievalRounds = maxRounds;

    const perRoundTimeoutMs = options.perRoundTimeoutMs ?? DEFAULT_EVIDENCE_PER_ROUND_TIMEOUT_MS;
    if (!Number.isInteger(perRoundTimeoutMs) || perRoundTimeoutMs < TIMEOUT_MIN_MS || perRoundTimeoutMs > TIMEOUT_MAX_MS) {
      throw optionsError(`perRoundTimeoutMs must be an integer in ${TIMEOUT_MIN_MS}..${TIMEOUT_MAX_MS}`);
    }
    this.perRoundTimeoutMs = perRoundTimeoutMs;

    this.guardRunStore = options.guardRunStore ?? new GuardRunStore();
    this.qualifiedEvidenceStore = options.qualifiedEvidenceStore ?? new QualifiedEvidenceStore();
  }

  // -------------------------------------------------------------------------
  // Trusted collection + qualification (never caller-selectable)
  // -------------------------------------------------------------------------

  private requirementForClass(requirements: readonly EvidenceRequirement[], classId: string): EvidenceRequirement | undefined {
    return requirements.find((requirement) => requirement.class_id === classId);
  }

  private recordQualified(qualification: CandidateQualification, provider: EvidenceProviderV1): void {
    if (qualification.kind !== 'qualified') return;
    const evidence = qualification.evidence;
    const record: QualifiedEvidenceRecord = {
      evidence_id: evidence.evidence_id,
      provider_id: evidence.provider_id,
      provider_version: provider.metadata.version,
      evidence_class: evidence.evidence_class,
      subject_key: evidence.subject_key,
      claim_key: evidence.claim_key,
      claim_digest: evidence.claim_digest,
      observed_at: evidence.observed_at,
      verification_level: evidence.verification_level,
      qualification_outcome: 'qualified',
      source_item_id: evidence.source_item_id,
      source_reference: evidence.source_reference,
      qualified_at: evidence.qualified_at,
    };
    this.qualifiedEvidenceStore.put(record);
  }

  private providerOutcomeKind(result: EvidenceProviderResult): ProviderOutcome['kind'] {
    if (result.diagnostics.some((diagnostic) => diagnostic.code === 'EVIDENCE_PROVIDER_ERROR')) {
      return 'provider_error';
    }
    switch (result.outcome) {
      case 'collected':
        return 'collected';
      case 'not_found':
        return 'not_found';
      case 'temporary_unavailable':
        return 'temporary_unavailable';
      case 'permanent_unavailable':
        return 'permanent_unavailable';
      case 'user_context_required':
        return 'user_context_required';
    }
  }

  private outcomeNote(kind: ProviderOutcome['kind']): string {
    switch (kind) {
      case 'temporary_unavailable':
        return 'temporary provider unavailability (retry bounded by guard rounds)';
      case 'provider_error':
        return 'provider collection failed; details withheld';
      case 'permanent_unavailable':
        return 'no trusted provider can serve this class';
      case 'user_context_required':
        return 'provider requires user-supplied context';
      case 'collection_limit_exceeded':
        return 'evidence collection bounds exceeded';
      default:
        return 'provider outcome recorded';
    }
  }

  private async collectClass(
    classId: string,
    subjectKey: string,
    signal: AbortSignal | undefined,
    requirements: readonly EvidenceRequirement[],
  ): Promise<{ batches: ProviderCollectionBatch[]; outcomes: ProviderOutcome[] }> {
    const providers = this.providers.providersForClass(classId);
    if (providers.length === 0) {
      return {
        batches: [],
        outcomes: [
          {
            evidence_class: classId,
            kind: 'permanent_unavailable',
            retryable: false,
            alternate_provider_available: false,
            note: this.outcomeNote('permanent_unavailable'),
          },
        ],
      };
    }

    const batches: ProviderCollectionBatch[] = [];
    const outcomes: ProviderOutcome[] = [];
    const requirement = this.requirementForClass(requirements, classId);
    const now = this.clock();

    for (const provider of providers) {
      const result = await collectFromProvider(provider, { evidence_class: classId, subject_key: subjectKey, signal });
      batches.push({ provider: provider.metadata, request: { evidence_class: classId, subject_key: subjectKey }, result });
      const kind = this.providerOutcomeKind(result);
      outcomes.push({
        evidence_class: classId,
        kind,
        retryable: kind === 'temporary_unavailable' || kind === 'provider_error',
        alternate_provider_available: false,
        note: this.outcomeNote(kind),
      });

      // Populate the server-owned qualified evidence ledger. A full store is
      // a fail-closed collection limit, surfaced as a structured outcome.
      for (const rawCandidate of result.candidates) {
        const qualification = qualifyCandidate(rawCandidate, {
          provider: provider.metadata,
          evidenceClass: classId,
          subjectKey,
          requirement,
          now,
        });
        try {
          this.recordQualified(qualification, provider);
        } catch (error) {
          if (error instanceof EvidenceError && error.code === 'EVIDENCE_COLLECTION_LIMIT_EXCEEDED') {
            outcomes.push({
              evidence_class: classId,
              kind: 'collection_limit_exceeded',
              retryable: false,
              alternate_provider_available: false,
              note: this.outcomeNote('collection_limit_exceeded'),
            });
            break;
          }
          throw error;
        }
      }
    }
    return { batches, outcomes };
  }

  private limitOutcomesFromBuild(build: BuildEvidenceCoverageResult): ProviderOutcome[] {
    const limited = new Set<string>();
    for (const diagnostic of build.diagnostics) {
      if (diagnostic.code === 'EVIDENCE_COLLECTION_LIMIT_EXCEEDED' && diagnostic.evidence_class) {
        limited.add(diagnostic.evidence_class);
      }
    }
    return [...limited].sort().map((evidenceClass) => ({
      evidence_class: evidenceClass,
      kind: 'collection_limit_exceeded' as const,
      retryable: false,
      alternate_provider_available: false,
      note: this.outcomeNote('collection_limit_exceeded'),
    }));
  }

  // -------------------------------------------------------------------------
  // Public evaluation
  // -------------------------------------------------------------------------

  async evaluateForCapability(rawRequest: unknown, signal?: AbortSignal): Promise<EvidenceSurfaceEvaluation> {
    const parsed = EvaluateForCapabilityRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new EvidenceError(
        'EVIDENCE_INPUT_INVALID',
        `invalid evaluateForCapability request: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const request: EvaluateForCapabilityRequest = parsed.data;

    const capability = this.capabilityLookup(request.capability_id);
    if (!capability) {
      throw new EvidenceError(
        'EVIDENCE_CAPABILITY_NOT_FOUND',
        `capability '${request.capability_id}' not found in the trusted catalog`,
      );
    }
    if (capability.version !== request.capability_version) {
      throw new EvidenceError(
        'EVIDENCE_CAPABILITY_VERSION_MISMATCH',
        `requested capability_version '${request.capability_version}' does not match trusted version '${capability.version}'`,
      );
    }

    const requirements = capability.required_evidence;
    const subjectKey = this.subjectResolvers.resolve(request.capability_id, request.normalized_inputs);
    const requirementsDigestValue = requirementsDigest(requirements);
    const inputsDigest = normalizedInputsDigest(request.normalized_inputs);
    const startedAt = this.clock().toISOString();

    // Initial coverage is produced exclusively by trusted providers ->
    // Lane A qualification -> coverage builder. No caller-supplied coverage
    // or requirements exist on this path.
    const latestBatches = new Map<string, ProviderCollectionBatch[]>();
    const initialOutcomes: ProviderOutcome[] = [];
    try {
      for (const requirement of requirements) {
        const collected = await this.collectClass(requirement.class_id, subjectKey, signal, requirements);
        latestBatches.set(requirement.class_id, collected.batches);
        initialOutcomes.push(...collected.outcomes);
      }
    } catch (error) {
      if (error instanceof EvidenceError && error.code === 'EVIDENCE_COLLECTION_ABORTED') {
        return this.abortedEvaluation(request, subjectKey, requirementsDigestValue, inputsDigest, startedAt);
      }
      return this.failClosedEvaluation(request, subjectKey, requirementsDigestValue, inputsDigest, startedAt, error);
    }

    let initialCoverage: EvidenceCoverageSnapshot;
    try {
      initialCoverage = buildEvidenceCoverage(
        requirements,
        [...latestBatches.values()].flat(),
        this.clock(),
        { limits: this.limits },
      ).snapshot;
    } catch (error) {
      return this.failClosedEvaluation(request, subjectKey, requirementsDigestValue, inputsDigest, startedAt, error);
    }

    const collectCoverage: CollectCoverage = async (params) => {
      const roundOutcomes: ProviderOutcome[] = [];
      for (const classId of params.requestedClasses) {
        let collected;
        try {
          collected = await this.collectClass(classId, subjectKey, params.signal, requirements);
        } catch (error) {
          if (error instanceof EvidenceError && error.code === 'EVIDENCE_COLLECTION_ABORTED') {
            throw new DOMException('evidence collection aborted', 'AbortError');
          }
          throw error;
        }
        latestBatches.set(classId, collected.batches);
        roundOutcomes.push(...collected.outcomes);
      }
      const build: BuildEvidenceCoverageResult = buildEvidenceCoverage(
        requirements,
        [...latestBatches.values()].flat(),
        this.clock(),
        { limits: this.limits },
      );
      roundOutcomes.push(...this.limitOutcomesFromBuild(build));
      return { coverage: build.snapshot, outcomes: roundOutcomes };
    };

    const guardRequest = {
      requirements,
      initial_coverage: initialCoverage,
      max_retrieval_rounds: this.maxRetrievalRounds,
      per_round_timeout_ms: this.perRoundTimeoutMs,
      ...(request.correlation_id !== undefined ? { correlation_id: request.correlation_id } : {}),
    };

    let guardResult: EvidenceGuardResult;
    try {
      guardResult = await runEvidenceGuard({ ...guardRequest, signal }, collectCoverage);
    } catch (error) {
      return this.failClosedEvaluation(request, subjectKey, requirementsDigestValue, inputsDigest, startedAt, error);
    }

    const finishedAt = this.clock().toISOString();
    const coverageDigestValue = coverageDigest(guardResult.final_coverage);
    const qualifiedIds = collectCoverageIds(guardResult.final_coverage);

    const record: EvidenceGuardRunRecord = {
      guard_run_id: randomUUID(),
      capability_id: request.capability_id,
      capability_version: request.capability_version,
      subject_key: subjectKey,
      normalized_inputs_digest: inputsDigest,
      requirements_digest: requirementsDigestValue,
      started_at: startedAt,
      finished_at: finishedAt,
      final_action: guardResult.action,
      final_coverage: guardResult.final_coverage,
      coverage_digest: coverageDigestValue,
      qualified_evidence_ids: qualifiedIds,
      rounds_used: guardResult.rounds_used,
      reason_codes: guardResult.reason_codes,
      provider_outcomes: [...initialOutcomes, ...guardResult.provider_outcomes],
      warnings: guardResult.warnings,
      non_blocking_findings: guardResult.non_blocking_findings,
      clarification_needs: guardResult.clarification_needs,
      aborted: guardResult.aborted,
      correlation_id: guardResult.correlation_id,
    };
    this.guardRunStore.put(record);

    return {
      guard_run_id: record.guard_run_id,
      capability_id: request.capability_id,
      capability_version: request.capability_version,
      subject_key: subjectKey,
      action: guardResult.action,
      rounds_used: guardResult.rounds_used,
      final_coverage: guardResult.final_coverage,
      final_assessment: guardResult.final_assessment,
      requested_classes: guardResult.requested_classes,
      remaining_mandatory: guardResult.remaining_mandatory,
      reason_codes: guardResult.reason_codes,
      provider_outcomes: [...initialOutcomes, ...guardResult.provider_outcomes],
      warnings: guardResult.warnings,
      non_blocking_findings: guardResult.non_blocking_findings,
      clarification_needs: guardResult.clarification_needs,
      aborted: guardResult.aborted,
      correlation_id: guardResult.correlation_id,
      requirements_digest: requirementsDigestValue,
      normalized_inputs_digest: inputsDigest,
      coverage_digest: coverageDigestValue,
      qualified_evidence_ids: qualifiedIds,
      started_at: startedAt,
      finished_at: finishedAt,
    };
  }

  private abortedEvaluation(
    request: EvaluateForCapabilityRequest,
    subjectKey: string,
    requirementsDigestValue: string,
    inputsDigest: string,
    startedAt: string,
  ): EvidenceSurfaceEvaluation {
    const emptyCoverage: EvidenceCoverageSnapshot = { entries: [] };
    const finishedAt = this.clock().toISOString();
    const coverageDigestValue = coverageDigest(emptyCoverage);
    const record: EvidenceGuardRunRecord = {
      guard_run_id: randomUUID(),
      capability_id: request.capability_id,
      capability_version: request.capability_version,
      subject_key: subjectKey,
      normalized_inputs_digest: inputsDigest,
      requirements_digest: requirementsDigestValue,
      started_at: startedAt,
      finished_at: finishedAt,
      final_action: 'defer',
      final_coverage: emptyCoverage,
      coverage_digest: coverageDigestValue,
      qualified_evidence_ids: [],
      rounds_used: 0,
      reason_codes: ['GUARD_ABORTED'],
      provider_outcomes: [],
      warnings: [],
      non_blocking_findings: [],
      clarification_needs: [],
      aborted: true,
      correlation_id: request.correlation_id ?? null,
    };
    this.guardRunStore.put(record);
    const requirements = this.requirementsOf(request);
    return {
      guard_run_id: record.guard_run_id,
      capability_id: request.capability_id,
      capability_version: request.capability_version,
      subject_key: subjectKey,
      action: 'defer',
      rounds_used: 0,
      final_coverage: emptyCoverage,
      final_assessment: assessEvidenceCoverage(requirements, emptyCoverage),
      requested_classes: [],
      remaining_mandatory: requirements.filter((requirement) => requirement.mandatory).map((requirement) => requirement.class_id).sort(),
      reason_codes: ['GUARD_ABORTED'],
      provider_outcomes: [],
      warnings: [],
      non_blocking_findings: [],
      clarification_needs: [],
      aborted: true,
      correlation_id: request.correlation_id ?? null,
      requirements_digest: requirementsDigestValue,
      normalized_inputs_digest: inputsDigest,
      coverage_digest: coverageDigestValue,
      qualified_evidence_ids: [],
      started_at: startedAt,
      finished_at: finishedAt,
    };
  }

  private failClosedEvaluation(
    request: EvaluateForCapabilityRequest,
    subjectKey: string,
    requirementsDigestValue: string,
    inputsDigest: string,
    startedAt: string,
    error: unknown,
  ): EvidenceSurfaceEvaluation {
    const emptyCoverage: EvidenceCoverageSnapshot = { entries: [] };
    const finishedAt = this.clock().toISOString();
    const coverageDigestValue = coverageDigest(emptyCoverage);
    const reasonCode: GuardReasonCode =
      error instanceof EvidenceError && error.code === 'EVIDENCE_COLLECTION_LIMIT_EXCEEDED'
        ? 'COLLECTION_LIMIT_EXCEEDED'
        : 'PROVIDER_ERROR';
    const record: EvidenceGuardRunRecord = {
      guard_run_id: randomUUID(),
      capability_id: request.capability_id,
      capability_version: request.capability_version,
      subject_key: subjectKey,
      normalized_inputs_digest: inputsDigest,
      requirements_digest: requirementsDigestValue,
      started_at: startedAt,
      finished_at: finishedAt,
      final_action: 'block',
      final_coverage: emptyCoverage,
      coverage_digest: coverageDigestValue,
      qualified_evidence_ids: [],
      rounds_used: 0,
      reason_codes: [reasonCode],
      provider_outcomes: [],
      warnings: [],
      non_blocking_findings: [],
      clarification_needs: [],
      aborted: false,
      correlation_id: request.correlation_id ?? null,
    };
    this.guardRunStore.put(record);
    return {
      guard_run_id: record.guard_run_id,
      capability_id: request.capability_id,
      capability_version: request.capability_version,
      subject_key: subjectKey,
      action: 'block',
      rounds_used: 0,
      final_coverage: emptyCoverage,
      final_assessment: assessEvidenceCoverage(this.requirementsOf(request), emptyCoverage),
      requested_classes: [],
      remaining_mandatory: this.requirementsOf(request).filter((requirement) => requirement.mandatory).map((requirement) => requirement.class_id).sort(),
      reason_codes: [reasonCode],
      provider_outcomes: [],
      warnings: [],
      non_blocking_findings: [],
      clarification_needs: [],
      aborted: false,
      correlation_id: request.correlation_id ?? null,
      requirements_digest: requirementsDigestValue,
      normalized_inputs_digest: inputsDigest,
      coverage_digest: coverageDigestValue,
      qualified_evidence_ids: [],
      started_at: startedAt,
      finished_at: finishedAt,
    };
  }

  private requirementsOf(request: EvaluateForCapabilityRequest): EvidenceRequirement[] {
    const capability = this.capabilityLookup(request.capability_id);
    return capability?.required_evidence ?? [];
  }
}

/** Sorted unique evidence ids (plus conflict ids) referenced by final coverage. */
export function collectCoverageIds(coverage: EvidenceCoverageSnapshot): string[] {
  const ids = new Set<string>();
  for (const entry of coverage.entries) {
    for (const id of entry.evidence_ids) ids.add(id);
    for (const id of entry.conflict_evidence_ids ?? []) ids.add(id);
  }
  return [...ids].sort();
}
