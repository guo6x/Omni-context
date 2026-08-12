/**
 * Goal24 Checkpoint 2 contract tests: Capability and SkillManifest.
 *
 * Security posture: all contracts are strict Zod objects, so unknown keys
 * (including `shell`, `command`, `exec`) are rejected at parse time, not
 * merely at the TypeScript type level.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_LEVELS,
  CapabilityDefinitionSchema,
  EvidenceRequirementSchema,
  RISK_LEVELS,
  SIDE_EFFECT_CLASSES,
} from '../src/capabilities/contracts.js';
import {
  ADAPTER_PREFERENCES,
  ProcedureStepSchema,
  SkillManifestSchema,
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
  required_evidence_classes: ['repository.current_state', 'actor.authority'],
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
  required_evidence_classes: [],
};

describe('Capability contract — valid', () => {
  it('accepts a valid write capability', () => {
    const result = CapabilityDefinitionSchema.safeParse(validWriteCapability);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('github.issue.create');
      expect(result.data.required_authority).toBe('L1');
      expect(result.data.rollback_capability).toBe('github.issue.close');
    }
  });

  it('accepts a valid read-only capability without verification/rollback', () => {
    const result = CapabilityDefinitionSchema.safeParse(validReadCapability);
    expect(result.success).toBe(true);
  });

  it('accepts an empty input_schema', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validReadCapability,
      input_schema: {},
    });
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

  it('rejects mcp-prefixed IDs', () => {
    const result = CapabilityDefinitionSchema.safeParse({ ...validWriteCapability, id: 'mcp.github.issue.create' });
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

  it('accepts a four-segment ID (github.pr.checks.read)', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validReadCapability,
      id: 'github.pr.checks.read',
      verification_capability: undefined,
    });
    expect(result.success).toBe(true);
  });
});

describe('Capability contract — evidence rules', () => {
  it('rejects duplicate required_evidence_classes', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      required_evidence_classes: ['repository.current_state', 'repository.current_state'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed evidence class ids', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      required_evidence_classes: ['Repository.Current_State'],
    });
    expect(result.success).toBe(false);
  });
});

describe('Capability contract — rollback and side-effect consistency', () => {
  it('rejects rollback_capability when reversible=false', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      reversible: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects self-referencing rollback_capability', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      rollback_capability: 'github.issue.create',
    });
    expect(result.success).toBe(false);
  });

  it('rejects self-referencing verification_capability', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      verification_capability: 'github.issue.create',
    });
    expect(result.success).toBe(false);
  });

  it('rejects read_only capability with risk_level=medium', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validReadCapability,
      risk_level: 'medium',
    });
    expect(result.success).toBe(false);
  });

  it('rejects read_only capability with a rollback_capability', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validReadCapability,
      rollback_capability: 'github.issue.close',
    });
    expect(result.success).toBe(false);
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

  it('rejects non-semver versions', () => {
    const result = CapabilityDefinitionSchema.safeParse({ ...validWriteCapability, version: '1.0' });
    expect(result.success).toBe(false);
  });
});

describe('Capability contract — security boundary', () => {
  it('rejects a shell field (runtime schema, not just types)', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      shell: 'rm -rf /',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a command field', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      command: 'gh issue create "title"',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an exec field', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      exec: 'powershell -c "..."',
    });
    expect(result.success).toBe(false);
  });

  it('is strict: any unknown key is rejected', () => {
    const result = CapabilityDefinitionSchema.safeParse({
      ...validWriteCapability,
      unexpected_field: true,
    });
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

  it('rejects unknown keys (strict)', () => {
    const result = EvidenceRequirementSchema.safeParse({
      class_id: 'pull_request.current_state',
      mandatory: true,
      retrieval_query: 'SELECT *',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SkillManifest
// ---------------------------------------------------------------------------

const validSkill = {
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
    if (result.success) {
      expect(result.data.adapter_preference).toBe('cli');
      expect(result.data.procedure).toHaveLength(2);
    }
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

  it('rejects verification referencing an undeclared capability', () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkill,
      verification: { capability_id: 'github.pr.read' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects rollback referencing an undeclared capability', () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkill,
      rollback: { capability_id: 'github.pr.close' },
    });
    expect(result.success).toBe(false);
  });
});

describe('SkillManifest contract — adapter preference', () => {
  it('rejects an illegal adapter preference', () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkill,
      adapter_preference: 'ssh',
    });
    expect(result.success).toBe(false);
  });
});

describe('SkillManifest contract — procedure is not an execution layer', () => {
  it('rejects a procedure step carrying a command field', () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkill,
      procedure: [
        { step_id: 'run_shell', description: 'run', command: 'gh issue comment 17 "hi"' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a procedure step carrying a shell field', () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkill,
      procedure: [
        { step_id: 'run_shell', description: 'run', shell: 'rm -rf /' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a manifest-level exec field', () => {
    const result = SkillManifestSchema.safeParse({
      ...validSkill,
      exec: 'powershell -c "Get-Process"',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty procedure', () => {
    const result = SkillManifestSchema.safeParse({ ...validSkill, procedure: [] });
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
