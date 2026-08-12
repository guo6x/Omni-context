/**
 * Goal24 Checkpoint 2.2 contract tests: ExecutionPlan, evidence coverage,
 * approval reference and risk snapshot.
 *
 * Covers the 2.1 hardening (evidence status invariants, policy-aware coverage
 * assessment, verification/rollback binding, JSON-safe wire values, risk
 * snapshot version chain, approval record model, deterministic expiry) and the
 * 2.2 Lane A fail-closed semantics: unverified/conflicted(undefined policy)
 * evidence never satisfies mandatory requirements, and optional evidence never
 * gates execution.
 */

import { describe, expect, it } from 'vitest';
import { CapabilityDefinitionSchema, type CapabilityDefinition } from '../src/capabilities/contracts.js';
import {
  ApprovalReferenceSchema,
  assessEvidenceCoverage,
  EvidenceCoverageEntrySchema,
  EvidenceCoverageSnapshotSchema,
  ExecutionPlanSchema,
  FORBIDDEN_INPUT_KEYS,
  isExecutionPlanExpired,
  RiskSnapshotSchema,
  validateExecutionPlanAgainstCapabilities,
} from '../src/execution/contracts.js';

const NOW = '2026-08-12T12:00:00.000Z';
const LATER = '2026-08-12T13:00:00.000Z';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const readCapability = CapabilityDefinitionSchema.parse({
  id: 'github.issue.read',
  version: '1.2.0',
  description: 'Read a GitHub issue',
  input_schema: { type: 'object' },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

const writeCapability = CapabilityDefinitionSchema.parse({
  id: 'github.issue.create',
  version: '1.0.0',
  description: 'Create a GitHub issue',
  input_schema: { type: 'object' },
  required_authority: 'L1',
  risk_level: 'medium',
  reversible: true,
  side_effect_class: 'reversible_write',
  required_evidence: [
    { class_id: 'repository.current_state', mandatory: true, conflict_policy: 'reject' },
    { class_id: 'actor.authority', mandatory: true, verification_requirement: 'verified' },
  ],
  verification_capability: 'github.issue.read',
  rollback_capability: 'github.issue.close',
});

const closeCapability = CapabilityDefinitionSchema.parse({
  id: 'github.issue.close',
  version: '1.0.0',
  description: 'Close a GitHub issue',
  input_schema: { type: 'object' },
  required_authority: 'L2',
  risk_level: 'high',
  reversible: true,
  side_effect_class: 'reversible_write',
  required_evidence: ['pull_request.current_state', 'actor.authority'].map((classId) => ({ class_id: classId, mandatory: true })),
  verification_capability: 'github.issue.read',
});

const registry = new Map<string, CapabilityDefinition>([
  ['github.issue.read', readCapability],
  ['github.issue.create', writeCapability],
  ['github.issue.close', closeCapability],
]);
const lookup = (id: string) => registry.get(id);

function readPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    plan_id: 'plan-read-0001',
    decision_id: 'decision-abc-123',
    capability_id: 'github.issue.read',
    capability_version: '1.2.0',
    adapter_id: 'github-cli',
    normalized_inputs: { owner: 'guo6x', repo: 'Omni-context', issue_number: 17 },
    required_approval: false,
    approval: null,
    risk_snapshot: {
      risk_level: 'low',
      reversible: false,
      side_effect_class: 'read_only',
      required_authority: 'L0',
      capability_version: '1.2.0',
    },
    evidence_coverage_snapshot: { entries: [] },
    timeout_ms: 30_000,
    verification_plan: null,
    rollback_plan: null,
    state: 'ready',
    created_at: NOW,
    ...overrides,
  };
}

function writePlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    plan_id: 'plan-write-0002',
    decision_id: 'decision-abc-456',
    capability_id: 'github.issue.create',
    capability_version: '1.0.0',
    adapter_id: 'github-cli',
    normalized_inputs: { owner: 'guo6x', repo: 'Omni-context', title: 'Bug report', body: 'details' },
    required_approval: true,
    approval: {
      approval_id: 'approval-0001',
      plan_id: 'plan-write-0002',
      granted_by: 'owner',
      granted_at: NOW,
      policy_version: '1',
      token_reference: 'tokref-1',
      token_digest: 'digest-placeholder',
    },
    risk_snapshot: {
      risk_level: 'medium',
      reversible: true,
      side_effect_class: 'reversible_write',
      required_authority: 'L1',
      capability_version: '1.0.0',
    },
    evidence_coverage_snapshot: {
      entries: [
        {
          evidence_class: 'repository.current_state',
          status: 'present',
          verification_level: 'verified',
          evidence_ids: ['evt-1'],
          checked_at: NOW,
        },
        {
          evidence_class: 'actor.authority',
          status: 'present',
          verification_level: 'verified',
          evidence_ids: ['evt-2'],
          checked_at: NOW,
        },
      ],
    },
    timeout_ms: 60_000,
    verification_plan: {
      verification_capability_id: 'github.issue.read',
      verification_inputs: { owner: 'guo6x', repo: 'Omni-context', issue_number: 0 },
    },
    rollback_plan: {
      rollback_capability_id: 'github.issue.close',
      rollback_inputs: { owner: 'guo6x', repo: 'Omni-context', issue_number: 0 },
    },
    state: 'ready',
    created_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ExecutionPlan — valid shapes
// ---------------------------------------------------------------------------

describe('ExecutionPlan — valid', () => {
  it('accepts a valid read plan', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan());
    expect(result.success).toBe(true);
  });

  it('accepts a valid write plan with approval record, verification and rollback', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.approval?.approval_id).toBe('approval-0001');
      expect(result.data.verification_plan?.verification_capability_id).toBe('github.issue.read');
      expect(result.data.rollback_plan?.rollback_capability_id).toBe('github.issue.close');
    }
  });

  it('accepts a draft plan without approval even when approval is required', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan({ state: 'draft', approval: null }));
    expect(result.success).toBe(true);
  });

  it('accepts awaiting_approval with required_approval=true and no approval', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan({ state: 'awaiting_approval', approval: null }));
    expect(result.success).toBe(true);
  });

  it('keeps the approval record on a succeeded plan for auditability', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan({ state: 'succeeded' }));
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExecutionPlan — approval model (2.1)
// ---------------------------------------------------------------------------

describe('ExecutionPlan — approval model', () => {
  it('rejects an executable plan that requires approval but has no approval record', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan({ approval: null }));
    expect(result.success).toBe(false);
  });

  it('rejects awaiting_approval when required_approval=false', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ state: 'awaiting_approval' }));
    expect(result.success).toBe(false);
  });

  it('rejects an approval record when required_approval=false', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ approval: writePlan().approval }));
    expect(result.success).toBe(false);
  });

  it('rejects an approval whose plan_id does not match the plan', () => {
    const mismatched = { ...(writePlan().approval as object), plan_id: 'plan-other-999' };
    const result = ExecutionPlanSchema.safeParse(writePlan({ approval: mismatched }));
    expect(result.success).toBe(false);
  });

  it('rejects an approval record in a pre-approval state (draft)', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan({ state: 'draft' }));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ExecutionPlan — risk snapshot consistency
// ---------------------------------------------------------------------------

describe('ExecutionPlan — risk snapshot consistency (2.1)', () => {
  it('rejects a read_only plan carrying a rollback_plan', () => {
    const result = ExecutionPlanSchema.safeParse(
      readPlan({
        rollback_plan: { rollback_capability_id: 'github.issue.close', rollback_inputs: {} },
      }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a rollback_plan when risk_snapshot.reversible=false', () => {
    const result = ExecutionPlanSchema.safeParse(
      writePlan({ risk_snapshot: { ...(writePlan().risk_snapshot as object), reversible: false } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a write plan without verification_plan', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan({ verification_plan: null }));
    expect(result.success).toBe(false);
  });

  it('RiskSnapshotSchema rejects a missing capability_version', () => {
    const { capability_version: _unused, ...withoutVersion } = writePlan().risk_snapshot as any;
    const result = RiskSnapshotSchema.safeParse(withoutVersion);
    expect(result.success).toBe(false);
  });

  it('RiskSnapshotSchema rejects read_only with reversible=true', () => {
    const result = RiskSnapshotSchema.safeParse({
      risk_level: 'low',
      reversible: true,
      side_effect_class: 'read_only',
      required_authority: 'L0',
      capability_version: '1.0.0',
    });
    expect(result.success).toBe(false);
  });

  it('RiskSnapshotSchema rejects destructive_write with reversible=true', () => {
    const result = RiskSnapshotSchema.safeParse({
      risk_level: 'high',
      reversible: true,
      side_effect_class: 'destructive_write',
      required_authority: 'L3',
      capability_version: '1.0.0',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ExecutionPlan — timeout bounds
// ---------------------------------------------------------------------------

describe('ExecutionPlan — timeout bounds', () => {
  it('rejects timeout below the safety minimum', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ timeout_ms: 50 }));
    expect(result.success).toBe(false);
  });

  it('rejects timeout above the safety maximum', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ timeout_ms: 90_000_000 }));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ExecutionPlan — expiry (2.1)
// ---------------------------------------------------------------------------

describe('ExecutionPlan — expiry', () => {
  it('rejects expires_at not after created_at', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ expires_at: NOW }));
    expect(result.success).toBe(false);
  });

  it('rejects expires_at before created_at', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ expires_at: '2026-08-12T11:00:00.000Z' }));
    expect(result.success).toBe(false);
  });

  it('accepts expires_at after created_at', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ expires_at: LATER }));
    expect(result.success).toBe(true);
  });

  it('isExecutionPlanExpired is deterministic and injected-now', () => {
    const plan = ExecutionPlanSchema.parse(readPlan({ expires_at: LATER }));
    expect(isExecutionPlanExpired(plan, '2026-08-12T12:30:00.000Z')).toBe(false);
    expect(isExecutionPlanExpired(plan, LATER)).toBe(true);
    expect(isExecutionPlanExpired(plan, '2026-08-12T14:00:00.000Z')).toBe(true);
    const noExpiry = ExecutionPlanSchema.parse(readPlan());
    expect(isExecutionPlanExpired(noExpiry, '2030-01-01T00:00:00.000Z')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ExecutionPlan — security boundary
// ---------------------------------------------------------------------------

describe('ExecutionPlan — security boundary', () => {
  it('rejects a plan-level shell field', () => {
    const result = ExecutionPlanSchema.safeParse({ ...readPlan(), shell: 'rm -rf /' });
    expect(result.success).toBe(false);
  });

  it('rejects a plan-level command field', () => {
    const result = ExecutionPlanSchema.safeParse({ ...readPlan(), command: 'gh issue close 17' });
    expect(result.success).toBe(false);
  });

  it('rejects every reserved top-level input key', () => {
    for (const key of FORBIDDEN_INPUT_KEYS) {
      const result = ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: { [key]: 'x' } }));
      expect(result.success, `reserved key '${key}' must be rejected`).toBe(false);
    }
  });

  it('allows semantic text that mentions a command inside a string value', () => {
    const result = ExecutionPlanSchema.safeParse(
      readPlan({ normalized_inputs: { body: 'The command failed on Windows: gh issue close 17', command_output: 'rm -rf is dangerous' } }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// JSON-safe wire contract (2.1)
// ---------------------------------------------------------------------------

describe('JSON-safe wire contract', () => {
  it('rejects Date values in normalized_inputs', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: { when: new Date() } }));
    expect(result.success).toBe(false);
  });

  it('rejects BigInt values', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: { count: 42n as unknown } }));
    expect(result.success).toBe(false);
  });

  it('rejects function values', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: { fn: (() => 1) as unknown } }));
    expect(result.success).toBe(false);
  });

  it('rejects symbol values', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: { sym: Symbol('x') as unknown } }));
    expect(result.success).toBe(false);
  });

  it('rejects Map and Set values', () => {
    expect(ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: { m: new Map() as unknown } })).success).toBe(false);
    expect(ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: { s: new Set() as unknown } })).success).toBe(false);
  });

  it('rejects class instances', () => {
    class Example {
      value = 1;
    }
    const result = ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: { instance: new Example() as unknown } }));
    expect(result.success).toBe(false);
  });

  it('rejects circular objects without crashing the parser', () => {
    const circular: Record<string, unknown> = { nested: { a: 1 } };
    (circular.nested as Record<string, unknown>).back = circular;
    const result = ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: circular }));
    expect(result.success).toBe(false);
  });

  it('accepts deeply nested JSON values', () => {
    const result = ExecutionPlanSchema.safeParse(
      readPlan({ normalized_inputs: { deep: { list: [1, 2, { ok: true, text: 'command', nil: null }] } } }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects non-finite numbers', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: { n: Number.NaN } }));
    expect(result.success).toBe(false);
    const inf = ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: { n: Number.POSITIVE_INFINITY } }));
    expect(inf.success).toBe(false);
  });

  it('applies JSON-safety to verification and rollback inputs', () => {
    expect(
      ExecutionPlanSchema.safeParse(
        writePlan({ verification_plan: { verification_capability_id: 'github.issue.read', verification_inputs: { d: new Date() } } }),
      ).success,
    ).toBe(false);
    expect(
      ExecutionPlanSchema.safeParse(
        writePlan({ rollback_plan: { rollback_capability_id: 'github.issue.close', rollback_inputs: { d: new Date() } } }),
      ).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Evidence coverage — status invariants (2.1)
// ---------------------------------------------------------------------------

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    evidence_class: 'pull_request.current_state',
    status: 'present',
    verification_level: 'verified',
    evidence_ids: ['evt-1'],
    checked_at: NOW,
    ...overrides,
  };
}

describe('Evidence coverage — status invariants (2.1)', () => {
  it('rejects present with zero evidence ids (bypass closed)', () => {
    const result = EvidenceCoverageEntrySchema.safeParse(entry({ evidence_ids: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects present with conflict_evidence_ids', () => {
    const result = EvidenceCoverageEntrySchema.safeParse(entry({ conflict_evidence_ids: ['evt-2'] }));
    expect(result.success).toBe(false);
  });

  it('rejects present with stale_since', () => {
    const result = EvidenceCoverageEntrySchema.safeParse(entry({ stale_since: NOW }));
    expect(result.success).toBe(false);
  });

  it('rejects missing with non-empty evidence ids', () => {
    const result = EvidenceCoverageEntrySchema.safeParse(entry({ status: 'missing', evidence_ids: ['evt-1'] }));
    expect(result.success).toBe(false);
  });

  it('accepts missing with empty evidence ids', () => {
    const result = EvidenceCoverageEntrySchema.safeParse(entry({ status: 'missing', evidence_ids: [] }));
    expect(result.success).toBe(true);
  });

  it('rejects stale without stale_since', () => {
    const result = EvidenceCoverageEntrySchema.safeParse(entry({ status: 'stale' }));
    expect(result.success).toBe(false);
  });

  it('accepts stale with stale_since and evidence ids', () => {
    const result = EvidenceCoverageEntrySchema.safeParse(entry({ status: 'stale', stale_since: NOW }));
    expect(result.success).toBe(true);
  });

  it('rejects conflicted without conflict ids', () => {
    const result = EvidenceCoverageEntrySchema.safeParse(entry({ status: 'conflicted' }));
    expect(result.success).toBe(false);
  });

  it('rejects conflicted with overlapping evidence ids', () => {
    const result = EvidenceCoverageEntrySchema.safeParse(
      entry({ status: 'conflicted', conflict_evidence_ids: ['evt-1'] }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts conflicted with disjoint conflict ids', () => {
    const result = EvidenceCoverageEntrySchema.safeParse(
      entry({ status: 'conflicted', conflict_evidence_ids: ['evt-2'] }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects unverified with zero evidence ids', () => {
    const result = EvidenceCoverageEntrySchema.safeParse(entry({ status: 'unverified', evidence_ids: [] }));
    expect(result.success).toBe(false);
  });

  it('rejects duplicate coverage entries by evidence_class', () => {
    const result = EvidenceCoverageSnapshotSchema.safeParse({
      entries: [
        entry(),
        entry({ status: 'missing', evidence_ids: [] }),
      ],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Coverage assessment — policy aware (2.1)
// ---------------------------------------------------------------------------

describe('Coverage assessment — policy aware', () => {
  it('blocks a verified requirement satisfied only by asserted evidence', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'actor.authority', mandatory: true, verification_requirement: 'verified' }],
      { entries: [entry({ evidence_class: 'actor.authority', verification_level: 'asserted' })] },
    );
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.missing_mandatory).toContain('actor.authority');
    expect(assessment.blocking_reasons.some((reason) => reason.includes('verification_requirement=verified'))).toBe(true);
  });

  it('blocks conflict_policy=reject with conflicted evidence', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'repository.current_state', mandatory: true, conflict_policy: 'reject' }],
      { entries: [entry({ evidence_class: 'repository.current_state', status: 'conflicted', conflict_evidence_ids: ['evt-2'] })] },
    );
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.blocking_reasons.some((reason) => reason.includes('conflict_policy=reject'))).toBe(true);
  });

  it('tolerates conflict_policy=warn with a non-silent warning', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'repository.current_state', mandatory: true, conflict_policy: 'warn' }],
      { entries: [entry({ evidence_class: 'repository.current_state', status: 'conflicted', conflict_evidence_ids: ['evt-2'] })] },
    );
    expect(assessment.mandatory_satisfied).toBe(true);
    expect(assessment.warnings.some((warning) => warning.includes('conflict_policy=warn'))).toBe(true);
  });

  it('blocks stale evidence', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'repository.current_state', mandatory: true }],
      { entries: [entry({ evidence_class: 'repository.current_state', status: 'stale', stale_since: NOW })] },
    );
    expect(assessment.mandatory_satisfied).toBe(false);
  });

  it('blocks unverified evidence when verification is required', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'actor.authority', mandatory: true, verification_requirement: 'asserted' }],
      { entries: [entry({ evidence_class: 'actor.authority', status: 'unverified', verification_level: 'none' })] },
    );
    expect(assessment.mandatory_satisfied).toBe(false);
  });

  it('reports not_checked for a missing entry', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'branch_protection.rules', mandatory: true }],
      { entries: [] },
    );
    expect(assessment.missing_mandatory).toEqual(['branch_protection.rules']);
    expect(assessment.entries[0].status).toBe('not_checked');
  });
});

// ---------------------------------------------------------------------------
// Coverage assessment — fail-closed (2.2, Lane A)
// ---------------------------------------------------------------------------

describe('Coverage assessment — fail-closed (2.2)', () => {
  const satisfiedEntry = (classId: string) =>
    entry({ evidence_class: classId, status: 'present', verification_level: 'verified' });
  const unverifiedEntry = (classId: string) =>
    entry({ evidence_class: classId, status: 'unverified', verification_level: 'none' });
  const conflictedEntry = (classId: string) =>
    entry({ evidence_class: classId, status: 'conflicted', conflict_evidence_ids: ['evt-2'] });

  it('blocks mandatory unverified when verification_requirement is undefined', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'actor.authority', mandatory: true }],
      { entries: [unverifiedEntry('actor.authority')] },
    );
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.blocking_reasons.some((reason) => reason.includes('unverified'))).toBe(true);
  });

  it('blocks mandatory unverified even with verification_requirement=none', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'actor.authority', mandatory: true, verification_requirement: 'none' }],
      { entries: [unverifiedEntry('actor.authority')] },
    );
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.missing_mandatory).toContain('actor.authority');
  });

  it('blocks mandatory conflicted when conflict_policy is undefined (default reject)', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'repository.current_state', mandatory: true }],
      { entries: [conflictedEntry('repository.current_state')] },
    );
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.blocking_reasons.some((reason) => reason.includes('conflict_policy=reject'))).toBe(true);
  });

  it('blocks mandatory conflicted with conflict_policy=reject', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'repository.current_state', mandatory: true, conflict_policy: 'reject' }],
      { entries: [conflictedEntry('repository.current_state')] },
    );
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.missing_mandatory).toContain('repository.current_state');
  });

  it('satisfies mandatory conflicted with conflict_policy=warn and emits a warning', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'repository.current_state', mandatory: true, conflict_policy: 'warn' }],
      { entries: [conflictedEntry('repository.current_state')] },
    );
    expect(assessment.mandatory_satisfied).toBe(true);
    expect(assessment.warnings.some((warning) => warning.includes('conflict_policy=warn'))).toBe(true);
  });

  it('satisfies mandatory conflicted with conflict_policy=allow', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'repository.current_state', mandatory: true, conflict_policy: 'allow' }],
      { entries: [conflictedEntry('repository.current_state')] },
    );
    expect(assessment.mandatory_satisfied).toBe(true);
    expect(assessment.blocking_reasons).toEqual([]);
  });

  it('optional missing does not affect mandatory_satisfied', () => {
    const assessment = assessEvidenceCoverage(
      [
        { class_id: 'actor.authority', mandatory: true },
        { class_id: 'branch_protection.rules', mandatory: false },
      ],
      {
        entries: [
          satisfiedEntry('actor.authority'),
          { evidence_class: 'branch_protection.rules', status: 'missing', verification_level: 'none', evidence_ids: [], checked_at: NOW },
        ],
      },
    );
    expect(assessment.mandatory_satisfied).toBe(true);
    expect(assessment.blocking_reasons).toEqual([]);
    expect(assessment.non_blocking_findings.some((finding) => finding.includes('branch_protection.rules'))).toBe(true);
  });

  it('optional stale never enters blocking_reasons', () => {
    const assessment = assessEvidenceCoverage(
      [
        { class_id: 'actor.authority', mandatory: true },
        { class_id: 'branch_protection.rules', mandatory: false },
      ],
      {
        entries: [
          satisfiedEntry('actor.authority'),
          { evidence_class: 'branch_protection.rules', status: 'stale', verification_level: 'verified', evidence_ids: ['evt-9'], checked_at: NOW, stale_since: NOW },
        ],
      },
    );
    expect(assessment.mandatory_satisfied).toBe(true);
    expect(assessment.blocking_reasons.some((reason) => reason.includes('stale'))).toBe(false);
    expect(assessment.non_blocking_findings.some((finding) => finding.includes('stale'))).toBe(true);
  });

  it('optional unverified does not block', () => {
    const assessment = assessEvidenceCoverage(
      [
        { class_id: 'actor.authority', mandatory: true },
        { class_id: 'branch_protection.rules', mandatory: false },
      ],
      { entries: [satisfiedEntry('actor.authority'), unverifiedEntry('branch_protection.rules')] },
    );
    expect(assessment.mandatory_satisfied).toBe(true);
    expect(assessment.blocking_reasons).toEqual([]);
    expect(assessment.non_blocking_findings.some((finding) => finding.includes('unverified'))).toBe(true);
  });

  it('optional conflicted does not block the mandatory gate', () => {
    const assessment = assessEvidenceCoverage(
      [
        { class_id: 'actor.authority', mandatory: true },
        { class_id: 'branch_protection.rules', mandatory: false },
      ],
      { entries: [satisfiedEntry('actor.authority'), conflictedEntry('branch_protection.rules')] },
    );
    expect(assessment.mandatory_satisfied).toBe(true);
    expect(assessment.blocking_reasons).toEqual([]);
    expect(assessment.non_blocking_findings.some((finding) => finding.includes('conflicted'))).toBe(true);
  });

  it('present asserted satisfies verification_requirement=none', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'actor.authority', mandatory: true, verification_requirement: 'none' }],
      { entries: [entry({ evidence_class: 'actor.authority', status: 'present', verification_level: 'asserted' })] },
    );
    expect(assessment.mandatory_satisfied).toBe(true);
  });

  it('present asserted cannot satisfy verification_requirement=verified', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'actor.authority', mandatory: true, verification_requirement: 'verified' }],
      { entries: [entry({ evidence_class: 'actor.authority', status: 'present', verification_level: 'asserted' })] },
    );
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.blocking_reasons.some((reason) => reason.includes('verification_requirement=verified'))).toBe(true);
  });

  it('optional present with unmet verification level stays non-blocking', () => {
    const assessment = assessEvidenceCoverage(
      [
        { class_id: 'actor.authority', mandatory: true },
        { class_id: 'branch_protection.rules', mandatory: false, verification_requirement: 'verified' },
      ],
      {
        entries: [
          satisfiedEntry('actor.authority'),
          { evidence_class: 'branch_protection.rules', status: 'present', verification_level: 'asserted', evidence_ids: ['evt-7'], checked_at: NOW },
        ],
      },
    );
    expect(assessment.mandatory_satisfied).toBe(true);
    expect(assessment.blocking_reasons).toEqual([]);
  });
});
// ---------------------------------------------------------------------------
// Registry-bound validation (2.1)
// ---------------------------------------------------------------------------

describe('validateExecutionPlanAgainstCapabilities', () => {
  it('accepts a valid read plan against the registry', () => {
    const plan = ExecutionPlanSchema.parse(readPlan());
    expect(validateExecutionPlanAgainstCapabilities(plan, lookup)).toEqual([]);
  });

  it('accepts a valid write plan against the registry', () => {
    const plan = ExecutionPlanSchema.parse(writePlan());
    expect(validateExecutionPlanAgainstCapabilities(plan, lookup)).toEqual([]);
  });

  it('reports an unknown capability_id', () => {
    const plan = ExecutionPlanSchema.parse(readPlan({ capability_id: 'github.repo.inspect' }));
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'capability_id')).toBe(true);
  });

  it('reports a capability version mismatch (plan vs capability)', () => {
    const plan = ExecutionPlanSchema.parse(readPlan({ capability_version: '9.9.9' }));
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'capability_version')).toBe(true);
  });

  it('reports a risk snapshot capability_version not matching the plan version', () => {
    const plan = ExecutionPlanSchema.parse(
      readPlan({ risk_snapshot: { ...(readPlan().risk_snapshot as object), capability_version: '9.9.9' } }),
    );
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'risk_snapshot.capability_version')).toBe(true);
  });

  it('reports a risk snapshot that diverges from the capability declaration', () => {
    const plan = ExecutionPlanSchema.parse(
      readPlan({ risk_snapshot: { ...(readPlan().risk_snapshot as object), risk_level: 'high' } }),
    );
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'risk_snapshot.risk_level')).toBe(true);
  });

  it('reports missing mandatory evidence for an executable write plan', () => {
    const plan = ExecutionPlanSchema.parse(writePlan({ evidence_coverage_snapshot: { entries: [] } }));
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'evidence_coverage_snapshot')).toBe(true);
  });

  it('does not gate evidence coverage for draft plans', () => {
    const plan = ExecutionPlanSchema.parse(
      writePlan({ state: 'draft', approval: null, evidence_coverage_snapshot: { entries: [] } }),
    );
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'evidence_coverage_snapshot')).toBe(false);
  });
  it('fails an executable plan whose mandatory evidence is unverified (fail-closed)', () => {
    const plan = ExecutionPlanSchema.parse(
      writePlan({
        evidence_coverage_snapshot: {
          entries: [
            { evidence_class: 'repository.current_state', status: 'present', verification_level: 'verified', evidence_ids: ['evt-1'], checked_at: NOW },
            { evidence_class: 'actor.authority', status: 'unverified', verification_level: 'none', evidence_ids: ['evt-2'], checked_at: NOW },
          ],
        },
      }),
    );
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'evidence_coverage_snapshot')).toBe(true);
  });

  it('does not gate draft plans on unverified mandatory evidence', () => {
    const plan = ExecutionPlanSchema.parse(
      writePlan({
        state: 'draft',
        approval: null,
        evidence_coverage_snapshot: {
          entries: [
            { evidence_class: 'repository.current_state', status: 'present', verification_level: 'verified', evidence_ids: ['evt-1'], checked_at: NOW },
            { evidence_class: 'actor.authority', status: 'unverified', verification_level: 'none', evidence_ids: ['evt-2'], checked_at: NOW },
          ],
        },
      }),
    );
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'evidence_coverage_snapshot')).toBe(false);
  });

  it('rejects a verification capability unrelated to the capability contract', () => {
    const plan = ExecutionPlanSchema.parse(
      writePlan({ verification_plan: { verification_capability_id: 'github.pr.read', verification_inputs: {} } }),
    );
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'verification_plan.verification_capability_id')).toBe(true);
  });

  it('rejects a verification capability that does not exist in the registry', () => {
    const plan = ExecutionPlanSchema.parse(
      writePlan({ verification_plan: { verification_capability_id: 'github.repo.inspect', verification_inputs: {} } }),
    );
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'verification_plan.verification_capability_id')).toBe(true);
  });

  it('rejects a rollback capability unrelated to the capability contract', () => {
    const plan = ExecutionPlanSchema.parse(
      writePlan({ rollback_plan: { rollback_capability_id: 'github.pr.merge', rollback_inputs: {} } }),
    );
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'rollback_plan.rollback_capability_id')).toBe(true);
  });

  it('rejects a rollback capability that does not exist in the registry', () => {
    const plan = ExecutionPlanSchema.parse(
      writePlan({ rollback_plan: { rollback_capability_id: 'github.repo.inspect', rollback_inputs: {} } }),
    );
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'rollback_plan.rollback_capability_id')).toBe(true);
  });

  it('rejects a rollback plan on a capability that declares no rollback', () => {
    const plan = ExecutionPlanSchema.parse(
      writePlan({
        capability_id: 'github.issue.close',
        capability_version: '1.0.0',
        risk_snapshot: {
          risk_level: 'high',
          reversible: true,
          side_effect_class: 'reversible_write',
          required_authority: 'L2',
          capability_version: '1.0.0',
        },
        evidence_coverage_snapshot: {
          entries: [
            entry({ evidence_class: 'pull_request.current_state' }),
            entry({ evidence_class: 'actor.authority' }),
          ],
        },
        verification_plan: { verification_capability_id: 'github.issue.read', verification_inputs: {} },
        rollback_plan: { rollback_capability_id: 'github.issue.read', rollback_inputs: {} },
        required_approval: true,
        approval: {
          approval_id: 'approval-0002',
          plan_id: 'plan-write-0002',
          granted_by: 'owner',
          granted_at: NOW,
          policy_version: '1',
          token_reference: 'tokref-2',
          token_digest: 'digest-placeholder',
        },
      }),
    );
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'rollback_plan')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Approval reference
// ---------------------------------------------------------------------------

describe('ApprovalReference contract', () => {
  it('parses a grant record without a raw token on the wire', () => {
    const result = ApprovalReferenceSchema.safeParse({
      approval_id: 'approval-0001',
      plan_id: 'plan-write-0002',
      granted_by: 'owner',
      granted_at: NOW,
      policy_version: '1',
      token_reference: 'tokref-1',
      token_digest: 'digest-placeholder',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a record without token_reference', () => {
    const result = ApprovalReferenceSchema.safeParse({
      approval_id: 'approval-0001',
      plan_id: 'plan-write-0002',
      granted_by: 'owner',
      granted_at: NOW,
      policy_version: '1',
      token_digest: 'digest-placeholder',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a record without policy_version', () => {
    const result = ApprovalReferenceSchema.safeParse({
      approval_id: 'approval-0001',
      plan_id: 'plan-write-0002',
      granted_by: 'owner',
      granted_at: NOW,
      token_reference: 'tokref-1',
      token_digest: 'digest-placeholder',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe('Serialization round-trip', () => {
  it('parse -> serialize -> parse yields the same semantic object', () => {
    for (const input of [readPlan(), writePlan()]) {
      const first = ExecutionPlanSchema.parse(input);
      const serialized = JSON.stringify(first);
      const second = ExecutionPlanSchema.parse(JSON.parse(serialized));
      expect(second).toEqual(first);
      expect(JSON.stringify(second)).toBe(serialized);
    }
  });

  it('wire values are JSON-compatible primitives only', () => {
    const plan = ExecutionPlanSchema.parse(writePlan());
    expect(plan.created_at).toBeTypeOf('string');
    const values = JSON.parse(JSON.stringify(plan));
    expect(values.created_at).toBe(plan.created_at);
  });
});
