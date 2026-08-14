/**
 * Goal24 Checkpoint 7 (Lane A) - deterministic fake approval fixtures.
 *
 * Synthetic capabilities (test.resource.read / update / rollback / destroy),
 * guard-run seeding for CP6 evidence eligibility, and fake native grant
 * verifiers. No process execution, no network, no randomness beyond server
 * id generation (ids are randomUUID by design; assertions are pattern-based).
 */

import { randomUUID } from 'node:crypto';
import {
  CapabilityDefinitionSchema,
  type AuthorityLevel,
  type CapabilityDefinition,
} from '../../src/capabilities/contracts.js';
import type { JsonObject } from '../../src/contracts/json-safe.js';
import {
  CapabilityEvidenceSubjectResolverRegistry,
  coverageDigest,
  genericTestSubjectResolver,
  GuardRunStore,
  normalizedInputsDigest,
  requirementsDigest,
  type EvidenceGuardRunRecord,
} from '../../src/evidence/index.js';
import {
  type ApprovalGrantVerificationResult,
  type ApprovalGrantVerifier,
  type TrustedApprovalActor,
  type VerifiedGrant,
} from '../../src/approval/index.js';

export const TEST_NOW = new Date('2026-08-14T00:00:00.000Z');

export const TEST_READ_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'test.resource.read',
  version: '1.0.0',
  description: 'Synthetic read capability for CP7 tests.',
  input_schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: [] },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

export const TEST_ROLLBACK_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'test.resource.rollback',
  version: '1.0.0',
  description: 'Synthetic rollback capability referenced by the synthetic write.',
  input_schema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: [] },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

export const TEST_WRITE_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'test.resource.update',
  version: '1.0.0',
  description: 'Synthetic reversible write capability: medium risk, L2 authority (CP7 test-only).',
  input_schema: { type: 'object', additionalProperties: false, properties: { repo: { type: 'string' } }, required: [] },
  required_authority: 'L2',
  risk_level: 'medium',
  reversible: true,
  side_effect_class: 'reversible_write',
  required_evidence: [],
  verification_capability: 'test.resource.read',
  rollback_capability: 'test.resource.rollback',
});

export const TEST_DESTRUCTIVE_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'test.resource.destroy',
  version: '1.0.0',
  description: 'Synthetic destructive write capability: high risk, L3 authority (CP7 test-only).',
  input_schema: { type: 'object', additionalProperties: false, properties: { repo: { type: 'string' } }, required: [] },
  required_authority: 'L3',
  risk_level: 'high',
  reversible: false,
  side_effect_class: 'destructive_write',
  required_evidence: [],
  verification_capability: 'test.resource.read',
});

export const TEST_CAPABILITIES: readonly CapabilityDefinition[] = [
  TEST_READ_CAPABILITY,
  TEST_ROLLBACK_CAPABILITY,
  TEST_WRITE_CAPABILITY,
  TEST_DESTRUCTIVE_CAPABILITY,
];

export function testCapabilityLookup(
  extra: readonly CapabilityDefinition[] = [],
): (capabilityId: string) => CapabilityDefinition | undefined {
  const map = new Map<string, CapabilityDefinition>();
  for (const capability of [...TEST_CAPABILITIES, ...extra]) {
    map.set(capability.id, capability);
  }
  return (capabilityId) => map.get(capabilityId);
}

export function testSubjectResolvers(): CapabilityEvidenceSubjectResolverRegistry {
  const registry = new CapabilityEvidenceSubjectResolverRegistry();
  for (const capability of TEST_CAPABILITIES) {
    registry.register(capability.id, genericTestSubjectResolver('test'));
  }
  return registry;
}

export interface SeedGuardRunOptions {
  guardRunStore: GuardRunStore;
  capability: CapabilityDefinition;
  normalizedInputs: JsonObject;
  guardRunId?: string;
  now?: Date;
  subjectKey?: string;
}

/** Seed a proceed guard run whose digests/subject match the given capability inputs. */
export function seedEligibleGuardRun(options: SeedGuardRunOptions): EvidenceGuardRunRecord {
  const now = options.now ?? TEST_NOW;
  const startedAt = new Date(now.getTime() - 1000).toISOString();
  const coverage = { entries: [] };
  const record: EvidenceGuardRunRecord = {
    guard_run_id: options.guardRunId ?? `run-${randomUUID()}`,
    capability_id: options.capability.id,
    capability_version: options.capability.version,
    subject_key:
      options.subjectKey ?? genericTestSubjectResolver('test')(options.capability.id, options.normalizedInputs),
    normalized_inputs_digest: normalizedInputsDigest(options.normalizedInputs),
    requirements_digest: requirementsDigest(options.capability.required_evidence),
    started_at: startedAt,
    finished_at: now.toISOString(),
    final_action: 'proceed',
    final_coverage: coverage,
    coverage_digest: coverageDigest(coverage),
    qualified_evidence_ids: [],
    rounds_used: 0,
    reason_codes: [],
    provider_outcomes: [],
    warnings: [],
    non_blocking_findings: [],
    clarification_needs: [],
    aborted: false,
    correlation_id: null,
  };
  options.guardRunStore.put(record);
  return record;
}

export function ownerActor(authorityLevel: AuthorityLevel, actorId = 'owner-alice'): TrustedApprovalActor {
  return { actor_id: actorId, actor_kind: 'owner', authority_level: authorityLevel, source: 'trusted_local' };
}

export function adminActor(authorityLevel: AuthorityLevel, actorId = 'admin-bob'): TrustedApprovalActor {
  return { actor_id: actorId, actor_kind: 'admin', authority_level: authorityLevel, source: 'trusted_local' };
}

export interface FakeGrantOptions {
  actor: TrustedApprovalActor;
  grantedAt?: Date;
  expiresAt?: Date;
  nativeRecordId?: string;
}

export function fakeGrant(options: FakeGrantOptions): VerifiedGrant {
  const grantedAt = options.grantedAt ?? TEST_NOW;
  const nativeRecordId = options.nativeRecordId ?? `native-${randomUUID()}`;
  return {
    actor: options.actor,
    authority: options.actor.authority_level,
    granted_at: grantedAt.toISOString(),
    expires_at: (options.expiresAt ?? new Date(grantedAt.getTime() + 60_000)).toISOString(),
    native_record_id: nativeRecordId,
    token_reference: `grant_${randomUUID().replaceAll('-', '').slice(0, 32)}`,
    token_digest: randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', ''),
  };
}

export function verifyingGrantVerifier(grant: VerifiedGrant): ApprovalGrantVerifier {
  return {
    verifyGrant: (): ApprovalGrantVerificationResult => ({ valid: true, grant }),
  };
}

export function rejectingGrantVerifier(reason = 'no native grant exists'): ApprovalGrantVerifier {
  return {
    verifyGrant: (): ApprovalGrantVerificationResult => ({ valid: false, reason }),
  };
}

export function bareApprovalReference(planId: string, policyVersion: string): Record<string, unknown> {
  return {
    approval_id: 'approval-1',
    plan_id: planId,
    granted_by: 'owner-alice',
    granted_at: TEST_NOW.toISOString(),
    policy_version: policyVersion,
    token_reference: 'native://approval-1',
    token_digest: '0'.repeat(64),
  };
}