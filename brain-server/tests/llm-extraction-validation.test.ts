import { describe, expect, it } from 'vitest';
import { parseLlmExtractionResult } from '../src/graphrag/llm-pipeline.js';

function payload(fact: Record<string, unknown>) {
  return JSON.stringify({
    entities: [
      { name: 'Alice', type: 'person', description: 'A person' },
      { name: 'Beijing', type: 'concept', description: 'A city' },
    ],
    facts: [fact],
    principles: [],
  });
}

describe('strict LLM extraction validation', () => {
  it('normalizes relative fact time and retains source evidence', () => {
    const result = parseLlmExtractionResult(payload({
      subject: 'Alice',
      predicate: 'lives_in',
      object: 'Beijing',
      confidence: 0.9,
      source_span: 'Alice moved to Beijing yesterday.',
      event_time: 'yesterday',
      timezone: 'Asia/Shanghai',
    }), new Date('2026-07-12T04:30:00.000Z'));

    expect(result.facts[0]).toMatchObject({
      event_time: '2026-07-10T16:00:00.000Z',
      valid_from: '2026-07-10T16:00:00.000Z',
      valid_until: '2026-07-11T16:00:00.000Z',
      temporal_confidence: 0.9,
      temporal_source: 'relative_expression',
    });
  });

  it.each([
    ['unknown entity type', { name: 'Alice', type: 'invented', description: '' }],
    ['confidence outside range', {
      subject: 'Alice', predicate: 'lives_in', object: 'Beijing', confidence: 2, source_span: 'evidence',
    }],
    ['missing source span', {
      subject: 'Alice', predicate: 'lives_in', object: 'Beijing', confidence: 0.8,
    }],
    ['unknown predicate', {
      subject: 'Alice', predicate: 'invented', object: 'Beijing', confidence: 0.8, source_span: 'evidence',
    }],
  ])('rejects %s', (scenario, invalid) => {
    const value = JSON.parse(payload({
      subject: 'Alice', predicate: 'lives_in', object: 'Beijing', confidence: 0.8, source_span: 'evidence',
    }));
    if (scenario === 'unknown entity type') value.entities[0] = invalid;
    else value.facts[0] = invalid;
    expect(() => parseLlmExtractionResult(JSON.stringify(value))).toThrow();
  });

  it('rejects temporal text that cannot be normalized', () => {
    expect(() => parseLlmExtractionResult(payload({
      subject: 'Alice',
      predicate: 'lives_in',
      object: 'Beijing',
      confidence: 0.9,
      source_span: 'Alice moved at some unknowable time.',
      event_time: 'whenever the stars align',
    }))).toThrow('INVALID_TEMPORAL_EXPRESSION');
  });
});
