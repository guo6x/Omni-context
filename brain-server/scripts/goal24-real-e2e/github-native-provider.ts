/**
 * Goal24 Post-CP8 Real E2E (DRG-2 candidate) - harness-local trusted GitHub
 * evidence provider (dev-only operator harness, NOT part of the production
 * provider registry).
 *
 * Fetches live GitHub state through the pinned, operator-configured gh.exe
 * with fixed fused argv and no shell. The same discipline as the production
 * Rust bindings: callers can never add flags, subcommands, executables, cwd
 * or env. Secrets can never reach the child (minimal env, no token vars).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  EvidenceCandidate,
  EvidenceCollectRequest,
  EvidenceProviderResult,
  EvidenceProviderV1,
} from '../../src/evidence/index.js';

const ISSUE_VIEW_FIELDS =
  'number,title,body,state,stateReason,url,author,labels,createdAt,updatedAt,closedAt';
const REPO_INSPECT_FIELDS =
  'nameWithOwner,description,visibility,isPrivate,isArchived,defaultBranchRef,url,viewerPermission';

const ISSUE_SUBJECT_PATTERN = /^github:issue:([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)#([1-9][0-9]*)$/;
const REPO_SUBJECT_PATTERN = /^github:repo:([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;

function ghPath(): string {
  const raw = process.env.OMNI_GITHUB_CLI_EXE;
  if (!raw) {
    throw new Error(
      'OMNI_GITHUB_CLI_EXE must name an absolute validated gh.exe (trusted operator config)',
    );
  }
  const path = resolve(raw);
  if (!existsSync(path)) {
    throw new Error(`OMNI_GITHUB_CLI_EXE does not exist: ${path}`);
  }
  return path;
}

/** Minimal env for the gh child: exactly what gh needs to find its own
 * config; never a token, proxy or hostname override. */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function runGh(argv: string[], cwd: string): { exit: number; stdout: string; timedOut: boolean } {
  const result = spawnSync(ghPath(), argv, {
    cwd,
    env: childEnv(),
    encoding: 'utf8',
    shell: false,
    timeout: 30_000,
    windowsHide: true,
  });
  return {
    exit: result.status ?? -1,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    timedOut: result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM',
  };
}

/**
 * Pre-execution business rule (pure, testable): a CLOSED issue must never be
 * closed again. The harness aborts with NO_EFFECT_REQUIRED instead of
 * executing a redundant write.
 */
export function closePrecondition(issueState: unknown): 'proceed' | 'no_effect_required' {
  if (issueState === 'CLOSED') return 'no_effect_required';
  if (issueState === 'OPEN') return 'proceed';
  return 'no_effect_required';
}

function failed(kind: 'temporary_unavailable' | 'not_found', code: string, message: string): EvidenceProviderResult {
  return {
    outcome: kind,
    candidates: [],
    diagnostics: [{ code, message }],
  };
}

function candidateFor(
  evidenceClass: string,
  subjectKey: string,
  claimKey: string,
  claimValue: unknown,
  sourceReference: string,
  sourceUpdatedAt: string | undefined,
): EvidenceCandidate {
  return {
    evidence_class: evidenceClass,
    subject_key: subjectKey,
    claim_key: claimKey,
    claim_value: claimValue as never,
    source_item_id: `gh:${subjectKey}`,
    source_reference: sourceReference,
    observed_at: new Date().toISOString(),
    verification_level: 'asserted',
    ...(sourceUpdatedAt !== undefined ? { source_updated_at: sourceUpdatedAt } : {}),
  };
}

export class GithubNativeEvidenceProvider implements EvidenceProviderV1 {
  readonly metadata = {
    provider_id: 'github-native-gh',
    version: '1.0.0',
    supported_classes: ['repository.current_state', 'issue.current_state'],
    priority: 100,
    max_verification_level: 'asserted' as const,
    description:
      'Harness-local trusted GitHub evidence provider (pinned gh.exe, fixed argv, no shell). Dev-only for the Post-CP8 real E2E; not registered in production.',
  };

  async collect(request: EvidenceCollectRequest): Promise<EvidenceProviderResult> {
    if (request.evidence_class === 'issue.current_state') {
      return this.collectIssue(request.subject_key);
    }
    if (request.evidence_class === 'repository.current_state') {
      return this.collectRepo(request.subject_key);
    }
    return failed('permanent_unavailable', 'EVIDENCE_CLASS_UNSUPPORTED', `class ${request.evidence_class} is not served`);
  }

  private collectIssue(subjectKey: string): EvidenceProviderResult {
    const match = ISSUE_SUBJECT_PATTERN.exec(subjectKey);
    if (!match) {
      return failed('permanent_unavailable', 'EVIDENCE_SUBJECT_INVALID', `cannot derive issue identity from subject ${subjectKey}`);
    }
    const [, owner, repo, number] = match;
    const run = runGh(
      ['issue', 'view', number, `--repo=${owner}/${repo}`, `--json=${ISSUE_VIEW_FIELDS}`],
      process.cwd(),
    );
    if (run.timedOut) {
      return failed('temporary_unavailable', 'GH_FETCH_TIMEOUT', 'gh issue view timed out');
    }
    if (run.exit !== 0) {
      return failed('temporary_unavailable', 'GH_FETCH_FAILED', `gh issue view exited ${run.exit}`);
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(run.stdout.trim()) as Record<string, unknown>;
    } catch {
      return failed('temporary_unavailable', 'GH_JSON_INVALID', 'gh issue view stdout is not valid JSON');
    }
    const claim = {
      number: parsed.number,
      state: parsed.state,
      stateReason: parsed.stateReason ?? null,
      title: parsed.title ?? null,
      labels: parsed.labels ?? [],
      updatedAt: parsed.updatedAt ?? null,
      closedAt: parsed.closedAt ?? null,
    };
    return {
      outcome: 'collected',
      candidates: [
        candidateFor('issue.current_state', subjectKey, 'issue.current_state', claim, 'github.issue.read', typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined),
      ],
      diagnostics: [],
    };
  }

  private collectRepo(subjectKey: string): EvidenceProviderResult {
    // The CP6 runtime binds ONE subject per capability. For
    // github.issue.close that subject is the issue; the repository identity
    // claim is therefore bound to the SAME canonical issue subject (the
    // owner/repo are part of the subject itself) while the claim value is
    // fetched live for exactly that repository. Trusted provider logic only:
    // callers can never choose a subject.
    const match = ISSUE_SUBJECT_PATTERN.exec(subjectKey);
    if (!match) {
      return failed('permanent_unavailable', 'EVIDENCE_SUBJECT_INVALID', `cannot derive repo identity from subject ${subjectKey}`);
    }
    const [, owner, repo] = match;
    const run = runGh(
      ['repo', 'view', `${owner}/${repo}`, `--json=${REPO_INSPECT_FIELDS}`],
      process.cwd(),
    );
    if (run.timedOut) {
      return failed('temporary_unavailable', 'GH_FETCH_TIMEOUT', 'gh repo view timed out');
    }
    if (run.exit !== 0) {
      return failed('temporary_unavailable', 'GH_FETCH_FAILED', `gh repo view exited ${run.exit}`);
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(run.stdout.trim()) as Record<string, unknown>;
    } catch {
      return failed('temporary_unavailable', 'GH_JSON_INVALID', 'gh repo view stdout is not valid JSON');
    }
    const claim = {
      nameWithOwner: parsed.nameWithOwner ?? null,
      visibility: parsed.visibility ?? null,
      isPrivate: parsed.isPrivate ?? null,
      isArchived: parsed.isArchived ?? null,
      defaultBranchRef: parsed.defaultBranchRef ?? null,
      viewerPermission: parsed.viewerPermission ?? null,
    };
    return {
      outcome: 'collected',
      candidates: [
        candidateFor('repository.current_state', subjectKey, 'repository.current_state', claim, 'github.repo.inspect', undefined),
      ],
      diagnostics: [],
    };
  }
}
