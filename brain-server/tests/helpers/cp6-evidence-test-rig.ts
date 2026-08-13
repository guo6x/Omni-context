/**
 * CP6 integration test rig: deterministic capability catalog, provider
 * registry, subject resolvers, trusted clock, stores, runtime and
 * eligibility service wired exactly like the production trust boundary.
 * Pure in-memory fixtures; no process execution, no network, no filesystem.
 */

import {
  CapabilityEvidenceSubjectResolverRegistry,
  EvidenceEligibilityService,
  EvidenceProviderRegistry,
  EvidenceSurfaceRuntime,
  GuardRunStore,
  QualifiedEvidenceStore,
  type EvidenceCollectionLimits,
  type EvidenceRequirement,
  type EvidenceSurfaceRuntimeOptions,
} from '../../src/evidence/index.js';
import type { CapabilityDefinition } from '../../src/capabilities/contracts.js';
import { candidate, fakeProvider, metadata, type FakeProviderOptions } from './fake-evidence-providers.js';

export const CLASS_A = 'state.alpha';
export const CLASS_B = 'state.beta';
export const CLASS_OPTIONAL = 'state.optional';
export const TEST_CAPABILITY_ID = 'test.evidence.read';
export const TEST_SUBJECT_INPUTS = { owner: 'octocat', repo: 'hello-world', number: 42 };

export function requirement(classId: string, overrides: Partial<EvidenceRequirement> = {}): EvidenceRequirement {
  return {
    class_id: classId,
    mandatory: true,
    ...overrides,
  };
}

export function testCapability(overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: TEST_CAPABILITY_ID,
    version: '1.0.0',
    description: 'synthetic CP6 test capability (deterministic fixtures only)',
    input_schema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, number: { type: 'integer' } } },
    required_authority: 'L0',
    risk_level: 'low',
    reversible: false,
    side_effect_class: 'read_only',
    required_evidence: [requirement(CLASS_A), requirement(CLASS_B)],
    ...overrides,
  };
}

export interface ControlledClock {
  now: Date;
  advance(ms: number): void;
  getTime(): number;
}

export function controlledClock(startIso: string): ControlledClock {
  const state: ControlledClock = {
    now: new Date(startIso),
    advance(ms) {
      state.now = new Date(state.now.getTime() + ms);
    },
    getTime() {
      return state.now.getTime();
    },
  };
  return state;
}

export interface TestRigOptions {
  capability?: CapabilityDefinition;
  /** Additional capabilities indexed by id (lookup also sees the primary). */
  extraCapabilities?: Record<string, CapabilityDefinition>;
  limits?: Partial<EvidenceCollectionLimits>;
  maxRetrievalRounds?: number;
  perRoundTimeoutMs?: number;
  clockStart?: string;
  registerSubjectResolvers?: (registry: CapabilityEvidenceSubjectResolverRegistry) => void;
  /** When false, the rig does not register its default test subject resolver. */
  defaultSubjectResolver?: boolean;
  maxQualifiedRecords?: number;
  maxGuardRuns?: number;
}

export interface TestRig {
  runtime: EvidenceSurfaceRuntime;
  eligibility: EvidenceEligibilityService;
  providers: EvidenceProviderRegistry;
  subjects: CapabilityEvidenceSubjectResolverRegistry;
  capabilities: Map<string, CapabilityDefinition>;
  qualifiedStore: QualifiedEvidenceStore;
  guardRunStore: GuardRunStore;
  clock: ControlledClock;
  capabilityLookup: (capabilityId: string) => CapabilityDefinition | undefined;
  capability(): CapabilityDefinition;
  setCapability(capability: CapabilityDefinition): void;
}

export function buildTestRig(options: TestRigOptions = {}): TestRig {
  const capability = options.capability ?? testCapability();
  const capabilities = new Map<string, CapabilityDefinition>();
  capabilities.set(capability.id, capability);
  for (const [id, extra] of Object.entries(options.extraCapabilities ?? {})) {
    capabilities.set(id, extra);
  }

  const providers = new EvidenceProviderRegistry();
  const subjects = new CapabilityEvidenceSubjectResolverRegistry();
  if (options.defaultSubjectResolver !== false) {
    subjects.register(capability.id, (_capabilityId, inputs) => {
    const owner = inputs.owner;
    const repo = inputs.repo;
    const number = inputs.number;
    if (typeof owner !== 'string' || typeof repo !== 'string' || typeof number !== 'number') {
      throw new Error('test subject inputs must include owner, repo and number');
    }
    return `test:${owner}/${repo}#${number}`;
    });
  }
  if (options.registerSubjectResolvers) {
    options.registerSubjectResolvers(subjects);
  }

  const clock = controlledClock(options.clockStart ?? '2026-08-14T00:00:00.000Z');
  const qualifiedStore = new QualifiedEvidenceStore(options.maxQualifiedRecords);
  const guardRunStore = new GuardRunStore(options.maxGuardRuns);
  const capabilityLookup = (capabilityId: string) => capabilities.get(capabilityId);

  const runtimeOptions: EvidenceSurfaceRuntimeOptions = {
    capabilityLookup,
    providers,
    subjectResolvers: subjects,
    clock: () => clock.now,
    guardRunStore,
    qualifiedEvidenceStore: qualifiedStore,
  };
  if (options.limits) runtimeOptions.limits = options.limits;
  if (options.maxRetrievalRounds !== undefined) runtimeOptions.maxRetrievalRounds = options.maxRetrievalRounds;
  if (options.perRoundTimeoutMs !== undefined) runtimeOptions.perRoundTimeoutMs = options.perRoundTimeoutMs;

  const runtime = new EvidenceSurfaceRuntime(runtimeOptions);
  const eligibility = new EvidenceEligibilityService({
    guardRunStore,
    qualifiedEvidenceStore: qualifiedStore,
    capabilityLookup,
    subjectResolvers: subjects,
    clock: () => clock.now,
  });

  return {
    runtime,
    eligibility,
    providers,
    subjects,
    capabilities,
    qualifiedStore,
    guardRunStore,
    clock,
    capabilityLookup,
    capability: () => capabilities.get(TEST_CAPABILITY_ID)!,
    setCapability(next) {
      capabilities.set(TEST_CAPABILITY_ID, next);
    },
  };
}

export function freshCandidateFor(classId: string, claim: unknown, overrides = {}) {
  return candidate({
    evidence_class: classId,
    claim_key: classId,
    claim_value: claim,
    observed_at: '2026-08-14T00:00:00.000Z',
    subject_key: 'test:octocat/hello-world#42',
    ...overrides,
  });
}

export function validProvider(classId: string, claim: unknown, overrides: FakeProviderOptions = {}): ReturnType<typeof fakeProvider> {
  const defaultProviderId = 'provider-' + classId.replace(/[^a-z0-9-]+/g, '-');
  return fakeProvider({
    metadata: { provider_id: defaultProviderId, supported_classes: [classId], priority: 100, max_verification_level: 'verified', ...overrides.metadata },
    ...(overrides.result
      ? { result: overrides.result }
      : {
          result: {
            outcome: 'collected' as const,
            candidates: [freshCandidateFor(classId, claim)],
            diagnostics: [],
          },
        }),
    ...(overrides.collect ? { collect: overrides.collect } : {}),
    ...(overrides.throwError ? { throwError: overrides.throwError } : {}),
    ...(overrides.respectAbort !== undefined ? { respectAbort: overrides.respectAbort } : {}),
  });
}

export function emptyProvider(classId: string, outcome: 'collected' | 'not_found' = 'not_found') {
  const emptyProviderId = 'empty-' + classId.replace(/[^a-z0-9-]+/g, '-');
  return fakeProvider({
    metadata: { provider_id: emptyProviderId, supported_classes: [classId] },
    result: { outcome, candidates: [], diagnostics: [] },
  });
}

export { metadata, candidate, fakeProvider };
