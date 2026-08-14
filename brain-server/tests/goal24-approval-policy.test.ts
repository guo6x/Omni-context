/**
 * Goal24 Checkpoint 7 (Lane A) - approval policy + contract tests.
 *
 * Pure deterministic tests: V1 fail-closed policy matrix, server-derived
 * risk snapshot, authority ordering, expiry bounds, strict caller-boundary
 * schema rejection, immutable binding digest determinism and JSON-safety.
 */

import { describe, expect, it } from 'vitest';
import {
  ApprovalBindingPayloadSchema,
  ApprovalRequestRecordSchema,
  ExecutionAuthorizationRequestSchema,
  TrustedApprovalActorSchema,
  APPROVAL_POLICY_VERSION,
  ApprovalError,
  approvalRequired,
  approvalBindingDigest,
  authoritySatisfies,
  buildApprovalBindingPayload,
  computePlanExpiry,
  DEFAULT_MAX_APPROVAL_TTL_MS,
  deriveRiskSnapshot,
  digestJsonValue,
  generateAuthorizationPlanId,
  isExpiredAt,
  type ExecutionAuthorizationRequest,
} from '../src/approval/index.js';
import { PLAN_ID_PATTERN } from '../src/execution/contracts.js';
import {
  TEST_DESTRUCTIVE_CAPABILITY,
  TEST_NOW,
  TEST_READ_CAPABILITY,
  TEST_WRITE_CAPABILITY,
} from './helpers/fake-approval.js';


function writeRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision_id: 'decision-1',
    capability_id: TEST_WRITE_CAPABILITY.id,
    capability_version: TEST_WRITE_CAPABILITY.version,
    adapter_id: 'test-adapter',
    normalized_inputs: { repo: 'repo-a' },
    guard_run_id: 'run-policy',
    timeout_ms: 5000,
    verification_plan: {
      verification_capability_id: TEST_READ_CAPABILITY.id,
      verification_inputs: { id: 'resource-1' },
    },
    rollback_plan: {
      rollback_capability_id: 'test.resource.rollback',
      rollback_inputs: { id: 'resource-1' },
    },
    ...overrides,
  };
}

describe('approval policy V1 (fail closed)', () => {
  it('fixes the V1 policy version', () => {
    expect(APPROVAL_POLICY_VERSION).toBe('goal24-approval-policy-v1');
  });

  it('read_only + low + L0 does not require approval', () => {
    expect(
      approvalRequired({
        side_effect_class: 'read_only',
        risk_level: 'low',
        required_authority: 'L0',
      }),
    ).toBe(false);
  });

  it('any write side effect requires approval', () => {
    expect(
      approvalRequired({
        side_effect_class: 'reversible_write',
        risk_level: 'low',
        required_authority: 'L0',
      }),
    ).toBe(true);
    expect(
      approvalRequired({
        side_effect_class: 'destructive_write',
        risk_level: 'low',
        required_authority: 'L0',
      }),
    ).toBe(true);
    expect(
      approvalRequired({
        side_effect_class: 'external_effect',
        risk_level: 'low',
        required_authority: 'L0',
      }),
    ).toBe(true);
  });

  it('non-low risk requires approval even for reads', () => {
    expect(
      approvalRequired({
        side_effect_class: 'read_only',
        risk_level: 'medium',
        required_authority: 'L0',
      }),
    ).toBe(true);
    expect(
      approvalRequired({
        side_effect_class: 'read_only',
        risk_level: 'high',
        required_authority: 'L0',
      }),
    ).toBe(true);
  });

  it('elevated authority requires approval even for low reads', () => {
    expect(
      approvalRequired({
        side_effect_class: 'read_only',
        risk_level: 'low',
        required_authority: 'L1',
      }),
    ).toBe(true);
    expect(
      approvalRequired({
        side_effect_class: 'read_only',
        risk_level: 'low',
        required_authority: 'L3',
      }),
    ).toBe(true);
  });

  it('does not implement write auto-approval in V1', () => {
    expect(approvalRequired(TEST_WRITE_CAPABILITY)).toBe(true);
    expect(approvalRequired(TEST_DESTRUCTIVE_CAPABILITY)).toBe(true);
    expect(approvalRequired(TEST_READ_CAPABILITY)).toBe(false);
  });

  it('derives the risk snapshot exclusively from the trusted capability definition', () => {
    const snapshot = deriveRiskSnapshot(TEST_WRITE_CAPABILITY);
    expect(snapshot).toEqual({
      risk_level: 'medium',
      reversible: true,
      side_effect_class: 'reversible_write',
      required_authority: 'L2',
      capability_version: '1.0.0',
    });
  });

  it('orders authority L0 < L1 < L2 < L3', () => {
    expect(authoritySatisfies('L0', 'L0')).toBe(true);
    expect(authoritySatisfies('L1', 'L0')).toBe(true);
    expect(authoritySatisfies('L2', 'L1')).toBe(true);
    expect(authoritySatisfies('L3', 'L2')).toBe(true);
    expect(authoritySatisfies('L0', 'L1')).toBe(false);
    expect(authoritySatisfies('L1', 'L2')).toBe(false);
    expect(authoritySatisfies('L2', 'L3')).toBe(false);
  });

  it('bounds plan expiry to the 15-minute policy cap', () => {
    expect(DEFAULT_MAX_APPROVAL_TTL_MS).toBe(900_000);
    const created = TEST_NOW;
    const policyBound = new Date(created.getTime() + DEFAULT_MAX_APPROVAL_TTL_MS).toISOString();
    expect(computePlanExpiry(created, undefined, DEFAULT_MAX_APPROVAL_TTL_MS)).toBe(policyBound);

    const earlier = new Date(created.getTime() + 60_000).toISOString();
    expect(computePlanExpiry(created, earlier, DEFAULT_MAX_APPROVAL_TTL_MS)).toBe(earlier);

    const later = new Date(created.getTime() + DEFAULT_MAX_APPROVAL_TTL_MS + 60_000).toISOString();
    expect(computePlanExpiry(created, later, DEFAULT_MAX_APPROVAL_TTL_MS)).toBe(policyBound);
  });

  it('rejects a caller expires_at that is not after created_at', () => {
    expect(() => computePlanExpiry(TEST_NOW, TEST_NOW.toISOString(), DEFAULT_MAX_APPROVAL_TTL_MS)).toThrow(ApprovalError);
    expect(() =>
      computePlanExpiry(TEST_NOW, new Date(TEST_NOW.getTime() - 1).toISOString(), DEFAULT_MAX_APPROVAL_TTL_MS),
    ).toThrow('APPROVAL_INPUT_INVALID');
    expect(() => computePlanExpiry(TEST_NOW, 'not-a-date', DEFAULT_MAX_APPROVAL_TTL_MS)).toThrow(ApprovalError);
  });

  it('defines expiry boundary as inclusive: now == expires_at is expired', () => {
    const expiresAt = new Date(TEST_NOW.getTime() + 1000).toISOString();
    expect(isExpiredAt(expiresAt, TEST_NOW)).toBe(false);
    expect(isExpiredAt(expiresAt, new Date(Date.parse(expiresAt)))).toBe(true);
    expect(isExpiredAt(expiresAt, new Date(Date.parse(expiresAt) + 1))).toBe(true);
  });
});

describe('caller authority boundary (strict schemas)', () => {
  it('accepts a well-formed write authorization request', () => {
    const parsed = ExecutionAuthorizationRequestSchema.safeParse(writeRequest());
    expect(parsed.success).toBe(true);
    expect((parsed.data as ExecutionAuthorizationRequest).normalized_inputs).toEqual({ repo: 'repo-a' });
  });

  const callerAuthorityKeys = [
    'required_approval',
    'risk_snapshot',
    'state',
    'approval',
    'evidence_coverage_snapshot',
    'plan_id',
    'now',
    'granted_at',
  ] as const;
  for (const key of callerAuthorityKeys) {
    it(`rejects caller-supplied '${key}'`, () => {
      const parsed = ExecutionAuthorizationRequestSchema.safeParse(writeRequest({ [key]: {} }));
      expect(parsed.success).toBe(false);
    });
  }

  it('rejects any unknown request key (strict)', () => {
    expect(ExecutionAuthorizationRequestSchema.safeParse(writeRequest({ surprise: true })).success).toBe(false);
  });

  it('rejects reserved normalized_inputs top-level keys', () => {
    for (const key of ['shell', 'command', 'exec', 'bash', 'powershell', 'cmd', 'cmdline', 'script']) {
      const parsed = ExecutionAuthorizationRequestSchema.safeParse(
        writeRequest({ normalized_inputs: { [key]: 'echo hi' } }),
      );
      expect(parsed.success).toBe(false);
    }
  });

  it('only allows owner/admin actors with source trusted_local', () => {
    expect(
      TrustedApprovalActorSchema.safeParse({
        actor_id: 'owner-alice',
        actor_kind: 'owner',
        authority_level: 'L2',
        source: 'trusted_local',
      }).success,
    ).toBe(true);
    expect(
      TrustedApprovalActorSchema.safeParse({
        actor_id: 'admin-bob',
        actor_kind: 'admin',
        authority_level: 'L3',
        source: 'trusted_local',
      }).success,
    ).toBe(true);
    for (const bad of [
      { actor_id: 'm1', actor_kind: 'model', authority_level: 'L3', source: 'trusted_local' },
      { actor_id: 's1', actor_kind: 'skill', authority_level: 'L3', source: 'trusted_local' },
      { actor_id: 'p1', actor_kind: 'provider', authority_level: 'L3', source: 'trusted_local' },
      { actor_id: 'u1', actor_kind: 'owner', authority_level: 'L3', source: 'untrusted_api' },
      { actor_id: 'u2', actor_kind: 'owner', authority_level: 'L4', source: 'trusted_local' },
    ]) {
      expect(TrustedApprovalActorSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('approval binding digest', () => {
  function bindingInputs() {
    return {
      plan_id: 'plan-00000000-0000-4000-8000-000000000001',
      decision_id: 'decision-1',
      capability_id: TEST_WRITE_CAPABILITY.id,
      capability_version: TEST_WRITE_CAPABILITY.version,
      adapter_id: 'test-adapter',
      normalized_inputs: { repo: 'repo-a' },
      risk_snapshot: deriveRiskSnapshot(TEST_WRITE_CAPABILITY),
      evidence_coverage_snapshot: { entries: [] },
      evidence_guard_run_id: 'run-1',
      timeout_ms: 5000,
      verification_plan: {
        verification_capability_id: TEST_READ_CAPABILITY.id,
        verification_inputs: { id: 'resource-1' },
      },
      rollback_plan: {
        rollback_capability_id: 'test.resource.rollback',
        rollback_inputs: { id: 'resource-1' },
      },
      created_at: TEST_NOW.toISOString(),
      expires_at: new Date(TEST_NOW.getTime() + 60_000).toISOString(),
      policy_version: APPROVAL_POLICY_VERSION,
    };
  }

  it('excludes state and approval from the binding payload', () => {
    const payload = buildApprovalBindingPayload(bindingInputs());
    expect(payload).not.toHaveProperty('state');
    expect(payload).not.toHaveProperty('approval');
    expect(Object.keys(payload).sort()).toEqual(
      [
        'adapter_id',
        'capability_id',
        'capability_version',
        'created_at',
        'decision_id',
        'evidence_coverage_digest',
        'evidence_guard_run_id',
        'expires_at',
        'normalized_inputs_digest',
        'plan_id',
        'policy_version',
        'risk_snapshot_digest',
        'rollback_plan_digest',
        'timeout_ms',
        'verification_plan_digest',
      ].sort(),
    );
  });

  it('rejects state/approval keys on the payload (strict)', () => {
    const payload = buildApprovalBindingPayload(bindingInputs());
    expect(ApprovalBindingPayloadSchema.safeParse({ ...payload, state: 'ready' }).success).toBe(false);
    expect(ApprovalBindingPayloadSchema.safeParse({ ...payload, approval: {} }).success).toBe(false);
  });

  it('is deterministic for the same semantic inputs', () => {
    const first = approvalBindingDigest(buildApprovalBindingPayload(bindingInputs()));
    const second = approvalBindingDigest(buildApprovalBindingPayload(bindingInputs()));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is invariant to object key insertion order', () => {
    const inputs = bindingInputs();
    const a = approvalBindingDigest(
      buildApprovalBindingPayload({
        ...inputs,
        risk_snapshot: {
          capability_version: '1.0.0',
          risk_level: 'medium',
          reversible: true,
          side_effect_class: 'reversible_write',
          required_authority: 'L2',
        },
      }),
    );
    const b = approvalBindingDigest(
      buildApprovalBindingPayload({
        ...inputs,
        risk_snapshot: {
          required_authority: 'L2',
          side_effect_class: 'reversible_write',
          risk_level: 'medium',
          reversible: true,
          capability_version: '1.0.0',
        },
      }),
    );
    expect(a).toBe(b);
  });

  it('rejects non-JSON-safe binding values', () => {
    expect(() => digestJsonValue({ value: NaN })).toThrow('APPROVAL_INPUT_INVALID');
    expect(() => digestJsonValue({ value: Infinity })).toThrow('APPROVAL_INPUT_INVALID');
    expect(() => digestJsonValue({ value: undefined })).toThrow('APPROVAL_INPUT_INVALID');
    expect(() => digestJsonValue({ value: BigInt(1) })).toThrow('APPROVAL_INPUT_INVALID');
    expect(() => digestJsonValue({ value: new Date() })).toThrow('APPROVAL_INPUT_INVALID');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => digestJsonValue(cyclic)).toThrow('APPROVAL_INPUT_INVALID');
  });

  it('changes when any bound semantic changes', () => {
    const base = approvalBindingDigest(buildApprovalBindingPayload(bindingInputs()));
    const mutations: Array<Record<string, unknown>> = [
      { normalized_inputs: { repo: 'repo-b' } },
      { adapter_id: 'other-adapter' },
      { timeout_ms: 5001 },
      { decision_id: 'decision-2' },
      { capability_version: '1.0.1' },
      { expires_at: new Date(TEST_NOW.getTime() + 120_000).toISOString() },
      { verification_plan: { verification_capability_id: TEST_READ_CAPABILITY.id, verification_inputs: { id: 'other' } } },
      { rollback_plan: { rollback_capability_id: 'test.resource.rollback', rollback_inputs: { id: 'other' } } },
      { evidence_coverage_snapshot: { entries: [] }, risk_snapshot: { risk_level: 'high', reversible: true, side_effect_class: 'reversible_write', required_authority: 'L3', capability_version: '1.0.0' } },
    ];
    for (const mutation of mutations) {
      const mutated = approvalBindingDigest(buildApprovalBindingPayload({ ...bindingInputs(), ...mutation }));
      expect(mutated).not.toBe(base);
    }
  });
});

describe('approval request record', () => {
  it('accepts a pending record with the required fields', () => {
    const record = {
      approval_request_id: 'apr-1',
      plan_id: 'plan-00000000-0000-4000-8000-000000000001',
      decision_id: 'decision-1',
      capability_id: TEST_WRITE_CAPABILITY.id,
      capability_version: '1.0.0',
      risk_snapshot: deriveRiskSnapshot(TEST_WRITE_CAPABILITY),
      side_effect_summary: { side_effect_class: 'reversible_write', reversible: true },
      reversible: true,
      evidence_summary: {
        guard_run_id: 'run-1',
        coverage_digest: 'a'.repeat(64),
        mandatory_classes: [],
        mandatory_satisfied: true,
      },
      coverage_digest: 'a'.repeat(64),
      normalized_inputs_digest: 'b'.repeat(64),
      approval_binding_digest: 'c'.repeat(64),
      required_authority: 'L2',
      policy_version: APPROVAL_POLICY_VERSION,
      created_at: TEST_NOW.toISOString(),
      expires_at: new Date(TEST_NOW.getTime() + 60_000).toISOString(),
      status: 'pending',
    };
    expect(ApprovalRequestRecordSchema.safeParse(record).success).toBe(true);
  });

  it('is strict and carries no secret fields', () => {
    const base = ApprovalRequestRecordSchema.parse({
      approval_request_id: 'apr-1',
      plan_id: 'plan-00000000-0000-4000-8000-000000000001',
      decision_id: 'decision-1',
      capability_id: TEST_WRITE_CAPABILITY.id,
      capability_version: '1.0.0',
      risk_snapshot: deriveRiskSnapshot(TEST_WRITE_CAPABILITY),
      side_effect_summary: { side_effect_class: 'reversible_write', reversible: true },
      reversible: true,
      evidence_summary: { guard_run_id: 'run-1', coverage_digest: 'a'.repeat(64), mandatory_classes: [], mandatory_satisfied: true },
      coverage_digest: 'a'.repeat(64),
      normalized_inputs_digest: 'b'.repeat(64),
      approval_binding_digest: 'c'.repeat(64),
      required_authority: 'L2',
      policy_version: APPROVAL_POLICY_VERSION,
      created_at: TEST_NOW.toISOString(),
      expires_at: new Date(TEST_NOW.getTime() + 60_000).toISOString(),
      status: 'pending',
    });
    expect(ApprovalRequestRecordSchema.safeParse({ ...base, token: 'secret' }).success).toBe(false);
    expect(ApprovalRequestRecordSchema.safeParse({ ...base, status: 'approved' }).success).toBe(false);
  });
});

describe('server-owned plan id', () => {
  it('generates plan ids matching PLAN_ID_PATTERN', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateAuthorizationPlanId()).toMatch(PLAN_ID_PATTERN);
    }
  });

  it('never reuses a plan id', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateAuthorizationPlanId()));
    expect(ids.size).toBe(100);
  });
});