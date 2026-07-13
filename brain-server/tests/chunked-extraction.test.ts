import { describe, expect, it, vi } from 'vitest';
import { GraphRAGExtractor } from '../src/graphrag/extractor.js';
import { LLMExtractorPipeline } from '../src/graphrag/llm-pipeline.js';

describe('chunked GraphRAG extraction', () => {
  it('extracts a tail entity without silent truncation and returns provenance coverage', async () => {
    const extractor = new GraphRAGExtractor({ useLocalExtraction: true });
    const prefix = `${'ordinary paragraph without entities. '.repeat(240)}\n\n`;
    const text = `${prefix}class TailSentinel {}`;
    const result = await extractor.extract({
      textContent: text,
      timestamp: '2026-07-12T00:00:00.000Z',
      sourceType: 'manual',
      source: 'long-fixture.txt',
      documentId: 'long-doc',
    });

    expect(result.entities.some((entity) => entity.name === 'TailSentinel')).toBe(true);
    expect(result.chunking).toMatchObject({
      document_id: 'long-doc',
      processed_chunks: expect.any(Number),
      failed_chunks: [],
      coverage: 1,
      truncated: false,
    });
    expect(result.chunking!.total_chunks).toBeGreaterThan(1);
    expect(result.chunking!.chunks.at(-1)?.source_span).toContain('TailSentinel');
    const tailEntity = result.entities.find((entity) => entity.name === 'TailSentinel');
    expect(tailEntity?.metadata?.extraction_chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({ document_id: 'long-doc', source: 'long-fixture.txt' }),
    ]));
  });

  it('deduplicates entities found in overlapping chunks at document scope', async () => {
    const extractor = new GraphRAGExtractor({ useLocalExtraction: true });
    const text = Array.from({ length: 40 }, (_, index) => (
      `# Section ${index}\nclass SharedEntity {}\n${'context '.repeat(20)}`
    )).join('\n\n');
    const result = await extractor.extract({
      textContent: text,
      timestamp: '2026-07-12T00:00:00.000Z',
      sourceType: 'manual',
      documentId: 'dedup-doc',
    });
    expect(result.entities.filter((entity) => entity.name === 'SharedEntity')).toHaveLength(1);
    const entity = result.entities.find((candidate) => candidate.name === 'SharedEntity');
    expect(entity?.metadata?.extraction_chunks.length).toBeGreaterThan(1);
  });

  it('reports a failed LLM chunk instead of presenting partial extraction as complete', async () => {
    const spy = vi.spyOn(LLMExtractorPipeline.prototype, 'extractWithDiagnostics').mockImplementation(async (text) => {
      if (text.includes('FAIL_CHUNK')) throw new Error('fixture provider failure');
      return {
        result: { entities: [], facts: [], principles: [] },
        diagnostics: {
          http_status: 200, raw_response_sha256: 'b'.repeat(64), finish_reason: 'stop', status: 'parsed' as const,
          parsed_counts: { entities: 0, facts: 0, principles: 0 },
          normalization: { entity_types: [], predicates: [] },
        },
      };
    });
    try {
      const extractor = new GraphRAGExtractor();
      const text = `${'successful context. '.repeat(230)}\n\nFAIL_CHUNK ${'tail '.repeat(200)}`;
      const result = await extractor.extract({
        textContent: text,
        timestamp: '2026-07-12T00:00:00.000Z',
        documentId: 'partial-doc',
      });
      expect(result.chunking!.failed_chunks).toEqual([
        expect.objectContaining({ error: 'fixture provider failure' }),
      ]);
      expect(result.chunking!.coverage).toBeLessThan(1);
      expect(result.chunking!.truncated).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
