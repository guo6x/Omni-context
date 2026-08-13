/**
 * Goal24 Checkpoint 5 - importer -> managed snapshot -> registry bridge tests.
 *
 * These tests prove the formal security bridge: imported packages always
 * start quarantined, trust can only change through an explicit internal
 * decision, resolveSkillForUse re-verifies the managed snapshot digest
 * before every use, revocation survives restart and re-import, the registry
 * store fails closed, and no bundled code is ever executed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GITHUB_READONLY_CAPABILITIES } from '../src/capabilities/github-readonly.js';
import { computePackageDigest, sha256Hex } from '../src/skills/importer/package-digest.js';
import {
  findCaseFoldedPathCollisions,
  normalizeRelativePath,
} from '../src/skills/importer/path-policy.js';
import { importSkillPackage } from '../src/skills/importer/package-loader.js';
import { SkillRegistry } from '../src/skills/registry.js';
import { SkillRegistryError } from '../src/skills/registry-types.js';
import { SkillPackageRegistryService } from '../src/skills/skill-package-registry-service.js';
import { parseSkillFrontmatter } from '../src/skills/importer/frontmatter.js';

const FIXTURES = path.resolve(
  __dirname,
  '../../docs/goal24/fixtures/cp5-skills',
);

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
});

function makeCapabilityLookup() {
  return (capabilityId: string) =>
    GITHUB_READONLY_CAPABILITIES.find((capability) => capability.id === capabilityId);
}

function writePackage(root: string, files: Record<string, string>): void {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
}

const VALID_SKILL_MD = `---
name: github-issue-inspector
description: read-only issue inspection
---
# body text (inert)
`;

const VALID_MANIFEST = JSON.stringify({
  name: 'github-issue-inspector',
  version: '1.0.0',
  description: 'read-only issue inspection',
  capabilities: ['github.issue.search', 'github.issue.read'],
  procedure: [
    { step_id: 'search', description: 'search issues', capability_id: 'github.issue.search' },
  ],
  risk: 'low',
  adapter_preference: 'any',
});

function buildPackage(version = '1.0.0'): string {
  const root = makeTempDir('cp5-src-');
  writePackage(root, {
    'SKILL.md': VALID_SKILL_MD,
    'omni-skill.json': VALID_MANIFEST.replace('"version":"1.0.0"', '"version":"' + version + '"'),
  });
  return root;
}

async function makeService(managedRoot?: string) {
  const managed = managedRoot ?? makeTempDir('cp5-managed-');
  const storePath = path.join(makeTempDir('cp5-store-'), 'skill-registry.json');
  const registry = await SkillRegistry.open(storePath, {
    capabilityLookup: makeCapabilityLookup(),
  });
  const service = new SkillPackageRegistryService(registry, {
    managedSkillRoot: managed,
  });
  return { service, registry, storePath, managed };
}

describe('import -> registry security bridge', () => {
  it('registers an imported package as quarantined, never trusted', async () => {
    const { service, registry } = await makeService();
    const result = await service.importSkillPackage(buildPackage());
    expect(result.status).toBe('REGISTERED_QUARANTINED');
    expect(result.record?.trust_status).toBe('quarantined');
    expect(result.record?.source_type).toBe('imported');
    expect(registry.isEligibleForUse(result.record!)).toBe(false);
    expect(() => service.resolveSkillForUse('github-issue-inspector')).toThrowError(
      /SKILL_NOT_ELIGIBLE/,
    );
  });

  it('rejects a caller-supplied trust_status=trusted on registration input', async () => {
    const { service, registry } = await makeService();
    const imported = importSkillPackage(buildPackage(), {
      managedSkillRoot: makeTempDir('cp5-managed-spoof-'),
    });
    expect(imported.manifest).not.toBeNull();
    await expect(
      registry.register({
        manifest: imported.manifest!,
        package_digest: imported.package_digest!,
        manifest_digest: imported.manifest_digest!,
        source_type: 'imported',
        source_id: 'spoofed',
        trust_status: 'trusted',
      } as never),
    ).rejects.toThrowError(/SKILL_INPUT_INVALID/);
  });

  it('never registers a SKILL.md-only package as a usable skill', async () => {
    const { service, registry } = await makeService();
    const root = makeTempDir('cp5-smd-only-');
    writePackage(root, { 'SKILL.md': VALID_SKILL_MD });
    const result = await service.importSkillPackage(root);
    expect(result.status).toBe('QUARANTINED_UNBOUND');
    expect(result.record).toBeNull();
    expect(registry.list()).toHaveLength(0);
    expect(() => service.resolveSkillForUse('github-issue-inspector')).toThrowError(
      /SKILL_NOT_FOUND/,
    );
  });

  it('rejects a manifest referencing a capability that does not exist', async () => {
    const { service } = await makeService();
    const root = makeTempDir('cp5-missing-cap-');
    const manifest = JSON.parse(VALID_MANIFEST);
    manifest.capabilities = ['github.issue.search', 'vscode.terminal.execute'];
    writePackage(root, {
      'SKILL.md': VALID_SKILL_MD,
      'omni-skill.json': JSON.stringify(manifest),
    });
    const result = await service.importSkillPackage(root);
    expect(result.status).toBe('REGISTRATION_REJECTED');
    expect(result.error).toMatch(/SKILL_VALIDATION_FAILED/);
  });

  it('quarantines a manifest whose name mismatches SKILL.md', async () => {
    const { service, registry } = await makeService();
    const root = makeTempDir('cp5-mismatch-');
    const manifest = JSON.parse(VALID_MANIFEST);
    manifest.name = 'other-skill-name';
    writePackage(root, {
      'SKILL.md': VALID_SKILL_MD,
      'omni-skill.json': JSON.stringify(manifest),
    });
    const result = await service.importSkillPackage(root);
    expect(result.status).toBe('QUARANTINED_NAME_MISMATCH');
    expect(registry.list()).toHaveLength(0);
  });
});

describe('trust lifecycle and resolveSkillForUse', () => {
  it('owner-decision transition quarantined -> reviewed -> trusted makes resolve pass', async () => {
    const { service, registry } = await makeService();
    const imported = await service.importSkillPackage(buildPackage());
    expect(imported.status).toBe('REGISTERED_QUARANTINED');
    const name = imported.record!.name;
    const version = imported.record!.version;

    await registry.setTrustStatus(name, version, 'reviewed', {
      actor: 'owner',
      mechanism: 'owner-decision',
      reason: 'review complete',
      at: new Date().toISOString(),
    });
    expect(() => service.resolveSkillForUse(name, version)).toThrowError(/SKILL_NOT_ELIGIBLE/);

    await registry.setTrustStatus(name, version, 'trusted', {
      actor: 'owner',
      mechanism: 'owner-decision',
      reason: 'approved for use',
      at: new Date().toISOString(),
    });
    const resolved = service.resolveSkillForUse(name, version);
    expect(resolved.record.trust_status).toBe('trusted');
    expect(resolved.snapshotRoot).toContain(resolved.record.package_digest);
    expect(resolved.files.length).toBeGreaterThan(0);
  });

  it('mutation of the managed snapshot after trust blocks use', async () => {
    const { service, registry } = await makeService();
    const imported = await service.importSkillPackage(buildPackage());
    const name = imported.record!.name;
    const version = imported.record!.version;
    await registry.setTrustStatus(name, version, 'trusted', {
      actor: 'owner',
      mechanism: 'owner-decision',
      at: new Date().toISOString(),
    });
    const resolved = service.resolveSkillForUse(name, version);
    const skillMdPath = path.join(resolved.snapshotRoot, 'SKILL.md');
    fs.writeFileSync(skillMdPath, fs.readFileSync(skillMdPath, 'utf8') + '\n# mutated\n');
    expect(() => service.resolveSkillForUse(name, version)).toThrowError(
      /SKILL_PACKAGE_INTEGRITY_FAILURE/,
    );
  });

  it('revocation survives restart and same-digest re-import', async () => {
    const managed = makeTempDir('cp5-managed-');
    const storePath = path.join(makeTempDir('cp5-store-'), 'skill-registry.json');
    const registry1 = await SkillRegistry.open(storePath, { capabilityLookup: makeCapabilityLookup() });
    const service1 = new SkillPackageRegistryService(registry1, { managedSkillRoot: managed });
    const imported = await service1.importSkillPackage(buildPackage());
    const name = imported.record!.name;
    const version = imported.record!.version;
    await registry1.setTrustStatus(name, version, 'trusted', {
      actor: 'owner',
      mechanism: 'owner-decision',
      at: new Date().toISOString(),
    });
    await registry1.revoke(name, version, {
      actor: 'owner',
      mechanism: 'owner-decision',
      reason: 'security issue',
      at: new Date().toISOString(),
    });
    expect(() => service1.resolveSkillForUse(name, version)).toThrowError(/SKILL_NOT_ELIGIBLE/);

    const registry2 = await SkillRegistry.open(storePath, { capabilityLookup: makeCapabilityLookup() });
    const service2 = new SkillPackageRegistryService(registry2, { managedSkillRoot: managed });
    expect(registry2.get(name, version)?.revoked).toBe(true);
    expect(() => service2.resolveSkillForUse(name, version)).toThrowError(/SKILL_NOT_ELIGIBLE/);

    // Same-digest re-import must not revive the revoked record.
    const reimport = await service2.importSkillPackage(buildPackage());
    expect(reimport.status).toBe('REGISTERED_QUARANTINED');
    const record = reimport.record!;
    expect(record.revoked).toBe(true);
    expect(record.trust_status).toBe('revoked');
    expect(() => service2.resolveSkillForUse(name, version)).toThrowError(/SKILL_NOT_ELIGIBLE/);
  });

  it('disabled state survives same-digest re-registration', async () => {
    const { service, registry } = await makeService();
    const imported = await service.importSkillPackage(buildPackage());
    const name = imported.record!.name;
    const version = imported.record!.version;
    await registry.disable(name, version);
    const reimport = await service.importSkillPackage(buildPackage());
    expect(reimport.record?.enabled).toBe(false);
  });
});

describe('version semantics', () => {
  it('same name@version with different content throws SKILL_VERSION_CONFLICT', async () => {
    const { service } = await makeService();
    const first = await service.importSkillPackage(buildPackage('1.0.0'));
    expect(first.status).toBe('REGISTERED_QUARANTINED');
    const root = buildPackage('1.0.0');
    fs.writeFileSync(path.join(root, 'extra.txt'), 'different content');
    const second = await service.importSkillPackage(root);
    expect(second.status).toBe('REGISTRATION_REJECTED');
    expect(second.error).toMatch(/SKILL_VERSION_CONFLICT/);
  });

  it('resolves the latest trusted version numerically (1.10.0 > 1.9.0)', async () => {
    const { service, registry } = await makeService();
    const v190 = await service.importSkillPackage(buildPackage('1.9.0'));
    const v1100 = await service.importSkillPackage(buildPackage('1.10.0'));
    for (const record of [v190.record!, v1100.record!]) {
      await registry.setTrustStatus(record.name, record.version, 'trusted', {
        actor: 'owner',
        mechanism: 'owner-decision',
        at: new Date().toISOString(),
      });
    }
    const resolved = service.resolveSkillForUse('github-issue-inspector');
    expect(resolved.record.version).toBe('1.10.0');
  });
});

describe('concurrency', () => {
  it('parallel registrations never lose updates in the persistent store', async () => {
    const { service, registry, storePath } = await makeService();
    const roots = Array.from({ length: 30 }, (_, index) => {
      const root = makeTempDir(`cp5-par-${index}-`);
      const manifest = JSON.parse(VALID_MANIFEST);
      manifest.name = `parallel-skill-${index}`;
      writePackage(root, {
        'SKILL.md': VALID_SKILL_MD.replace(
          'name: github-issue-inspector',
          `name: parallel-skill-${index}`,
        ),
        'omni-skill.json': JSON.stringify(manifest),
      });
      return root;
    });
    await Promise.all(roots.map((root) => service.importSkillPackage(root)));
    expect(registry.list()).toHaveLength(30);

    const reopened = await SkillRegistry.open(storePath, {
      capabilityLookup: makeCapabilityLookup(),
    });
    expect(reopened.list()).toHaveLength(30);
    expect(reopened.list().map((record) => record.name).sort()).toEqual(
      roots.map((_, index) => `parallel-skill-${index}`).sort(),
    );
  });
});

describe('path safety hardening', () => {
  it('detects case-insensitive path collisions deterministically', () => {
    const collisions = findCaseFoldedPathCollisions(['A.txt', 'a.txt', 'other.txt']);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].sort()).toEqual(['A.txt', 'a.txt']);
    expect(findCaseFoldedPathCollisions(['A.txt', 'B.txt'])).toHaveLength(0);
  });

  it('rejects control characters and traversal in relative paths', () => {
    expect(normalizeRelativePath('a/b.txt')).toBe('a/b.txt');
    expect(normalizeRelativePath('a\nb.txt')).toBeNull();
    expect(normalizeRelativePath('a\tb.txt')).toBeNull();
    expect(normalizeRelativePath('../etc/passwd')).toBeNull();
    expect(normalizeRelativePath('C:\\evil.txt')).toBeNull();
    expect(normalizeRelativePath('\\\\server\\share\\evil')).toBeNull();
    expect(normalizeRelativePath('a/' + 'x'.repeat(300))).toBeNull();
  });
});

describe('package digest encoding', () => {
  it('is unambiguous: a crafted multi-file listing cannot collide with a single evil path', () => {
    const listing1 = [
      { relative_path: 'a', size: 1, sha256: '1'.repeat(64), classification: 'text' as const },
      { relative_path: 'b', size: 2, sha256: '2'.repeat(64), classification: 'text' as const },
    ];
    const evilPath = `a 1 ${'1'.repeat(64)}\nb`;
    const listing2 = [
      { relative_path: evilPath, size: 2, sha256: '2'.repeat(64), classification: 'text' as const },
    ];
    const d1 = computePackageDigest(listing1);
    const d2 = computePackageDigest(listing2);
    expect(d1).not.toBe(d2);
  });

  it('digest covers every file including bundled scripts', () => {
    const base = [
      { relative_path: 'SKILL.md', size: 10, sha256: sha256Hex('a'.repeat(10)), classification: 'skill_md' as const },
      { relative_path: 'run.ps1', size: 4, sha256: sha256Hex('evil'), classification: 'script' as const },
    ];
    const changed = [
      base[0],
      { ...base[1], size: 5, sha256: sha256Hex('evil2') },
    ];
    expect(computePackageDigest(base)).not.toBe(computePackageDigest(changed));
  });
});

describe('frontmatter hardening', () => {
  it('rejects duplicate keys, custom tags, multi-document streams and proto keys', () => {
    expect(() =>
      parseSkillFrontmatter('---\nname: a\nname: b\ndescription: d\n---\n'),
    ).toThrowError(/duplicated mapping key/);
    expect(() =>
      parseSkillFrontmatter('---\nname: !omni/policy x\ndescription: d\n---\n'),
    ).toThrowError(/malformed YAML/);
    expect(() =>
      parseSkillFrontmatter('---\nname: a\ndescription: d\n--- \nname: b\n---\n'),
    ).toThrowError(/exactly one YAML document/);
    expect(() =>
      parseSkillFrontmatter('---\nname: a\ndescription: d\n__proto__: polluted\n---\n'),
    ).toThrowError(/prototype-pollution/);
  });

  it('bounds deep nesting and cyclic aliases', () => {
    const deep = '---\nname: a\ndescription: d\nvalue: ' + '['.repeat(200) + '1' + ']'.repeat(200) + '\n---\n';
    expect(() => parseSkillFrontmatter(deep)).toThrowError(/nesting|malformed/);
    expect(() =>
      parseSkillFrontmatter('---\nname: a\ndescription: d\na: &x [*x]\n---\n'),
    ).toThrowError(/cyclic alias graph/);
  });

  it('rejects control characters and bidi overrides in descriptions', () => {
    expect(() =>
      parseSkillFrontmatter('---\nname: a\ndescription: "d\u001bESC"\n---\n'),
    ).toThrowError(/control characters|malformed YAML/);
    expect(() =>
      parseSkillFrontmatter('---\nname: a\ndescription: "d\u202eRLO"\n---\n'),
    ).toThrowError(/bidi override/);
  });

  it('preserves allowed-tools as inert vendor metadata and rejects names over 64 chars', () => {
    const parsed = parseSkillFrontmatter(
      '---\nname: a\ndescription: d\nallowed-tools: ["Bash(git:*)"]\n---\n',
    );
    expect(parsed.vendorMetadata).toEqual({ 'allowed-tools': ['Bash(git:*)'] });
    expect(parsed.unknownKeys).toEqual([]);
    expect(() =>
      parseSkillFrontmatter(`---\nname: ${'a'.repeat(65)}\ndescription: d\n---\n`),
    ).toThrowError(/at most 64/);
  });
});

describe('bundled code is never executed', () => {
  it('imports script fixtures without running them or creating sentinels', () => {
    const managed = makeTempDir('cp5-managed-scripts-');
    const source = path.join(FIXTURES, 'bundled-code');
    const result = importSkillPackage(source, { managedSkillRoot: managed });
    expect(result.failure).toBeNull();
    expect(result.bundled_code_present).toBe(true);
    expect(result.script_files.length).toBeGreaterThan(0);
    for (const base of [source, managed, process.cwd()]) {
      expect(fs.existsSync(path.join(base, 'SHOULD_NOT_EXIST.txt'))).toBe(false);
    }
  });
});
