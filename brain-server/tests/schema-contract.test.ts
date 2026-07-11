import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import {
  buildCapabilityMatrix,
  buildGeneratedTypeModule,
  buildMcpToolManifest,
  buildSchemaManifest,
} from '../scripts/generate-schema-artifacts.js';
import initDatabase from '../src/db/sqlite.js';
import { AddRelationshipSchema, tools } from '../src/mcp-tools.js';
import {
  ENTITY_TYPES,
  NOTIFICATION_TYPES,
  RELATIONSHIP_TYPES,
} from '../src/schema/domain.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('generated domain contract', () => {
  it('contains unique types and exposes every relationship through add_relationship', () => {
    expect(new Set(ENTITY_TYPES).size).toBe(ENTITY_TYPES.length);
    expect(new Set(RELATIONSHIP_TYPES).size).toBe(RELATIONSHIP_TYPES.length);
    expect(new Set(NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);

    for (const relationshipType of RELATIONSHIP_TYPES) {
      expect(AddRelationshipSchema.safeParse({
        sourceId: 'source',
        targetId: 'target',
        type: relationshipType,
      }).success).toBe(true);
    }

    const definition = tools.find((tool) => tool.name === 'add_relationship');
    const properties = definition?.inputSchema.properties as Record<string, { enum?: string[] }> | undefined;
    expect(properties?.type.enum).toEqual([...RELATIONSHIP_TYPES]);
  });

  it('keeps checked-in manifests and generated client types deterministic', async () => {
    const schemaManifest = JSON.parse(await readFile(
      path.join(repositoryRoot, 'schema_manifest.json'), 'utf8'));
    const mcpManifest = JSON.parse(await readFile(
      path.join(repositoryRoot, 'mcp_tool_manifest.json'), 'utf8'));
    const capabilityMatrix = await readFile(
      path.join(repositoryRoot, 'generated_capability_matrix.md'), 'utf8');
    const sharedTypes = await readFile(
      path.join(repositoryRoot, 'shared', 'generated-domain-types.ts'), 'utf8');
    const mobileTypes = await readFile(
      path.join(repositoryRoot, 'mobile-app', 'src', 'types', 'generated-domain.ts'), 'utf8');

    expect(schemaManifest).toEqual(buildSchemaManifest());
    expect(mcpManifest).toEqual(buildMcpToolManifest());
    expect(capabilityMatrix).toBe(buildCapabilityMatrix());
    expect(sharedTypes).toBe(buildGeneratedTypeModule());
    expect(mobileTypes).toBe(buildGeneratedTypeModule());
    expect(mcpManifest.toolCount).toBe(25);
  });
});

describe('domain constraint migration', () => {
  it('rejects invalid entity, relationship and notification types at the database boundary', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await expect(db.run(
      "INSERT INTO entities (id, name, type) VALUES ('bad', 'Bad', 'invented_type')",
    )).rejects.toThrow(/invalid entity type/);
    await expect(db.run(
      "INSERT INTO relationships (id, source_id, target_id, type) VALUES ('bad', 'a', 'b', 'invented_type')",
    )).rejects.toThrow(/invalid relationship type/);
    await expect(db.run(
      "INSERT INTO notifications (id, title, content, type) VALUES ('bad', 'Bad', 'Bad', 'invented_type')",
    )).rejects.toThrow(/invalid notification type/);
    await db.close();
  });

  it('upgrades a database with all migrations through v13', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omni-schema-migration-'));
    const dbPath = path.join(directory, 'legacy-v13.db');
    const triggerNames = [
      'validate_entity_type_insert',
      'validate_entity_type_update',
      'validate_relationship_type_insert',
      'validate_relationship_type_update',
      'validate_notification_type_insert',
      'validate_notification_type_update',
    ];
    try {
      const prepared = initDatabase({ dbPath });
      await prepared.runMigrations();
      for (const trigger of triggerNames) await prepared.run(`DROP TRIGGER ${trigger}`);
      await prepared.run("DELETE FROM migrations WHERE name = 'enforce_domain_type_constraints'");
      await prepared.close();

      const upgraded = initDatabase({ dbPath });
      await upgraded.runMigrations();
      const triggers = await upgraded.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'validate_%_type_%'",
      );
      expect(triggers.map((row) => row.name).sort()).toEqual([...triggerNames].sort());
      await upgraded.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
