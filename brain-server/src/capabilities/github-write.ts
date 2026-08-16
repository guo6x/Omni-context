/**
 * Goal24 Post-CP8 Real E2E (DRG-2 candidate) - GitHub semantic write capability.
 *
 * This lane adds EXACTLY ONE production semantic write capability:
 * `github.issue.close`. It is the only write whose CP8 read-back mapping is
 * complete (issue.close = MAPPED in docs/goal24/cp8-github-readback-catalog.json):
 * github.issue.read returns the exact subject owner/repo#number with
 * state OPEN|CLOSED, so the deterministic close evaluator can verify the
 * external effect without any locator or read-back gap.
 *
 * A CapabilityDefinition describes WHAT the system may do, never HOW it is
 * transported. No CLI command, argv, executable, shell, adapter id or path
 * appears here; the transport binding lives in the Rust GitHub CLI layer.
 *
 * Risk policy (derived exclusively by the CP7 trusted policy from this
 * declaration - callers can never supply risk/authority/reversibility):
 * - side_effect_class = reversible_write  (GitHub reopen exists; the state
 *   mutation is externally visible and shared)
 * - risk_level = medium                   (visible state change on a public
 *   tracker, low blast radius, reversible)
 * - required_authority = L2              (CP7 policy: anything above
 *   read_only/low/L0 requires explicit approval; L2 marks an owner-visible
 *   external mutation rather than a purely local reversible action)
 * - reversible = true
 * Approval is therefore REQUIRED by the fixed CP7 V1 policy
 * (approvalRequired() = NOT read_only/low/L0).
 */

import {
  CapabilityDefinitionSchema,
  type CapabilityDefinition,
} from './contracts.js';
import {
  GITHUB_OWNER_MAX_LENGTH,
  GITHUB_OWNER_PATTERN,
  GITHUB_REPO_MAX_LENGTH,
  GITHUB_REPO_PATTERN,
} from './github-inputs.js';

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
  description: 'Issue number (strictly positive; zero and negatives are rejected).',
  minimum: 1,
} as const;

const UNKNOWN_KEYS_NOTE = {
  description: 'Unknown keys are rejected by the Brain Server runtime.',
} as const;

/**
 * The single production semantic write capability of the Post-CP8 Real E2E
 * lane. Evidence requirements (CP6): before any close execution the guard
 * must have trusted, fresh evidence for the repository identity and the
 * exact issue state (issue.current_state confirms existence AND state; a
 * CLOSED issue short-circuits to no-effect rather than re-closing).
 */
export const GITHUB_ISSUE_CLOSE_CAPABILITY: CapabilityDefinition = CapabilityDefinitionSchema.parse({
  id: 'github.issue.close',
  version: '1.0.0',
  description:
    'Close a single GitHub issue. External side effect on a shared tracker; ' +
    'requires explicit approval and a trusted read-back (github.issue.read ' +
    'observing state=CLOSED) before the outcome can be verified.',
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
  required_authority: 'L2',
  risk_level: 'medium',
  reversible: true,
  side_effect_class: 'reversible_write',
  required_evidence: [
    {
      class_id: 'repository.current_state',
      mandatory: true,
      freshness_policy: { max_age_ms: 24 * 60 * 60 * 1000 },
      verification_requirement: 'asserted',
    },
    {
      class_id: 'issue.current_state',
      mandatory: true,
      freshness_policy: { max_age_ms: 5 * 60 * 1000 },
      verification_requirement: 'asserted',
    },
  ],
  verification_capability: 'github.issue.read',
  rollback_capability: 'github.issue.reopen',
});

/**
 * Static Post-CP8 write catalog (exactly one entry). Registration semantics
 * follow CP5: static export, never a dynamic registration runtime.
 */
export const GITHUB_WRITE_CAPABILITIES: readonly CapabilityDefinition[] = [
  GITHUB_ISSUE_CLOSE_CAPABILITY,
];

const catalogIds = GITHUB_WRITE_CAPABILITIES.map((capability) => capability.id);
if (new Set(catalogIds).size !== catalogIds.length) {
  throw new Error('GITHUB_WRITE_CAPABILITIES contains duplicate capability ids');
}
