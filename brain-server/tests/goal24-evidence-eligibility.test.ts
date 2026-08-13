/**
 * CP6 integration - EvidenceEligibilityService: the only way caller code can
 * obtain authoritative coverage for a future executable ExecutionPlan.
 *
 * Red-team coverage for the forged-coverage closure:
 * - a forged EvidenceCoverageSnapshot (even digest-consistent) can never
 *   materialize into executable-plan eligibility;
 * - caller-supplied coverage/requirements/clock keys are schema-rejected;
 * - only server-owned guard runs with final_action=proceed are eligible;
 * - cross-subject replay and capability policy changes invalidate old runs;
 * - every evidence id must trace to a qualified record;
 * - restart-invalidated runs fail closed with EVIDENCE_GUARD_RUN_NOT_FOUND;
 * - tampered coverage fails closed on digest/assessment checks.
 */

import { describe, expect, it } from 'vitest';
import {
  EvidenceEligibilityService,
  EvidenceError,
  GuardRunStore,
  QualifiedEvidenceStore,
  coverageDigest,
  normalizedInputsDigest,
  requirementsDigest,
  type EvidenceGuardRunRecord,
} from '../src/evidence/index.js';
import {
  buildTestRig,
  CLASS_A,
  CLASS_B,
  CLASS_OPTIONAL,
  TEST_CAPABILITY_ID,
  TEST_SUBJECT_INPUTS,
  requirement,
  testCapability,
  validProvider,
} from './helpers/cp6-evidence-test-rig.js';

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    capability_id: TEST_CAPABILITY_ID,
    capability_version: '1.0.0',
    normalized_inputs: TEST_SUBJECT_INPUTS,
    ...overrides,
  };
}

async function proceedRig() {
  const rig = buildTestRig();
  rig.providers.register(validProvider(CLASS_A, 'alpha-ok', { metadata: { max_verification_level: 'verified' } }));
  rig.providers.register(validProvider(CLASS_B, 'beta-ok', { metadata: { max_verification_level: 'verified' } }));
  const evaluation = await rig.runtime.evaluateForCapability(validRequest());
  return { rig, evaluation };
}

describe('EvidenceEligibilityService - happy path', () => {
  it('materializes authoritative coverage only from a server-owned proceed run', async () => {
    const { rig, evaluation } = await proceedRig();
    expect(evaluation.action).toBe('proceed');
    const record = rig.eligibility.materializeEvidenceForExecutablePlan({
      guard_run_id: evaluation.guard_run_id,
      capability_id: TEST_CAPABILITY_ID,
      capability_version: '1.0.0',
      normalized_inputs: TEST_SUBJECT_INPUTS,
    });
    expect(record.eligibility).toBe('eligible');
    expect(record.guard_run_id).toBe(evaluation.guard_run_id);
    expect(record.authoritative_coverage).toEqual(evaluation.final_coverage);
    expect(record.requirements_digest).toBe(evaluation.requirements_digest);
    expect(record.normalized_inputs_digest).toBe(evaluation.normalized_inputs_digest);
    expect(record.coverage_digest).toBe(evaluation.coverage_digest);
    expect(record.qualified_evidence_ids.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(record.materialized_at))).toBe(true);
    expect(record.final_assessment.mandatory_satisfied).toBe(true);
  });
});

describe('EvidenceEligibilityService - request authority surface', () => {
  it('rejects caller-supplied coverage / requirements / clock / provider keys', async () => {
    const { rig, evaluation } = await proceedRig();
    const fakeCoverage = {
      entries: [
        { evidence_class: CLASS_A, status: 'present', verification_level: 'verified', evidence_ids: ['f'.repeat(64)], checked_at: '2026-08-14T00:00:00.000Z' },
        { evidence_class: CLASS_B, status: 'present', verification_level: 'verified', evidence_ids: ['e'.repeat(64)], checked_at: '2026-08-14T00:00:00.000Z' },
      ],
    };
    const base = {
      guard_run_id: evaluation.guard_run_id,
      capability_id: TEST_CAPABILITY_ID,
      capability_version: '1.0.0',
      normalized_inputs: TEST_SUBJECT_INPUTS,
    };
    for (const [key, value] of Object.entries({
      evidence_coverage_snapshot: fakeCoverage,
      coverage: fakeCoverage,
      initial_coverage: fakeCoverage,
      requirements: [],
      provider_id: 'attacker',
      providers: ['attacker'],
      now: '2099-01-01T00:00:00.000Z',
      checked_at: '2099-01-01T00:00:00.000Z',
      evidence_ids: ['fake'],
      subject_key: 'attacker/subject',
      verification_level: 'verified',
    })) {
      expect(
        () => rig.eligibility.materializeEvidenceForExecutablePlan({ ...base, [key]: value }),
        `request key '${key}'`,
      ).toThrowError(/EVIDENCE_INPUT_INVALID/);
    }
  });
});

describe('EvidenceEligibilityService - forged snapshot closure', () => {
  it('a forged snapshot with a fabricated guard run id can never materialize', async () => {
    const rig = buildTestRig();
    expect(() =>
      rig.eligibility.materializeEvidenceForExecutablePlan({
        guard_run_id: '11111111-1111-4111-8111-111111111111',
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(/EVIDENCE_GUARD_RUN_NOT_FOUND/);
  });

  it('a digest-consistent forged guard record with fake evidence ids fails lineage', async () => {
    const rig = buildTestRig();
    const capability = rig.capability();
    const fakeCoverage = {
      entries: [
        { evidence_class: CLASS_A, status: 'present', verification_level: 'verified', evidence_ids: ['f'.repeat(64)], checked_at: '2026-08-14T00:00:00.000Z' },
        { evidence_class: CLASS_B, status: 'present', verification_level: 'verified', evidence_ids: ['e'.repeat(64)], checked_at: '2026-08-14T00:00:00.000Z' },
      ],
    } as const;
    const forged: EvidenceGuardRunRecord = {
      guard_run_id: '22222222-2222-4222-8222-222222222222',
      capability_id: TEST_CAPABILITY_ID,
      capability_version: '1.0.0',
      subject_key: 'test:octocat/hello-world#42',
      normalized_inputs_digest: normalizedInputsDigest(TEST_SUBJECT_INPUTS),
      requirements_digest: requirementsDigest(capability.required_evidence),
      started_at: '2026-08-14T00:00:00.000Z',
      finished_at: '2026-08-14T00:00:01.000Z',
      final_action: 'proceed',
      final_coverage: fakeCoverage,
      coverage_digest: coverageDigest(fakeCoverage),
      qualified_evidence_ids: ['f'.repeat(64), 'e'.repeat(64)],
      rounds_used: 0,
      reason_codes: ['EVIDENCE_SATISFIED'],
      provider_outcomes: [],
      warnings: [],
      non_blocking_findings: [],
      clarification_needs: [],
      aborted: false,
      correlation_id: null,
    };
    rig.guardRunStore.put(forged);
    // every digest recomputes and the record is schema-valid, but no
    // qualified evidence exists for the fake ids: lineage fails closed.
    expect(() =>
      rig.eligibility.materializeEvidenceForExecutablePlan({
        guard_run_id: forged.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(/EVIDENCE_LINEAGE_MISSING/);
  });
});

describe('EvidenceEligibilityService - guard action and identity gates', () => {
  it('only proceed runs are eligible; block runs fail with NOT_PROCEED', async () => {
    const rig = buildTestRig();
    rig.providers.register(validProvider(CLASS_A, 'alpha-ok', { metadata: { max_verification_level: 'verified' } }));
    const evaluation = await rig.runtime.evaluateForCapability(validRequest());
    expect(evaluation.action).toBe('block');
    expect(() =>
      rig.eligibility.materializeEvidenceForExecutablePlan({
        guard_run_id: evaluation.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(/EVIDENCE_GUARD_RUN_NOT_PROCEED/);
  });

  it('a capability version mismatch fails closed', async () => {
    const { rig, evaluation } = await proceedRig();
    expect(() =>
      rig.eligibility.materializeEvidenceForExecutablePlan({
        guard_run_id: evaluation.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '9.9.9',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(/EVIDENCE_CAPABILITY_VERSION_MISMATCH/);
  });

  it('a removed capability invalidates the run', async () => {
    const { rig, evaluation } = await proceedRig();
    rig.capabilities.delete(TEST_CAPABILITY_ID);
    expect(() =>
      rig.eligibility.materializeEvidenceForExecutablePlan({
        guard_run_id: evaluation.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(/EVIDENCE_CAPABILITY_NOT_FOUND/);
  });
});

describe('EvidenceEligibilityService - subject and policy binding', () => {
  it('cross-subject replay: different normalized inputs can never reuse a run', async () => {
    const { rig, evaluation } = await proceedRig();
    expect(() =>
      rig.eligibility.materializeEvidenceForExecutablePlan({
        guard_run_id: evaluation.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: { owner: 'octocat', repo: 'evil-other-repo', number: 7 },
      }),
    ).toThrowError(/EVIDENCE_INPUT_BINDING_MISMATCH/);
  });

  it('same-digest inputs cannot dodge the subject resolver check', async () => {
    const { rig, evaluation } = await proceedRig();
    const alternateSubjects = new (await import('../src/evidence/subject.js')).CapabilityEvidenceSubjectResolverRegistry();
    alternateSubjects.register(TEST_CAPABILITY_ID, () => 'test:octocat/hello-world#42');
    const spoofed = new EvidenceEligibilityService({
      guardRunStore: rig.guardRunStore,
      qualifiedEvidenceStore: rig.qualifiedStore,
      capabilityLookup: rig.capabilityLookup,
      subjectResolvers: alternateSubjects,
    });
    // The run subject is the canonical key; a service whose trusted resolver
    // produces a different key for the same inputs fails closed.
    const divergent = new (await import('../src/evidence/subject.js')).CapabilityEvidenceSubjectResolverRegistry();
    divergent.register(TEST_CAPABILITY_ID, () => 'test:octocat/other-repo#42');
    const divergentService = new EvidenceEligibilityService({
      guardRunStore: rig.guardRunStore,
      qualifiedEvidenceStore: rig.qualifiedStore,
      capabilityLookup: rig.capabilityLookup,
      subjectResolvers: divergent,
    });
    expect(() =>
      divergentService.materializeEvidenceForExecutablePlan({
        guard_run_id: evaluation.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(/EVIDENCE_SUBJECT_MISMATCH/);
    // and the same-key service still materializes (resolver identity is
    // trusted by construction, not by caller-supplied data).
    expect(() =>
      spoofed.materializeEvidenceForExecutablePlan({
        guard_run_id: evaluation.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).not.toThrow();
  });

  it('capability policy change (A+B -> A+B+C) invalidates old runs', async () => {
    const { rig, evaluation } = await proceedRig();
    rig.setCapability(
      testCapability({
        required_evidence: [
          requirement(CLASS_A),
          requirement(CLASS_B),
          requirement(CLASS_OPTIONAL, { mandatory: true }),
        ],
      }),
    );
    expect(() =>
      rig.eligibility.materializeEvidenceForExecutablePlan({
        guard_run_id: evaluation.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(/EVIDENCE_REQUIREMENTS_CHANGED/);
  });
});

describe('EvidenceEligibilityService - lineage and integrity', () => {
  it('invalidated qualified evidence breaks lineage for every referencing run', async () => {
    const { rig, evaluation } = await proceedRig();
    const firstId = evaluation.qualified_evidence_ids[0];
    expect(firstId).toBeTruthy();
    rig.qualifiedStore.invalidate(firstId!);
    expect(() =>
      rig.eligibility.materializeEvidenceForExecutablePlan({
        guard_run_id: evaluation.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(/EVIDENCE_LINEAGE_MISSING/);
  });

  it('tampered coverage (stale digest) fails the integrity check', async () => {
    const { rig, evaluation } = await proceedRig();
    const original = rig.guardRunStore.get(evaluation.guard_run_id)!;
    const tampered: EvidenceGuardRunRecord = {
      ...original,
      final_coverage: {
        entries: original.final_coverage.entries.map((entry) => ({
          ...entry,
          checked_at: '2099-01-01T00:00:00.000Z',
        })),
      },
    };
    const tamperedStore = new GuardRunStore();
    tamperedStore.put(tampered);
    const service = new EvidenceEligibilityService({
      guardRunStore: tamperedStore,
      qualifiedEvidenceStore: rig.qualifiedStore,
      capabilityLookup: rig.capabilityLookup,
      subjectResolvers: rig.subjects,
    });
    expect(() =>
      service.materializeEvidenceForExecutablePlan({
        guard_run_id: evaluation.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(/EVIDENCE_COVERAGE_INTEGRITY_FAILURE/);
  });

  it('coverage whose digest is repaired but no longer satisfies policy fails assessment', async () => {
    const { rig, evaluation } = await proceedRig();
    const original = rig.guardRunStore.get(evaluation.guard_run_id)!;
    const guttedCoverage = { entries: original.final_coverage.entries.slice(0, 1) };
    const tampered: EvidenceGuardRunRecord = {
      ...original,
      final_coverage: guttedCoverage,
      coverage_digest: coverageDigest(guttedCoverage),
      qualified_evidence_ids: original.final_coverage.entries[0].evidence_ids,
    };
    const tamperedStore = new GuardRunStore();
    tamperedStore.put(tampered);
    const service = new EvidenceEligibilityService({
      guardRunStore: tamperedStore,
      qualifiedEvidenceStore: rig.qualifiedStore,
      capabilityLookup: rig.capabilityLookup,
      subjectResolvers: rig.subjects,
    });
    expect(() =>
      service.materializeEvidenceForExecutablePlan({
        guard_run_id: evaluation.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(/EVIDENCE_COVERAGE_ASSESSMENT_FAILED/);
  });

  it('restart semantics: fresh stores can never materialize old runs', async () => {
    const { rig, evaluation } = await proceedRig();
    const restarted = new EvidenceEligibilityService({
      guardRunStore: new GuardRunStore(),
      qualifiedEvidenceStore: new QualifiedEvidenceStore(),
      capabilityLookup: rig.capabilityLookup,
      subjectResolvers: rig.subjects,
    });
    expect(() =>
      restarted.materializeEvidenceForExecutablePlan({
        guard_run_id: evaluation.guard_run_id,
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(/EVIDENCE_GUARD_RUN_NOT_FOUND/);
  });

  it('a guard run id that is not a UUID-shaped string is rejected by the schema', async () => {
    const rig = buildTestRig();
    expect(() =>
      rig.eligibility.materializeEvidenceForExecutablePlan({
        guard_run_id: 'not-a-valid-id'.repeat(40),
        capability_id: TEST_CAPABILITY_ID,
        capability_version: '1.0.0',
        normalized_inputs: TEST_SUBJECT_INPUTS,
      }),
    ).toThrowError(EvidenceError);
  });
});

describe('EvidenceEligibilityService - construction boundary', () => {
  it('rejects non-server-owned dependencies', () => {
    const rig = buildTestRig();
    expect(() => new EvidenceEligibilityService({
      guardRunStore: {} as GuardRunStore,
      qualifiedEvidenceStore: rig.qualifiedStore,
      capabilityLookup: rig.capabilityLookup,
      subjectResolvers: rig.subjects,
    })).toThrowError(/EVIDENCE_INPUT_INVALID/);
    expect(() => new EvidenceEligibilityService({
      guardRunStore: rig.guardRunStore,
      qualifiedEvidenceStore: {} as QualifiedEvidenceStore,
      capabilityLookup: rig.capabilityLookup,
      subjectResolvers: rig.subjects,
    })).toThrowError(/EVIDENCE_INPUT_INVALID/);
    expect(() => new EvidenceEligibilityService({
      guardRunStore: rig.guardRunStore,
      qualifiedEvidenceStore: rig.qualifiedStore,
      capabilityLookup: 'not-a-function' as unknown as (id: string) => never,
      subjectResolvers: rig.subjects,
    })).toThrowError(/EVIDENCE_INPUT_INVALID/);
  });
});
