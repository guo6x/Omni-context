import { createHash } from 'crypto';

export interface SourceChunk {
  document_id: string;
  chunk_id: string;
  ordinal: number;
  source: string;
  content: string;
  source_span: string;
  start_offset: number;
  end_offset: number;
  timestamp: string;
}

export interface ChunkDocumentOptions {
  documentId: string;
  source: string;
  timestamp: string;
  maxChars?: number;
  overlapChars?: number;
}

const DEFAULT_MAX_CHARS = 3_500;
const DEFAULT_OVERLAP_CHARS = 160;

function stableChunkId(documentId: string, start: number, end: number, content: string): string {
  const digest = createHash('sha256')
    .update(documentId)
    .update('\0')
    .update(String(start))
    .update(':')
    .update(String(end))
    .update('\0')
    .update(content)
    .digest('hex')
    .slice(0, 24);
  return `${documentId}:${digest}`;
}

function boundaryEnd(text: string, start: number, hardEnd: number, minimumEnd: number): number {
  const window = text.slice(start, hardEnd);
  const boundaries: RegExp[] = [
    /\n(?=(?:user|assistant|human|system|用户|助手|提问|回答)\s*[:：])/gi,
    /\n(?=#{1,6}\s)/g,
    /\n\s*\n/g,
    /[。！？.!?]\s+/g,
    /\s+/g,
  ];
  for (const pattern of boundaries) {
    let match: RegExpExecArray | null;
    let last = -1;
    while ((match = pattern.exec(window)) !== null) {
      const candidate = start + match.index + match[0].length;
      if (candidate >= minimumEnd && candidate <= hardEnd) last = candidate;
      if (match[0].length === 0) pattern.lastIndex++;
    }
    if (last >= minimumEnd) return last;
  }
  return hardEnd;
}

/**
 * Deterministic, lossless source chunking. Boundaries prefer conversation turns,
 * headings, paragraphs, and sentences before falling back to a hard character cap.
 */
export function chunkDocument(text: string, options: ChunkDocumentOptions): SourceChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  if (!Number.isInteger(maxChars) || maxChars < 256) throw new Error('maxChars must be an integer >= 256');
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error('overlapChars must be an integer from 0 to maxChars - 1');
  }
  if (!options.documentId.trim()) throw new Error('documentId is required');
  if (!options.source.trim()) throw new Error('source is required');
  if (!Number.isFinite(new Date(options.timestamp).getTime())) throw new Error('timestamp must be ISO-compatible');
  if (!text) return [];

  const chunks: SourceChunk[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + maxChars);
    const minimumEnd = Math.min(hardEnd, start + Math.floor(maxChars * 0.6));
    const end = hardEnd === text.length ? hardEnd : boundaryEnd(text, start, hardEnd, minimumEnd);
    const content = text.slice(start, end);
    chunks.push({
      document_id: options.documentId,
      chunk_id: stableChunkId(options.documentId, start, end, content),
      ordinal: chunks.length,
      source: options.source,
      content,
      source_span: content,
      start_offset: start,
      end_offset: end,
      timestamp: new Date(options.timestamp).toISOString(),
    });
    if (end >= text.length) break;
    const next = Math.max(start + 1, end - overlapChars);
    start = next;
  }
  return chunks;
}

export function coveredCharacterCount(chunks: Array<Pick<SourceChunk, 'start_offset' | 'end_offset'>>): number {
  const intervals = chunks
    .filter((chunk) => chunk.end_offset > chunk.start_offset)
    .map((chunk) => [chunk.start_offset, chunk.end_offset] as const)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let start = -1;
  let end = -1;
  for (const interval of intervals) {
    if (start < 0) {
      [start, end] = interval;
    } else if (interval[0] <= end) {
      end = Math.max(end, interval[1]);
    } else {
      covered += end - start;
      [start, end] = interval;
    }
  }
  return start < 0 ? 0 : covered + end - start;
}
