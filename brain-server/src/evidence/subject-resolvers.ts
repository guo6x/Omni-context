/**
 * Goal24 Checkpoint 6 (Integration) - deterministic subject resolvers.
 *
 * CP6 ships no live GitHub provider, so these resolvers are the deterministic
 * V1 bindings used by tests and as the roadmap wiring for the future GitHub
 * evidence providers (CP8+). They derive canonical subject keys strictly from
 * normalized capability inputs:
 *
 * - github.repo.inspect   -> github:repo:<owner>/<repo>
 * - github.issue.read     -> github:issue:<owner>/<repo>#<number>
 * - github.issue.search   -> github:issue-search:<owner>/<repo>
 * - github.pr.read        -> github:pr:<owner>/<repo>#<number>
 * - github.pr.checks.read -> github:pr:<owner>/<repo>#<number>
 *
 * Inputs are validated strictly (owner/repo identifiers, positive integer
 * numbers). Anything malformed throws EVIDENCE_SUBJECT_KEY_INVALID and the
 * evaluation fails closed. No resolver output is ever taken from a request
 * field named subject_key.
 */

import type { JsonObject, JsonValue } from '../contracts/json-safe.js';
import { EvidenceError } from './errors.js';
import {
  CapabilityEvidenceSubjectResolverRegistry,
  type CapabilityEvidenceSubjectResolver,
} from './subject.js';

const GITHUB_OWNER_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function requiredString(inputs: JsonObject, key: string): string {
  const value = inputs[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EvidenceError('EVIDENCE_SUBJECT_KEY_INVALID', `normalized_inputs.${key} must be a non-empty string`);
  }
  return value.trim();
}

function requiredPositiveInteger(inputs: JsonObject, key: string): number {
  const value = inputs[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new EvidenceError('EVIDENCE_SUBJECT_KEY_INVALID', `normalized_inputs.${key} must be a positive integer`);
  }
  return value;
}

function ownerRepo(inputs: JsonObject): { owner: string; repo: string } {
  const owner = requiredString(inputs, 'owner');
  const repo = requiredString(inputs, 'repo');
  for (const [label, part] of [['owner', owner], ['repo', repo]] as const) {
    if (!GITHUB_OWNER_REPO_PATTERN.test(part) || part.length > 100) {
      throw new EvidenceError(
        'EVIDENCE_SUBJECT_KEY_INVALID',
        `normalized_inputs.${label} '${part}' is not a valid GitHub owner/repo identifier`,
      );
    }
  }
  return { owner, repo };
}

function numberSuffix(inputs: JsonObject): string {
  const number = requiredPositiveInteger(inputs, 'number');
  return `#${number}`;
}

export const githubRepoInspectSubjectResolver: CapabilityEvidenceSubjectResolver = (_capabilityId, inputs) => {
  const { owner, repo } = ownerRepo(inputs);
  return `github:repo:${owner}/${repo}`;
};

export const githubIssueReadSubjectResolver: CapabilityEvidenceSubjectResolver = (_capabilityId, inputs) => {
  const { owner, repo } = ownerRepo(inputs);
  return `github:issue:${owner}/${repo}${numberSuffix(inputs)}`;
};

// Closing an issue is bound to the same exact issue identity as reading it.
// The action differs, but evidence and authorization must never be able to
// drift to a repository-wide or caller-supplied subject.
export const githubIssueCloseSubjectResolver: CapabilityEvidenceSubjectResolver = githubIssueReadSubjectResolver;

export const githubIssueSearchSubjectResolver: CapabilityEvidenceSubjectResolver = (_capabilityId, inputs) => {
  const { owner, repo } = ownerRepo(inputs);
  return `github:issue-search:${owner}/${repo}`;
};

export const githubPrReadSubjectResolver: CapabilityEvidenceSubjectResolver = (_capabilityId, inputs) => {
  const { owner, repo } = ownerRepo(inputs);
  return `github:pr:${owner}/${repo}${numberSuffix(inputs)}`;
};

export const githubPrChecksReadSubjectResolver: CapabilityEvidenceSubjectResolver = githubPrReadSubjectResolver;

/**
 * A registry wired with the deterministic GitHub read-only subject bindings
 * declared by the CP6 evidence class catalog. Test/demo wiring only: no live
 * provider is registered here.
 */
export function githubSubjectResolverRegistry(): CapabilityEvidenceSubjectResolverRegistry {
  const registry = new CapabilityEvidenceSubjectResolverRegistry();
  registry.register('github.repo.inspect', githubRepoInspectSubjectResolver);
  registry.register('github.issue.read', githubIssueReadSubjectResolver);
  registry.register('github.issue.close', githubIssueCloseSubjectResolver);
  registry.register('github.issue.search', githubIssueSearchSubjectResolver);
  registry.register('github.pr.read', githubPrReadSubjectResolver);
  registry.register('github.pr.checks.read', githubPrChecksReadSubjectResolver);
  return registry;
}

/** Generic deterministic resolver for synthetic test capabilities. */
export function genericTestSubjectResolver(prefix: string): CapabilityEvidenceSubjectResolver {
  return (capabilityId, inputs) => {
    const entries = Object.entries(inputs).sort(([a], [b]) => (a < b ? -1 : 1));
    const parts = entries.map(([key, value]) => `${key}=${JSON.stringify(value as JsonValue)}`);
    return `${prefix}:${capabilityId}[${parts.join(',')}]`;
  };
}
