import { describe, expect, it } from 'vitest';
import { parseLlmExtractionResult, parseLlmExtractionResultDetailed } from '../src/graphrag/llm-pipeline.js';

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
    ['confidence outside range', {
      subject: 'Alice', predicate: 'lives_in', object: 'Beijing', confidence: 2, source_span: 'evidence',
    }],
    ['missing source span', {
      subject: 'Alice', predicate: 'lives_in', object: 'Beijing', confidence: 0.8,
    }],
  ])('rejects %s', (scenario, invalid) => {
    const value = JSON.parse(payload({
      subject: 'Alice', predicate: 'lives_in', object: 'Beijing', confidence: 0.8, source_span: 'evidence',
    }));
    value.facts[0] = invalid;
    expect(() => parseLlmExtractionResult(JSON.stringify(value))).toThrow();
  });

  it('normalizes isolated unknown domain labels without discarding the full response', () => {
    const value = JSON.parse(payload({
      subject: 'Alice', predicate: 'invented_predicate', object: 'Beijing', confidence: 0.8, source_span: 'evidence',
    }));
    value.entities[0].type = 'invented_entity_type';
    const parsed = parseLlmExtractionResultDetailed(JSON.stringify(value));
    expect(parsed.result.entities[0].type).toBe('concept');
    expect(parsed.result.facts[0].predicate).toBe('relates_to');
    expect(parsed.result.facts[0].original_predicate).toBe('invented_predicate');
    expect(parsed.normalization).toEqual({
      entity_types: [{ index: 0, from: 'invented_entity_type', to: 'concept' }],
      predicates: [{ index: 0, from: 'invented_predicate', to: 'relates_to' }],
    });
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

  it('accepts null for optional temporal metadata without dropping the fact', () => {
    const value = JSON.parse(payload({
      subject: 'Alice',
      predicate: 'lives_in',
      object: 'Beijing',
      confidence: 0.9,
      source_span: 'Alice lives in Beijing.',
      event_time: null,
      valid_from: null,
      valid_until: null,
      temporal_confidence: null,
      temporal_source: null,
      timezone: null,
    }));
    const parsed = parseLlmExtractionResult(JSON.stringify(value));
    expect(parsed.facts).toHaveLength(1);
    expect(parsed.facts[0].event_time).toBeUndefined();
  });
});
