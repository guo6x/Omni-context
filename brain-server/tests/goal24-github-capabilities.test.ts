/**
 * Goal24 Checkpoint 4 (Lane B) - GitHub read-only semantic capability catalog.
 *
 * Covers the CP4 acceptance requirements: all five catalog definitions pass
 * the transport-independent CapabilityDefinitionSchema; the catalog is
 * read-only / low risk / L0 / irreversible with no evidence, verification,
 * or rollback coupling; no write capability and no adapter transport is
 * encoded; and the runtime input normalization enforces the shared safe
 * subset (unknown keys, injection characters, numeric bounds).
 */

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_ID_PATTERN,
  CapabilityDefinitionSchema,
  RESERVED_TRANSPORT_PREFIXES,
} from '../src/capabilities/contracts.js';
import {
  GITHUB_ISSUE_READ_CAPABILITY,
  GITHUB_ISSUE_SEARCH_CAPABILITY,
  GITHUB_PR_CHECKS_READ_CAPABILITY,
  GITHUB_PR_READ_CAPABILITY,
  GITHUB_READONLY_CAPABILITIES,
  GITHUB_REPO_INSPECT_CAPABILITY,
} from '../src/capabilities/github-readonly.js';
import {
  GITHUB_OWNER_MAX_LENGTH,
  GITHUB_READONLY_CAPABILITY_IDS,
  GITHUB_REPO_MAX_LENGTH,
  GitHubIssueReadInputSchema,
  GitHubIssueSearchInputSchema,
  GitHubOwnerSchema,
  GitHubPrChecksReadInputSchema,
  GitHubPrReadInputSchema,
  GitHubRepoInspectInputSchema,
  GitHubRepoNameSchema,
  normalizeGitHubCapabilityInput,
  type GitHubIssueSearchInput,
} from '../src/capabilities/github-inputs.js';

const VALID_INPUTS: Record<(typeof GITHUB_READONLY_CAPABILITY_IDS)[number], Record<string, unknown>> = {
  'github.repo.inspect': { owner: 'octocat', repo: 'hello-world' },
  'github.issue.search': { owner: 'octocat', repo: 'hello-world' },
  'github.issue.read': { owner: 'octocat', repo: 'hello-world', number: 1 },
  'github.pr.read': { owner: 'octocat', repo: 'hello-world', number: 2 },
  'github.pr.checks.read': { owner: 'octocat', repo: 'hello-world', number: 3 },
};

describe('catalog definitions', () => {
  it('exports exactly the five CP4 read-only capabilities', () => {
    expect(GITHUB_READONLY_CAPABILITY_IDS).toEqual([
      'github.repo.inspect',
      'github.issue.search',
      'github.issue.read',
      'github.pr.read',
      'github.pr.checks.read',
    ]);
    expect(GITHUB_READONLY_CAPABILITIES.map((capability) => capability.id)).toEqual([
      'github.repo.inspect',
      'github.issue.search',
      'github.issue.read',
      'github.pr.read',
      'github.pr.checks.read',
    ]);
  });

  it('all five definitions pass CapabilityDefinitionSchema', () => {
    for (const definition of GITHUB_READONLY_CAPABILITIES) {
      const result = CapabilityDefinitionSchema.safeParse(definition);
      expect(result.success, `definition ${definition.id} must parse`).toBe(true);
    }
    expect(GITHUB_READONLY_CAPABILITIES).toHaveLength(5);
  });

  it('uniformly declares read_only / low / L0 / irreversible / version 1.0.0', () => {
    for (const definition of GITHUB_READONLY_CAPABILITIES) {
      expect(definition.version, definition.id).toBe('1.0.0');
      expect(definition.side_effect_class, definition.id).toBe('read_only');
      expect(definition.risk_level, definition.id).toBe('low');
      expect(definition.required_authority, definition.id).toBe('L0');
      expect(definition.reversible, definition.id).toBe(false);
      expect(definition.required_evidence, definition.id).toEqual([]);
      expect(definition.verification_capability, definition.id).toBeUndefined();
      expect(definition.rollback_capability, definition.id).toBeUndefined();
    }
  });

  it('ids are semantic and never start with a reserved transport prefix', () => {
    for (const definition of GITHUB_READONLY_CAPABILITIES) {
      expect(CAPABILITY_ID_PATTERN.test(definition.id), definition.id).toBe(true);
      const firstSegment = definition.id.split('.')[0];
      expect(RESERVED_TRANSPORT_PREFIXES).not.toContain(firstSegment);
    }
  });

  it('encodes no transport, adapter, or command vocabulary', () => {
    const serialized = JSON.stringify(GITHUB_READONLY_CAPABILITIES).toLowerCase();
    expect(serialized).not.toContain('adapter_id');
    expect(serialized).not.toContain('argv');
    expect(serialized).not.toContain('executable');
    expect(serialized).not.toContain('"shell"');
    expect(serialized).not.toContain('"command"');
    expect(/\bgh\b/.test(serialized)).toBe(false);
  });

  it('does not define any write capability', () => {
    const ids = GITHUB_READONLY_CAPABILITIES.map((capability) => capability.id);
    for (const writeId of [
      'github.issue.create',
      'github.issue.comment',
      'github.issue.close',
      'github.pr.merge',
    ]) {
      expect(ids).not.toContain(writeId);
    }
  });

  it('descriptive input_schema honestly declares strict unknown-key rejection', () => {
    for (const definition of GITHUB_READONLY_CAPABILITIES) {
      expect(definition.input_schema.type, definition.id).toBe('object');
      expect(definition.input_schema.additionalProperties, definition.id).toBe(false);
    }
  });

  it('descriptive input_schema required fields match the runtime schemas', () => {
    const expected: Record<string, string[]> = {
      'github.repo.inspect': ['owner', 'repo'],
      'github.issue.search': ['owner', 'repo'],
      'github.issue.read': ['owner', 'repo', 'number'],
      'github.pr.read': ['owner', 'repo', 'number'],
      'github.pr.checks.read': ['owner', 'repo', 'number'],
    };
    for (const definition of GITHUB_READONLY_CAPABILITIES) {
      expect(definition.input_schema.required, definition.id).toEqual(expected[definition.id]);
    }
  });

  it('keeps the five named exports in sync with the catalog', () => {
    const named = [
      GITHUB_REPO_INSPECT_CAPABILITY,
      GITHUB_ISSUE_SEARCH_CAPABILITY,
      GITHUB_ISSUE_READ_CAPABILITY,
      GITHUB_PR_READ_CAPABILITY,
      GITHUB_PR_CHECKS_READ_CAPABILITY,
    ];
    expect(GITHUB_READONLY_CAPABILITIES).toEqual(named);
  });
});

describe('owner / repo safe subset', () => {
  const INJECTION_VALUES = [
    '/',
    '\\',
    'a/b',
    'a\\b',
    '\u0000',
    'a\u0000b',
    'a\r\nb',
    'a\u0001b',
    'a\tb',
    '-repo',
    '-',
    '--repo',
    '',
    ' ',
    '  ',
    'a b',
    ' owner',
    'owner ',
  ];

  it.each(INJECTION_VALUES)('rejects owner %j', (value) => {
    expect(GitHubOwnerSchema.safeParse(value).success).toBe(false);
  });

  it.each(INJECTION_VALUES)('rejects repo %j', (value) => {
    expect(GitHubRepoNameSchema.safeParse(value).success).toBe(false);
  });

  it('rejects over-length owner and repo', () => {
    expect(GitHubOwnerSchema.safeParse('a'.repeat(GITHUB_OWNER_MAX_LENGTH + 1)).success).toBe(false);
    expect(GitHubRepoNameSchema.safeParse('a'.repeat(GITHUB_REPO_MAX_LENGTH + 1)).success).toBe(false);
  });

  it('accepts the documented safe subset', () => {
    expect(GitHubOwnerSchema.safeParse('octocat').success).toBe(true);
    expect(GitHubOwnerSchema.safeParse('octo-cat-1').success).toBe(true);
    expect(GitHubOwnerSchema.safeParse('a'.repeat(GITHUB_OWNER_MAX_LENGTH)).success).toBe(true);
    expect(GitHubRepoNameSchema.safeParse('hello-world').success).toBe(true);
    expect(GitHubRepoNameSchema.safeParse('repo_1.2-rc').success).toBe(true);
    expect(GitHubRepoNameSchema.safeParse('a'.repeat(GITHUB_REPO_MAX_LENGTH)).success).toBe(true);
  });
});

describe('runtime input normalization', () => {
  it.each(GITHUB_READONLY_CAPABILITY_IDS)('%s accepts its canonical input', (capabilityId) => {
    const output = normalizeGitHubCapabilityInput(capabilityId, VALID_INPUTS[capabilityId]);
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
  });

  it.each(GITHUB_READONLY_CAPABILITY_IDS)('%s rejects unknown input keys', (capabilityId) => {
    expect(() =>
      normalizeGitHubCapabilityInput(capabilityId, { ...VALID_INPUTS[capabilityId], extra: 'nope' }),
    ).toThrow();
    expect(() =>
      normalizeGitHubCapabilityInput(capabilityId, { ...VALID_INPUTS[capabilityId], argv: ['--repo'] }),
    ).toThrow();
  });

  it('rejects unsupported capability ids, including write capability ids', () => {
    expect(() => normalizeGitHubCapabilityInput('github.issue.create', {})).toThrow();
    expect(() => normalizeGitHubCapabilityInput('github.issue.comment', {})).toThrow();
    expect(() => normalizeGitHubCapabilityInput('github.issue.close', {})).toThrow();
    expect(() => normalizeGitHubCapabilityInput('github.pr.merge', {})).toThrow();
    expect(() => normalizeGitHubCapabilityInput('cli.github.issue.read', {})).toThrow();
  });

  it('rejects non-object input', () => {
    expect(() => normalizeGitHubCapabilityInput('github.repo.inspect', null)).toThrow();
    expect(() => normalizeGitHubCapabilityInput('github.repo.inspect', 'octocat/hello-world')).toThrow();
    expect(() => normalizeGitHubCapabilityInput('github.repo.inspect', ['octocat', 'hello-world'])).toThrow();
  });

  it('normalized repo.inspect output contains exactly owner and repo', () => {
    const output = normalizeGitHubCapabilityInput('github.repo.inspect', {
      owner: 'octocat',
      repo: 'hello-world',
    });
    expect(Object.keys(output).sort()).toEqual(['owner', 'repo']);
    expect(output).toEqual({ owner: 'octocat', repo: 'hello-world' });
  });
});

describe('github.issue.search', () => {
  const base = { owner: 'octocat', repo: 'hello-world' };

  it('carries search syntax as semantic query data', () => {
    for (const query of ['-label:bug', 'foo bar', '--web', '; calc.exe']) {
      const output = normalizeGitHubCapabilityInput('github.issue.search', { ...base, query }) as GitHubIssueSearchInput;
      expect(output.query).toBe(query);
    }
  });

  it('applies the canonical default limit of 30', () => {
    const output = normalizeGitHubCapabilityInput('github.issue.search', base) as GitHubIssueSearchInput;
    expect(output.limit).toBe(30);
  });

  it('keeps an explicit limit and state', () => {
    const output = normalizeGitHubCapabilityInput('github.issue.search', {
      ...base,
      limit: 100,
      state: 'closed',
    }) as GitHubIssueSearchInput;
    expect(output.limit).toBe(100);
    expect(output.state).toBe('closed');
  });

  it('accepts the full state enum', () => {
    for (const state of ['open', 'closed', 'all']) {
      const output = normalizeGitHubCapabilityInput('github.issue.search', { ...base, state }) as GitHubIssueSearchInput;
      expect(output.state).toBe(state);
    }
  });

  it.each([0, 101, 1.5, '30'])('rejects limit %j', (limit) => {
    expect(GitHubIssueSearchInputSchema.safeParse({ ...base, limit }).success).toBe(false);
    expect(() => normalizeGitHubCapabilityInput('github.issue.search', { ...base, limit })).toThrow();
  });

  it('accepts limit bounds 1 and 100', () => {
    expect(GitHubIssueSearchInputSchema.safeParse({ ...base, limit: 1 }).success).toBe(true);
    expect(GitHubIssueSearchInputSchema.safeParse({ ...base, limit: 100 }).success).toBe(true);
  });

  it('rejects invalid state values', () => {
    for (const state of ['merged', 'OPEN', '', 1, null]) {
      expect(GitHubIssueSearchInputSchema.safeParse({ ...base, state }).success).toBe(false);
    }
  });

  it('rejects queries longer than 1024 characters', () => {
    expect(
      GitHubIssueSearchInputSchema.safeParse({ ...base, query: 'a'.repeat(1025) }).success,
    ).toBe(false);
    expect(
      GitHubIssueSearchInputSchema.safeParse({ ...base, query: 'a'.repeat(1024) }).success,
    ).toBe(true);
  });

  it('rejects queries containing control characters', () => {
    for (const query of ['a\u0000b', 'a\r\nb', 'a\u0001b']) {
      expect(GitHubIssueSearchInputSchema.safeParse({ ...base, query }).success).toBe(false);
    }
  });

  it('rejects non-string query values', () => {
    for (const query of [1, null, {}, ['-label:bug']]) {
      expect(GitHubIssueSearchInputSchema.safeParse({ ...base, query }).success).toBe(false);
    }
  });
});

describe.each(['github.issue.read', 'github.pr.read', 'github.pr.checks.read'] as const)(
  '%s number validation',
  (capabilityId) => {
    const base = { owner: 'octocat', repo: 'hello-world' };

    it('accepts positive integer numbers', () => {
      expect(() => normalizeGitHubCapabilityInput(capabilityId, { ...base, number: 42 })).not.toThrow();
      expect(() => normalizeGitHubCapabilityInput(capabilityId, { ...base, number: 1 })).not.toThrow();
    });

    it.each([0, -1, 1.5, '1', NaN, Infinity, null])('rejects number %j', (number) => {
      expect(() => normalizeGitHubCapabilityInput(capabilityId, { ...base, number })).toThrow();
    });

    it('rejects a missing number', () => {
      expect(() => normalizeGitHubCapabilityInput(capabilityId, base)).toThrow();
    });
  },
);

describe('runtime schemas declare only the documented fields', () => {
  it('field sets match the cross-language contract', () => {
    expect(Object.keys(GitHubRepoInspectInputSchema.shape).sort()).toEqual(['owner', 'repo']);
    expect(Object.keys(GitHubIssueSearchInputSchema.shape).sort()).toEqual([
      'limit',
      'owner',
      'query',
      'repo',
      'state',
    ]);
    expect(Object.keys(GitHubIssueReadInputSchema.shape).sort()).toEqual(['number', 'owner', 'repo']);
    expect(Object.keys(GitHubPrReadInputSchema.shape).sort()).toEqual(['number', 'owner', 'repo']);
    expect(Object.keys(GitHubPrChecksReadInputSchema.shape).sort()).toEqual(['number', 'owner', 'repo']);
  });
});
