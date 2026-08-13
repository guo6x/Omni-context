/**
 * Goal24 Checkpoint 5 (Lane A) - Skill Registry V1 runtime core tests.
 *
 * Pure tests only: no process spawn, no network, no remote state changes.
 * The registry stores validated procedural artifact metadata; it never
 * executes scripts, commands, shells, Python, JS, PowerShell or binaries,
 * and it never treats `adapter_preference` as transport authority.
 *
 * Coverage: registration validation and fail-closed error codes, canonical
 * trust states (imported/local default `quarantined`, no auto-trust),
 * provenance-gated trust transitions, version identity/conflict semantics,
 * numeric semantic version resolution, eligibility gates, deterministic
 * persistence, and fail-closed loading of corrupt or unknown-field stores.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type CapabilityDefinition } from '../src/capabilities/contracts.js';
import {
  compareSemver,
  eligible_for_use,
  SkillRegistry,
} from '../src/skills/registry.js';
import {
  SKILL_TRUST_STATES,
  SkillRegistryError,
  skillRecordKey,
  type CapabilityLookup,
  type SkillRegistryRegistrationInput,
  type SkillProvenance,
} from '../src/skills/registry-types.js';
import type { SkillManifest as SkillManifestType } from '../src/skills/contracts.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2026-08-13T00:00:00.000Z');

const readCapability: CapabilityDefinition = {
  id: 'github.issue.read',
  version: '1.0.0',
  description: 'Read a GitHub issue',
  input_schema: { type: 'object', properties: {} },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
};

const closeCapability: CapabilityDefinition = {
  id: 'github.issue.close',
  version: '1.0.0',
  description: 'Close a GitHub issue',
  input_schema: { type: 'object', properties: {} },
  required_authority: 'L2',
  risk_level: 'high',
  reversible: true,
  side_effect_class: 'reversible_write',
  required_evidence: [],
  verification_capability: 'github.issue.read',
};

const guardedCapability: CapabilityDefinition = {
  ...readCapability,
  id: 'github.issue.triage',
  required_evidence: [
    { class_id: 'repository.current_state', mandatory: true, conflict_policy: 'reject' },
  ],
};

const defaultLookup: CapabilityLookup = (capabilityId) => {
  const catalog = new Map<string, CapabilityDefinition>([
    [readCapability.id, readCapability],
    [closeCapability.id, closeCapability],
    [guardedCapability.id, guardedCapability],
  ]);
  return catalog.get(capabilityId);
};

function baseManifest(overrides: Partial<SkillManifestType> = {}): SkillManifestType {
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
    ...overrides,
  };
}

const PKG_A = 'a'.repeat(64);
const PKG_B = 'b'.repeat(64);
const MANIFEST_A = 'c'.repeat(64);
const MANIFEST_B = 'd'.repeat(64);

function registrationInput(
  overrides: Partial<SkillRegistryRegistrationInput> = {},
): SkillRegistryRegistrationInput {
  return {
    manifest: baseManifest(),
    package_digest: PKG_A,
    manifest_digest: MANIFEST_A,
    source_type: 'imported',
    source_id: 'unit-test',
    ...overrides,
  };
}

function provenance(mechanism: string, actor = 'admin'): SkillProvenance {
  return { actor, mechanism, reason: 'unit test', at: '2026-08-13T00:00:00.000Z' };
}

function makeRegistry(
  options: Partial<ConstructorParameters<typeof SkillRegistry>[0]> = {},
  storePath?: string,
): SkillRegistry {
  return new SkillRegistry(
    {
      capabilityLookup: defaultLookup,
      now: () => FIXED_NOW,
      ...options,
    },
    storePath,
  );
}

async function errorOf(promise: Promise<unknown>): Promise<SkillRegistryError> {
  try {
    await promise;
  } catch (error) {
    return error as SkillRegistryError;
  }
  throw new Error('expected the promise to reject with a SkillRegistryError');
}

const tempDirectories: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-registry-test-'));
  tempDirectories.push(directory);
  return directory;
}

afterAll(async () => {
  await Promise.all(
    tempDirectories.map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('registration', () => {
  it('registers a valid skill and defaults imported skills to quarantined', async () => {
    const registry = makeRegistry();
    const record = await registry.register(registrationInput());
    expect(record.name).toBe('issue-triage');
    expect(record.version).toBe('1.0.0');
    expect(record.trust_status).toBe('quarantined');
    expect(record.enabled).toBe(true);
    expect(record.revoked).toBe(false);
    expect(record.validation_status).toBe('valid');
    expect(record.validation_issues).toEqual([]);
    expect(record.capability_ids).toEqual(['github.issue.read']);
    expect(record.risk_snapshot).toEqual({
      risk_level: 'low',
      highest_capability_risk: 'low',
      capability_count: 1,
    });
    expect(record.provenance[0].mechanism).toBe('registration');
  });

  it('rejects a schema-invalid manifest with SKILL_INPUT_INVALID', async () => {
    const registry = makeRegistry();
    const error = await errorOf(
      registry.register(registrationInput({ manifest: baseManifest({ name: 'BAD_NAME' }) })),
    );
    expect(error.code).toBe('SKILL_INPUT_INVALID');
  });

  it('rejects registration inputs with unknown fields (strict schema)', async () => {
    const registry = makeRegistry();
    const error = await errorOf(
      registry.register({
        ...registrationInput(),
        command: 'calc.exe',
      } as unknown as SkillRegistryRegistrationInput),
    );
    expect(error.code).toBe('SKILL_INPUT_INVALID');
  });

  it('rejects a manifest referencing a missing capability with SKILL_VALIDATION_FAILED', async () => {
    const registry = makeRegistry();
    const error = await errorOf(
      registry.register(
        registrationInput({
          manifest: baseManifest({
            capabilities: ['github.issue.missing'],
            procedure: [
              { step_id: 'probe', description: 'Probe a missing capability', capability_id: 'github.issue.missing' },
            ],
          }),
        }),
      ),
    );
    expect(error.code).toBe('SKILL_VALIDATION_FAILED');
  });

  it('rejects risk weakening with SKILL_VALIDATION_FAILED', async () => {
    const registry = makeRegistry();
    const error = await errorOf(
      registry.register(
        registrationInput({
          manifest: baseManifest({
            capabilities: ['github.issue.close'],
            procedure: [
              { step_id: 'close_issue', description: 'Close the issue', capability_id: 'github.issue.close' },
            ],
            risk: 'low',
          }),
        }),
      ),
    );
    expect(error.code).toBe('SKILL_VALIDATION_FAILED');
    expect(error.message).toContain('risk');
  });

  it('rejects invalid SHA-256 digests with SKILL_INPUT_INVALID', async () => {
    const registry = makeRegistry();
    const invalidDigests = ['z'.repeat(64), 'A'.repeat(64), 'abcd1234', 'not-a-digest'];
    for (const digest of invalidDigests) {
      const packageError = await errorOf(
        registry.register(registrationInput({ package_digest: digest })),
      );
      expect(packageError.code, `package_digest ${digest}`).toBe('SKILL_INPUT_INVALID');
      const manifestError = await errorOf(
        registry.register(registrationInput({ manifest_digest: digest })),
      );
      expect(manifestError.code, `manifest_digest ${digest}`).toBe('SKILL_INPUT_INVALID');
    }
  });

  it('is idempotent for identical name@version content', async () => {
    const registry = makeRegistry();
    const first = await registry.register(registrationInput());
    const second = await registry.register(registrationInput());
    expect(second).toBe(first);
    expect(registry.list()).toHaveLength(1);
  });

  it('fails closed with SKILL_VERSION_CONFLICT for identical identity but different content', async () => {
    const registry = makeRegistry();
    const first = await registry.register(registrationInput());
    const error = await errorOf(
      registry.register(registrationInput({ package_digest: PKG_B })),
    );
    expect(error.code).toBe('SKILL_VERSION_CONFLICT');
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('issue-triage', '1.0.0')?.package_digest).toBe(first.package_digest);
  });

  it('fails closed when only the manifest digest differs for the same identity', async () => {
    const registry = makeRegistry();
    await registry.register(registrationInput());
    const error = await errorOf(
      registry.register(registrationInput({ manifest_digest: MANIFEST_B })),
    );
    expect(error.code).toBe('SKILL_VERSION_CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// Version identity and resolution
// ---------------------------------------------------------------------------

describe('version identity and resolution', () => {
  it('canonical identity is name@version', () => {
    expect(skillRecordKey('issue-triage', '1.0.0')).toBe('issue-triage@1.0.0');
  });

  it('compares semantic versions numerically, never as strings', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareSemver('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compareSemver('1.10.0', '1.10.0')).toBe(0);
    expect(compareSemver('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('resolves the latest trusted version with numeric semantics (1.10.0 > 1.9.0)', async () => {
    const registry = makeRegistry();
    await registry.register(registrationInput({ manifest: baseManifest({ version: '1.9.0' }) }));
    await registry.register(registrationInput({ manifest: baseManifest({ version: '1.10.0' }) }));
    await registry.setTrustStatus('issue-triage', '1.9.0', 'trusted', provenance('owner-decision'));
    await registry.setTrustStatus('issue-triage', '1.10.0', 'trusted', provenance('owner-decision'));
    expect(registry.resolveLatestTrusted('issue-triage')?.version).toBe('1.10.0');
  });

  it('lists versions ascending and returns undefined when no trusted version exists', async () => {
    const registry = makeRegistry();
    await registry.register(registrationInput({ manifest: baseManifest({ version: '1.10.0' }) }));
    await registry.register(registrationInput({ manifest: baseManifest({ version: '1.9.0' }) }));
    expect(registry.listVersions('issue-triage').map((record) => record.version)).toEqual([
      '1.9.0',
      '1.10.0',
    ]);
    expect(registry.resolveLatestTrusted('issue-triage')).toBeUndefined();
  });

  it('latest trusted resolution ignores revoked and disabled versions', async () => {
    const registry = makeRegistry();
    await registry.register(registrationInput({ manifest: baseManifest({ version: '1.9.0' }) }));
    await registry.register(registrationInput({ manifest: baseManifest({ version: '1.10.0' }) }));
    await registry.setTrustStatus('issue-triage', '1.9.0', 'trusted', provenance('owner-decision'));
    await registry.setTrustStatus('issue-triage', '1.10.0', 'trusted', provenance('owner-decision'));
    await registry.revoke('issue-triage', '1.10.0', provenance('admin-decision'));
    expect(registry.resolveLatestTrusted('issue-triage')?.version).toBe('1.9.0');
    await registry.disable('issue-triage', '1.9.0');
    expect(registry.resolveLatestTrusted('issue-triage')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Trust states and eligibility
// ---------------------------------------------------------------------------

describe('trust states and eligibility', () => {
  it('exports the canonical trust state list', () => {
    expect(SKILL_TRUST_STATES).toEqual(['quarantined', 'reviewed', 'trusted', 'revoked']);
  });

  it('quarantined, reviewed, revoked and disabled records are never eligible', async () => {
    const registry = makeRegistry();
    const record = await registry.register(registrationInput());
    expect(record.trust_status).toBe('quarantined');
    expect(registry.isEligibleForUse(record)).toBe(false);
    expect(eligible_for_use(record, defaultLookup)).toBe(false);

    const reviewed = await registry.setTrustStatus(
      'issue-triage', '1.0.0', 'reviewed', provenance('admin-decision'),
    );
    expect(reviewed.trust_status).toBe('reviewed');
    expect(registry.isEligibleForUse(reviewed)).toBe(false);

    const trusted = await registry.setTrustStatus(
      'issue-triage', '1.0.0', 'trusted', provenance('owner-decision'),
    );
    expect(trusted.trust_status).toBe('trusted');
    expect(registry.isEligibleForUse(trusted)).toBe(true);
    expect(eligible_for_use(trusted, defaultLookup)).toBe(true);

    const disabled = await registry.disable('issue-triage', '1.0.0');
    expect(disabled.enabled).toBe(false);
    expect(registry.isEligibleForUse(disabled)).toBe(false);

    const revoked = await registry.revoke('issue-triage', '1.0.0', provenance('admin-decision'));
    expect(revoked.trust_status).toBe('revoked');
    expect(revoked.revoked).toBe(true);
    expect(registry.isEligibleForUse(revoked)).toBe(false);
  });

  it('requires an explicit owner/admin/builtin mechanism to promote to trusted', async () => {
    const registry = makeRegistry();
    await registry.register(registrationInput());
    const error = await errorOf(
      registry.setTrustStatus('issue-triage', '1.0.0', 'trusted', provenance('self-service')),
    );
    expect(error.code).toBe('SKILL_TRUST_TRANSITION_INVALID');
  });

  it('never allows "revoked" as a direct transition target', async () => {
    const registry = makeRegistry();
    await registry.register(registrationInput());
    const error = await errorOf(
      registry.setTrustStatus('issue-triage', '1.0.0', 'revoked', provenance('admin-decision')),
    );
    expect(error.code).toBe('SKILL_TRUST_TRANSITION_INVALID');
  });

  it('never un-revokes a revoked version through setTrustStatus', async () => {
    const registry = makeRegistry();
    await registry.register(registrationInput());
    await registry.revoke('issue-triage', '1.0.0', provenance('admin-decision'));
    const error = await errorOf(
      registry.setTrustStatus('issue-triage', '1.0.0', 'trusted', provenance('owner-decision')),
    );
    expect(error.code).toBe('SKILL_TRUST_TRANSITION_INVALID');
  });

  it('requires a complete provenance object for every trust transition', async () => {
    const registry = makeRegistry();
    await registry.register(registrationInput());
    const error = await errorOf(
      registry.setTrustStatus('issue-triage', '1.0.0', 'reviewed', {
        mechanism: 'admin-decision',
        at: '2026-08-13T00:00:00.000Z',
      } as SkillProvenance),
    );
    expect(error.code).toBe('SKILL_INPUT_INVALID');
  });

  it('defaults imported and local skills to quarantined; builtins only via explicit policy', async () => {
    const registry = makeRegistry({
      builtinTrustedPolicy: ({ name, source_type }) => source_type === 'builtin' && name === 'core-tools',
    });
    const imported = await registry.register(registrationInput());
    expect(imported.trust_status).toBe('quarantined');

    const local = await registry.register(
      registrationInput({ source_type: 'local', manifest: baseManifest({ name: 'core-tools' }) }),
    );
    expect(local.trust_status).toBe('quarantined');

    const builtinWithoutPolicy = await registry.register(
      registrationInput({ source_type: 'builtin', manifest: baseManifest({ name: 'other-tools' }) }),
    );
    expect(builtinWithoutPolicy.trust_status).toBe('quarantined');

    const trustedBuiltin = await registry.register(
      registrationInput({
        source_type: 'builtin',
        manifest: baseManifest({ name: 'core-tools', version: '1.1.0' }),
      }),
    );
    expect(trustedBuiltin.trust_status).toBe('trusted');
    expect(trustedBuiltin.provenance.some((entry) => entry.mechanism === 'builtin-policy')).toBe(true);
  });

  it('eligibility fails when capability_ids drift from the manifest', async () => {
    const registry = makeRegistry();
    const record = await registry.register(registrationInput());
    await registry.setTrustStatus('issue-triage', '1.0.0', 'trusted', provenance('owner-decision'));
    const drifted = { ...record, capability_ids: ['github.issue.read', 'github.issue.read'] };
    expect(eligible_for_use(drifted, defaultLookup)).toBe(false);
  });

  it('exposes validation APIs without executing anything', async () => {
    const registry = makeRegistry();
    const weakened: SkillManifestType = baseManifest({
      capabilities: ['github.issue.triage'],
      procedure: [
        { step_id: 'triage_issue', description: 'Triage the issue', capability_id: 'github.issue.triage' },
      ],
      required_evidence: [
        { class_id: 'repository.current_state', mandatory: true, conflict_policy: 'allow' },
      ],
    });
    expect(registry.validateManifest(weakened).length).toBeGreaterThan(0);
    expect(registry.validateManifest(baseManifest())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('persistence', () => {
  it('persists records across reload with trust and revocation preserved', async () => {
    const directory = await makeTempDir();
    const storePath = path.join(directory, 'skill-registry.json');
    const first = makeRegistry({}, storePath);
    await first.register(registrationInput());
    await first.setTrustStatus('issue-triage', '1.0.0', 'trusted', provenance('owner-decision'));

    const raw = JSON.parse(await fs.readFile(storePath, 'utf8')) as {
      schema_version: number;
      records: unknown[];
    };
    expect(raw.schema_version).toBe(1);
    expect(raw.records).toHaveLength(1);

    const second = await SkillRegistry.open(storePath, {
      capabilityLookup: defaultLookup,
      now: () => FIXED_NOW,
    });
    const loaded = second.get('issue-triage', '1.0.0');
    expect(loaded).toBeDefined();
    expect(loaded?.trust_status).toBe('trusted');
    expect(loaded?.package_digest).toBe(PKG_A);
    expect(second.isEligibleForUse(loaded!)).toBe(true);

    await second.revoke('issue-triage', '1.0.0', provenance('admin-decision'));
    const third = await SkillRegistry.open(storePath, {
      capabilityLookup: defaultLookup,
      now: () => FIXED_NOW,
    });
    expect(third.get('issue-triage', '1.0.0')?.revoked).toBe(true);
    expect(third.isEligibleForUse(third.get('issue-triage', '1.0.0')!)).toBe(false);
  });

  it('fails closed on malformed JSON instead of silently resetting', async () => {
    const directory = await makeTempDir();
    const storePath = path.join(directory, 'skill-registry.json');
    await fs.writeFile(storePath, '{ this is not valid json', 'utf8');
    const error = await errorOf(
      SkillRegistry.open(storePath, { capabilityLookup: defaultLookup, now: () => FIXED_NOW }),
    );
    expect(error.code).toBe('SKILL_REGISTRY_CORRUPT');
  });

  it('fails closed on an unknown schema_version', async () => {
    const directory = await makeTempDir();
    const storePath = path.join(directory, 'skill-registry.json');
    await fs.writeFile(
      storePath,
      JSON.stringify({ schema_version: 99, updated_at: 'x', records: [] }),
      'utf8',
    );
    const error = await errorOf(
      SkillRegistry.open(storePath, { capabilityLookup: defaultLookup, now: () => FIXED_NOW }),
    );
    expect(error.code).toBe('SKILL_REGISTRY_CORRUPT');
  });

  it('fails closed on unknown fields inside a persisted record', async () => {
    const directory = await makeTempDir();
    const storePath = path.join(directory, 'skill-registry.json');
    const seed = makeRegistry({}, storePath);
    await seed.register(registrationInput());
    const stored = JSON.parse(await fs.readFile(storePath, 'utf8')) as {
      records: Array<Record<string, unknown>>;
    };
    stored.records[0].command = 'calc.exe';
    await fs.writeFile(storePath, JSON.stringify(stored), 'utf8');
    const error = await errorOf(
      SkillRegistry.open(storePath, { capabilityLookup: defaultLookup, now: () => FIXED_NOW }),
    );
    expect(error.code).toBe('SKILL_REGISTRY_CORRUPT');
  });

  it('fails closed on duplicate name@version identities in the persisted store', async () => {
    const directory = await makeTempDir();
    const storePath = path.join(directory, 'skill-registry.json');
    const seed = makeRegistry({}, storePath);
    await seed.register(registrationInput());
    const stored = JSON.parse(await fs.readFile(storePath, 'utf8')) as {
      records: Array<Record<string, unknown>>;
    };
    stored.records.push(JSON.parse(JSON.stringify(stored.records[0])) as Record<string, unknown>);
    await fs.writeFile(storePath, JSON.stringify(stored), 'utf8');
    const error = await errorOf(
      SkillRegistry.open(storePath, { capabilityLookup: defaultLookup, now: () => FIXED_NOW }),
    );
    expect(error.code).toBe('SKILL_REGISTRY_CORRUPT');
  });

  it('treats a missing store file as a clean first-run empty registry', async () => {
    const directory = await makeTempDir();
    const storePath = path.join(directory, 'does-not-exist', 'skill-registry.json');
    const registry = await SkillRegistry.open(storePath, {
      capabilityLookup: defaultLookup,
      now: () => FIXED_NOW,
    });
    expect(registry.list()).toEqual([]);
  });

  it('throws SKILL_NOT_FOUND for mutations of unknown identities', async () => {
    const registry = makeRegistry();
    expect((await errorOf(registry.disable('nope', '1.0.0'))).code).toBe('SKILL_NOT_FOUND');
    expect(
      (await errorOf(registry.revoke('nope', '1.0.0', provenance('admin-decision')))).code,
    ).toBe('SKILL_NOT_FOUND');
  });
});
