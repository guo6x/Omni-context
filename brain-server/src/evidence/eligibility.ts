/**
 * Goal24 Checkpoint 6 (Integration) - Evidence Eligibility Service.
 *
 * The ONLY way a caller can obtain authoritative coverage for a future
 * executable ExecutionPlan. Callers pass:
 *
 *   { guard_run_id, capability_id, capability_version, normalized_inputs }
 *
 * and never a coverage snapshot. The service re-validates the server-owned
 * GuardRunRecord end to end:
 *
 *   1. the guard run exists in the server-owned store,
 *   2. its final_action was 'proceed',
 *   3. capability identity/version match the request and the current catalog,
 *   4. the current capability still exists,
 *   5. the current requirements digest equals the run's requirements digest,
 *   6. the normalized-inputs digest matches,
 *   7. the trusted subject resolver output matches the run subject,
 *   8. the coverage digest recomputes to the recorded value,
 *   9. every referenced evidence id traces to a run-qualified record,
 *  10. assessEvidenceCoverage still reports mandatory_satisfied=true.
 *
 * The returned EvidenceEligibilityRecord is coverage + lineage, NOT an
 * approval token, NOT execution authority, and NOT a plan-state transition
 * (Checkpoint 7 concerns). A caller-constructed digest or a forged snapshot
 * proves nothing: authority lives in the server-owned store.
 */

import { z } from 'zod';
import {
  CAPABILITY_ID_PATTERN,
  SEMVER_PATTERN,
  type CapabilityDefinition,
} from '../capabilities/contracts.js';
import { JsonObjectSchema, type JsonObject } from '../contracts/json-safe.js';
import {
  assessEvidenceCoverage,
  type CoverageAssessment,
  type EvidenceCoverageSnapshot,
} from '../execution/contracts.js';
import { coverageDigest, normalizedInputsDigest, requirementsDigest } from './digests.js';
import { EvidenceError } from './errors.js';
import { GuardRunStore, QualifiedEvidenceStore, type EvidenceGuardRunRecord } from './stores.js';
import { CapabilityEvidenceSubjectResolverRegistry } from './subject.js';

export const MaterializeEvidenceRequestSchema = z.strictObject({
  guard_run_id: z.string().trim().min(1).max(200),
  capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability_id must be a dotted identifier'),
  capability_version: z.string().regex(SEMVER_PATTERN, 'capability_version must be semantic (major.minor.patch)'),
  normalized_inputs: JsonObjectSchema,
});
export type MaterializeEvidenceRequest = z.infer<typeof MaterializeEvidenceRequestSchema>;

export interface EvidenceEligibilityRecord {
  eligibility: 'eligible';
  guard_run_id: string;
  capability_id: string;
  capability_version: string;
  subject_key: string;
  /** Authoritative coverage from the server-owned guard run (never caller-supplied). */
  authoritative_coverage: EvidenceCoverageSnapshot;
  final_assessment: CoverageAssessment;
  requirements_digest: string;
  normalized_inputs_digest: string;
  coverage_digest: string;
  qualified_evidence_ids: string[];
  materialized_at: string;
}

export interface EvidenceEligibilityServiceOptions {
  guardRunStore: GuardRunStore;
  qualifiedEvidenceStore: QualifiedEvidenceStore;
  capabilityLookup: (capabilityId: string) => CapabilityDefinition | undefined;
  subjectResolvers: CapabilityEvidenceSubjectResolverRegistry;
  /** Trusted clock for the materialization timestamp; defaults to system clock. */
  clock?: () => Date;
}

/**
 * Materialize executable-plan evidence eligibility from a server-owned guard
 * run. Fail-closed on every mismatch; see the module header for the checks.
 */
export class EvidenceEligibilityService {
  private readonly guardRunStore: GuardRunStore;
  private readonly qualifiedEvidenceStore: QualifiedEvidenceStore;
  private readonly capabilityLookup: (capabilityId: string) => CapabilityDefinition | undefined;
  private readonly subjectResolvers: CapabilityEvidenceSubjectResolverRegistry;
  private readonly clock: () => Date;

  constructor(options: EvidenceEligibilityServiceOptions) {
    if (!(options.guardRunStore instanceof GuardRunStore)) {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', 'guardRunStore must be a GuardRunStore');
    }
    if (!(options.qualifiedEvidenceStore instanceof QualifiedEvidenceStore)) {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', 'qualifiedEvidenceStore must be a QualifiedEvidenceStore');
    }
    if (typeof options.capabilityLookup !== 'function') {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', 'capabilityLookup must be a function');
    }
    if (!(options.subjectResolvers instanceof CapabilityEvidenceSubjectResolverRegistry)) {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', 'subjectResolvers must be a CapabilityEvidenceSubjectResolverRegistry');
    }
    this.guardRunStore = options.guardRunStore;
    this.qualifiedEvidenceStore = options.qualifiedEvidenceStore;
    this.capabilityLookup = options.capabilityLookup;
    this.subjectResolvers = options.subjectResolvers;
    this.clock = options.clock ?? (() => new Date());
  }

  materializeEvidenceForExecutablePlan(rawRequest: unknown): EvidenceEligibilityRecord {
    const parsed = MaterializeEvidenceRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new EvidenceError(
        'EVIDENCE_INPUT_INVALID',
        `invalid materializeEvidenceForExecutablePlan request: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const request: MaterializeEvidenceRequest = parsed.data;

    // 1. server-owned guard run exists (restart-invalidated / evicted runs fail here)
    const run: EvidenceGuardRunRecord | undefined = this.guardRunStore.get(request.guard_run_id);
    if (!run) {
      throw new EvidenceError(
        'EVIDENCE_GUARD_RUN_NOT_FOUND',
        `guard run '${request.guard_run_id}' does not exist in the server-owned store`,
      );
    }

    // 2. only proceed runs are evidence-eligible
    if (run.final_action !== 'proceed') {
      throw new EvidenceError(
        'EVIDENCE_GUARD_RUN_NOT_PROCEED',
        `guard run '${request.guard_run_id}' ended with action '${run.final_action}'; only proceed is evidence-eligible`,
      );
    }

    // 3. capability identity/version binding
    if (run.capability_id !== request.capability_id || run.capability_version !== request.capability_version) {
      throw new EvidenceError(
        'EVIDENCE_CAPABILITY_VERSION_MISMATCH',
        `guard run capability '${run.capability_id}@${run.capability_version}' does not match request '${request.capability_id}@${request.capability_version}'`,
      );
    }

    // 4/5. current capability still exists and policy is unchanged
    const capability = this.capabilityLookup(request.capability_id);
    if (!capability) {
      throw new EvidenceError(
        'EVIDENCE_CAPABILITY_NOT_FOUND',
        `capability '${request.capability_id}' no longer exists in the trusted catalog`,
      );
    }
    if (capability.version !== request.capability_version || capability.version !== run.capability_version) {
      throw new EvidenceError(
        'EVIDENCE_CAPABILITY_VERSION_MISMATCH',
        `capability version '${capability.version}' does not match request '${request.capability_version}' or guard run '${run.capability_version}'`,
      );
    }
    const currentRequirementsDigest = requirementsDigest(capability.required_evidence);
    if (currentRequirementsDigest !== run.requirements_digest) {
      throw new EvidenceError(
        'EVIDENCE_REQUIREMENTS_CHANGED',
        'the capability evidence policy changed after the guard run; the run is no longer eligible',
      );
    }

    // 6. normalized-inputs binding (cross-subject / cross-scope replay blocked)
    const inputsDigest = normalizedInputsDigest(request.normalized_inputs);
    if (inputsDigest !== run.normalized_inputs_digest) {
      throw new EvidenceError(
        'EVIDENCE_INPUT_BINDING_MISMATCH',
        'normalized inputs do not match the guard run inputs digest',
      );
    }

    // 7. trusted subject resolver output must equal the run subject
    const currentSubjectKey = this.subjectResolvers.resolve(request.capability_id, request.normalized_inputs);
    if (currentSubjectKey !== run.subject_key) {
      throw new EvidenceError(
        'EVIDENCE_SUBJECT_MISMATCH',
        `current subject '${currentSubjectKey}' does not match the guard run subject '${run.subject_key}'`,
      );
    }

    // 8. coverage integrity: the recorded coverage must recompute to the same digest
    const recomputedCoverageDigest = coverageDigest(run.final_coverage);
    if (recomputedCoverageDigest !== run.coverage_digest) {
      throw new EvidenceError(
        'EVIDENCE_COVERAGE_INTEGRITY_FAILURE',
        'guard run coverage no longer matches its recorded coverage digest',
      );
    }

    // 9. every referenced evidence id (and conflict id) traces to a qualified record
    const referencedIds = new Set<string>();
    for (const entry of run.final_coverage.entries) {
      for (const id of entry.evidence_ids) referencedIds.add(id);
      for (const id of entry.conflict_evidence_ids ?? []) referencedIds.add(id);
    }
    for (const id of referencedIds) {
      if (!this.qualifiedEvidenceStore.has(id)) {
        throw new EvidenceError(
          'EVIDENCE_LINEAGE_MISSING',
          `coverage references evidence id '${id}' with no traceable qualified record`,
        );
      }
    }
    for (const id of run.qualified_evidence_ids) {
      if (!this.qualifiedEvidenceStore.has(id)) {
        throw new EvidenceError(
          'EVIDENCE_LINEAGE_MISSING',
          `guard run references qualified evidence id '${id}' that is no longer traceable`,
        );
      }
    }

    // 10. the pure policy assessment must still be satisfied
    const assessment = assessEvidenceCoverage(capability.required_evidence, run.final_coverage);
    if (!assessment.mandatory_satisfied) {
      throw new EvidenceError(
        'EVIDENCE_COVERAGE_ASSESSMENT_FAILED',
        'the recorded coverage no longer satisfies the capability evidence policy',
      );
    }

    return {
      eligibility: 'eligible',
      guard_run_id: run.guard_run_id,
      capability_id: run.capability_id,
      capability_version: run.capability_version,
      subject_key: run.subject_key,
      authoritative_coverage: run.final_coverage,
      final_assessment: assessment,
      requirements_digest: run.requirements_digest,
      normalized_inputs_digest: run.normalized_inputs_digest,
      coverage_digest: run.coverage_digest,
      qualified_evidence_ids: [...run.qualified_evidence_ids],
      materialized_at: this.clock().toISOString(),
    };
  }
}
