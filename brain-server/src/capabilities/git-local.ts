/**
 * Goal28 Lite - the first additional semantic capability/adapter pair.
 *
 * The capability describes a bounded local Git state change.  It deliberately
 * carries repository, branch and full start-point identities only; executable,
 * argv, shell, cwd and environment policy belong to the compiled native
 * `git.local` adapter.
 */

import {
  CapabilityDefinitionSchema,
  type CapabilityDefinition,
} from './contracts.js';

const UNKNOWN_KEYS_NOTE = {
  description: 'Unknown keys are rejected by the Brain Server runtime.',
} as const;

const REPOSITORY_PATH_FIELD = {
  type: 'string',
  description: 'Absolute path to an approved disposable local Git repository.',
  minLength: 1,
  maxLength: 4096,
} as const;

const BRANCH_NAME_FIELD = {
  type: 'string',
  description: 'A validated local branch name; option-like names are rejected.',
  minLength: 1,
  maxLength: 200,
} as const;

const START_POINT_FIELD = {
  type: 'string',
  description: 'The full 40-hex commit SHA from which the branch is created.',
  minLength: 40,
  maxLength: 40,
  pattern: '^[0-9a-f]{40}$',
} as const;

const CREATE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  ...UNKNOWN_KEYS_NOTE,
  properties: {
    repository_path: REPOSITORY_PATH_FIELD,
    branch_name: BRANCH_NAME_FIELD,
    start_point: START_POINT_FIELD,
  },
  required: ['repository_path', 'branch_name', 'start_point'],
} as const;

const READ_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  ...UNKNOWN_KEYS_NOTE,
  properties: {
    repository_path: REPOSITORY_PATH_FIELD,
    branch_name: BRANCH_NAME_FIELD,
  },
  required: ['repository_path', 'branch_name'],
} as const;

/** Read-back identity used by git.branch.create. */
export const GIT_BRANCH_READ_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'git.branch.read',
  version: '1.0.0',
  description: 'Read the commit SHA currently addressed by one local Git branch.',
  input_schema: READ_INPUT_SCHEMA,
  required_authority: 'L0',
  risk_level: 'low',
  reversible: false,
  side_effect_class: 'read_only',
  required_evidence: [],
});

/**
 * The one Goal28 Lite write capability.  It is local and reversible in the
 * sense that a branch can later be removed by an explicitly separate owner
 * action, but this checkpoint intentionally does not introduce a delete
 * capability or rollback surface.
 */
export const GIT_BRANCH_CREATE_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'git.branch.create',
  version: '1.0.0',
  description:
    'Create one approved local Git branch at an exact commit SHA; requires explicit approval and a trusted read-back.',
  input_schema: CREATE_INPUT_SCHEMA,
  required_authority: 'L1',
  risk_level: 'medium',
  reversible: true,
  side_effect_class: 'reversible_write',
  required_evidence: [
    {
      class_id: 'repository.current_state',
      mandatory: true,
      freshness_policy: { max_age_ms: 5 * 60 * 1000 },
      conflict_policy: 'reject',
      verification_requirement: 'asserted',
    },
  ],
  verification_capability: 'git.branch.read',
});

export const GIT_LOCAL_CAPABILITIES: readonly CapabilityDefinition[] = [
  GIT_BRANCH_READ_CAPABILITY,
  GIT_BRANCH_CREATE_CAPABILITY,
];

const catalogIds = GIT_LOCAL_CAPABILITIES.map((capability) => capability.id);
if (new Set(catalogIds).size !== catalogIds.length) {
  throw new Error('GIT_LOCAL_CAPABILITIES contains duplicate capability ids');
}
