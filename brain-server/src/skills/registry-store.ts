/**
 * Goal24 Checkpoint 5 - deterministic JSON persistence for the Skill
 * Registry V1 (Lane A).
 *
 * A small deterministic JSON store (schema_version + records + updated_at),
 * deliberately not a database migration. Writes are atomic: temp file ->
 * write -> fsync -> close -> rename. Reads are strict: malformed JSON,
 * unknown fields, duplicate record identities or an unknown schema version
 * all fail closed with SKILL_REGISTRY_CORRUPT. The store is never silently
 * reset, so trust/revocation history cannot be lost to a parse error.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  SkillRegistryError,
  SkillRegistryRecordSchema,
  skillRecordKey,
} from './registry-types.js';

export const SKILL_REGISTRY_STORE_VERSION = 1;

export const SkillRegistryStoreSchema = z.strictObject({
  schema_version: z.literal(SKILL_REGISTRY_STORE_VERSION),
  updated_at: z.string().min(1),
  records: z.array(SkillRegistryRecordSchema),
});

export type SkillRegistryStoreData = z.infer<typeof SkillRegistryStoreSchema>;

function corrupt(storePath: string, message: string): SkillRegistryError {
  return new SkillRegistryError('SKILL_REGISTRY_CORRUPT', `skill registry store at '${storePath}': ${message}`);
}

function describeZodIssues(issues: z.ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

/**
 * Load the store. A missing file is a first-run empty store (ENOENT only);
 * anything else that exists but is unreadable, malformed or schema-invalid
 * fails closed with SKILL_REGISTRY_CORRUPT.
 */
export async function loadSkillRegistryStore(storePath: string): Promise<SkillRegistryStoreData> {
  let raw: string;
  try {
    raw = await fs.readFile(storePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        schema_version: SKILL_REGISTRY_STORE_VERSION,
        updated_at: new Date(0).toISOString(),
        records: [],
      };
    }
    throw corrupt(storePath, `cannot read: ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw corrupt(storePath, 'file is not valid JSON');
  }

  const result = SkillRegistryStoreSchema.safeParse(parsed);
  if (!result.success) {
    throw corrupt(storePath, `failed strict schema validation: ${describeZodIssues(result.error.issues)}`);
  }

  // Fail closed on duplicate name@version identities instead of silently
  // deduplicating records whose conflict was decided outside this store.
  const seen = new Set<string>();
  for (const record of result.data.records) {
    const key = skillRecordKey(record.name, record.version);
    if (seen.has(key)) {
      throw corrupt(storePath, `contains duplicate record identity '${key}'`);
    }
    seen.add(key);
  }

  return result.data;
}

/**
 * Atomically persist the store. Serialization is deterministic: fixed
 * top-level field order and stable key order inside records; callers must
 * provide records in a stable order (the registry sorts them).
 */
export async function saveSkillRegistryStore(
  storePath: string,
  data: SkillRegistryStoreData,
): Promise<void> {
  const directory = path.dirname(storePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(storePath)}.${process.pid}.${Date.now().toString(36)}.tmp`,
  );
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const handle = await fs.open(temporary, 'w');
  try {
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, storePath);
}