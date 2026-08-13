/**
 * Goal24 Checkpoint 4 (Lane B) - GitHub read-only semantic capability catalog.
 *
 * A CapabilityDefinition describes WHAT the system may do, never HOW it is
 * transported. No CLI command, argv, executable, shell, adapter id, or
 * adapter path appears here; transport binding belongs to the Rust GitHub
 * CLI adapter (Lane A). The catalog is a static export only - dynamic
 * registration, persistence, marketplace, and skill discovery are
 * Checkpoint 5 (Skill/Capability Registry) concerns and are intentionally
 * absent from this module.
 *
 * These five capabilities are read-only evidence acquisition / inspection
 * operations. They require no prior evidence (`required_evidence = []`);
 * the Decision Capability evidence requirements are a Checkpoint 6 concern.
 */

import {
  CapabilityDefinitionSchema,
  type CapabilityDefinition,
} from './contracts.js';
import {
  GITHUB_ISSUE_STATES,
  GITHUB_OWNER_MAX_LENGTH,
  GITHUB_OWNER_PATTERN,
  GITHUB_QUERY_MAX_LENGTH,
  GITHUB_READONLY_CAPABILITY_IDS,
  GITHUB_REPO_MAX_LENGTH,
  GITHUB_REPO_PATTERN,
  GITHUB_SEARCH_LIMIT_DEFAULT,
  GITHUB_SEARCH_LIMIT_MAX,
  GITHUB_SEARCH_LIMIT_MIN,
} from './github-inputs.js';

// ---------------------------------------------------------------------------
// Descriptive input schema fragments (JSON-safe; honest, not a validator)
// ---------------------------------------------------------------------------

const OWNER_FIELD = {
  type: 'string',
  description:
    'Repository owner. Omni-Context GitHub CP4 safe subset: 1..39 chars, ' +
    'first char [A-Za-z0-9], remaining chars [A-Za-z0-9-].',
  minLength: 1,
  maxLength: GITHUB_OWNER_MAX_LENGTH,
  pattern: GITHUB_OWNER_PATTERN,
} as const;

const REPO_FIELD = {
  type: 'string',
  description:
    'Repository name. Omni-Context GitHub CP4 safe subset: 1..100 chars, ' +
    'first char [A-Za-z0-9], remaining chars [A-Za-z0-9._-].',
  minLength: 1,
  maxLength: GITHUB_REPO_MAX_LENGTH,
  pattern: GITHUB_REPO_PATTERN,
} as const;

const NUMBER_FIELD = {
  type: 'integer',
  description: 'Issue or pull request number.',
  minimum: 1,
} as const;

const UNKNOWN_KEYS_NOTE = {
  description: 'Unknown keys are rejected by the Brain Server runtime.',
} as const;

// ---------------------------------------------------------------------------
// Capability definitions
// ---------------------------------------------------------------------------

export const GITHUB_REPO_INSPECT_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'github.repo.inspect',
  version: '1.0.0',
  description: 'Inspect repository metadata and visibility for a GitHub repository.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    ...UNKNOWN_KEYS_NOTE,
    properties: {
      owner: OWNER_FIELD,
      repo: REPO_FIELD,
    },
    required: ['owner', 'repo'],
  },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

export const GITHUB_ISSUE_SEARCH_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'github.issue.search',
  version: '1.0.0',
  description: 'Search issues in a GitHub repository using GitHub search syntax.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    ...UNKNOWN_KEYS_NOTE,
    properties: {
      owner: OWNER_FIELD,
      repo: REPO_FIELD,
      query: {
        type: 'string',
        description:
          'GitHub issue search syntax carried as semantic data, never as a ' +
          'structural field or command. Operators such as "-label:bug" are allowed.',
        maxLength: GITHUB_QUERY_MAX_LENGTH,
      },
      state: {
        type: 'string',
        enum: [...GITHUB_ISSUE_STATES],
      },
      limit: {
        type: 'integer',
        description: 'Maximum number of results returned.',
        minimum: GITHUB_SEARCH_LIMIT_MIN,
        maximum: GITHUB_SEARCH_LIMIT_MAX,
        default: GITHUB_SEARCH_LIMIT_DEFAULT,
      },
    },
    required: ['owner', 'repo'],
  },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

export const GITHUB_ISSUE_READ_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'github.issue.read',
  version: '1.0.0',
  description: 'Read a single GitHub issue by number.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    ...UNKNOWN_KEYS_NOTE,
    properties: {
      owner: OWNER_FIELD,
      repo: REPO_FIELD,
      number: NUMBER_FIELD,
    },
    required: ['owner', 'repo', 'number'],
  },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

export const GITHUB_PR_READ_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'github.pr.read',
  version: '1.0.0',
  description: 'Read a single GitHub pull request by number.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    ...UNKNOWN_KEYS_NOTE,
    properties: {
      owner: OWNER_FIELD,
      repo: REPO_FIELD,
      number: NUMBER_FIELD,
    },
    required: ['owner', 'repo', 'number'],
  },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

export const GITHUB_PR_CHECKS_READ_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'github.pr.checks.read',
  version: '1.0.0',
  description: 'Read check-run statuses for a GitHub pull request.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    ...UNKNOWN_KEYS_NOTE,
    properties: {
      owner: OWNER_FIELD,
      repo: REPO_FIELD,
      number: NUMBER_FIELD,
    },
    required: ['owner', 'repo', 'number'],
  },
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

/**
 * Static CP4 catalog. This is a plain export, not a registration runtime.
 * Dynamic registration, persistence, marketplace, and skill discovery are
 * Checkpoint 5 concerns.
 */
export const GITHUB_READONLY_CAPABILITIES: readonly CapabilityDefinition[] = [
  GITHUB_REPO_INSPECT_CAPABILITY,
  GITHUB_ISSUE_SEARCH_CAPABILITY,
  GITHUB_ISSUE_READ_CAPABILITY,
  GITHUB_PR_READ_CAPABILITY,
  GITHUB_PR_CHECKS_READ_CAPABILITY,
];

const catalogIds = GITHUB_READONLY_CAPABILITIES.map((capability) => capability.id);
if (new Set(catalogIds).size !== catalogIds.length) {
  throw new Error('GITHUB_READONLY_CAPABILITIES contains duplicate capability ids');
}
if (catalogIds.join(',') !== GITHUB_READONLY_CAPABILITY_IDS.join(',')) {
  throw new Error('GITHUB_READONLY_CAPABILITIES does not match GITHUB_READONLY_CAPABILITY_IDS');
}
