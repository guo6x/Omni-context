/**
 * Goal24 Checkpoint 6 (Lane B) - Evidence Surface Guard control runtime.
 *
 * Covers the full deterministic control space: proceed / retrieve_more /
 * clarify / defer / block, optional-evidence semantics, retrieval bounds,
 * provider outcome taxonomy, coverage regression fail-closed behavior,
 * abort/timeout safety, and the CP6 core product regression: a synthetic
 * evidence-surface omission must never proceed.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  runEvidenceGuard,
} from '../src/evidence/guard.js';
import {
  evidenceGateCleared,
} from '../src/evidence/guard-policy.js';
import type {
  CollectCoverage,
  EvidenceGuardRequest,
  EvidenceGuardRequestWithSignal,
  ProviderOutcome,
} from '../src/evidence/guard-types.js';
import type { EvidenceCoverageEntry, EvidenceCoverageSnapshot } from '../src/execution/contracts.js';
import type { EvidenceRequirement } from '../src/capabilities/contracts.js';

const T0 = '2026-08-13T00:00:00+08:00';

function entry(
  classId: string,
  status: EvidenceCoverageEntry['status'],
  verification: EvidenceCoverageEntry['verification_level'] = 'verified',
): EvidenceCoverageEntry {
  return {
    evidence_class: classId,
    status,
    verification_level: verification,
    evidence_ids: status === 'missing' ? [] : [`evidence-${classId}-1`],
    checked_at: T0,
    ...(status === 'stale' ? { stale_since: T0 } : {}),
    ...(status === 'conflicted' ? { conflict_evidence_ids: [`conflict-${classId}-1`] } : {}),
  };
}

function snapshot(...entries: EvidenceCoverageEntry[]): EvidenceCoverageSnapshot {
  return { entries };
}

function requirement(classId: string, overrides: Partial<EvidenceRequirement> = {}): EvidenceRequirement {
  return { class_id: classId, mandatory: true, ...overrides };
}

function request(overrides: Partial<EvidenceGuardRequest> = {}): EvidenceGuardRequestWithSignal {
  return {
    requirements: [],
    max_retrieval_rounds: 3,
    per_round_timeout_ms: 1_000,
    ...overrides,
  };
}

const REJECTED_CALLBACK: CollectCoverage = async () => {
  throw new Error('collector must not be called');
};

describe('immediate gate decisions', () => {
  it('proceeds on empty requirements without any retrieval', async () => {
    const collector = vi.fn(REJECTED_CALLBACK);
    const result = await runEvidenceGuard(request(), collector);
    expect(result.action).toBe('proceed');
    expect(result.rounds_used).toBe(0);
    expect(result.remaining_mandatory).toEqual([]);
    expect(result.reason_codes).toEqual(['EVIDENCE_SATISFIED']);
    expect(evidenceGateCleared(result)).toBe(true);
    expect(collector).not.toHaveBeenCalled();
  });

  it('proceeds when all mandatory evidence is present and verified', async () => {
    const collector = vi.fn(REJECTED_CALLBACK);
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'present', 'verified')),
      }),
      collector,
    );
    expect(result.action).toBe('proceed');
    expect(result.rounds_used).toBe(0);
    expect(collector).not.toHaveBeenCalled();
  });

  it('proceeds when only optional evidence is missing', async () => {
    const collector = vi.fn(REJECTED_CALLBACK);
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state', { mandatory: false })],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      }),
      collector,
    );
    expect(result.action).toBe('proceed');
    expect(result.non_blocking_findings.length).toBeGreaterThan(0);
    expect(collector).not.toHaveBeenCalled();
  });

  it('proceeds when only optional evidence is stale', async () => {
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state', { mandatory: false })],
        initial_coverage: snapshot(entry('repository.current_state', 'stale', 'verified')),
      }),
      REJECTED_CALLBACK,
    );
    expect(result.action).toBe('proceed');
    expect(result.rounds_used).toBe(0);
  });

  it('proceeds when only optional evidence is unverified', async () => {
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state', { mandatory: false })],
        initial_coverage: snapshot(entry('repository.current_state', 'unverified', 'none')),
      }),
      REJECTED_CALLBACK,
    );
    expect(result.action).toBe('proceed');
    expect(result.rounds_used).toBe(0);
  });

  it('proceeds immediately on conflict warn with sufficient verification', async () => {
    const collector = vi.fn(REJECTED_CALLBACK);
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state', { conflict_policy: 'warn' })],
        initial_coverage: snapshot(entry('repository.current_state', 'conflicted', 'verified')),
      }),
      collector,
    );
    expect(result.action).toBe('proceed');
    expect(result.rounds_used).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(collector).not.toHaveBeenCalled();
  });
});

describe('retrieve_more flows', () => {
  it('retrieves missing mandatory evidence and then proceeds', async () => {
    const collector = vi.fn<CollectCoverage>(async (params) => {
      expect(params.requestedClasses).toEqual(['repository.current_state']);
      expect(params.round).toBe(1);
      expect(params.previousCoverage).toEqual(snapshot(entry('repository.current_state', 'missing', 'none')));
      return {
        coverage: snapshot(entry('repository.current_state', 'present', 'verified')),
        outcomes: [{ evidence_class: 'repository.current_state', kind: 'collected' }],
      };
    });
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      }),
      collector,
    );
    expect(result.action).toBe('proceed');
    expect(result.rounds_used).toBe(1);
    expect(result.requested_classes).toEqual(['repository.current_state']);
    expect(result.reason_codes).toEqual(['EVIDENCE_SATISFIED']);
    expect(result.trace[0].chosen_action).toBe('retrieve_more');
    expect(result.trace[1].chosen_action).toBe('proceed');
  });

  it('refreshes stale mandatory evidence and then proceeds', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'present', 'verified')),
      outcomes: [{ evidence_class: 'repository.current_state', kind: 'collected' }],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'stale', 'verified')),
      }),
      collector,
    );
    expect(result.action).toBe('proceed');
    expect(result.rounds_used).toBe(1);
  });

  it('replaces unverified evidence through an alternate verified provider', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'present', 'verified')),
      outcomes: [
        { evidence_class: 'repository.current_state', kind: 'collected', alternate_provider_available: true },
      ],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state', { verification_requirement: 'verified' })],
        initial_coverage: snapshot(entry('repository.current_state', 'unverified', 'asserted')),
      }),
      collector,
    );
    expect(result.action).toBe('proceed');
    expect(result.rounds_used).toBe(1);
  });

  it('resolves a conflict reject through an alternate source and proceeds', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'present', 'verified')),
      outcomes: [
        { evidence_class: 'repository.current_state', kind: 'collected', alternate_provider_available: true },
      ],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'conflicted', 'verified')),
      }),
      collector,
    );
    expect(result.action).toBe('proceed');
    expect(result.rounds_used).toBe(1);
  });

  it('requests only unresolved mandatory classes and never optional classes', async () => {
    const requested: string[][] = [];
    const collector = vi.fn<CollectCoverage>(async (params) => {
      requested.push(params.requestedClasses);
      return {
        coverage: snapshot(
          entry('repository.current_state', 'present', 'verified'),
          entry('actor.authority', 'missing', 'none'),
        ),
        outcomes: [{ evidence_class: 'repository.current_state', kind: 'collected' }],
      };
    });
    const result = await runEvidenceGuard(
      request({
        requirements: [
          requirement('repository.current_state'),
          requirement('actor.authority', { mandatory: false }),
        ],
        initial_coverage: snapshot(
          entry('repository.current_state', 'missing', 'none'),
          entry('actor.authority', 'missing', 'none'),
        ),
      }),
      collector,
    );
    expect(result.action).toBe('proceed');
    expect(requested).toEqual([['repository.current_state']]);
    expect(result.requested_classes).toEqual(['repository.current_state']);
  });
});

describe('clarify / defer / block decisions', () => {
  it('clarifies when a missing mandatory class needs user context', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      outcomes: [
        {
          evidence_class: 'repository.current_state',
          kind: 'user_context_required',
          clarification_key: 'repo_access_token',
        },
      ],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      }),
      collector,
    );
    expect(result.action).toBe('clarify');
    expect(result.rounds_used).toBe(1);
    expect(result.remaining_mandatory).toEqual(['repository.current_state']);
    expect(result.clarification_needs).toEqual([
      { evidence_class: 'repository.current_state', clarification_key: 'repo_access_token' },
    ]);
    expect(result.reason_codes).toContain('USER_CONTEXT_REQUIRED');
  });

  it('defers on temporary provider unavailability', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      outcomes: [
        { evidence_class: 'repository.current_state', kind: 'temporary_unavailable', retryable: false },
      ],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      }),
      collector,
    );
    expect(result.action).toBe('defer');
    expect(result.rounds_used).toBe(1);
    expect(result.reason_codes).toContain('PROVIDER_TEMPORARY_UNAVAILABLE');
  });

  it('blocks on permanent provider unavailability', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      outcomes: [{ evidence_class: 'repository.current_state', kind: 'permanent_unavailable' }],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.reason_codes).toContain('PROVIDER_PERMANENT_UNAVAILABLE');
    expect(result.reason_codes).toContain('RETRIEVAL_EXHAUSTED');
  });

  it('blocks on provider error once the budget is exhausted', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      outcomes: [{ evidence_class: 'repository.current_state', kind: 'provider_error', retryable: false }],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
        max_retrieval_rounds: 1,
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.rounds_used).toBe(1);
    expect(result.reason_codes).toContain('PROVIDER_ERROR');
    expect(result.reason_codes).toContain('RETRIEVAL_EXHAUSTED');
  });

  it('blocks after the max retrieval rounds are reached with a hard gap', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      outcomes: [{ evidence_class: 'repository.current_state', kind: 'not_found', retryable: true }],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
        max_retrieval_rounds: 2,
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.rounds_used).toBe(2);
    expect(collector).toHaveBeenCalledTimes(2);
    expect(result.reason_codes).toContain('RETRIEVAL_EXHAUSTED');
  });

  it('defers when temporary retryable outcomes hit the round cap', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      outcomes: [
        { evidence_class: 'repository.current_state', kind: 'temporary_unavailable', retryable: true },
      ],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
        max_retrieval_rounds: 2,
      }),
      collector,
    );
    expect(result.action).toBe('defer');
    expect(result.rounds_used).toBe(2);
    expect(collector).toHaveBeenCalledTimes(2);
  });

  it('never retrieves when max rounds is 0', async () => {
    const collector = vi.fn(REJECTED_CALLBACK);
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
        max_retrieval_rounds: 0,
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.rounds_used).toBe(0);
    expect(result.requested_classes).toEqual([]);
    expect(result.reason_codes).toContain('RETRIEVAL_EXHAUSTED');
    expect(result.reason_codes).toContain('EVIDENCE_MISSING');
    expect(collector).not.toHaveBeenCalled();
  });

  it('fails closed on unverified evidence even with verification_requirement=none', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'unverified', 'none')),
      outcomes: [{ evidence_class: 'repository.current_state', kind: 'collected', retryable: false }],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state', { verification_requirement: 'none' })],
        initial_coverage: snapshot(entry('repository.current_state', 'unverified', 'none')),
      }),
      collector,
    );
    expect(result.action).not.toBe('proceed');
    expect(result.remaining_mandatory).toContain('repository.current_state');
  });

  it('bounds retries: an always-retryable gap never loops forever', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      outcomes: [{ evidence_class: 'repository.current_state', kind: 'not_found', retryable: true }],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
        max_retrieval_rounds: 10,
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.rounds_used).toBe(10);
    expect(collector).toHaveBeenCalledTimes(10);
  });

  it('stops early when no class has a retryable path', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      outcomes: [
        { evidence_class: 'repository.current_state', kind: 'temporary_unavailable', retryable: false },
      ],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
        max_retrieval_rounds: 10,
      }),
      collector,
    );
    expect(result.action).toBe('defer');
    expect(result.rounds_used).toBe(1);
    expect(collector).toHaveBeenCalledTimes(1);
  });
});

describe('fail-closed paths', () => {
  it('blocks when the coverage regresses (satisfied class removed)', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      outcomes: [{ evidence_class: 'repository.current_state', kind: 'collected' }],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [
          requirement('repository.current_state'),
          requirement('actor.authority'),
        ],
        initial_coverage: snapshot(
          entry('repository.current_state', 'present', 'verified'),
          entry('actor.authority', 'missing', 'none'),
        ),
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.reason_codes).toContain('COVERAGE_REGRESSION');
    expect(result.rounds_used).toBe(0);
  });

  it('blocks when a satisfied class silently downgrades verification while present', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(
        entry('repository.current_state', 'present', 'asserted'),
        entry('actor.authority', 'present', 'verified'),
      ),
      outcomes: [],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [
          requirement('repository.current_state'),
          requirement('actor.authority'),
        ],
        initial_coverage: snapshot(
          entry('repository.current_state', 'present', 'verified'),
          entry('actor.authority', 'missing', 'none'),
        ),
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.reason_codes).toContain('COVERAGE_REGRESSION');
  });

  it('allows explicit stale/conflicted/unverified degradation with checked_at basis', async () => {
    let round = 0;
    const collector = vi.fn<CollectCoverage>(async () => {
      round += 1;
      if (round === 1) {
        return {
          coverage: snapshot(
            entry('repository.current_state', 'stale', 'verified'),
            entry('actor.authority', 'present', 'verified'),
          ),
          outcomes: [
            { evidence_class: 'repository.current_state', kind: 'collected', retryable: true },
            { evidence_class: 'actor.authority', kind: 'collected' },
          ],
        };
      }
      return {
        coverage: snapshot(
          entry('repository.current_state', 'present', 'verified'),
          entry('actor.authority', 'present', 'verified'),
        ),
        outcomes: [{ evidence_class: 'repository.current_state', kind: 'collected' }],
      };
    });
    const result = await runEvidenceGuard(
      request({
        requirements: [
          requirement('repository.current_state'),
          requirement('actor.authority'),
        ],
        initial_coverage: snapshot(
          entry('repository.current_state', 'present', 'verified'),
          entry('actor.authority', 'missing', 'none'),
        ),
      }),
      collector,
    );
    // stale is an allowed explicit degradation; the guard then refreshes it
    expect(result.action).toBe('proceed');
    expect(result.reason_codes).toContain('EVIDENCE_SATISFIED');
    expect(collector).toHaveBeenCalledTimes(2);
  });

  it('fails closed with provider_error when the callback throws', async () => {
    const collector = vi.fn<CollectCoverage>(async () => {
      throw new Error('provider crashed');
    });
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.reason_codes).toContain('PROVIDER_ERROR');
    expect(result.rounds_used).toBe(0);
    expect(result.aborted).toBe(false);
  });

  it('fails closed when the callback returns malformed coverage', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: { entries: [{ evidence_class: 'repository.current_state' }] } as never,
      outcomes: [],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.reason_codes).toContain('PROVIDER_ERROR');
  });

  it('fails closed when the callback returns malformed outcomes', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      outcomes: [{ evidence_class: 'repository.current_state', kind: 'teleported' } as unknown as ProviderOutcome],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.reason_codes).toContain('PROVIDER_ERROR');
  });

  it('returns a cancel-safe defer result on external abort', async () => {
    const controller = new AbortController();
    const collector = vi.fn<CollectCoverage>(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
        signal: controller.signal,
      }),
      collector,
    );
    expect(result.action).toBe('defer');
    expect(result.aborted).toBe(true);
    expect(result.reason_codes).toContain('GUARD_ABORTED');
  });

  it('treats a per-round timeout as temporary unavailability and ends in defer', async () => {
    const collector = vi.fn<CollectCoverage>(
      async (params) =>
        new Promise((_resolve, reject) => {
          params.signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
        max_retrieval_rounds: 2,
        per_round_timeout_ms: 100,
      }),
      collector,
    );
    expect(result.action).toBe('defer');
    expect(result.rounds_used).toBe(2);
    expect(result.reason_codes).toContain('PROVIDER_TEMPORARY_UNAVAILABLE');
    expect(result.provider_outcomes).toHaveLength(2);
    expect(result.provider_outcomes.every((outcome) => outcome.kind === 'temporary_unavailable')).toBe(true);
    expect(collector).toHaveBeenCalledTimes(2);
  });
});

describe('CP6 synthetic evidence-surface omission regression', () => {
  // Capability requires class.a AND class.b. The collector only ever
  // returns strong, verified, fresh evidence for class.a. The guard must
  // never proceed; it must eventually block / defer / clarify based on the
  // structured provider outcome for class.b.
  const requirements = [requirement('class.a'), requirement('class.b')];
  const strongA = entry('class.a', 'present', 'verified');

  const omissionCollector = (outcomesForB: ProviderOutcome[]): CollectCoverage =>
    vi.fn<CollectCoverage>(async (params) => ({
      coverage: snapshot(strongA),
      outcomes: outcomesForB.filter((outcome) => params.requestedClasses.includes(outcome.evidence_class)),
    }));

  it('never proceeds when class.b is omitted, even with perfect class.a', async () => {
    const collector = omissionCollector([]);
    const result = await runEvidenceGuard(
      request({
        requirements,
        initial_coverage: snapshot(strongA, entry('class.b', 'missing', 'none')),
        max_retrieval_rounds: 3,
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.remaining_mandatory).toEqual(['class.b']);
    expect(result.trace.every((round) => round.chosen_action !== 'proceed')).toBe(true);
    expect(result.reason_codes).toContain('RETRIEVAL_EXHAUSTED');
    expect(result.reason_codes).toContain('EVIDENCE_MISSING');
    expect(collector).toHaveBeenCalledTimes(1);
  });

  it('never proceeds and clarifies when class.b needs user context', async () => {
    const collector = omissionCollector([
      { evidence_class: 'class.b', kind: 'user_context_required', clarification_key: 'b_access' },
    ]);
    const result = await runEvidenceGuard(
      request({
        requirements,
        initial_coverage: snapshot(strongA, entry('class.b', 'missing', 'none')),
        max_retrieval_rounds: 3,
      }),
      collector,
    );
    expect(result.action).toBe('clarify');
    expect(result.clarification_needs).toEqual([{ evidence_class: 'class.b', clarification_key: 'b_access' }]);
    expect(result.trace.every((round) => round.chosen_action !== 'proceed')).toBe(true);
  });

  it('never proceeds and defers when class.b is temporarily unavailable', async () => {
    const collector = omissionCollector([
      { evidence_class: 'class.b', kind: 'temporary_unavailable', retryable: false },
    ]);
    const result = await runEvidenceGuard(
      request({
        requirements,
        initial_coverage: snapshot(strongA, entry('class.b', 'missing', 'none')),
        max_retrieval_rounds: 3,
      }),
      collector,
    );
    expect(result.action).toBe('defer');
    expect(result.trace.every((round) => round.chosen_action !== 'proceed')).toBe(true);
  });

  it('requests only class.b and never chases already-perfect class.a', async () => {
    const collector = omissionCollector([
      { evidence_class: 'class.b', kind: 'permanent_unavailable' },
    ]);
    const result = await runEvidenceGuard(
      request({
        requirements,
        initial_coverage: snapshot(strongA, entry('class.b', 'missing', 'none')),
        max_retrieval_rounds: 3,
      }),
      collector,
    );
    expect(result.action).toBe('block');
    expect(result.requested_classes).toEqual(['class.b']);
  });
});

describe('request validation and determinism', () => {
  it('rejects out-of-bounds max retrieval rounds', async () => {
    await expect(runEvidenceGuard(request({ max_retrieval_rounds: -1 }), REJECTED_CALLBACK)).rejects.toThrow(
      TypeError,
    );
    await expect(runEvidenceGuard(request({ max_retrieval_rounds: 11 }), REJECTED_CALLBACK)).rejects.toThrow(
      TypeError,
    );
    await expect(runEvidenceGuard(request({ max_retrieval_rounds: 1.5 }), REJECTED_CALLBACK)).rejects.toThrow(
      TypeError,
    );
  });

  it('rejects invalid per-round timeouts', async () => {
    await expect(runEvidenceGuard(request({ per_round_timeout_ms: 0 }), REJECTED_CALLBACK)).rejects.toThrow(
      TypeError,
    );
    await expect(
      runEvidenceGuard(request({ per_round_timeout_ms: 86_400_001 }), REJECTED_CALLBACK),
    ).rejects.toThrow(TypeError);
  });

  it('rejects forbidden context keys and non-JSON-safe context', async () => {
    await expect(
      runEvidenceGuard(request({ context: { shell: 'pwsh -c x' } }), REJECTED_CALLBACK),
    ).rejects.toThrow(TypeError);
    await expect(
      runEvidenceGuard(request({ context: { date: new Date() } }), REJECTED_CALLBACK),
    ).rejects.toThrow(TypeError);
    await expect(
      runEvidenceGuard(request({ context: { fn: () => 1 } }), REJECTED_CALLBACK),
    ).rejects.toThrow(TypeError);
  });

  it('accepts JSON-safe context metadata and echoes the correlation id', async () => {
    const result = await runEvidenceGuard(
      request({ correlation_id: 'trace-123', context: { locale: 'zh-CN', depth: 2 } }),
      REJECTED_CALLBACK,
    );
    expect(result.action).toBe('proceed');
    expect(result.correlation_id).toBe('trace-123');
  });

  it('requires a collectCoverage callback', async () => {
    await expect(runEvidenceGuard(request(), null as never)).rejects.toThrow(TypeError);
  });

  it('is deterministic across runs', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'present', 'verified')),
      outcomes: [{ evidence_class: 'repository.current_state', kind: 'collected' }],
    }));
    const make = () =>
      runEvidenceGuard(
        request({
          requirements: [requirement('repository.current_state')],
          initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
        }),
        collector,
      );
    const first = await make();
    const second = await make();
    expect(second.action).toBe(first.action);
    expect(second.reason_codes).toEqual(first.reason_codes);
    expect(second.trace).toEqual(first.trace);
    expect(second.requested_classes).toEqual(first.requested_classes);
  });

  it('returns a fully JSON-safe result', async () => {
    const collector = vi.fn<CollectCoverage>(async () => ({
      coverage: snapshot(entry('repository.current_state', 'present', 'verified')),
      outcomes: [{ evidence_class: 'repository.current_state', kind: 'collected' }],
    }));
    const result = await runEvidenceGuard(
      request({
        requirements: [requirement('repository.current_state')],
        initial_coverage: snapshot(entry('repository.current_state', 'missing', 'none')),
      }),
      collector,
    );
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('exposes the Decision Kernel boundary helper', async () => {
    expect(evidenceGateCleared({ action: 'proceed' })).toBe(true);
    expect(evidenceGateCleared({ action: 'retrieve_more' })).toBe(false);
    expect(evidenceGateCleared({ action: 'clarify' })).toBe(false);
    expect(evidenceGateCleared({ action: 'defer' })).toBe(false);
    expect(evidenceGateCleared({ action: 'block' })).toBe(false);
  });
});