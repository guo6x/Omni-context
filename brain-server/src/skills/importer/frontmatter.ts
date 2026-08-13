/**
 * Goal24 Checkpoint 5 (Lane B) - SKILL.md YAML frontmatter parsing.
 *
 * Frontmatter is parsed with a JSON-restricted YAML schema: only plain
 * JSON-safe values are accepted. No custom tags, no custom constructors,
 * no `eval`/`Function`, and no code execution of any kind. Frontmatter can
 * only provide `name` and `description` metadata; every other key is
 * ignored with a warning and can never override authority, risk, evidence,
 * or capability bindings declared by an omni-skill.json manifest.
 */

import { JSON_SCHEMA, load } from 'js-yaml';
import { SKILL_NAME_PATTERN } from '../contracts.js';

export const FRONTMATTER_DESCRIPTION_MAX_LENGTH = 2000;

export class SkillFrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillFrontmatterError';
  }
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  unknownKeys: string[];
}

/** Matches a leading `---` ... `---` block that starts at the very first byte. */
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Parse the SKILL.md frontmatter.
 *
 * Throws SkillFrontmatterError when the frontmatter is missing, malformed,
 * not a YAML mapping, or lacks a valid string `name` / `description`.
 */
export function parseSkillFrontmatter(skillMdText: string): SkillFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(skillMdText);
  if (!match) {
    throw new SkillFrontmatterError('SKILL.md must begin with a YAML frontmatter block delimited by --- lines');
  }

  let document: unknown;
  try {
    document = load(match[1], {
      schema: JSON_SCHEMA,
      json: true,
      filename: 'SKILL.md frontmatter',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new SkillFrontmatterError(`malformed YAML frontmatter: ${detail}`);
  }

  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new SkillFrontmatterError('frontmatter must be a YAML mapping of key/value pairs');
  }
  const record = document as Record<string, unknown>;

  const rawName = record['name'];
  if (typeof rawName !== 'string') {
    throw new SkillFrontmatterError('frontmatter requires a string "name"');
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

  const unknownKeys = Object.keys(record)
    .filter((key) => key !== 'name' && key !== 'description')
    .sort();

  return { name: rawName, description, unknownKeys };
}