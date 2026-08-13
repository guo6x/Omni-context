/**
 * Goal24 Checkpoint 4 (Lane B) - GitHub read-only input normalization.
 *
 * This module defines the Omni-Context GitHub CP4 safe input subset. The
 * Brain Server runtime enforces this subset with Zod schemas and normalizes
 * unknown input into canonical JSON-safe objects. The same subset is declared
 * machine-readably in docs/goal24/cp4-github-readonly-contract.json for a
 * 1:1 conformance check against the Rust adapter (Lane A).
 *
 * Scope is strictly semantic input data. This module never builds argv,
 * shell strings, commands, or repo CLI selectors, and it never references an
 * adapter implementation. Transport binding belongs to the Rust adapter.
 *
 * The subset is deliberately conservative: it is only claimed as the
 * "Omni-Context GitHub CP4 safe subset", not as complete coverage of all
 * present and future GitHub naming rules.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Subset constants
// ---------------------------------------------------------------------------

export const GITHUB_INPUT_SUBSET_VERSION = '1.0.0';

/**
 * Owner safe subset: 1..39 characters. First character is [A-Za-z0-9];
 * remaining characters are [A-Za-z0-9-]. This rejects `/`, `\`, NUL and all
 * control characters, empty and whitespace-only values, and a leading dash.
 */
export const GITHUB_OWNER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$';
export const GITHUB_OWNER_MAX_LENGTH = 39;

/**
 * Repo safe subset: 1..100 characters. First character is [A-Za-z0-9];
 * remaining characters are [A-Za-z0-9._-]. This rejects `/`, `\`, NUL and
 * all control characters, empty and whitespace-only values, and a leading
 * dash.
 */
export const GITHUB_REPO_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$';
export const GITHUB_REPO_MAX_LENGTH = 100;

/** Issue search query is semantic data and may carry GitHub search syntax. */
export const GITHUB_QUERY_MAX_LENGTH = 1024;

export const GITHUB_SEARCH_LIMIT_MIN = 1;
export const GITHUB_SEARCH_LIMIT_MAX = 100;
export const GITHUB_SEARCH_LIMIT_DEFAULT = 30;

export const GITHUB_ISSUE_STATES = ['open', 'closed', 'all'] as const;

export const GITHUB_READONLY_CAPABILITY_IDS = [
  'github.repo.inspect',
  'github.issue.search',
  'github.issue.read',
  'github.pr.read',
  'github.pr.checks.read',
] as const;
export type GitHubReadOnlyCapabilityId = (typeof GITHUB_READONLY_CAPABILITY_IDS)[number];

// ---------------------------------------------------------------------------
// Runtime Zod schemas (machine enforcement)
// ---------------------------------------------------------------------------

export const GitHubOwnerSchema = z
  .string()
  .min(1)
  .max(GITHUB_OWNER_MAX_LENGTH)
  .regex(
    new RegExp(GITHUB_OWNER_PATTERN),
    'owner must match the Omni-Context GitHub CP4 safe subset: 1..39 chars, first char [A-Za-z0-9], remaining chars [A-Za-z0-9-]',
  );

export const GitHubRepoNameSchema = z
  .string()
  .min(1)
  .max(GITHUB_REPO_MAX_LENGTH)
  .regex(
    new RegExp(GITHUB_REPO_PATTERN),
    'repo must match the Omni-Context GitHub CP4 safe subset: 1..100 chars, first char [A-Za-z0-9], remaining chars [A-Za-z0-9._-]',
  );

/** Positive integer issue/PR number. Floats, zero, negatives and numeric strings are rejected. */
export const GitHubIssueNumberSchema = z
  .number()
  .int('number must be a positive integer')
  .positive('number must be a positive integer');

/** Search query is semantic data; only length and control characters are bounded. */
export const GitHubSearchQuerySchema = z
  .string()
  .max(GITHUB_QUERY_MAX_LENGTH, `query must be at most ${GITHUB_QUERY_MAX_LENGTH} characters`)
  .refine(
    (query) => !/[\u0000-\u001f\u007f]/.test(query),
    'query must not contain NUL or C0 control characters',
  );

export const GitHubIssueStateSchema = z.enum(GITHUB_ISSUE_STATES);

export const GitHubSearchLimitSchema = z
  .number()
  .int('limit must be an integer')
  .min(GITHUB_SEARCH_LIMIT_MIN)
  .max(GITHUB_SEARCH_LIMIT_MAX)
  .optional();

export const GitHubRepoInspectInputSchema = z.strictObject({
  owner: GitHubOwnerSchema,
  repo: GitHubRepoNameSchema,
});

export const GitHubIssueSearchInputSchema = z.strictObject({
  owner: GitHubOwnerSchema,
  repo: GitHubRepoNameSchema,
  query: GitHubSearchQuerySchema.optional(),
  state: GitHubIssueStateSchema.optional(),
  limit: GitHubSearchLimitSchema,
});

export const GitHubIssueReadInputSchema = z.strictObject({
  owner: GitHubOwnerSchema,
  repo: GitHubRepoNameSchema,
  number: GitHubIssueNumberSchema,
});

export const GitHubPrReadInputSchema = z.strictObject({
  owner: GitHubOwnerSchema,
  repo: GitHubRepoNameSchema,
  number: GitHubIssueNumberSchema,
});

export const GitHubPrChecksReadInputSchema = z.strictObject({
  owner: GitHubOwnerSchema,
  repo: GitHubRepoNameSchema,
  number: GitHubIssueNumberSchema,
});

export type GitHubRepoInspectInput = z.infer<typeof GitHubRepoInspectInputSchema>;
export type GitHubIssueSearchInput = z.infer<typeof GitHubIssueSearchInputSchema>;
export type GitHubIssueReadInput = z.infer<typeof GitHubIssueReadInputSchema>;
export type GitHubPrReadInput = z.infer<typeof GitHubPrReadInputSchema>;
export type GitHubPrChecksReadInput = z.infer<typeof GitHubPrChecksReadInputSchema>;

export type GitHubCapabilityInput =
  | GitHubRepoInspectInput
  | GitHubIssueSearchInput
  | GitHubIssueReadInput
  | GitHubPrReadInput
  | GitHubPrChecksReadInput;

// ---------------------------------------------------------------------------
// Normalization API
// ---------------------------------------------------------------------------

/**
 * Normalize unknown input for one of the CP4 GitHub read-only capabilities.
 *
 * Unknown keys are rejected (all runtime schemas are strict), bounds are
 * enforced, and the returned value is a canonical JSON-safe plain object.
 * For `github.issue.search` the canonical default limit of 30 is applied
 * when the caller omitted it.
 *
 * Supported capability ids are exactly `GITHUB_READONLY_CAPABILITY_IDS`.
 * Anything else - including write capability ids such as
 * `github.issue.create` - is rejected; this lane defines no writes.
 */
export function normalizeGitHubCapabilityInput(
  capabilityId: string,
  unknownInput: unknown,
): GitHubCapabilityInput {
  switch (capabilityId) {
    case 'github.repo.inspect':
      return GitHubRepoInspectInputSchema.parse(unknownInput);
    case 'github.issue.search': {
      const parsed = GitHubIssueSearchInputSchema.parse(unknownInput);
      return { ...parsed, limit: parsed.limit ?? GITHUB_SEARCH_LIMIT_DEFAULT };
    }
    case 'github.issue.read':
      return GitHubIssueReadInputSchema.parse(unknownInput);
    case 'github.pr.read':
      return GitHubPrReadInputSchema.parse(unknownInput);
    case 'github.pr.checks.read':
      return GitHubPrChecksReadInputSchema.parse(unknownInput);
    default:
      throw new Error(
        `unsupported capability id: ${JSON.stringify(capabilityId)}. ` +
          `Supported read-only capability ids: ${GITHUB_READONLY_CAPABILITY_IDS.join(', ')}`,
      );
  }
}
