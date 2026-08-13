/**
 * Goal24 Checkpoint 6 (Lane A) - evidence qualification + coverage builder
 * tests.
 *
 * All tests are pure and deterministic (fixed injected clock, fake
 * providers). The builder output is fed directly into the existing
 * `assessEvidenceCoverage` so CP2.2 assessment semantics are verified
 * end-to-end, not re-implemented.
 */

import { describe, expect, it } from 'vitest';
import type { EvidenceRequirement } from '../src/capabilities/contracts.js';
import { assessEvidenceCoverage } from '../src/execution/contracts.js';
import {
  buildEvidenceCoverage,
  buildEvidenceId,
  claimDigest,
  EvidenceError,
  type BuildEvidenceCoverageResult,
  type EvidenceCollectionLimits,
  type EvidenceProviderResult,
  type ProviderCollectionBatch,
} from '../src/evidence/index.js';
import {
  candidate,
  collectedResult,
  fakeProvider,
  metadata,
  TEST_CLASS_STATE,
  TEST_SUBJECT,
} from './helpers/fake-evidence-providers.js';

const NOW = new Date('2026-08-13T12:00:00.000Z');

function requirement(overrides: Partial<EvidenceRequirement> = {}): EvidenceRequirement {
  return { class_id: TEST_CLASS_STATE, mandatory: true, ...overrides };
}

function batchOf(
  providerId: string,
  candidates: unknown[],
  overrides: Partial<ProviderCollectionBatch> = {},
): ProviderCollectionBatch {
  return {
    provider: metadata({ provider_id: providerId }),
    request: { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT },
    result: collectedResult(candidates as never),
    ...overrides,
  };
}

function build(
  requirements: readonly EvidenceRequirement[],
  batches: readonly ProviderCollectionBatch[],
  now: Date = NOW,
  limits?: Partial<EvidenceCollectionLimits>,
): BuildEvidenceCoverageResult {
  return buildEvidenceCoverage(requirements, batches, now, limits ? { limits } : undefined);
}

function entryOf(result: BuildEvidenceCoverageResult, classId = TEST_CLASS_STATE) {
  const entry = result.snapshot.entries.find((item) => item.evidence_class === classId);
  if (!entry) throw new Error(`no coverage entry for ${classId}`);
  return entry;
}

describe('qualification + coverage builder', () => {
  it('valid fresh candidate -> present', () => {
    const result = build([requirement()], [batchOf('prov-a', [candidate()])]);
    const entry = entryOf(result);
    expect(entry.status).toBe('present');
    expect(entry.evidence_ids).toHaveLength(1);
    expect(entry.verification_level).toBe('asserted');
    expect(entry.checked_at).toBe(NOW.toISOString());
    expect(entry.conflict_evidence_ids).toBeUndefined();
  });

  it('verification none + requirement none -> present with verification_level=none', () => {
    const result = build(
      [requirement()],
      [batchOf('prov-a', [candidate({ verification_level: 'none' })])],
    );
    const entry = entryOf(result);
    expect(entry.status).toBe('present');
    expect(entry.verification_level).toBe('none');
    const assessment = assessEvidenceCoverage([requirement()], result.snapshot);
    expect(assessment.entries[0].satisfied).toBe(true);
    expect(assessment.mandatory_satisfied).toBe(true);
  });

  it('verification none + requirement verified -> snapshot present/none and assessment blocks', () => {
    const verifiedRequirement = requirement({ verification_requirement: 'verified' });
    const result = build([verifiedRequirement], [batchOf('prov-a', [candidate({ verification_level: 'none' })])]);
    const entry = entryOf(result);
    expect(entry.status).toBe('present');
    expect(entry.verification_level).toBe('none');
    const assessment = assessEvidenceCoverage([verifiedRequirement], result.snapshot);
    expect(assessment.entries[0].satisfied).toBe(false);
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.missing_mandatory).toContain(TEST_CLASS_STATE);
  });

  it('candidate verification escalation -> unverified with escalation diagnostics', () => {
    const provider = fakeProvider({ metadata: { provider_id: 'prov-cap', max_verification_level: 'asserted' } });
    const batch: ProviderCollectionBatch = {
      provider: provider.metadata,
      request: { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT },
      result: collectedResult([candidate({ verification_level: 'verified' })]),
    };
    const result = build([requirement()], [batch]);
    const entry = entryOf(result);
    expect(entry.status).toBe('unverified');
    expect(entry.verification_level).toBe('none');
    expect(entry.note).toContain('verification_escalation');
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'verification_escalation')).toBe(true);
  });

  it('unsupported class -> fail closed', () => {
    // Provider does not declare the candidate's class.
    const undeclared = fakeProvider({
      metadata: { provider_id: 'prov-undeclared', supported_classes: ['other.class.id'] },
    });
    const batchUndeclared: ProviderCollectionBatch = {
      provider: undeclared.metadata,
      request: { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT },
      result: collectedResult([candidate()]),
    };
    const first = build([requirement()], [batchUndeclared]);
    expect(entryOf(first).status).toBe('unverified');
    expect(first.diagnostics.some((diagnostic) => diagnostic.code === 'class_mismatch')).toBe(true);

    // Candidate claims a class different from the requested one.
    const batchWrongClass = batchOf('prov-wrong', [candidate({ evidence_class: 'required_checks.aggregate_status' })]);
    const second = build([requirement()], [batchWrongClass]);
    expect(entryOf(second).status).toBe('unverified');
    expect(second.diagnostics.some((diagnostic) => diagnostic.code === 'class_mismatch')).toBe(true);
  });

  it('future observed_at -> unverified (never permanently fresh via negative age)', () => {
    const future = candidate({ observed_at: '2026-08-13T13:00:00.000Z' });
    const result = build([requirement({ freshness_policy: { max_age_ms: 1000 } })], [batchOf('prov-a', [future])]);
    const entry = entryOf(result);
    expect(entry.status).toBe('unverified');
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'future_observed_at')).toBe(true);
  });

  it('freshness boundary: age == max is fresh, age == max+1 is stale', () => {
    const requirementWithPolicy = requirement({ freshness_policy: { max_age_ms: 3_600_000 } });
    const atBoundary = candidate({ observed_at: '2026-08-13T11:00:00.000Z' }); // age == 3_600_000
    const pastBoundary = candidate({ observed_at: '2026-08-13T10:59:59.000Z' }); // age == 3_600_001

    const freshResult = build([requirementWithPolicy], [batchOf('prov-a', [atBoundary])]);
    const freshEntry = entryOf(freshResult);
    expect(freshEntry.status).toBe('present');
    expect(freshEntry.stale_since).toBeUndefined();

    const staleResult = build([requirementWithPolicy], [batchOf('prov-a', [pastBoundary])]);
    const staleEntry = entryOf(staleResult);
    expect(staleEntry.status).toBe('stale');
    expect(staleEntry.stale_since).toBe('2026-08-13T11:59:59.000Z');
    expect(staleEntry.evidence_ids).toHaveLength(1);
  });

  it('no freshness policy -> age alone never makes evidence stale', () => {
    const oldCandidate = candidate({ observed_at: '2020-01-01T00:00:00.000Z' });
    const result = build([requirement()], [batchOf('prov-a', [oldCandidate])]);
    expect(entryOf(result).status).toBe('present');
  });

  it('propagates valid provider diagnostics and non-collected outcomes', () => {
    const providerResult: EvidenceProviderResult = {
      outcome: 'collected',
      candidates: [candidate()],
      diagnostics: [{ code: 'cache-hit', message: 'served from cache' }],
    };
    const batch: ProviderCollectionBatch = {
      provider: metadata({ provider_id: 'prov-a' }),
      request: { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT },
      result: providerResult,
    };
    const built = build([requirement()], [batch]);
    expect(built.diagnostics.some((diagnostic) => diagnostic.code === 'cache-hit')).toBe(true);

    const unavailable: ProviderCollectionBatch = {
      provider: metadata({ provider_id: 'prov-b' }),
      request: { evidence_class: TEST_CLASS_STATE, subject_key: TEST_SUBJECT },
      result: { outcome: 'temporary_unavailable', candidates: [], diagnostics: [] },
    };
    const withOutcome = build([requirement()], [batch, unavailable]);
    expect(withOutcome.diagnostics.some((diagnostic) => diagnostic.code === 'temporary_unavailable')).toBe(true);
  });

  it('no candidate -> missing', () => {
    const result = build([requirement()], []);
    const entry = entryOf(result);
    expect(entry.status).toBe('missing');
    expect(entry.evidence_ids).toEqual([]);
    expect(entry.verification_level).toBe('none');
  });

  it('only invalid candidates -> unverified with retained reference ids', () => {
    const future = candidate({ observed_at: '2026-08-13T13:00:00.000Z' });
    const result = build([requirement()], [batchOf('prov-a', [future])]);
    const entry = entryOf(result);
    expect(entry.status).toBe('unverified');
    expect(entry.evidence_ids.length).toBeGreaterThan(0);
  });

  it('schema-invalid candidate -> unverified with deterministic diagnostic reference', () => {
    const broken = { ...candidate(), claim_key: undefined };
    const first = build([requirement()], [batchOf('prov-a', [broken])]);
    const second = build([requirement()], [batchOf('prov-a', [broken])]);
    const firstEntry = entryOf(first);
    expect(firstEntry.status).toBe('unverified');
    expect(firstEntry.evidence_ids[0]).toMatch(/^ref:[0-9a-f]{64}$/);
    expect(second.snapshot).toEqual(first.snapshot);
  });

  it('two agreeing providers -> present with corroborating ids and aggregate verification level', () => {
    const result = build(
      [requirement()],
      [
        batchOf('prov-a', [candidate({ source_item_id: 'item-a', verification_level: 'asserted' })]),
        batchOf('prov-b', [candidate({ source_item_id: 'item-b', verification_level: 'verified' })]),
      ],
    );
    const entry = entryOf(result);
    expect(entry.status).toBe('present');
    expect(entry.evidence_ids).toHaveLength(2);
    expect(entry.verification_level).toBe('verified');
  });

  it('two conflicting providers -> conflicted with deterministic disjoint partition', () => {
    const result = build(
      [requirement()],
      [
        batchOf('prov-high', [candidate({ source_item_id: 'item-a', claim_value: 'open' })], {
          provider: metadata({ provider_id: 'prov-high', priority: 100 }),
        }),
        batchOf('prov-low', [candidate({ source_item_id: 'item-b', claim_value: 'closed' })], {
          provider: metadata({ provider_id: 'prov-low', priority: 10 }),
        }),
      ],
    );
    const entry = entryOf(result);
    expect(entry.status).toBe('conflicted');
    expect(entry.evidence_ids.length).toBeGreaterThan(0);
    expect(entry.conflict_evidence_ids!.length).toBeGreaterThan(0);
    expect(entry.evidence_ids.some((id) => entry.conflict_evidence_ids!.includes(id))).toBe(false);

    // Deterministic primary: the higher-priority provider's claim wins the
    // primary side, so its evidence id lands in evidence_ids and the
    // disagreeing claim lands in conflict_evidence_ids.
    const highProviderId = buildEvidenceId({
      provider_id: 'prov-high',
      evidence_class: TEST_CLASS_STATE,
      subject_key: TEST_SUBJECT,
      source_item_id: 'item-a',
      claim_digest: claimDigest('open'),
    });
    const lowProviderId = buildEvidenceId({
      provider_id: 'prov-low',
      evidence_class: TEST_CLASS_STATE,
      subject_key: TEST_SUBJECT,
      source_item_id: 'item-b',
      claim_digest: claimDigest('closed'),
    });
    expect(entry.evidence_ids).toEqual([highProviderId]);
    expect(entry.conflict_evidence_ids).toEqual([lowProviderId]);
    expect(entry.note).toContain('pull_request.state');
  });

  it('provider priority determinism: batch input order never changes the partition', () => {
    const high = batchOf('prov-high', [candidate({ source_item_id: 'item-a', claim_value: 'open' })], {
      provider: metadata({ provider_id: 'prov-high', priority: 100 }),
    });
    const low = batchOf('prov-low', [candidate({ source_item_id: 'item-b', claim_value: 'closed' })], {
      provider: metadata({ provider_id: 'prov-low', priority: 10 }),
    });
    const first = build([requirement()], [low, high]);
    const second = build([requirement()], [high, low]);
    expect(second.snapshot).toEqual(first.snapshot);
    expect(entryOf(first).evidence_ids).toEqual(entryOf(second).evidence_ids);
    expect(entryOf(first).conflict_evidence_ids).toEqual(entryOf(second).conflict_evidence_ids);
  });

  it('stale disagreement + fresh valid -> fresh valid wins', () => {
    const stale = candidate({
      source_item_id: 'item-stale',
      claim_value: 'closed',
      observed_at: '2026-08-13T10:00:00.000Z',
    });
    const fresh = candidate({ source_item_id: 'item-fresh', claim_value: 'open', observed_at: '2026-08-13T11:30:00.000Z' });
    const requirementWithPolicy = requirement({ freshness_policy: { max_age_ms: 3_600_000 } });
    const result = build(
      [requirementWithPolicy],
      [batchOf('prov-a', [stale, fresh])],
    );
    const entry = entryOf(result);
    expect(entry.status).toBe('present');
    expect(entry.evidence_ids).toHaveLength(1);
    expect(entry.conflict_evidence_ids).toBeUndefined();
  });

  it('duplicate source item: identical duplicates dedupe; different claims conflict', () => {
    const duplicate = build(
      [requirement()],
      [batchOf('prov-a', [candidate(), candidate()])],
    );
    const duplicateEntry = entryOf(duplicate);
    expect(duplicateEntry.status).toBe('present');
    expect(duplicateEntry.evidence_ids).toHaveLength(1);

    const disagreeing = build(
      [requirement()],
      [batchOf('prov-a', [candidate(), candidate({ claim_value: 'closed' })])],
    );
    const disagreeingEntry = entryOf(disagreeing);
    expect(disagreeingEntry.status).toBe('conflicted');
  });

  it('is fully deterministic: identical input -> identical snapshot and diagnostics', () => {
    const batches = [
      batchOf('prov-a', [candidate({ source_item_id: 'item-a' })]),
      batchOf('prov-b', [candidate({ source_item_id: 'item-b', verification_level: 'verified' })]),
    ];
    const first = build([requirement()], batches);
    const second = build([requirement()], batches);
    expect(second.snapshot).toEqual(first.snapshot);
    expect(second.diagnostics).toEqual(first.diagnostics);
  });

  it('coverage includes exactly one entry per requirement (mandatory and optional)', () => {
    const optional = requirement({ class_id: 'required_checks.aggregate_status', mandatory: false });
    const result = build([requirement(), optional], []);
    expect(result.snapshot.entries.map((entry) => entry.evidence_class).sort()).toEqual([
      TEST_CLASS_STATE,
      'required_checks.aggregate_status',
    ].sort());
    expect(result.snapshot.entries).toHaveLength(2);
  });

  it('optional requirement still gets a coverage entry and never blocks', () => {
    const optional = requirement({ class_id: 'required_checks.aggregate_status', mandatory: false });
    const result = build([requirement(), optional], [batchOf('prov-a', [candidate()])]);
    const optionalEntry = entryOf(result, 'required_checks.aggregate_status');
    expect(optionalEntry.status).toBe('missing');
    const assessment = assessEvidenceCoverage([requirement(), optional], result.snapshot);
    expect(assessment.mandatory_satisfied).toBe(true);
    expect(assessment.non_blocking_findings.some((finding) => finding.includes('required_checks.aggregate_status'))).toBe(true);
  });

  it('rejects duplicate requirement class ids', () => {
    expect(() => build([requirement(), requirement()], [])).toThrowError(EvidenceError);
  });
});

describe('collection bounds - fail closed', () => {
  it('maxProvidersPerClass exceeded -> EVIDENCE_COLLECTION_LIMIT_EXCEEDED and blocked class', () => {
    const result = build(
      [requirement()],
      [batchOf('prov-a', [candidate()]), batchOf('prov-b', [candidate()])],
      NOW,
      { maxProvidersPerClass: 1 },
    );
    const entry = entryOf(result);
    expect(entry.status).toBe('unverified');
    expect(entry.note).toContain('EVIDENCE_COLLECTION_LIMIT_EXCEEDED');
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'EVIDENCE_COLLECTION_LIMIT_EXCEEDED')).toBe(true);
    const assessment = assessEvidenceCoverage([requirement()], result.snapshot);
    expect(assessment.mandatory_satisfied).toBe(false);
  });

  it('maxCandidatesPerProviderClass exceeded -> blocked class', () => {
    const result = build(
      [requirement()],
      [batchOf('prov-a', [candidate(), candidate()])],
      NOW,
      { maxCandidatesPerProviderClass: 1 },
    );
    expect(entryOf(result).status).toBe('unverified');
    expect(entryOf(result).note).toContain('EVIDENCE_COLLECTION_LIMIT_EXCEEDED');
  });

  it('maxCandidatesTotal exceeded -> blocked class', () => {
    const result = build(
      [requirement()],
      [batchOf('prov-a', [candidate()]), batchOf('prov-b', [candidate()])],
      NOW,
      { maxCandidatesTotal: 1 },
    );
    expect(entryOf(result).status).toBe('unverified');
    expect(entryOf(result).note).toContain('EVIDENCE_COLLECTION_LIMIT_EXCEEDED');
  });

  it('maxClaimJsonBytes exceeded -> blocked class', () => {
    const hugeClaim = candidate({ claim_value: { payload: 'x'.repeat(256) } });
    const result = build([requirement()], [batchOf('prov-a', [hugeClaim])], NOW, {
      maxClaimJsonBytes: 64,
    });
    expect(entryOf(result).status).toBe('unverified');
    expect(entryOf(result).note).toContain('EVIDENCE_COLLECTION_LIMIT_EXCEEDED');
  });

  it('maxDiagnostics caps diagnostics and reports truncation', () => {
    const invalidCandidates = Array.from({ length: 10 }, (_, index) =>
      candidate({ observed_at: `2026-08-13T13:0${index}:00.000Z` }),
    );
    const result = build([requirement()], [batchOf('prov-a', invalidCandidates)], NOW, {
      maxDiagnostics: 3,
    });
    expect(result.diagnostics.length).toBeLessThanOrEqual(3);
    expect(result.diagnostics_truncated).toBe(true);
  });

  it('rejects non-positive limit values', () => {
    expect(() => build([requirement()], [], NOW, { maxProvidersPerClass: 0 })).toThrowError(EvidenceError);
  });
});

describe('integration with existing assessEvidenceCoverage', () => {
  it('mandatory missing -> block', () => {
    const result = build([requirement()], []);
    const assessment = assessEvidenceCoverage([requirement()], result.snapshot);
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.missing_mandatory).toContain(TEST_CLASS_STATE);
    expect(assessment.blocking_reasons.join(' ')).toContain('missing');
  });

  it('mandatory stale -> block', () => {
    const stale = candidate({ observed_at: '2026-08-13T10:59:59.000Z' });
    const result = build(
      [requirement({ freshness_policy: { max_age_ms: 3_600_000 } })],
      [batchOf('prov-a', [stale])],
    );
    const assessment = assessEvidenceCoverage(
      [requirement({ freshness_policy: { max_age_ms: 3_600_000 } })],
      result.snapshot,
    );
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.blocking_reasons.join(' ')).toContain('stale');
  });

  it('mandatory unverified -> block even with verification_requirement=none', () => {
    const future = candidate({ observed_at: '2026-08-13T13:00:00.000Z' });
    const result = build([requirement()], [batchOf('prov-a', [future])]);
    const assessment = assessEvidenceCoverage([requirement()], result.snapshot);
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.blocking_reasons.join(' ')).toContain('unverified');
  });

  it('conflict with undeclared policy -> reject (block)', () => {
    const result = build(
      [requirement()],
      [
        batchOf('prov-high', [candidate({ source_item_id: 'item-a', claim_value: 'open' })], {
          provider: metadata({ provider_id: 'prov-high', priority: 100 }),
        }),
        batchOf('prov-low', [candidate({ source_item_id: 'item-b', claim_value: 'closed' })], {
          provider: metadata({ provider_id: 'prov-low', priority: 10 }),
        }),
      ],
    );
    const assessment = assessEvidenceCoverage([requirement()], result.snapshot);
    expect(assessment.mandatory_satisfied).toBe(false);
    expect(assessment.blocking_reasons.join(' ')).toContain('conflict_policy=reject');
  });

  it('conflict with warn policy -> tolerated warning (non-blocking when verification met)', () => {
    const warnRequirement = requirement({ conflict_policy: 'warn' });
    const result = build(
      [warnRequirement],
      [
        batchOf('prov-high', [candidate({ source_item_id: 'item-a', claim_value: 'open' })], {
          provider: metadata({ provider_id: 'prov-high', priority: 100 }),
        }),
        batchOf('prov-low', [candidate({ source_item_id: 'item-b', claim_value: 'closed' })], {
          provider: metadata({ provider_id: 'prov-low', priority: 10 }),
        }),
      ],
    );
    const assessment = assessEvidenceCoverage([warnRequirement], result.snapshot);
    expect(assessment.entries[0].satisfied).toBe(true);
    expect(assessment.mandatory_satisfied).toBe(true);
    expect(assessment.warnings.some((warning) => warning.includes('conflicted evidence tolerated'))).toBe(true);
  });

  it('optional missing -> non-blocking finding', () => {
    const optional = requirement({ class_id: 'required_checks.aggregate_status', mandatory: false });
    const result = build([requirement(), optional], [batchOf('prov-a', [candidate()])]);
    const assessment = assessEvidenceCoverage([requirement(), optional], result.snapshot);
    expect(assessment.mandatory_satisfied).toBe(true);
    expect(assessment.missing_mandatory).toEqual([]);
    expect(assessment.non_blocking_findings.length).toBeGreaterThan(0);
  });

  it('subject mismatch batches are reported and fail closed', () => {
    const wrongSubject: ProviderCollectionBatch = {
      provider: metadata({ provider_id: 'prov-other-subject' }),
      request: { evidence_class: TEST_CLASS_STATE, subject_key: 'someone/else#1' },
      result: collectedResult([candidate({ subject_key: 'someone/else#1' })]),
    };
    const result = build(
      [requirement()],
      [batchOf('prov-a', [candidate()]), wrongSubject],
    );
    expect(entryOf(result).status).toBe('present');
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'subject_mismatch')).toBe(true);
  });
});