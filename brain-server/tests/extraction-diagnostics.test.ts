import { createHash } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphRAGExtractionError, GraphRAGExtractor } from '../src/graphrag/extractor.js';
import { LLMExtractorPipeline } from '../src/graphrag/llm-pipeline.js';

afterEach(() => vi.restoreAllMocks());

describe('formal evaluation extraction diagnostics', () => {
  it('records HTTP status and the hash of the raw provider response while safely normalizing labels', async () => {
    const content = JSON.stringify({
      entities: [{ name: 'Caroline', type: 'human', description: 'A conversation participant' }],
      facts: [{
        subject: 'Caroline', predicate: 'enjoys', object: 'painting', confidence: 0.9,
        source_span: 'Caroline: I enjoy painting.',
      }],
      principles: [],
    });
    const raw = JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(raw, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const pipeline = new LLMExtractorPipeline({ apiUrl: 'http://127.0.0.1:11434/v1', model: 'fixture' });
    const detailed = await pipeline.extractWithDiagnostics('Caroline: I enjoy painting.', {
      referenceTime: '2023-05-21T19:48:00.000Z',
    });

    expect(detailed.diagnostics).toMatchObject({
      http_status: 200,
      raw_response_sha256: createHash('sha256').update(raw).digest('hex'),
      finish_reason: 'stop',
      status: 'parsed',
      parsed_counts: { entities: 1, facts: 1, principles: 0 },
      normalization: {
        entity_types: [{ index: 0, from: 'human', to: 'concept' }],
        predicates: [{ index: 0, from: 'enjoys', to: 'relates_to' }],
      },
    });
  });

  it('uses the dataset session timestamp and preserves multiple dialogue participants', async () => {
    vi.spyOn(LLMExtractorPipeline.prototype, 'extractWithDiagnostics').mockResolvedValue({
      result: {
        entities: [
          { name: 'Caroline', type: 'person', description: 'Speaker one' },
          { name: 'Melanie', type: 'person', description: 'Speaker two' },
        ],
        facts: [{
          subject: 'Caroline', predicate: 'likes', object: 'painting', confidence: 0.9,
          source_span: 'Caroline: I like painting.',
        }],
        principles: [],
      },
      diagnostics: {
        http_status: 200, raw_response_sha256: 'd'.repeat(64), finish_reason: 'stop', status: 'parsed',
        parsed_counts: { entities: 2, facts: 1, principles: 0 },
        normalization: { entity_types: [], predicates: [] },
      },
    });
    const extractor = new GraphRAGExtractor();
    const timestamp = '2023-05-21T19:48:00.000Z';
    const result = await extractor.extract({
      textContent: 'Caroline: I like painting.\nMelanie: That is wonderful.',
      timestamp,
      source: 'LoCoMo conv1 session1',
      documentId: '1',
      requireLlmSuccess: true,
    });

    expect(result.entities.filter((entity) => entity.type === 'person').map((entity) => entity.name)).toEqual([
      'Caroline', 'Melanie',
    ]);
    expect(result.entities.every((entity) => entity.created_at === timestamp)).toBe(true);
    expect(result.assertions).toHaveLength(3);
    const semanticAssertions = result.assertions?.filter(
      (assertion) => assertion.provenance?.evidence_kind !== 'raw_event',
    ) ?? [];
    const rawEventAssertions = result.assertions?.filter(
      (assertion) => assertion.provenance?.evidence_kind === 'raw_event',
    ) ?? [];
    expect(semanticAssertions).toHaveLength(1);
    expect(semanticAssertions[0].valid_from).toBe(timestamp);
    expect(rawEventAssertions).toHaveLength(2);
    expect(rawEventAssertions.map((assertion) => assertion.provenance?.source_agent)).toEqual([
      'Caroline', 'Melanie',
    ]);
    expect(rawEventAssertions.every((assertion) => assertion.valid_from === timestamp)).toBe(true);
    expect(result.diagnostics).toMatchObject({
      input_characters: 54,
      chunks: 1,
      parsed_counts: { entities: 2, facts: 1, principles: 0 },
      produced_counts: { entities: 2, assertions: 3 },
      skipped_facts_missing_subject: 0,
    });
  });

  it('marks max-token truncation as a formal failure even when the partial JSON parses', async () => {
    const content = JSON.stringify({ entities: [], facts: [], principles: [] });
    const raw = JSON.stringify({ choices: [{ message: { content }, finish_reason: 'length' }] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(raw, { status: 200 }));
    const pipeline = new LLMExtractorPipeline({ apiUrl: 'http://127.0.0.1:11434/v1', model: 'fixture' });
    const detailed = await pipeline.extractWithDiagnostics('input');
    expect(detailed.diagnostics).toMatchObject({
      status: 'truncated',
      error: 'LLM_OUTPUT_TRUNCATED',
      finish_reason: 'length',
    });
  });

  it('keeps valid facts when optional provider time text is vague and records a hash-only diagnostic', async () => {
    const content = JSON.stringify({
      entities: [{ name: 'Caroline', type: 'person', description: 'A person' }],
      facts: [{
        subject: 'Caroline', predicate: 'likes', object: 'painting', confidence: 0.9,
        source_span: 'Caroline: I enjoy painting.', event_time: 'whenever the stars align',
      }],
      principles: [],
    });
    const raw = JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(raw, { status: 200 }));
    const pipeline = new LLMExtractorPipeline({ apiUrl: 'http://127.0.0.1:11434/v1', model: 'fixture' });
    const detailed = await pipeline.extractWithDiagnostics('Caroline: I enjoy painting.', {
      referenceTime: '2023-05-21T19:48:00.000Z',
    });
    expect(detailed.diagnostics.status).toBe('parsed');
    expect(detailed.result.facts).toHaveLength(1);
    expect(detailed.result.facts[0].event_time).toBeUndefined();
    expect(detailed.diagnostics.normalization.temporal_values).toEqual([{
      fact_index: 0,
      field: 'event_time',
      value_sha256: createHash('sha256').update('whenever the stars align').digest('hex'),
      action: 'dropped',
      reason: 'unparseable_optional_temporal_value',
    }]);
  });

  it('fails formal evaluation instead of silently returning regex-only output', async () => {
    vi.spyOn(LLMExtractorPipeline.prototype, 'extractWithDiagnostics').mockResolvedValue({
      result: { entities: [], facts: [], principles: [] },
      diagnostics: {
        http_status: 200, raw_response_sha256: 'e'.repeat(64), finish_reason: 'stop',
        status: 'invalid_response', error: 'LLM_OUTPUT_INVALID:entities:invalid_type',
        parsed_counts: { entities: 0, facts: 0, principles: 0 },
        normalization: { entity_types: [], predicates: [] },
      },
    });
    const extractor = new GraphRAGExtractor();
    await expect(extractor.extract({
      textContent: 'class RegexWouldOtherwiseHideTheFailure {}',
      timestamp: '2023-05-21T19:48:00.000Z',
      requireLlmSuccess: true,
    })).rejects.toBeInstanceOf(GraphRAGExtractionError);
  });

  it('retries a truncated provider response and preserves every attempt diagnostic', async () => {
    const parsed = {
      result: {
        entities: [{ name: 'Caroline', type: 'person' as const, description: 'Speaker' }],
        facts: [], principles: [],
      },
      diagnostics: {
        http_status: 200, raw_response_sha256: 'a'.repeat(64), finish_reason: 'stop',
        status: 'parsed' as const, parsed_counts: { entities: 1, facts: 0, principles: 0 },
        normalization: { entity_types: [], predicates: [] },
      },
    };
    const truncated = {
      result: { entities: [], facts: [], principles: [] },
      diagnostics: {
        http_status: 200, raw_response_sha256: 'b'.repeat(64), finish_reason: 'length',
        status: 'truncated' as const, error: 'LLM_OUTPUT_TRUNCATED',
        parsed_counts: { entities: 0, facts: 0, principles: 0 },
        normalization: { entity_types: [], predicates: [] },
      },
    };
    const spy = vi.spyOn(LLMExtractorPipeline.prototype, 'extractWithDiagnostics')
      .mockResolvedValueOnce(truncated)
      .mockResolvedValueOnce(parsed);
    const extractor = new GraphRAGExtractor();
    const result = await extractor.extract({
      textContent: 'Caroline joined the conversation.',
      timestamp: '2023-05-21T19:48:00.000Z',
      requireLlmSuccess: true,
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.diagnostics.llm_calls).toEqual([
      expect.objectContaining({ attempt: 1, status: 'truncated' }),
      expect.objectContaining({ attempt: 2, status: 'parsed' }),
    ]);
    expect(result.diagnostics.failure_reason).toBeUndefined();
  });
});
