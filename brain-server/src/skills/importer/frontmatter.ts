/**
 * Goal24 Checkpoint 5 (Lane B) - SKILL.md YAML frontmatter parsing.
 *
 * Frontmatter is parsed with a JSON-restricted YAML schema: only plain
 * JSON-safe values are accepted. No custom tags, no custom constructors,
 * no `eval`/`Function`, and no code execution of any kind. Duplicate keys,
 * multi-document streams, custom tags and cyclic alias graphs are rejected.
 *
 * The parsed document is additionally bounded: alias count, nesting depth
 * and total node count are all capped, so a small SKILL.md can never expand
 * into an unbounded object graph. Frontmatter can only provide `name`,
 * `description` and a display-only `vendor_metadata` block; every other key
 * is ignored with a warning and can never override authority, risk,
 * evidence, or capability bindings declared by an omni-skill.json manifest.
 */

import { JSON_SCHEMA, load } from 'js-yaml';
import { SKILL_NAME_PATTERN } from '../contracts.js';

export const FRONTMATTER_DESCRIPTION_MAX_LENGTH = 2000;
export const FRONTMATTER_NAME_MAX_LENGTH = 64;
export const FRONTMATTER_MAX_ALIASES = 100;
export const FRONTMATTER_MAX_DEPTH = 32;
export const FRONTMATTER_MAX_NODES = 100_000;

/**
 * Agent Skills compatibility keys that are preserved as display-only vendor
 * metadata. They are never mapped to authority, capability, approval or an
 * executable.
 */
export const FRONTMATTER_VENDOR_KEYS = [
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
] as const;

const BIDI_OVERRIDE_PATTERN = /[\u202a-\u202e\u2066-\u2069]/;

export class SkillFrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillFrontmatterError';
  }
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  vendorMetadata: Record<string, unknown>;
  unknownKeys: string[];
}

/** Matches a leading `---` ... `---` block that starts at the very first byte. */
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

interface WalkStats {
  depth: number;
  nodes: number;
}

function assertBoundedJsonSafe(
  value: unknown,
  depth: number,
  stats: WalkStats,
  seen: Set<object>,
  context: string,
): void {
  if (depth > FRONTMATTER_MAX_DEPTH) {
    throw new SkillFrontmatterError(
      `frontmatter ${context} exceeds the maximum nesting depth of ${FRONTMATTER_MAX_DEPTH}`,
    );
  }
  stats.nodes += 1;
  if (stats.nodes > FRONTMATTER_MAX_NODES) {
    throw new SkillFrontmatterError(
      `frontmatter expands beyond the maximum node count of ${FRONTMATTER_MAX_NODES}`,
    );
  }
  if (value === null) return;
  const valueType = typeof value;
  if (valueType === 'string') return;
  if (valueType === 'boolean') return;
  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      throw new SkillFrontmatterError(`frontmatter contains a non-finite number at ${context}`);
    }
    return;
  }
  if (valueType !== 'object') {
    throw new SkillFrontmatterError(`frontmatter contains a non-JSON value at ${context}`);
  }
  if (seen.has(value as object)) {
    throw new SkillFrontmatterError('frontmatter contains a cyclic alias graph, which is not accepted');
  }
  seen.add(value as object);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertBoundedJsonSafe(item, depth + 1, stats, seen, `${context}[${index}]`);
    });
    seen.delete(value as object);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new SkillFrontmatterError(`frontmatter contains a non-plain object at ${context}`);
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new SkillFrontmatterError(
        `frontmatter key '${key}' at ${context} is rejected (prototype-pollution key)`,
      );
    }
    assertBoundedJsonSafe(
      (value as Record<string, unknown>)[key],
      depth + 1,
      stats,
      seen,
      `${context}.${key}`,
    );
  }
  seen.delete(value as object);
}

/**
 * Parse the SKILL.md frontmatter.
 *
 * Throws SkillFrontmatterError when the frontmatter is missing, malformed,
 * not a YAML mapping, exceeds the structural bounds, or lacks a valid string
 * `name` / `description`.
 */
export function parseSkillFrontmatter(skillMdText: string): SkillFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(skillMdText);
  if (!match) {
    throw new SkillFrontmatterError('SKILL.md must begin with a YAML frontmatter block delimited by --- lines');
  }

  const block = match[1];
  if (block.split(/\r?\n/).some((line) => line.trim() === '---')) {
    throw new SkillFrontmatterError('frontmatter must contain exactly one YAML document; a second --- delimiter inside the block is rejected');
  }

  let document: unknown;
  try {
    document = load(block, {
      schema: JSON_SCHEMA,
      maxAliasCount: FRONTMATTER_MAX_ALIASES,
      filename: 'SKILL.md frontmatter',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SkillFrontmatterError(`malformed YAML frontmatter: ${detail}`);
  }

  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new SkillFrontmatterError('frontmatter must be a YAML mapping of key/value pairs');
  }

  assertBoundedJsonSafe(document, 0, { depth: 0, nodes: 0 }, new Set(), 'root');
  const record = document as Record<string, unknown>;

  const rawName = record['name'];
  if (typeof rawName !== 'string') {
    throw new SkillFrontmatterError('frontmatter requires a string "name"');
  }
  if (rawName.length > FRONTMATTER_NAME_MAX_LENGTH) {
    throw new SkillFrontmatterError(
      `frontmatter "name" must be at most ${FRONTMATTER_NAME_MAX_LENGTH} characters`,
    );
  }
  if (!SKILL_NAME_PATTERN.test(rawName)) {
    throw new SkillFrontmatterError(
      `frontmatter "name" must match ${String(SKILL_NAME_PATTERN)} (lowercase identifier with dashes)`,
    );
  }

  const rawDescription = record['description'];
  if (typeof rawDescription !== 'string') {
    throw new SkillFrontmatterError('frontmatter requires a string "description"');
  }
  const description = rawDescription.trim();
  if (description.length === 0) {
    throw new SkillFrontmatterError('frontmatter "description" must not be empty after trimming');
  }
  if (description.length > FRONTMATTER_DESCRIPTION_MAX_LENGTH) {
    throw new SkillFrontmatterError(
      `frontmatter "description" must be at most ${FRONTMATTER_DESCRIPTION_MAX_LENGTH} characters`,
    );
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(description)) {
    throw new SkillFrontmatterError('frontmatter "description" must not contain control characters');
  }
  if (BIDI_OVERRIDE_PATTERN.test(description)) {
    throw new SkillFrontmatterError('frontmatter "description" must not contain bidi override characters');
  }

  const vendorMetadata: Record<string, unknown> = {};
  for (const key of FRONTMATTER_VENDOR_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      vendorMetadata[key] = record[key];
    }
  }

  const unknownKeys = Object.keys(record)
    .filter(
      (key) =>
        key !== 'name' &&
        key !== 'description' &&
        !(FRONTMATTER_VENDOR_KEYS as readonly string[]).includes(key),
    )
    .sort();

  return { name: rawName, description, vendorMetadata, unknownKeys };
}
