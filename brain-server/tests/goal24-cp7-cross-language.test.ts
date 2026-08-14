/**
 * Goal24 Checkpoint 7 (Integration) - cross-language conformance (TS half).
 *
 * Reads the SAME golden fixture files the Rust conformance test reads
 * (docs/goal24/fixtures/cp7-approval/*). A digest/policy mismatch here or in
 * the Rust half is a CP7 integration failure; neither side maintains its own
 * expected values.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ApprovalBindingPayloadSchema,
  type ApprovalBindingPayload,
} from '../src/approval/contracts.js';
import {
  approvalBindingDigest,
  bindingPayloadForPlan,
  buildApprovalBindingPayload,
  canonicalNumberString,
} from '../src/approval/binding.js';
import {
  APPROVAL_POLICY_VERSION,
  AUTHORITY_RANK,
  approvalRequired,
  authoritySatisfies,
} from '../src/approval/policy.js';
import {
  ApprovalReferenceSchema,
  ExecutionPlanSchema,
  RiskSnapshotSchema,
  type ExecutionPlan,
} from '../src/execution/contracts.js';
import type { AuthorityLevel } from '../src/capabilities/contracts.js';

const FIXTURES = path.resolve(__dirname, '../../docs/goal24/fixtures/cp7-approval');

interface GoldenVector {
  id: string;
  kind: string;
  description: string;
  policy_version: string;
  plan: Record<string, unknown>;
  expected_payload: Record<string, unknown>;
  expected_digest: string;
  mutates?: string;
  differs_from?: string;
}

const golden = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'binding-golden-vectors.json'), 'utf8'),
) as { total_vectors: number; baseline_vector_id: string; vectors: GoldenVector[] };
const riskPolicy = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'risk-policy-vectors.json'), 'utf8'),
) as {
  policy_version_literal: string;
  native_minimum_matrix: Array<Record<string, unknown>>;
  authority_order: Array<{ lower: string; higher: string; ordered: boolean }>;
  authority_satisfies: Array<{ actor: string; required: string; satisfies: boolean }>;
};

function computeForVector(vector: GoldenVector): { payload: ApprovalBindingPayload; digest: string } {
  const plan = ExecutionPlanSchema.parse(vector.plan) as ExecutionPlan;
  const payload = bindingPayloadForPlan(plan, vector.policy_version);
  return { payload, digest: approvalBindingDigest(payload) };
}

describe('cp7 cross-language binding golden vectors (TS)', () => {
  it('policy version literal matches the shared fixture', () => {
    expect(APPROVAL_POLICY_VERSION).toBe(riskPolicy.policy_version_literal);
    expect(APPROVAL_POLICY_VERSION).toBe(golden.vectors.every((v) => true) && 'goal24-approval-policy-v1');
  });

  it('every golden vector digests to the shared expected digest', () => {
    expect(golden.total_vectors).toBe(golden.vectors.length);
    expect(golden.vectors.length).toBeGreaterThanOrEqual(30);
    for (const vector of golden.vectors) {
      const { payload, digest } = computeForVector(vector);
      expect(payload, vector.id).toEqual(vector.expected_payload);
      expect(digest, vector.id).toBe(vector.expected_digest);
    }
  });

  it('every mutation vector changes the digest versus the baseline', () => {
    const baseline = golden.vectors.find((v) => v.id === golden.baseline_vector_id);
    expect(baseline).toBeDefined();
    for (const vector of golden.vectors.filter((v) => v.kind === 'mutation')) {
      const { digest } = computeForVector(vector);
      expect(digest, vector.id).not.toBe(baseline!.expected_digest);
    }
  });

  it('lifecycle fields (state/approval/required_approval) never change the binding digest', () => {
    const baseline = golden.vectors.find((v) => v.id === golden.baseline_vector_id)!;
    const excluded = golden.vectors.find((v) => v.id === 'golden-excluded-fields')!;
    const { digest } = computeForVector(excluded);
    expect(digest).toBe(baseline.expected_digest);
  });

  it('unicode is never normalized: combining and precomposed inputs digest differently', () => {
    const combining = golden.vectors.find((v) => v.id === 'golden-uni-combining')!;
    const precomposed = golden.vectors.find((v) => v.id === 'golden-uni-precomposed')!;
    expect(computeForVector(combining).digest).not.toBe(computeForVector(precomposed).digest);
  });

  it('negative zero canonicalizes to 0 with the same digest as plain 0', () => {
    const zero = golden.vectors.find((v) => v.id === 'golden-num-000')!;
    const negZero = golden.vectors.find((v) => v.id === 'golden-num-negzero')!;
    expect(computeForVector(negZero).digest).toBe(computeForVector(zero).digest);
    expect(canonicalNumberString(-0)).toBe('0');
  });

  it('absent optional values encode as explicit JSON null', () => {
    const nullPlans = computeForVector(golden.vectors.find((v) => v.id === 'golden-null-plans')!);
    const nullExpiry = computeForVector(golden.vectors.find((v) => v.id === 'golden-null-expiry')!);
    expect(nullPlans.payload.verification_plan_digest).toBeNull();
    expect(nullPlans.payload.rollback_plan_digest).toBeNull();
    expect(nullExpiry.payload.expires_at).toBeNull();
  });
});

describe('cp7 cross-language number domain (TS)', () => {
  const baseInputs = () => ({
    plan_id: 'plan-00000000-0000-4000-8000-000000000001',
    decision_id: 'decision-1',
    capability_id: 'test.resource.update',
    capability_version: '1.0.0',
    adapter_id: 'test-adapter',
    normalized_inputs: { repo: 'repo-a' },
    risk_snapshot: {
      risk_level: 'medium',
      reversible: true,
      side_effect_class: 'reversible_write',
      required_authority: 'L2',
      capability_version: '1.0.0',
    },
    evidence_coverage_snapshot: { entries: [] },
    timeout_ms: 5000,
    verification_plan: null,
    rollback_plan: null,
    created_at: '2026-08-14T00:00:00.000Z',
    expires_at: '2026-08-14T00:15:00.000Z',
    policy_version: APPROVAL_POLICY_VERSION,
  });

  it('accepts the canonical number subset', () => {
    for (const value of [0, -0, 1, -1, 1.5, 123456789, 9007199254740991]) {
      expect(() =>
        buildApprovalBindingPayload({ ...baseInputs(), normalized_inputs: { n: value } }),
      ).not.toThrow();
    }
  });

  it('rejects NaN and infinities fail closed', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(() =>
        buildApprovalBindingPayload({ ...baseInputs(), normalized_inputs: { n: value } }),
      ).toThrow('APPROVAL_INPUT_INVALID');
    }
  });

  it('rejects values beyond Number.MAX_SAFE_INTEGER and exponent notation', () => {
    for (const value of [9007199254740992, 2 ** 53, 1e21, 1e-7, 0.30000000000000004, 1.1234567]) {
      expect(() =>
        buildApprovalBindingPayload({ ...baseInputs(), normalized_inputs: { n: value } }),
      ).toThrow('APPROVAL_INPUT_INVALID');
    }
  });

  it('binding digest is invariant to input object key insertion order', () => {
    const a = buildApprovalBindingPayload({
      ...baseInputs(),
      normalized_inputs: { alpha: 1, beta: 'x', gamma: true },
    });
    const b = buildApprovalBindingPayload({
      ...baseInputs(),
      normalized_inputs: { gamma: true, alpha: 1, beta: 'x' },
    });
    expect(approvalBindingDigest(a)).toBe(approvalBindingDigest(b));
  });

  it('payload rejects unknown keys strictly', () => {
    const payload = buildApprovalBindingPayload(baseInputs());
    expect(
      ApprovalBindingPayloadSchema.safeParse({ ...payload, evidence_guard_run_id: 'run-x' }).success,
    ).toBe(false);
    expect(ApprovalBindingPayloadSchema.safeParse({ ...payload, state: 'ready' }).success).toBe(false);
  });
});

describe('cp7 cross-language risk policy vectors (TS)', () => {
  it('approvalRequired matches every shared matrix row', () => {
    for (const row of riskPolicy.native_minimum_matrix) {
      const actual = approvalRequired({
        side_effect_class: row.side_effect_class as 'read_only',
        risk_level: row.risk_level as 'low',
        required_authority: row.required_authority as AuthorityLevel,
      });
      expect(actual, JSON.stringify(row)).toBe(row.approval_required);
    }
  });

  it('authority ordering matches every shared pair', () => {
    for (const row of riskPolicy.authority_order) {
      const actual =
        AUTHORITY_RANK[row.lower as AuthorityLevel] < AUTHORITY_RANK[row.higher as AuthorityLevel];
      expect(actual, JSON.stringify(row)).toBe(row.ordered);
    }
  });

  it('authoritySatisfies matches every shared pair', () => {
    for (const row of riskPolicy.authority_satisfies) {
      const actual = authoritySatisfies(row.actor as AuthorityLevel, row.required as AuthorityLevel);
      expect(actual, JSON.stringify(row)).toBe(row.satisfies);
    }
  });
});

describe('cp7 cross-language type domain (TS)', () => {
  const validRiskSnapshot = () => ({
    capability_version: '1.0.0',
    risk_level: 'medium',
    reversible: true,
    side_effect_class: 'reversible_write',
    required_authority: 'L2',
  });

  const validPlan = () => ({
    plan_id: 'plan-00000000-0000-4000-8000-000000000001',
    decision_id: 'decision-1',
    capability_id: 'test.resource.update',
    capability_version: '1.0.0',
    adapter_id: 'test-adapter',
    normalized_inputs: { count: 1 },
    required_approval: true,
    approval: null,
    risk_snapshot: validRiskSnapshot(),
    evidence_coverage_snapshot: { entries: [] },
    timeout_ms: 5000,
    verification_plan: null,
    rollback_plan: null,
    state: 'awaiting_approval',
    created_at: '2026-08-14T00:00:00.000Z',
    expires_at: '2026-08-14T00:15:00.000Z',
  });

  const bindingInputs = () => ({
    plan_id: 'plan-00000000-0000-4000-8000-000000000001',
    decision_id: 'decision-1',
    capability_id: 'test.resource.update',
    capability_version: '1.0.0',
    adapter_id: 'test-adapter',
    normalized_inputs: { count: 1 },
    risk_snapshot: validRiskSnapshot(),
    evidence_coverage_snapshot: { entries: [] },
    timeout_ms: 5000,
    verification_plan: null,
    rollback_plan: null,
    created_at: '2026-08-14T00:00:00.000Z',
    expires_at: '2026-08-14T00:15:00.000Z',
    policy_version: APPROVAL_POLICY_VERSION,
  });

  it('unknown risk/authority/side-effect/state enum values fail closed', () => {
    expect(RiskSnapshotSchema.safeParse({ ...validRiskSnapshot(), risk_level: 'risky' }).success).toBe(false);
    expect(RiskSnapshotSchema.safeParse({ ...validRiskSnapshot(), required_authority: 'L9' }).success).toBe(false);
    expect(RiskSnapshotSchema.safeParse({ ...validRiskSnapshot(), side_effect_class: 'write' }).success).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ ...validPlan(), state: 'flying' }).success).toBe(false);
  });

  it('non-boolean required_approval, string timeout_ms and structural mismatches fail closed', () => {
    expect(ExecutionPlanSchema.safeParse({ ...validPlan(), required_approval: 'false' }).success).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ ...validPlan(), timeout_ms: '5000' }).success).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ ...validPlan(), normalized_inputs: ['not-an-object'] }).success).toBe(false);
  });

  it('missing required plan fields fail closed', () => {
    const missingRisk = { ...validPlan() };
    delete (missingRisk as Record<string, unknown>).risk_snapshot;
    expect(ExecutionPlanSchema.safeParse(missingRisk).success).toBe(false);
    const missingApprovalFlag = { ...validPlan() };
    delete (missingApprovalFlag as Record<string, unknown>).required_approval;
    expect(ExecutionPlanSchema.safeParse(missingApprovalFlag).success).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ ...validPlan(), capability_version: 'not-semver' }).success).toBe(false);
    const missingVersion = { ...validPlan() };
    delete (missingVersion as Record<string, unknown>).capability_version;
    expect(ExecutionPlanSchema.safeParse(missingVersion).success).toBe(false);
    const missingInputs = { ...validPlan() };
    delete (missingInputs as Record<string, unknown>).normalized_inputs;
    expect(ExecutionPlanSchema.safeParse(missingInputs).success).toBe(false);
  });

  it('number/type coercion never aliases distinct values', () => {
    expect(canonicalNumberString(1)).toBe('1');
    expect(canonicalNumberString(1.0)).toBe('1');
    const numeric = buildApprovalBindingPayload({ ...bindingInputs(), normalized_inputs: { count: 1 } });
    const stringForm = buildApprovalBindingPayload({ ...bindingInputs(), normalized_inputs: { count: '1' } });
    expect(approvalBindingDigest(numeric)).not.toBe(approvalBindingDigest(stringForm));
  });

  it('approval_id bounds and trimming are schema-enforced', () => {
    const reference = {
      approval_id: 'appr-1',
      plan_id: 'plan-00000000-0000-4000-8000-000000000001',
      granted_by: 'owner',
      granted_at: '2026-08-14T00:00:00.000Z',
      policy_version: APPROVAL_POLICY_VERSION,
      token_reference: 'tref-1',
      token_digest: 'a'.repeat(64),
    };
    expect(ApprovalReferenceSchema.safeParse(reference).success).toBe(true);
    expect(ApprovalReferenceSchema.safeParse({ ...reference, approval_id: 'x'.repeat(201) }).success).toBe(false);
    expect(ApprovalReferenceSchema.safeParse({ ...reference, approval_id: 0 }).success).toBe(false);
    const padded = ApprovalReferenceSchema.safeParse({ ...reference, approval_id: '  appr-1  ' });
    expect(padded.success).toBe(true);
    expect(padded.data?.approval_id ?? null).toBe('appr-1');
  });

  it('invalid capability and adapter identifier forms fail closed', () => {
    expect(ExecutionPlanSchema.safeParse({ ...validPlan(), capability_id: 'github.issue.Read' }).success).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ ...validPlan(), capability_id: 'cli.github.issue.read' }).success).toBe(false);
    expect(ExecutionPlanSchema.safeParse({ ...validPlan(), adapter_id: 'github-Cli' }).success).toBe(false);
  });
});
