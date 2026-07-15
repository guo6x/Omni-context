import { describe, expect, it } from 'vitest';
import {
  buildAssertionProvenance,
  buildRawEventEvidenceProvenance,
  parseRawEventReferences,
} from '../src/graphrag/evidence-fidelity.js';
import { GraphRAGExtractor } from '../src/graphrag/extractor.js';

describe('evidence fidelity provenance', () => {
  it('parses event ids, timestamps, and agents from benchmark-style transcript lines', () => {
    const events = parseRawEventReferences(
      '[evt-17] 2026-05-03T10:30:00.000Z Agent Alpha: The deployment target changed.\n'
      + '[evt-18] 2026-05-04T09:00:00.000Z Agent Beta: The earlier value is no longer current.',
      { timestamp: '2026-05-04T09:00:00.000Z', documentId: 'session-a', source: 'conversation' },
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event_id: 'evt-17',
      timestamp: '2026-05-03T10:30:00.000Z',
      agent: 'Agent Alpha',
      text: 'The deployment target changed.',
      document_id: 'session-a',
    });
  });

  it('derives source agent only from the raw event that contains the verbatim source span', () => {
    const rawText = [
      '[evt-a] 2026-05-03T10:30:00.000Z Agent Alpha: The first statement is unrelated.',
      '[evt-b] 2026-05-04T09:00:00.000Z Agent Beta: The active setting is now the second value.',
    ].join('\n');
    const events = parseRawEventReferences(rawText, {
      timestamp: '2026-05-04T09:00:00.000Z', documentId: 'session-b', source: 'conversation',
    });

    const provenance = buildAssertionProvenance({
      fact: {
        subject: 'A person', predicate: 'relates_to', original_predicate: 'active_setting',
        object: 'the second value', exact_value: 'the second value', confidence: 0.98,
        source_span: 'The active setting is now the second value.',
        state: 'current', state_key: 'active setting', source_event_id: 'untrusted-id',
      },
      rawEvents: events,
      source: 'conversation', documentId: 'session-b', model: 'provider-model',
    });

    expect(provenance.source_event_ids).toEqual(['evt-b']);
    expect(provenance.source_agent).toBe('Agent Beta');
    expect(provenance.exact_value).toBe('the second value');
    expect(provenance.state).toBe('current');
    expect(provenance.raw_event_references).toEqual([
      expect.objectContaining({ event_id: 'evt-b', agent: 'Agent Beta' }),
    ]);
    expect(provenance.source_event_ids).not.toContain('untrusted-id');
  });

  it('preserves a structured transition without guessing from prose', () => {
    const events = parseRawEventReferences(
      'Operator: The preference changed from the first option to the second option.',
      { timestamp: '2026-05-04T09:00:00.000Z', documentId: 'session-c', source: 'conversation' },
    );
    const provenance = buildAssertionProvenance({
      fact: {
        subject: 'A person', predicate: 'relates_to', original_predicate: 'preference',
        object: 'the second option', confidence: 0.9,
        source_span: 'The preference changed from the first option to the second option.',
        state: 'current', state_key: 'preference',
        transition: {
          kind: 'updated', from_value: 'the first option', to_value: 'the second option',
          effective_at: '2026-05-04T09:00:00.000Z',
        },
      },
      rawEvents: events,
      source: 'conversation', documentId: 'session-c', model: 'provider-model',
    });

    expect(provenance.transition).toEqual({
      kind: 'updated', from_value: 'the first option', to_value: 'the second option',
      effective_at: '2026-05-04T09:00:00.000Z',
    });
  });

  it('turns an envelope-derived raw event into bounded evidence provenance', () => {
    const [event] = parseRawEventReferences(
      '[evt-raw] 2026-05-05T09:00:00.000Z Agent Gamma: A source-only detail that extraction may omit.',
      { timestamp: '2026-05-05T09:00:00.000Z', documentId: 'session-raw', source: 'conversation' },
    );

    expect(buildRawEventEvidenceProvenance(event)).toEqual(expect.objectContaining({
      extractor: 'raw_event',
      evidence_kind: 'raw_event',
      state: 'observed',
      source_agent: 'Agent Gamma',
      source_event_ids: ['evt-raw'],
      exact_value: 'A source-only detail that extraction may omit.',
    }));
  });

  it('persists envelope-derived events as first-class evidence when semantic extraction omits them', async () => {
    const extractor = new GraphRAGExtractor({ useLocalExtraction: true });
    const result = await extractor.extract({
      textContent: '[evt-gap] 2026-05-06T09:00:00.000Z Agent Delta: A detail available only in the source event.',
      timestamp: '2026-05-06T09:00:00.000Z',
      sourceType: 'log',
      source: 'conversation',
    });

    expect(result.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Agent Delta', tags: expect.arrayContaining(['raw-event-source']) }),
    ]));
    expect(result.assertions).toEqual([
      expect.objectContaining({
        original_predicate: 'reported',
        literal_value: 'A detail available only in the source event.',
        provenance: expect.objectContaining({ evidence_kind: 'raw_event', source_event_ids: ['evt-gap'] }),
      }),
    ]);
  });
});
