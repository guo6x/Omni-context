import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDecisionLineage,
  readDecisionLineage,
  isUserDecision,
  getSafeOutcomeRetryArgs,
  isDeterministicOutcomeRejection,
} from '../src/lib/decision-timeline.ts';
import { createRequestDeadline } from '../src/lib/request-deadline.ts';

test('normalizes Brain snake_case lineage sources for the Desktop decision log', () => {
  const source = {
    decision_id: 'decision-1',
    entity_id: 'source-1',
    entity_name: 'Project note',
    entity_type: 'fact',
    relationship: 'supported_by',
    direction: 'outgoing',
  };
  const lineage = normalizeDecisionLineage({
    current: { id: 'decision-1', name: 'Decision', outcomes: [] },
    sources: [source],
    chain: [],
    recursive: true,
  });

  assert.deepEqual(lineage.sources, [{
    entity_id: 'source-1',
    entity_name: 'Project note',
    entity_type: 'fact',
    relationship: 'supported_by',
  }]);
});

test('does not silently turn malformed lineage citations into an empty source list', () => {
  assert.throws(() => normalizeDecisionLineage({
    current: { id: 'decision-1', name: 'Decision' },
    sources: [{ entity_id: 'source-1', entity_name: 'Missing type' }],
    chain: [],
  }), /decision lineage field/);
});

test('decision timeline hides only explicitly unconfirmed AI-derived records', () => {
  assert.equal(isUserDecision({ authority: 'ai_derived', user_confirmed: false }), false);
  assert.equal(isUserDecision({ authority: 'user_confirmed', user_confirmed: true }), true);
  assert.equal(isUserDecision({ id: 'legacy-decision' }), true);
  assert.equal(isUserDecision({ authority: 'ai_derived' }), true);
});

test('lineage read failures are explicit and a later retry can load the real source', async () => {
  const unavailable = await readDecisionLineage(async () => new Response('', { status: 503 }));
  assert.deepEqual(unavailable, { kind: 'error' });

  const loaded = await readDecisionLineage(async () => new Response(JSON.stringify({
    current: { id: 'decision-1', name: 'Decision', outcomes: [] },
    sources: [{ entity_id: 'source-1', entity_name: 'Project note', entity_type: 'fact', relationship: 'supported_by' }],
    chain: [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  assert.equal(loaded.kind, 'loaded');
  if (loaded.kind === 'loaded') assert.equal(loaded.data.sources[0].entity_id, 'source-1');
});

test('an uncertain outcome retry reuses the exact original arguments and request key', () => {
  const args = Object.freeze({
    decision_id: 'decision-1',
    idempotency_key: 'outcome:stable-key',
    actual_outcome: 'The change worked.',
    outcome_timestamp: '2026-10-23T00:00:00.000Z',
    outcome_score: 0.75,
    provenance: { source: 'desktop-decision-log', authority: 'user-journal' },
  });
  assert.equal(getSafeOutcomeRetryArgs({ status: 'uncertain', args }), args);
  assert.equal(getSafeOutcomeRetryArgs({ status: 'saving', args }), undefined);
  assert.equal(getSafeOutcomeRetryArgs(undefined), undefined);
});

test('ambiguous HTTP outcomes preserve same-key retries while definite 4xx responses permit editing', () => {
  const args = Object.freeze({
    decision_id: 'decision-ambiguous',
    idempotency_key: 'outcome:ambiguous-stable-key',
    actual_outcome: 'The deployment result is still being checked.',
    outcome_timestamp: '2026-10-23T00:00:00.000Z',
    outcome_score: 0.5,
    provenance: { source: 'desktop-decision-log', authority: 'user-journal' },
  });

  for (const status of [408, 425, 429, 500, 502, 503]) {
    assert.equal(isDeterministicOutcomeRejection(status, null), false, `HTTP ${status} must remain uncertain`);
    const retry = getSafeOutcomeRetryArgs({ status: 'uncertain', args });
    assert.equal(retry, args, `HTTP ${status} must retain the exact request body`);
    assert.equal(retry?.idempotency_key, 'outcome:ambiguous-stable-key');
  }

  assert.equal(isDeterministicOutcomeRejection(400, 'VALIDATION_ERROR'), true);
  assert.equal(isDeterministicOutcomeRejection(403, 'FORBIDDEN'), true);
  assert.equal(isDeterministicOutcomeRejection(409, 'IDEMPOTENCY_KEY_REUSED'), false);
});

test('request deadline aborts a hung operation and reports that it timed out', async () => {
  const deadline = createRequestDeadline(15);
  try {
    const result = await deadline.race(new Promise(() => {}));
    assert.deepEqual(result, { timedOut: true });
    assert.equal(deadline.signal.aborted, true);
    assert.equal(deadline.didTimeout(), true);
  } finally {
    deadline.clear();
  }
});

test('clearing a completed request deadline prevents a later abort', async () => {
  const deadline = createRequestDeadline(15);
  deadline.clear();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(deadline.signal.aborted, false);
  assert.equal(deadline.didTimeout(), false);
});

test('parent cancellation aborts a request deadline before its timeout', () => {
  const parent = new AbortController();
  const deadline = createRequestDeadline(1_000, parent.signal);
  parent.abort();
  assert.equal(deadline.signal.aborted, true);
  assert.equal(deadline.didTimeout(), false);
  deadline.clear();
});
