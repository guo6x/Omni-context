/**
 * Goal24 Checkpoint 7 (Lane A) - Brain authorization service lifecycle tests.
 *
 * Deterministic fixtures: synthetic capabilities, CP6 guard-run seeding,
 * fake native grant verifiers and a mutable trusted clock. The real
 * EvidenceEligibilityService is used so forged coverage can never enter CP7.
 */

import { describe, expect, it } from 'vitest';
import { GITHUB_READONLY_CAPABILITIES } from '../src/capabilities/github-readonly.js';
import type { CapabilityDefinition } from '../src/capabilities/contracts.js';
import type { JsonObject } from '../src/contracts/json-safe.js';
import {
  AuthorizationService,
  AuthorizationStore,
  ApprovalError,
  APPROVAL_POLICY_VERSION,
  DEFAULT_MAX_APPROVAL_TTL_MS,
  type ApprovalGrantVerifier,
  type PlanAuthorizationRecord,
} from '../src/approval/index.js';
import {
  CapabilityEvidenceSubjectResolverRegistry,
  EvidenceEligibilityService,
  GuardRunStore,
  QualifiedEvidenceStore,
  githubSubjectResolverRegistry,
} from '../src/evidence/index.js';
import {
  adminActor,
  bareApprovalReference,
  fakeGrant,
  ownerActor,
  rejectingGrantVerifier,
  seedEligibleGuardRun,
  TEST_DESTRUCTIVE_CAPABILITY,
  TEST_NOW,
  TEST_READ_CAPABILITY,
  TEST_WRITE_CAPABILITY,
  testCapabilityLookup,
  testSubjectResolvers,
  verifyingGrantVerifier,
} from './helpers/fake-approval.js';

interface ServiceFixture {
  service: AuthorizationService;
  guardRunStore: GuardRunStore;
  store: AuthorizationStore;
  now: Date;
  setNow: (next: Date) => void;
  withVerifier: (verifier: ApprovalGrantVerifier) => void;
  withPolicyVersion: (policyVersion: string) => void;
}

interface MakeFixtureOptions {
  capabilities?: readonly CapabilityDefinition[];
  subjectResolvers?: CapabilityEvidenceSubjectResolverRegistry;
  policyVersion?: string;
  verifier?: ApprovalGrantVerifier;
  maxTtlMs?: number;
  store?: AuthorizationStore;
  now?: Date;
}

function makeFixture(options: MakeFixtureOptions = {}): ServiceFixture {
  const state = { current: options.now ?? new Date(TEST_NOW) };
  const guardRunStore = new GuardRunStore();
  const qualifiedStore = new QualifiedEvidenceStore();
  const subjectResolvers = options.subjectResolvers ?? testSubjectResolvers();
  const eligibility = new EvidenceEligibilityService({
    guardRunStore,
    qualifiedEvidenceStore: qualifiedStore,
    capabilityLookup: testCapabilityLookup(options.capabilities),
    subjectResolvers,
    clock: () => state.current,
  });
  const store = options.store ?? new AuthorizationStore();
  let lastVerifier: ApprovalGrantVerifier = options.verifier ?? rejectingGrantVerifier();
  const holder: { service: AuthorizationService } = { service: buildService(lastVerifier, options.policyVersion) };

  function buildService(verifier: ApprovalGrantVerifier, policyVersion?: string): AuthorizationService {
    return new AuthorizationService({
      capabilityLookup: testCapabilityLookup(options.capabilities),
      evidenceEligibility: eligibility,
      grantVerifier: verifier,
      store,
      clock: () => state.current,
      ...(policyVersion !== undefined ? { policyVersion } : {}),
      ...(options.maxTtlMs !== undefined ? { maxApprovalTtlMs: options.maxTtlMs } : {}),
    });
  }

  return {
    get service(): AuthorizationService {
      return holder.service;
    },
    guardRunStore,
    store,
    now: state.current,
    setNow: (next: Date) => {
      state.current = next;
    },
    withVerifier: (verifier: ApprovalGrantVerifier) => {
      lastVerifier = verifier;
      holder.service = buildService(verifier, options.policyVersion);
    },
    withPolicyVersion: (policyVersion: string) => {
      holder.service = buildService(lastVerifier, policyVersion);
    },
  };
}

function writeRequest(fixture: ServiceFixture, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const guardRun = seedEligibleGuardRun({
    guardRunStore: fixture.guardRunStore,
    capability: TEST_WRITE_CAPABILITY,
    normalizedInputs: { repo: 'repo-a' },
  });
  return {
    decision_id: 'decision-1',
    capability_id: TEST_WRITE_CAPABILITY.id,
    capability_version: TEST_WRITE_CAPABILITY.version,
    adapter_id: 'test-adapter',
    normalized_inputs: { repo: 'repo-a' },
    guard_run_id: guardRun.guard_run_id,
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

function authorizeWrite(
  fixture: ServiceFixture,
  overrides: Record<string, unknown> = {},
): ReturnType<AuthorizationService['authorize']> {
  return fixture.service.authorize(writeRequest(fixture, overrides));
}

function l2Grant(fixture: ServiceFixture) {
  return fakeGrant({
    actor: ownerActor('L2'),
    grantedAt: fixture.now,
    expiresAt: new Date(fixture.now.getTime() + 60_000),
  });
}

function approveWith(fixture: ServiceFixture, grant: ReturnType<typeof fakeGrant>): void {
  fixture.withVerifier(verifyingGrantVerifier(grant));
}

describe('authorization policy lifecycle', () => {
  it('read-only capability is ready without approval', () => {
    const fixture = makeFixture();
    const guardRun = seedEligibleGuardRun({
      guardRunStore: fixture.guardRunStore,
      capability: TEST_READ_CAPABILITY,
      normalizedInputs: { id: 'resource-1' },
    });
    const result = fixture.service.authorize({
      decision_id: 'decision-1',
      capability_id: TEST_READ_CAPABILITY.id,
      capability_version: TEST_READ_CAPABILITY.version,
      adapter_id: 'test-adapter',
      normalized_inputs: { id: 'resource-1' },
      guard_run_id: guardRun.guard_run_id,
      timeout_ms: 5000,
      verification_plan: null,
      rollback_plan: null,
    });
    expect(result.required_approval).toBe(false);
    expect(result.plan.state).toBe('ready');
    expect(result.plan.approval).toBeNull();
    expect(result.approval_request).toBeNull();
    expect(result.plan.required_approval).toBe(false);
  });

  it('the five CP4 read capabilities remain approval-free', () => {
    const inputsByCapability: Record<string, JsonObject> = {
      'github.repo.inspect': { owner: 'acme', repo: 'repo' },
      'github.issue.search': { owner: 'acme', repo: 'repo' },
      'github.issue.read': { owner: 'acme', repo: 'repo', number: 1 },
      'github.pr.read': { owner: 'acme', repo: 'repo', number: 1 },
      'github.pr.checks.read': { owner: 'acme', repo: 'repo', number: 1 },
    };
    const subjectResolvers = githubSubjectResolverRegistry();
    const fixture = makeFixture({ capabilities: GITHUB_READONLY_CAPABILITIES, subjectResolvers });
    for (const capability of GITHUB_READONLY_CAPABILITIES) {
      const normalizedInputs = inputsByCapability[capability.id];
      const subjectKey = subjectResolvers.resolve(capability.id, normalizedInputs);
      const guardRun = seedEligibleGuardRun({
        guardRunStore: fixture.guardRunStore,
        capability,
        normalizedInputs,
        subjectKey,
      });
      const result = fixture.service.authorize({
        decision_id: `decision-${capability.id}`,
        capability_id: capability.id,
        capability_version: capability.version,
        adapter_id: 'github-cli',
        normalized_inputs: normalizedInputs,
        guard_run_id: guardRun.guard_run_id,
        timeout_ms: 5000,
        verification_plan: null,
        rollback_plan: null,
      });
      expect(result.required_approval).toBe(false);
      expect(result.plan.state).toBe('ready');
    }
  });

  it('synthetic medium/L2 write requires approval and waits', () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    expect(result.required_approval).toBe(true);
    expect(result.plan.state).toBe('awaiting_approval');
    expect(result.plan.approval).toBeNull();
    expect(result.approval_request).not.toBeNull();
    expect(result.approval_request?.status).toBe('pending');
    expect(result.approval_request?.required_authority).toBe('L2');
    expect(result.approval_request?.policy_version).toBe(APPROVAL_POLICY_VERSION);
    expect(result.approval_request?.risk_snapshot).toEqual({
      risk_level: 'medium',
      reversible: true,
      side_effect_class: 'reversible_write',
      required_authority: 'L2',
      capability_version: '1.0.0',
    });
    expect(result.plan.risk_snapshot.risk_level).toBe('medium');
    expect(result.approval_binding_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(result.plan.expires_at ?? '')).toBeLessThanOrEqual(
      fixture.now.getTime() + DEFAULT_MAX_APPROVAL_TTL_MS,
    );
  });

  it('high-risk L3 destructive write also waits for approval', () => {
    const fixture = makeFixture();
    const guardRun = seedEligibleGuardRun({
      guardRunStore: fixture.guardRunStore,
      capability: TEST_DESTRUCTIVE_CAPABILITY,
      normalizedInputs: { repo: 'repo-a' },
    });
    const result = fixture.service.authorize({
      decision_id: 'decision-1',
      capability_id: TEST_DESTRUCTIVE_CAPABILITY.id,
      capability_version: TEST_DESTRUCTIVE_CAPABILITY.version,
      adapter_id: 'test-adapter',
      normalized_inputs: { repo: 'repo-a' },
      guard_run_id: guardRun.guard_run_id,
      timeout_ms: 5000,
      verification_plan: {
        verification_capability_id: TEST_READ_CAPABILITY.id,
        verification_inputs: { id: 'resource-1' },
      },
      rollback_plan: null,
    });
    expect(result.required_approval).toBe(true);
    expect(result.plan.state).toBe('awaiting_approval');
    expect(result.approval_request?.required_authority).toBe('L3');
    expect(result.plan.risk_snapshot.risk_level).toBe('high');
  });

  it('caller cannot force required_approval=false for a medium/L2 write', () => {
    const fixture = makeFixture();
    expect(() => authorizeWrite(fixture, { required_approval: false })).toThrow('APPROVAL_INPUT_INVALID');
  });

  it('caller cannot supply risk_snapshot', () => {
    const fixture = makeFixture();
    expect(() => authorizeWrite(fixture, { risk_snapshot: { risk_level: 'low' } })).toThrow('APPROVAL_INPUT_INVALID');
  });

  it('caller cannot choose state=ready', () => {
    const fixture = makeFixture();
    expect(() => authorizeWrite(fixture, { state: 'ready' })).toThrow('APPROVAL_INPUT_INVALID');
  });

  it('caller cannot supply approval', () => {
    const fixture = makeFixture();
    expect(() => authorizeWrite(fixture, { approval: {} })).toThrow('APPROVAL_INPUT_INVALID');
  });

  it('caller cannot supply plan_id', () => {
    const fixture = makeFixture();
    expect(() => authorizeWrite(fixture, { plan_id: 'plan-chosen-by-caller' })).toThrow('APPROVAL_INPUT_INVALID');
  });

  it('caller cannot inject evidence coverage', () => {
    const fixture = makeFixture();
    expect(() => authorizeWrite(fixture, { evidence_coverage_snapshot: { entries: [] } })).toThrow(
      'APPROVAL_INPUT_INVALID',
    );
  });

  it('a forged guard_run_id cannot materialize coverage', () => {
    const fixture = makeFixture();
    expect(() => authorizeWrite(fixture, { guard_run_id: 'run-forged' })).toThrow('APPROVAL_EVIDENCE_INELIGIBLE');
  });

  it('an unknown capability is rejected', () => {
    const fixture = makeFixture();
    expect(() =>
      authorizeWrite(fixture, { capability_id: 'test.resource.missing', capability_version: '1.0.0' }),
    ).toThrow('APPROVAL_CAPABILITY_NOT_FOUND');
  });

  it('a wrong capability version is rejected', () => {
    const fixture = makeFixture();
    expect(() => authorizeWrite(fixture, { capability_version: '9.9.9' })).toThrow(
      'APPROVAL_CAPABILITY_VERSION_MISMATCH',
    );
  });
});

describe('approval grant enforcement', () => {
  it('a bare ApprovalReference can never ready a plan', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
      ),
    ).rejects.toThrow('APPROVAL_GRANT_INVALID');
    expect(fixture.service.getPlan(result.plan.plan_id)?.state).toBe('awaiting_approval');
    expect(fixture.service.getRecord(result.plan.plan_id)?.approval_request?.status).toBe('pending');
  });

  it('a verified native grant moves the plan to ready', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    approveWith(fixture, l2Grant(fixture));
    const applied = await fixture.service.applyApproval(
      result.plan.plan_id,
      bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
    );
    expect(applied.plan.state).toBe('ready');
    expect(applied.plan.approval).not.toBeNull();
    expect(applied.plan.approval?.token_digest).toBe(result.approval_binding_digest);
    expect(applied.plan.approval?.granted_by).toBe('owner-alice');
    expect(applied.plan.approval?.policy_version).toBe(APPROVAL_POLICY_VERSION);
    const record = fixture.service.getRecord(result.plan.plan_id);
    expect(record?.approval_request?.status).toBe('granted');
    expect(record?.grant?.native_record_id).toBeDefined();
  });

  it('rejects a grant for a different plan id', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    approveWith(fixture, l2Grant(fixture));
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference('plan-00000000-0000-4000-8000-000000000999', APPROVAL_POLICY_VERSION),
      ),
    ).rejects.toThrow('APPROVAL_PLAN_MISMATCH');
  });

  it('rejects an L1 actor against an L2 capability', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    approveWith(
      fixture,
      fakeGrant({
        actor: ownerActor('L1'),
        grantedAt: fixture.now,
        expiresAt: new Date(fixture.now.getTime() + 60_000),
      }),
    );
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
      ),
    ).rejects.toThrow('APPROVAL_AUTHORITY_INSUFFICIENT');
    expect(fixture.service.getPlan(result.plan.plan_id)?.state).toBe('awaiting_approval');
  });

  it('accepts an L2 actor against an L2 capability', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    approveWith(fixture, l2Grant(fixture));
    const applied = await fixture.service.applyApproval(
      result.plan.plan_id,
      bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
    );
    expect(applied.plan.state).toBe('ready');
  });

  it('rejects an L2 actor against the high-risk L3 destructive capability', async () => {
    const fixture = makeFixture();
    const guardRun = seedEligibleGuardRun({
      guardRunStore: fixture.guardRunStore,
      capability: TEST_DESTRUCTIVE_CAPABILITY,
      normalizedInputs: { repo: 'repo-a' },
    });
    const result = fixture.service.authorize({
      decision_id: 'decision-1',
      capability_id: TEST_DESTRUCTIVE_CAPABILITY.id,
      capability_version: TEST_DESTRUCTIVE_CAPABILITY.version,
      adapter_id: 'test-adapter',
      normalized_inputs: { repo: 'repo-a' },
      guard_run_id: guardRun.guard_run_id,
      timeout_ms: 5000,
      verification_plan: {
        verification_capability_id: TEST_READ_CAPABILITY.id,
        verification_inputs: { id: 'resource-1' },
      },
      rollback_plan: null,
    });
    approveWith(fixture, l2Grant(fixture));
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
      ),
    ).rejects.toThrow('APPROVAL_AUTHORITY_INSUFFICIENT');
  });

  it('allows an L3 owner to grant the L3 destructive capability (still not executed)', async () => {
    const fixture = makeFixture();
    const guardRun = seedEligibleGuardRun({
      guardRunStore: fixture.guardRunStore,
      capability: TEST_DESTRUCTIVE_CAPABILITY,
      normalizedInputs: { repo: 'repo-a' },
    });
    const result = fixture.service.authorize({
      decision_id: 'decision-1',
      capability_id: TEST_DESTRUCTIVE_CAPABILITY.id,
      capability_version: TEST_DESTRUCTIVE_CAPABILITY.version,
      adapter_id: 'test-adapter',
      normalized_inputs: { repo: 'repo-a' },
      guard_run_id: guardRun.guard_run_id,
      timeout_ms: 5000,
      verification_plan: {
        verification_capability_id: TEST_READ_CAPABILITY.id,
        verification_inputs: { id: 'resource-1' },
      },
      rollback_plan: null,
    });
    approveWith(
      fixture,
      fakeGrant({
        actor: ownerActor('L3'),
        grantedAt: fixture.now,
        expiresAt: new Date(fixture.now.getTime() + 60_000),
      }),
    );
    const applied = await fixture.service.applyApproval(
      result.plan.plan_id,
      bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
    );
    expect(applied.plan.state).toBe('ready');
    expect(fixture.service.getPlan(result.plan.plan_id)?.state).toBe('ready');
  });

  it('rejects an expired grant', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    approveWith(
      fixture,
      fakeGrant({
        actor: ownerActor('L2'),
        grantedAt: new Date(fixture.now.getTime() - 120_000),
        expiresAt: fixture.now,
      }),
    );
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
      ),
    ).rejects.toThrow('APPROVAL_GRANT_EXPIRED');
  });

  it('rejects a grant with a future granted_at', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    approveWith(
      fixture,
      fakeGrant({
        actor: ownerActor('L2'),
        grantedAt: new Date(fixture.now.getTime() + 1000),
        expiresAt: new Date(fixture.now.getTime() + 60_000),
      }),
    );
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
      ),
    ).rejects.toThrow('APPROVAL_GRANT_INVALID');
  });

  it('rejects a grant that expires after the plan expiry / policy cap', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    const planExpiry = Date.parse(result.plan.expires_at ?? '');
    approveWith(
      fixture,
      fakeGrant({
        actor: ownerActor('L2'),
        grantedAt: fixture.now,
        expiresAt: new Date(planExpiry + 1000),
      }),
    );
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
      ),
    ).rejects.toThrow('APPROVAL_GRANT_INVALID');
  });

  it('rejects a reference bound to a stale policy version', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    approveWith(fixture, l2Grant(fixture));
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, 'goal24-approval-policy-v0'),
      ),
    ).rejects.toThrow('APPROVAL_POLICY_VERSION_MISMATCH');
  });

  it('a runtime policy version change invalidates old pending approvals', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    fixture.withPolicyVersion('goal24-approval-policy-v2');
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, 'goal24-approval-policy-v2'),
      ),
    ).rejects.toThrow('APPROVAL_POLICY_VERSION_MISMATCH');
  });

  it('denied approvals can never ready a plan', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    const denied = fixture.service.denyApproval(result.plan.plan_id);
    expect(denied.plan.state).toBe('blocked');
    expect(denied.approval_request?.status).toBe('denied');
    approveWith(fixture, l2Grant(fixture));
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
      ),
    ).rejects.toThrow('APPROVAL_STATE_CONFLICT');
  });

  it('revoked approvals block the plan and cannot be re-applied', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    approveWith(fixture, l2Grant(fixture));
    await fixture.service.applyApproval(
      result.plan.plan_id,
      bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
    );
    const revoked = fixture.service.revokeApproval(result.plan.plan_id);
    expect(revoked.plan.state).toBe('blocked');
    expect(revoked.plan.approval).toBeNull();
    expect(revoked.approval_request?.status).toBe('revoked');
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
      ),
    ).rejects.toThrow('APPROVAL_STATE_CONFLICT');
  });

  it('an expired pending approval can never ready a plan', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    fixture.setNow(new Date(Date.parse(result.plan.expires_at ?? '') + 1000));
    approveWith(fixture, l2Grant(fixture));
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
      ),
    ).rejects.toThrow('APPROVAL_REQUEST_EXPIRED');
  });

  it('sweepExpired blocks expired pending approvals and expired grants', async () => {
    const fixture = makeFixture();
    const pending = authorizeWrite(fixture);

    const otherGrant = fakeGrant({
      actor: adminActor('L2'),
      grantedAt: fixture.now,
      expiresAt: new Date(fixture.now.getTime() + 60_000),
    });
    approveWith(fixture, otherGrant);
    const second = authorizeWrite(fixture);
    await fixture.service.applyApproval(
      second.plan.plan_id,
      bareApprovalReference(second.plan.plan_id, APPROVAL_POLICY_VERSION),
    );
    expect(fixture.service.getPlan(second.plan.plan_id)?.state).toBe('ready');

    fixture.setNow(new Date(fixture.now.getTime() + DEFAULT_MAX_APPROVAL_TTL_MS + 1000));
    const affected = fixture.service.sweepExpired();
    expect(affected.sort()).toEqual([pending.plan.plan_id, second.plan.plan_id].sort());
    const pendingRecord = fixture.service.getRecord(pending.plan.plan_id);
    expect(pendingRecord?.plan.state).toBe('blocked');
    expect(pendingRecord?.approval_request?.status).toBe('expired');
    const grantedRecord = fixture.service.getRecord(second.plan.plan_id);
    expect(grantedRecord?.plan.state).toBe('blocked');
    expect(grantedRecord?.plan.approval).toBeNull();
    expect(grantedRecord?.approval_request?.status).toBe('expired');
  });
});

describe('immutable approval binding', () => {
  function tamper(
    fixture: ServiceFixture,
    planId: string,
    mutate: (record: PlanAuthorizationRecord) => PlanAuthorizationRecord,
  ): void {
    const record = fixture.service.getRecord(planId);
    if (!record) throw new Error('record missing');
    fixture.store.replace(mutate(record));
  }

  const tamperCases: Array<[string, (record: PlanAuthorizationRecord) => PlanAuthorizationRecord]> = [
    ['input swap', (record) => ({ ...record, plan: { ...record.plan, normalized_inputs: { repo: 'repo-b' } } })],
    [
      'coverage swap',
      (record) => ({
        ...record,
        plan: {
          ...record.plan,
          evidence_coverage_snapshot: {
            entries: [
              {
                evidence_class: 'pull_request.current_state',
                status: 'missing',
                verification_level: 'none',
                evidence_ids: [],
                checked_at: record.plan.created_at,
              },
            ],
          },
        },
      }),
    ],
    [
      'risk downgrade',
      (record) => ({
        ...record,
        plan: {
          ...record.plan,
          risk_snapshot: {
            risk_level: 'low',
            reversible: true,
            side_effect_class: 'reversible_write',
            required_authority: 'L2',
            capability_version: '1.0.0',
          },
        },
      }),
    ],
    ['adapter swap', (record) => ({ ...record, plan: { ...record.plan, adapter_id: 'other-adapter' } })],
    ['timeout mutation', (record) => ({ ...record, plan: { ...record.plan, timeout_ms: record.plan.timeout_ms + 100 } })],
    [
      'verification-plan mutation',
      (record) => ({
        ...record,
        plan: {
          ...record.plan,
          verification_plan: {
            verification_capability_id: TEST_READ_CAPABILITY.id,
            verification_inputs: { id: 'other-resource' },
          },
        },
      }),
    ],
    [
      'rollback-plan mutation',
      (record) => ({
        ...record,
        plan: {
          ...record.plan,
          rollback_plan: {
            rollback_capability_id: 'test.resource.rollback',
            rollback_inputs: { id: 'other-resource' },
          },
        },
      }),
    ],
    ['decision identity mutation', (record) => ({ ...record, plan: { ...record.plan, decision_id: 'decision-2' } })],
    [
      'expiry mutation',
      (record) => ({
        ...record,
        plan: { ...record.plan, expires_at: new Date(Date.parse(record.plan.expires_at ?? '') + 1000).toISOString() },
      }),
    ],
  ];

  for (const [label, mutate] of tamperCases) {
    it(`${label} invalidates the approval binding digest`, async () => {
      const fixture = makeFixture();
      const result = authorizeWrite(fixture);
      tamper(fixture, result.plan.plan_id, mutate);
      approveWith(fixture, l2Grant(fixture));
      await expect(
        fixture.service.applyApproval(
          result.plan.plan_id,
          bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
        ),
      ).rejects.toThrow('APPROVAL_BINDING_MISMATCH');
      expect(fixture.service.getPlan(result.plan.plan_id)?.state).not.toBe('ready');
    });
  }
});

describe('authorization store', () => {
  it('is bounded and fails closed when full', () => {
    const store = new AuthorizationStore(2);
    const fixture = makeFixture({ store });
    const first = authorizeWrite(fixture);
    const second = authorizeWrite(fixture);
    expect(first.plan.plan_id).not.toBe(second.plan.plan_id);
    expect(store.size).toBe(2);
    expect(() => authorizeWrite(fixture)).toThrow('APPROVAL_STORE_FULL');
  });

  it('rejects duplicate plan ids', () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    const record = fixture.service.getRecord(result.plan.plan_id);
    if (!record) throw new Error('record missing');
    expect(() => fixture.store.put(record)).toThrow('APPROVAL_STORE_CONFLICT');
  });

  it('does not know plans that were never authorized', () => {
    const fixture = makeFixture();
    expect(fixture.service.getRecord('plan-00000000-0000-4000-8000-000000000001')).toBeUndefined();
    expect(() => fixture.service.denyApproval('plan-00000000-0000-4000-8000-000000000001')).toThrow(
      'APPROVAL_PLAN_NOT_FOUND',
    );
  });
});

describe('fail-closed misc', () => {
  it('plans carry the guard run lineage and server-owned digests', () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    const record = fixture.service.getRecord(result.plan.plan_id);
    expect(record?.guard_run_id).toBeTruthy();
    expect(record?.approval_request?.coverage_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(record?.approval_request?.normalized_inputs_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(record?.approval_request?.approval_binding_digest).toBe(result.approval_binding_digest);
  });

  it('no system auto-approval: without applyApproval a write plan never becomes ready', () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    expect(result.plan.state).toBe('awaiting_approval');
    expect(fixture.service.getPlan(result.plan.plan_id)?.state).toBe('awaiting_approval');
  });

  it('verifier receives the server-owned binding digest', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    let seenDigest = '';
    fixture.withVerifier({
      verifyGrant: (request) => {
        seenDigest = request.approval_binding_digest;
        return { valid: true, grant: l2Grant(fixture) };
      },
    });
    await fixture.service.applyApproval(
      result.plan.plan_id,
      bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
    );
    expect(seenDigest).toBe(result.approval_binding_digest);
  });

  it('a caller expires_at can shorten but never extend the policy bound', () => {
    const fixture = makeFixture();
    const short = authorizeWrite(fixture, {
      expires_at: new Date(fixture.now.getTime() + 60_000).toISOString(),
    });
    expect(Date.parse(short.plan.expires_at ?? '')).toBe(fixture.now.getTime() + 60_000);
    const long = authorizeWrite(fixture, {
      expires_at: new Date(fixture.now.getTime() + DEFAULT_MAX_APPROVAL_TTL_MS + 60_000).toISOString(),
    });
    expect(Date.parse(long.plan.expires_at ?? '')).toBe(fixture.now.getTime() + DEFAULT_MAX_APPROVAL_TTL_MS);
  });

  it('rejects a caller expires_at before the trusted now', () => {
    const fixture = makeFixture();
    expect(() =>
      authorizeWrite(fixture, { expires_at: new Date(fixture.now.getTime() - 1000).toISOString() }),
    ).toThrow('APPROVAL_INPUT_INVALID');
  });

  it('grant with mismatched actor authority metadata is rejected', async () => {
    const fixture = makeFixture();
    const result = authorizeWrite(fixture);
    const grant = l2Grant(fixture);
    grant.authority = 'L3';
    approveWith(fixture, grant);
    await expect(
      fixture.service.applyApproval(
        result.plan.plan_id,
        bareApprovalReference(result.plan.plan_id, APPROVAL_POLICY_VERSION),
      ),
    ).rejects.toThrow('APPROVAL_GRANT_INVALID');
  });
});

describe('ApprovalError shape', () => {
  it('throws structured ApprovalError codes, not raw text', () => {
    const fixture = makeFixture();
    try {
      authorizeWrite(fixture, { state: 'ready' });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ApprovalError);
      expect((error as ApprovalError).code).toBe('APPROVAL_INPUT_INVALID');
    }
  });
});