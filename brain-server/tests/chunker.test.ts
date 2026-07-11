import { describe, expect, it } from 'vitest';
import { chunkDocument, coveredCharacterCount } from '../src/ingest/chunker.js';

const options = {
  documentId: 'doc-1',
  source: 'fixture.md',
  timestamp: '2026-07-12T00:00:00.000Z',
  maxChars: 300,
  overlapChars: 30,
};

describe('lossless document chunking', () => {
  it('covers the complete source including a fact at the tail', () => {
    const text = `${'第一段内容。'.repeat(100)}\n\nTAIL_FACT_必须保留`;
    const chunks = chunkDocument(text, options);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.at(-1)?.content).toContain('TAIL_FACT_必须保留');
    expect(coveredCharacterCount(chunks)).toBe(text.length);
    expect(chunks.every((chunk) => chunk.content.length <= options.maxChars)).toBe(true);
  });

  it('prefers conversation turn and heading boundaries', () => {
    const text = `${'背景 '.repeat(70)}\nUser: 新问题\n${'回答 '.repeat(80)}\n# 下一节\n结尾`;
    const chunks = chunkDocument(text, options);
    expect(chunks[0].content.endsWith('\n')).toBe(true);
    expect(chunks.some((chunk) => chunk.content.includes('# 下一节'))).toBe(true);
  });

  it('attaches stable provenance and exact offsets', () => {
    const text = 'A'.repeat(900);
    const first = chunkDocument(text, options);
    const second = chunkDocument(text, options);
    expect(first.map((chunk) => chunk.chunk_id)).toEqual(second.map((chunk) => chunk.chunk_id));
    for (const [ordinal, chunk] of first.entries()) {
      expect(chunk).toMatchObject({
        document_id: 'doc-1',
        ordinal,
        source: 'fixture.md',
        timestamp: options.timestamp,
      });
      expect(chunk.source_span).toBe(text.slice(chunk.start_offset, chunk.end_offset));
      expect(chunk.content).toBe(chunk.source_span);
    }
  });

  it('rejects invalid limits instead of truncating', () => {
    expect(() => chunkDocument('text', { ...options, maxChars: 100 })).toThrow(/maxChars/);
    expect(() => chunkDocument('text', { ...options, overlapChars: 300 })).toThrow(/overlapChars/);
  });
});
