/**
 * Goal24 Checkpoint 2.1 contract tests: Capability and SkillManifest.
 *
 * Security posture: all contracts are strict Zod objects, so unknown keys
 * (including `shell`, `command`, `exec`) are rejected at parse time, not
 * merely at the TypeScript type level. This file also covers the 2.1
 * hardening: canonical evidence requirements, side-effect/reversibility
 * consistency, JSON-safe input schemas and skill safety inheritance.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_LEVELS,
  CapabilityDefinitionSchema,
  EvidenceRequirementSchema,
  RISK_LEVELS,
  SIDE_EFFECT_CLASSES,
  type CapabilityDefinition,
} from '../src/capabilities/contracts.js';
import {
  ADAPTER_PREFERENCES,
  ProcedureStepSchema,
  SkillManifestSchema,
  validateSkillManifestAgainstCapabilities,
  type SkillManifest,
} from '../src/skills/contracts.js';

const validWriteCapability = {
  id: 'github.issue.create',
  version: '1.0.0',
  description: 'Create a GitHub issue in a repository',
  input_schema: {
    type: 'object',
    properties: {
      owner: { type: 'string' },
      repo: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['owner', 'repo', 'title'],
  },
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
};

const validReadCapability = {
  id: 'github.issue.read',
  version: '1.2.0',
  description: 'Read a GitHub issue',
  input_schema: {
    type: 'object',
    properties: {
      owner: { type: 'string' },
      repo: { type: 'string' },
      issue_number: { type: 'integer' },
    },
  },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
};

describe('Capability contract — valid', () => {
  it('accepts a valid write capability with canonical evidence requirements', () => {
    const result = CapabilityDefinitionSchema.safeParse(validWriteCapability);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.required_evidence).toHaveLength(2);
      expect(result.data.required_evidence[1].verification_requirement).toBe('verified');
    }
  });

  it('accepts a valid read-only capability without verification/rollback', () => {
    const result = CapabilityDefinitionSchema.safeParse(validReadCapability);
    expect(result.success).toBe(true);
  });

  it('exposes machine-validatable enums for authority, risk and side effects', () => {
    expect(AUTHORITY_LEVELS).toEqual(['L0', 'L1', 'L2', 'L3']);
    expect(RISK_LEVELS).toEqual(['low', 'medium', 'high']);
    expect(SIDE_EFFECT_CLASSES).toEqual([
      'read_only',
      'reversible_write',
      'destructive_write',
      'external_effect',
    ]);
  });
});

describe('Capability contract — ID rules', () => {
  it('rejects transport-prefixed IDs (cli.github.issue.create)', () => {
    const result = CapabilityDefinitionSchema.safeParse({ ...validWriteCapability, id: 'cli.github.issue.create' });
    expect(result.success).toBe(false);
  });

  it('rejects IDs with fewer than three segments', () => {
    const result = CapabilityDefinitionSchema.safeParse({ ...validWriteCapability, id: 'github.issue' });
    expect(result.success).toBe(false);
  });

  it('rejects IDs with uppercase segments', () => {
    const result = CapabilityDefinitionSchema.safeParse({ ...validWriteCapability, id: 'GitHub.issue.create' });
    expect(result.success).toBe(false);
  });
});

describe('Capability contract — canonical evidence requirements (2.1)', () => {
  it('rejects duplicate required_evidence class_ids', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      required_evidence: [
        { class_id: 'repository.current_state', mandatory: true },
        { class_id: 'repository.current_state', mandatory: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed evidence class ids', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      required_evidence: [{ class_id: 'Repository.Current_State', mandatory: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects the legacy required_evidence_classes field (unknown key)', () => {
    const { required_evidence: _unused, ...legacy } = validWriteCapability as any;
    const result = CapabilityDefinitionSchema.safeParse({
      ...legacy,
      required_evidence_classes: ['repository.current_state'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a freshness policy beyond 7 days (no arbitrary cap)', () => {
    const result = EvidenceRequirementSchema.safeParse({
      class_id: 'repository.current_state',
      mandatory: true,
      freshness_policy: { max_age_ms: 30 * 86_400_000 },
    });
    expect(result.success).toBe(true);
  });
});

describe('Capability contract — rollback and side-effect consistency (2.1)', () => {
  it('rejects rollback_capability when reversible=false', () => {
    const result = CapabilityDefinitionSchema.safeParse({ ...validWriteCapability, reversible: false });
    expect(result.success).toBe(false);
  });

  it('rejects self-referencing rollback_capability', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      rollback_capability: 'github.issue.create',
    });
    expect(result.success).toBe(false);
  });

  it('rejects read_only capability with reversible=true', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validReadCapability,
      reversible: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects read_only capability with risk_level=medium', () => {
    const result = CapabilityDefinitionSchema.safeParse({ ...validReadCapability, risk_level: 'medium' });
    expect(result.success).toBe(false);
  });

  it('rejects read_only capability with a rollback_capability', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validReadCapability,
      rollback_capability: 'github.issue.close',
    });
    expect(result.success).toBe(false);
  });

  it('rejects reversible_write capability with reversible=false', () => {
    const result = CapabilityDefinitionSchema.safeParse({ ...validWriteCapability, reversible: false });
    expect(result.success).toBe(false);
  });

  it('rejects destructive_write capability with reversible=true', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      side_effect_class: 'destructive_write',
      reversible: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts destructive_write capability with reversible=false and no rollback', () => {
    const { rollback_capability: _unused, ...withoutRollback } = validWriteCapability;
    const result = CapabilityDefinitionSchema.safeParse({
      ...withoutRollback,
      side_effect_class: 'destructive_write',
      reversible: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects write capability without verification_capability (read-back required)', () => {
    const { verification_capability: _omitted, ...withoutVerification } = validWriteCapability;
    const result = CapabilityDefinitionSchema.safeParse(withoutVerification);
    expect(result.success).toBe(false);
  });
});

describe('Capability contract — version rules', () => {
  it('rejects empty version strings', () => {
    const result = CapabilityDefinitionSchema.safeParse({ ...validWriteCapability, version: '' });
    expect(result.success).toBe(false);
  });
});

describe('Capability contract — security boundary', () => {
  it('rejects a shell field (runtime schema, not just types)', () => {
    const result = CapabilityDefinitionSchema.safeParse({ ...validWriteCapability, shell: 'rm -rf /' });
    expect(result.success).toBe(false);
  });

  it('rejects a command field', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      command: 'gh issue create "title"',
    });
    expect(result.success).toBe(false);
  });

  it('is strict: any unknown key is rejected', () => {
    const result = CapabilityDefinitionSchema.safeParse({ ...validWriteCapability, unexpected_field: true });
    expect(result.success).toBe(false);
  });
});

describe('Capability contract — JSON-safe input_schema (2.1)', () => {
  it('rejects a Date inside input_schema', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      input_schema: { type: 'object', created: new Date() },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a circular input_schema', () => {
    const circular: Record<string, unknown> = { type: 'object' };
    circular.self = circular;
    const result = CapabilityDefinitionSchema.safeParse({ ...validWriteCapability, input_schema: circular });
    expect(result.success).toBe(false);
  });
});

describe('EvidenceRequirement contract', () => {
  it('accepts a full requirement', () => {
    const result = EvidenceRequirementSchema.safeParse({
      class_id: 'pull_request.current_state',
      mandatory: true,
      freshness_policy: { max_age_ms: 60_000 },
      conflict_policy: 'reject',
      verification_requirement: 'verified',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing mandatory flag', () => {
    const result = EvidenceRequirementSchema.safeParse({ class_id: 'pull_request.current_state' });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SkillManifest
// ---------------------------------------------------------------------------

const readCapability = CapabilityDefinitionSchema.parse({
  id: 'github.issue.read',
  version: '1.2.0',
  description: 'Read a GitHub issue',
  input_schema: {},
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

const commentCapability = CapabilityDefinitionSchema.parse({
  id: 'github.issue.comment',
  version: '1.0.0',
  description: 'Comment on a GitHub issue',
  input_schema: {},
  required_authority: 'L1',
  risk_level: 'medium',
  reversible: true,
  side_effect_class: 'reversible_write',
  required_evidence: [
    { class_id: 'repository.current_state', mandatory: true, conflict_policy: 'reject' },
  ],
  verification_capability: 'github.issue.read',
});

const closeCapability = CapabilityDefinitionSchema.parse({
  id: 'github.issue.close',
  version: '1.0.0',
  description: 'Close a GitHub issue',
  input_schema: {},
  required_authority: 'L2',
  risk_level: 'high',
  reversible: true,
  side_effect_class: 'reversible_write',
  required_evidence: [
    {
      class_id: 'actor.authority',
      mandatory: true,
      verification_requirement: 'verified',
      freshness_policy: { max_age_ms: 3_600_000 },
    },
  ],
  verification_capability: 'github.issue.read',
});

function registryOf(capabilities: CapabilityDefinition[]) {
  const map = new Map(capabilities.map((capability) => [capability.id, capability]));
  return (id: string) => map.get(id);
}

const validSkill: SkillManifest = {
  name: 'github-issue-triage',
  version: '1.0.0',
  description: 'Triage a GitHub issue and route it to the right owner',
  capabilities: ['github.issue.read', 'github.issue.comment'],
  prerequisites: ['gh-cli-installed', 'authenticated'],
  required_evidence: [
    { class_id: 'repository.current_state', mandatory: true, conflict_policy: 'reject' },
  ],
  procedure: [
    { step_id: 'read_issue', description: 'Read the issue and its thread', capability_id: 'github.issue.read', note: 'Check labels and assignees' },
    { step_id: 'comment_triage', description: 'Post a triage comment', capability_id: 'github.issue.comment' },
  ],
  risk: 'medium',
  verification: { capability_id: 'github.issue.read', description: 'Read back the comment' },
  rollback: { capability_id: 'github.issue.comment', description: 'Comment to correct the triage' },
  adapter_preference: 'cli',
};

describe('SkillManifest contract — valid', () => {
  it('accepts a valid skill manifest', () => {
    const result = SkillManifestSchema.safeParse(validSkill);
    expect(result.success).toBe(true);
  });

  it('enumerates legal adapter preferences', () => {
    expect(ADAPTER_PREFERENCES).toEqual(['any', 'cli', 'api', 'mcp', 'local']);
  });
});

describe('SkillManifest contract — capability rules', () => {
  it('rejects duplicate capabilities', () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkill,
      capabilities: ['github.issue.read', 'github.issue.read'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a procedure step referencing an undeclared capability', () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkill,
      procedure: [
        { step_id: 'read_issue', description: 'read', capability_id: 'github.issue.read' },
        { step_id: 'merge_pr', description: 'merge', capability_id: 'github.pr.merge' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('SkillManifest contract — adapter preference', () => {
  it('rejects an illegal adapter preference', () => {
    const result = SkillManifestSchema.safeParse({ ...validSkill, adapter_preference: 'ssh' });
    expect(result.success).toBe(false);
  });
});

describe('SkillManifest contract — procedure is not an execution layer', () => {
  it('rejects a procedure step carrying a command field', () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkill,
      procedure: [{ step_id: 'run_shell', description: 'run', command: 'gh issue comment 17 "hi"' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a manifest-level exec field', () => {
    const result = SkillManifestSchema.safeParse({ ...validSkill, exec: 'powershell -c "Get-Process"' });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate required_evidence class_ids', () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkill,
      required_evidence: [
        { class_id: 'repository.current_state', mandatory: true },
        { class_id: 'repository.current_state', mandatory: false },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('Skill safety inheritance — validateSkillManifestAgainstCapabilities (2.1)', () => {
  it('accepts a skill that matches referenced capability safety', () => {
    const issues = validateSkillManifestAgainstCapabilities(validSkill, registryOf([readCapability, commentCapability]));
    expect(issues).toEqual([]);
  });

  it('accepts a skill that strengthens evidence requirements', () => {
    const strengthened: SkillManifest = {
      ...validSkill,
      required_evidence: [
        {
          class_id: 'repository.current_state',
          mandatory: true,
          conflict_policy: 'reject',
          freshness_policy: { max_age_ms: 60_000 },
          verification_requirement: 'verified',
        },
      ],
    };
    const issues = validateSkillManifestAgainstCapabilities(strengthened, registryOf([readCapability, commentCapability]));
    expect(issues).toEqual([]);
  });

  it('rejects an unknown capability reference', () => {
    const issues = validateSkillManifestAgainstCapabilities(validSkill, registryOf([readCapability]));
    expect(issues.some((issue) => issue.path === 'capabilities')).toBe(true);
  });

  it('rejects a skill risk lower than the highest referenced capability risk', () => {
    const downgraded: SkillManifest = { ...validSkill, risk: 'low' };
    const issues = validateSkillManifestAgainstCapabilities(downgraded, registryOf([readCapability, commentCapability]));
    expect(issues.some((issue) => issue.path === 'risk')).toBe(true);
  });

  it('rejects weakening mandatory evidence to optional', () => {
    const weakened: SkillManifest = {
      ...validSkill,
      required_evidence: [{ class_id: 'repository.current_state', mandatory: false, conflict_policy: 'reject' }],
    };
    const issues = validateSkillManifestAgainstCapabilities(weakened, registryOf([readCapability, commentCapability]));
    expect(issues.some((issue) => issue.path === 'required_evidence')).toBe(true);
  });

  it('rejects dropping a mandatory evidence class entirely', () => {
    const dropped: SkillManifest = { ...validSkill, required_evidence: [] };
    const issues = validateSkillManifestAgainstCapabilities(dropped, registryOf([readCapability, commentCapability]));
    expect(issues.some((issue) => issue.path === 'required_evidence')).toBe(true);
  });

  it('rejects downgrading conflict_policy reject to warn', () => {
    const warnPolicy: SkillManifest = {
      ...validSkill,
      required_evidence: [{ class_id: 'repository.current_state', mandatory: true, conflict_policy: 'warn' }],
    };
    const issues = validateSkillManifestAgainstCapabilities(warnPolicy, registryOf([readCapability, commentCapability]));
    expect(issues.some((issue) => issue.path === 'required_evidence')).toBe(true);
  });

  it('rejects downgrading verification_requirement verified to asserted', () => {
    const skillWithClose: SkillManifest = {
      ...validSkill,
      capabilities: ['github.issue.read', 'github.issue.close'],
      risk: 'high',
      procedure: [
        { step_id: 'read_issue', description: 'Read the issue', capability_id: 'github.issue.read' },
        { step_id: 'close_issue', description: 'Close the issue', capability_id: 'github.issue.close' },
      ],
      verification: { capability_id: 'github.issue.read' },
      required_evidence: [
        { class_id: 'actor.authority', mandatory: true, verification_requirement: 'asserted', freshness_policy: { max_age_ms: 3_600_000 } },
      ],
    };
    const issues = validateSkillManifestAgainstCapabilities(skillWithClose, registryOf([readCapability, closeCapability]));
    expect(issues.some((issue) => issue.path === 'required_evidence')).toBe(true);
  });

  it('rejects dropping a capability freshness_policy', () => {
    const noFreshness: SkillManifest = {
      ...validSkill,
      capabilities: ['github.issue.read', 'github.issue.close'],
      risk: 'high',
      procedure: [
        { step_id: 'read_issue', description: 'Read the issue', capability_id: 'github.issue.read' },
        { step_id: 'close_issue', description: 'Close the issue', capability_id: 'github.issue.close' },
      ],
      verification: { capability_id: 'github.issue.read' },
      required_evidence: [
        { class_id: 'actor.authority', mandatory: true, verification_requirement: 'verified', freshness_policy: { max_age_ms: 7_200_000 } },
      ],
    };
    const issues = validateSkillManifestAgainstCapabilities(noFreshness, registryOf([readCapability, closeCapability]));
    // freshness 7.2M > capability 3.6M -> weakening; also verification ok (verified)
    expect(issues.some((issue) => issue.path === 'required_evidence')).toBe(true);
  });

  it('accepts a skill with strictly stronger freshness', () => {
    const stronger: SkillManifest = {
      ...validSkill,
      capabilities: ['github.issue.read', 'github.issue.close'],
      risk: 'high',
      procedure: [
        { step_id: 'read_issue', description: 'Read the issue', capability_id: 'github.issue.read' },
        { step_id: 'close_issue', description: 'Close the issue', capability_id: 'github.issue.close' },
      ],
      verification: { capability_id: 'github.issue.read' },
      required_evidence: [
        { class_id: 'actor.authority', mandatory: true, verification_requirement: 'verified', freshness_policy: { max_age_ms: 1_800_000 } },
      ],
    };
    const issues = validateSkillManifestAgainstCapabilities(stronger, registryOf([readCapability, closeCapability]));
    expect(issues).toEqual([]);
  });
});

describe('ProcedureStep contract — standalone', () => {
  it('accepts a semantic step without any capability reference', () => {
    const result = ProcedureStepSchema.safeParse({
      step_id: 'review_output',
      description: 'Review the output before continuing',
      note: 'Manual review required',
    });
    expect(result.success).toBe(true);
  });
});
