/**
 * Goal24 Checkpoint 5 (Lane A) - canonical skill safety inheritance tests.
 *
 * CP5 closes the last inheritance-semantics gap in
 * `validateSkillManifestAgainstCapabilities`: conflict policy and
 * verification requirement are compared by canonical rank ordering with
 * canonical defaults (`conflict_policy ?? 'reject'`,
 * `verification_requirement ?? 'none'`), never by ad-hoc per-value checks.
 *
 * Canonical strictness:
 *   conflict:     allow(0) < warn(1) < reject(2); undefined -> reject
 *   verification: none(0) < asserted(1) < verified(2); undefined -> none
 *
 * A skill may only strengthen a referenced capability requirement; the
 * effective skill value must be >= the effective capability value.
 */

import { describe, expect, it } from 'vitest';
import {
  type CapabilityDefinition,
  type ConflictPolicy,
  type EvidenceRequirement,
  type VerificationRequirement,
} from '../src/capabilities/contracts.js';
import {
  effectiveVerificationRequirement,
  validateSkillManifestAgainstCapabilities,
  type SkillManifest,
} from '../src/skills/contracts.js';

const CONFLICT_CLASS = 'evidence.conflict';
const VERIFICATION_CLASS = 'evidence.authority';

function capabilityWithEvidence(requirement: EvidenceRequirement): CapabilityDefinition {
  return {
    id: 'github.issue.read',
    version: '1.0.0',
    description: 'Read a GitHub issue',
    input_schema: { type: 'object', properties: {} },
    required_authority: 'L0',
    risk_level: 'low',
    reversible: false,
    side_effect_class: 'read_only',
    required_evidence: [requirement],
  };
}

function manifestWithEvidence(requirement: EvidenceRequirement | undefined): SkillManifest {
  return {
    name: 'issue-triage',
    version: '1.0.0',
    description: 'Triage GitHub issues',
    capabilities: ['github.issue.read'],
    procedure: [
      { step_id: 'read_issue', description: 'Read the issue', capability_id: 'github.issue.read' },
    ],
    risk: 'low',
    adapter_preference: 'any',
    ...(requirement !== undefined ? { required_evidence: [requirement] } : {}),
  };
}

function evidenceRequirement(
  classId: string,
  fields: {
    conflictPolicy?: ConflictPolicy;
    verification?: VerificationRequirement;
  },
): EvidenceRequirement {
  return {
    class_id: classId,
    mandatory: true,
    ...(fields.conflictPolicy !== undefined ? { conflict_policy: fields.conflictPolicy } : {}),
    ...(fields.verification !== undefined ? { verification_requirement: fields.verification } : {}),
  };
}

describe('canonical verification default (CP5)', () => {
  it('effectiveVerificationRequirement defaults undeclared to none', () => {
    expect(effectiveVerificationRequirement({ class_id: 'evidence.authority', mandatory: true })).toBe('none');
  });

  it('returns the declared verification requirement unchanged', () => {
    expect(
      effectiveVerificationRequirement({
        class_id: 'evidence.authority',
        mandatory: true,
        verification_requirement: 'asserted',
      }),
    ).toBe('asserted');
    expect(
      effectiveVerificationRequirement({
        class_id: 'evidence.authority',
        mandatory: true,
        verification_requirement: 'verified',
      }),
    ).toBe('verified');
    expect(
      effectiveVerificationRequirement({
        class_id: 'evidence.authority',
        mandatory: true,
        verification_requirement: 'none',
      }),
    ).toBe('none');
  });
});

describe('conflict policy ordering — skill must be >= capability (CP5)', () => {
  const cases: Array<{
    label: string;
    capability: ConflictPolicy | undefined;
    skill: ConflictPolicy | undefined;
    rejected: boolean;
  }> = [
    { label: 'cap undefined + skill allow', capability: undefined, skill: 'allow', rejected: true },
    { label: 'cap undefined + skill undefined', capability: undefined, skill: undefined, rejected: false },
    { label: 'cap warn + skill allow', capability: 'warn', skill: 'allow', rejected: true },
    { label: 'cap warn + skill undefined', capability: 'warn', skill: undefined, rejected: false },
    { label: 'cap warn + skill warn', capability: 'warn', skill: 'warn', rejected: false },
    { label: 'cap warn + skill reject', capability: 'warn', skill: 'reject', rejected: false },
    { label: 'cap reject + skill allow', capability: 'reject', skill: 'allow', rejected: true },
    { label: 'cap reject + skill warn', capability: 'reject', skill: 'warn', rejected: true },
    { label: 'cap reject + skill reject', capability: 'reject', skill: 'reject', rejected: false },
  ];

  for (const testCase of cases) {
    it(`${testCase.label} -> ${testCase.rejected ? 'reject' : 'pass'}`, () => {
      const capability = capabilityWithEvidence(
        evidenceRequirement(CONFLICT_CLASS, { conflictPolicy: testCase.capability }),
      );
      const manifest = manifestWithEvidence(
        evidenceRequirement(CONFLICT_CLASS, { conflictPolicy: testCase.skill }),
      );
      const issues = validateSkillManifestAgainstCapabilities(manifest, () => capability);
      const conflictIssues = issues.filter((issue) => issue.path === 'required_evidence');
      if (testCase.rejected) {
        expect(conflictIssues.length).toBeGreaterThan(0);
        expect(conflictIssues[0].message).toContain('conflict_policy');
      } else {
        expect(issues).toEqual([]);
      }
    });
  }
});

describe('verification ordering — skill must be >= capability (CP5)', () => {
  const cases: Array<{
    label: string;
    capability: VerificationRequirement | undefined;
    skill: VerificationRequirement | undefined;
    rejected: boolean;
  }> = [
    { label: 'cap asserted + skill undefined', capability: 'asserted', skill: undefined, rejected: true },
    { label: 'cap asserted + skill none', capability: 'asserted', skill: 'none', rejected: true },
    { label: 'cap asserted + skill asserted', capability: 'asserted', skill: 'asserted', rejected: false },
    { label: 'cap asserted + skill verified', capability: 'asserted', skill: 'verified', rejected: false },
    { label: 'cap verified + skill none', capability: 'verified', skill: 'none', rejected: true },
    { label: 'cap verified + skill asserted', capability: 'verified', skill: 'asserted', rejected: true },
    { label: 'cap verified + skill verified', capability: 'verified', skill: 'verified', rejected: false },
    { label: 'cap undefined + skill undefined', capability: undefined, skill: undefined, rejected: false },
    { label: 'cap none + skill undefined', capability: 'none', skill: undefined, rejected: false },
  ];

  for (const testCase of cases) {
    it(`${testCase.label} -> ${testCase.rejected ? 'reject' : 'pass'}`, () => {
      const capability = capabilityWithEvidence(
        evidenceRequirement(VERIFICATION_CLASS, { verification: testCase.capability }),
      );
      const manifest = manifestWithEvidence(
        evidenceRequirement(VERIFICATION_CLASS, { verification: testCase.skill }),
      );
      const issues = validateSkillManifestAgainstCapabilities(manifest, () => capability);
      const verificationIssues = issues.filter((issue) => issue.path === 'required_evidence');
      if (testCase.rejected) {
        expect(verificationIssues.length).toBeGreaterThan(0);
        expect(verificationIssues[0].message).toContain('verification_requirement');
      } else {
        expect(issues).toEqual([]);
      }
    });
  }
});

describe('unchanged inheritance gates still hold (CP2.1/CP5 regression)', () => {
  it('rejects dropping a mandatory capability evidence class', () => {
    const capability = capabilityWithEvidence(
      evidenceRequirement(CONFLICT_CLASS, { conflictPolicy: 'reject' }),
    );
    const manifest = manifestWithEvidence(undefined);
    const issues = validateSkillManifestAgainstCapabilities(manifest, () => capability);
    expect(issues.some((issue) => issue.path === 'required_evidence')).toBe(true);
  });

  it('rejects weakening mandatory evidence to optional', () => {
    const capability = capabilityWithEvidence(
      evidenceRequirement(CONFLICT_CLASS, { conflictPolicy: 'reject' }),
    );
    const manifest = manifestWithEvidence({ class_id: CONFLICT_CLASS, mandatory: false });
    const issues = validateSkillManifestAgainstCapabilities(manifest, () => capability);
    expect(issues.some((issue) => issue.path === 'required_evidence')).toBe(true);
  });

  it('rejects weakening a capability freshness policy', () => {
    const capability = capabilityWithEvidence({
      class_id: VERIFICATION_CLASS,
      mandatory: true,
      verification_requirement: 'verified',
      freshness_policy: { max_age_ms: 3_600_000 },
    });
    const manifest = manifestWithEvidence({
      class_id: VERIFICATION_CLASS,
      mandatory: true,
      verification_requirement: 'verified',
      freshness_policy: { max_age_ms: 7_200_000 },
    });
    const issues = validateSkillManifestAgainstCapabilities(manifest, () => capability);
    expect(issues.some((issue) => issue.path === 'required_evidence')).toBe(true);
  });

  it('accepts a strictly stronger freshness policy', () => {
    const capability = capabilityWithEvidence({
      class_id: VERIFICATION_CLASS,
      mandatory: true,
      verification_requirement: 'verified',
      freshness_policy: { max_age_ms: 3_600_000 },
    });
    const manifest = manifestWithEvidence({
      class_id: VERIFICATION_CLASS,
      mandatory: true,
      verification_requirement: 'verified',
      freshness_policy: { max_age_ms: 1_800_000 },
    });
    const issues = validateSkillManifestAgainstCapabilities(manifest, () => capability);
    expect(issues).toEqual([]);
  });
});