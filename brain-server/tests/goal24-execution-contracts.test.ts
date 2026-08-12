/**
 * Goal24 Checkpoint 2 contract tests: ExecutionPlan, evidence coverage,
 * approval reference and risk snapshot.
 *
 * The ExecutionPlan is the only formal handoff to adapter execution; these
 * tests pin the security boundary (no shell/command expressible) and the
 * cross-field validation rules for approval, risk and evidence coverage.
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
  RiskSnapshotSchema,
  validateExecutionPlanAgainstCapabilities,
  type ExecutionPlan,
} from '../src/execution/contracts.js';

const NOW = '2026-08-12T12:00:00.000Z';

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
  required_evidence_classes: [],
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
  required_evidence_classes: ['repository.current_state', 'actor.authority'],
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
  required_evidence_classes: ['pull_request.current_state', 'actor.authority'],
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
    approval_token: 'tok-123456',
    risk_snapshot: {
      risk_level: 'medium',
      reversible: true,
      side_effect_class: 'reversible_write',
      required_authority: 'L1',
      capability_version: '1.0.0',
    },
    evidence_coverage_snapshot: {
      entries: [
        { evidence_class: 'repository.current_state', status: 'present', evidence_ids: ['evt-1'], checked_at: NOW },
        { evidence_class: 'actor.authority', status: 'present', evidence_ids: ['evt-2'], checked_at: NOW },
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

  it('accepts a valid write plan with approval token, verification and rollback', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verification_plan?.verification_capability_id).toBe('github.issue.read');
      expect(result.data.rollback_plan?.rollback_capability_id).toBe('github.issue.close');
      expect(result.data.approval_token).toBe('tok-123456');
    }
  });

  it('accepts a draft plan without approval token even when approval is required', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan({ state: 'draft', approval_token: undefined }));
    expect(result.success).toBe(true);
  });

  it('accepts awaiting_approval state with required_approval=true and no token', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan({ state: 'awaiting_approval', approval_token: undefined }));
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ExecutionPlan — approval rules
// ---------------------------------------------------------------------------

describe('ExecutionPlan — approval rules', () => {
  it('rejects an executable plan that requires approval but has no approval_token', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan({ approval_token: undefined }));
    expect(result.success).toBe(false);
  });

  it('rejects awaiting_approval when required_approval=false', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ state: 'awaiting_approval' }));
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ExecutionPlan — risk snapshot consistency
// ---------------------------------------------------------------------------

describe('ExecutionPlan — risk snapshot consistency', () => {
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
      writePlan({ risk_snapshot: { ...writePlan().risk_snapshot, reversible: false } as any }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a write plan without verification_plan', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan({ verification_plan: null }));
    expect(result.success).toBe(false);
  });

  it('accepts a verification-only write plan when rollback is not declared', () => {
    const result = ExecutionPlanSchema.safeParse(writePlan({ rollback_plan: null }));
    expect(result.success).toBe(true);
  });

  it('RiskSnapshotSchema parses and round-trips', () => {
    const snapshot = {
      risk_level: 'high',
      reversible: true,
      side_effect_class: 'external_effect',
      required_authority: 'L3',
      capability_version: '1.0.0',
    };
    const parsed = RiskSnapshotSchema.parse(snapshot);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
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

  it('accepts timeouts within bounds', () => {
    const result = ExecutionPlanSchema.safeParse(readPlan({ timeout_ms: 5_000 }));
    expect(result.success).toBe(true);
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

  it('rejects normalized_inputs containing a command key', () => {
    const result = ExecutionPlanSchema.safeParse(
      readPlan({ normalized_inputs: { command: 'gh issue close 17' } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects normalized_inputs containing a shell key', () => {
    const result = ExecutionPlanSchema.safeParse(
      readPlan({ normalized_inputs: { shell: 'rm -rf /' } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects every reserved input key', () => {
    for (const key of FORBIDDEN_INPUT_KEYS) {
      const result = ExecutionPlanSchema.safeParse(readPlan({ normalized_inputs: { [key]: 'x' } }));
      expect(result.success, `reserved key '${key}' must be rejected`).toBe(false);
    }
  });

  it('is strict: any unknown key is rejected', () => {
    const result = ExecutionPlanSchema.safeParse({ ...readPlan(), unexpected_field: true });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ExecutionPlan — registry-bound validation
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

  it('reports a capability version mismatch', () => {
    const plan = ExecutionPlanSchema.parse(readPlan({ capability_version: '9.9.9' }));
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'capability_version')).toBe(true);
  });

  it('reports a risk snapshot that diverges from the capability declaration', () => {
    const plan = ExecutionPlanSchema.parse(
      readPlan({ risk_snapshot: { ...readPlan().risk_snapshot, risk_level: 'high' } as any }),
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
      writePlan({ state: 'draft', approval_token: undefined, evidence_coverage_snapshot: { entries: [] } }),
    );
    const issues = validateExecutionPlanAgainstCapabilities(plan, lookup);
    expect(issues.some((issue) => issue.path === 'evidence_coverage_snapshot')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Evidence coverage
// ---------------------------------------------------------------------------

describe('Evidence coverage contract', () => {
  it('parses every coverage status', () => {
    for (const status of ['present', 'missing', 'stale', 'conflicted', 'unverified']) {
      const result = EvidenceCoverageEntrySchema.safeParse({
        evidence_class: 'pull_request.current_state',
        status,
        evidence_ids: ['evt-1'],
        checked_at: NOW,
      });
      expect(result.success, `status '${status}' must parse`).toBe(true);
    }
  });

  it('rejects duplicate coverage entries by evidence_class', () => {
    const result = EvidenceCoverageSnapshotSchema.safeParse({
      entries: [
        { evidence_class: 'repository.current_state', status: 'present', evidence_ids: ['evt-1'], checked_at: NOW },
        { evidence_class: 'repository.current_state', status: 'missing', evidence_ids: [], checked_at: NOW },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate evidence_ids inside one entry', () => {
    const result = EvidenceCoverageEntrySchema.safeParse({
      evidence_class: 'repository.current_state',
      status: 'present',
      evidence_ids: ['evt-1', 'evt-1'],
      checked_at: NOW,
    });
    expect(result.success).toBe(false);
  });

  it('records conflict evidence ids and stale_since when present', () => {
    const result = EvidenceCoverageEntrySchema.safeParse({
      evidence_class: 'repository.current_state',
      status: 'conflicted',
      evidence_ids: ['evt-1'],
      conflict_evidence_ids: ['evt-2'],
      stale_since: NOW,
      checked_at: NOW,
    });
    expect(result.success).toBe(true);
  });

  it('assesses mandatory coverage: only present satisfies', () => {
    const requirements = [
      { class_id: 'repository.current_state', mandatory: true },
      { class_id: 'actor.authority', mandatory: true },
      { class_id: 'review_approval.status', mandatory: false },
    ];
    const assessment = assessEvidenceCoverage(requirements as any, {
      entries: [
        { evidence_class: 'repository.current_state', status: 'present', evidence_ids: ['evt-1'], checked_at: NOW },
        { evidence_class: 'actor.authority', status: 'stale', evidence_ids: ['evt-2'], checked_at: NOW },
      ],
    });
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.missing_mandatory).toContain('actor.authority');
    expect(assessment.entries.find((e) => e.class_id === 'review_approval.status')?.satisfied).toBe(false);
  });

  it('assesses not_checked when no coverage entry exists', () => {
    const assessment = assessEvidenceCoverage(
      [{ class_id: 'branch_protection.rules', mandatory: true }] as any,
      { entries: [] },
    );
    expect(assessment.missing_mandatory).toEqual(['branch_protection.rules']);
    expect(assessment.entries[0].status).toBe('not_checked');
  });
});

// ---------------------------------------------------------------------------
// Approval reference
// ---------------------------------------------------------------------------

describe('ApprovalReference contract', () => {
  it('parses a grant record', () => {
    const result = ApprovalReferenceSchema.safeParse({
      approval_id: 'approval-0001',
      plan_id: 'plan-write-0002',
      granted_by: 'owner',
      granted_at: NOW,
      token: 'tok-123456',
      policy_version: '1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a record without a token', () => {
    const result = ApprovalReferenceSchema.safeParse({
      approval_id: 'approval-0001',
      plan_id: 'plan-write-0002',
      granted_by: 'owner',
      granted_at: NOW,
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

  it('wire values are JSON-compatible primitives only (no Date, no class instances)', () => {
    const plan = ExecutionPlanSchema.parse(writePlan());
    expect(plan.created_at).toBeTypeOf('string');
    const values = JSON.parse(JSON.stringify(plan));
    expect(values.created_at).toBe(plan.created_at);
  });
});
