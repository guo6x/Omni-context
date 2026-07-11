import http from 'http';
import { RequestContext, parseBody, sendResponse, sendError } from '../routes.js';
import { OCRPipeline } from '../../ocr/pipeline.js';
import { resolveConflicts } from '../../graphrag/conflict-resolver.js';
import { resolveEntities } from '../../graphrag/entity-resolver.js';
import { v4 as uuidv4 } from 'uuid';
import { Entity } from '../../shared-types.js';
import { preprocess } from '../../ingest/preprocess.js';
import { parseChatExport, ParsedConversation } from '../../importers/chat-export.js';
import { createHash } from 'crypto';
import { coveredCharacterCount } from '../../ingest/chunker.js';

// 文件上传抽取管线（v1：仅文本类）
// 入参形态：JSON { filename, contentType, base64 }
// 复用既有的 parseBody（JSON-only），避免引入 multipart 依赖。
// 30MB 软上限（PDF 等常较大）；同时受 routes.ts 的 MAX_BODY_BYTES 硬上限保护（base64 约 +33%）。
const MAX_INGEST_BYTES = Number(process.env.INGEST_MAX_BYTES || 30 * 1024 * 1024);

const TEXT_CONTENT_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'application/json',
]);

const PDF_CONTENT_TYPES = new Set([
  'application/pdf',
]);

const IMAGE_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const DOCX_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const EPUB_CT = 'application/epub+zip';
const HTML_CTS = new Set(['text/html', 'application/xhtml+xml']);

const OFFICE_AND_EBOOK_CTS = new Set([DOCX_CT, XLSX_CT, PPTX_CT, EPUB_CT]);

interface IngestFilePayload {
  filename?: string;
  contentType?: string;
  base64?: string;
}

function normalizeContentType(ct: string): string {
  return (ct || '').split(';')[0].trim().toLowerCase();
}

function isAcceptedContentType(ct: string): boolean {
  if (TEXT_CONTENT_TYPES.has(ct)) return true;
  if (PDF_CONTENT_TYPES.has(ct)) return true;
  if (IMAGE_CONTENT_TYPES.has(ct)) return true;
  if (OFFICE_AND_EBOOK_CTS.has(ct)) return true;
  if (HTML_CTS.has(ct)) return true;
  // text/* 全开（text/x-yaml、application/x-python 之类用户也可能拖进来）
  if (ct.startsWith('text/')) return true;
  // image/* 兜底（image/webp 等）
  if (ct.startsWith('image/')) return true;
  return false;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const mammoth: any = await import('mammoth');
  const extractRawText = mammoth.extractRawText || mammoth.default?.extractRawText;
  const result = await extractRawText({ buffer });
  return (result?.value || '').toString();
}

async function extractTextFromXlsx(buffer: Buffer): Promise<string> {
  const xlsx: any = await import('xlsx');
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const csv = xlsx.utils.sheet_to_csv(sheet);
    if (csv.trim()) parts.push(`# Sheet: ${sheetName}\n${csv}`);
  }
  return parts.join('\n\n');
}

async function extractTextFromPptx(buffer: Buffer): Promise<string> {
  const mod: any = await import('jszip');
  const JSZip = mod.default || mod;
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((name: string) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a: string, b: string) => {
      const an = Number(a.match(/slide(\d+)\.xml$/)?.[1] || 0);
      const bn = Number(b.match(/slide(\d+)\.xml$/)?.[1] || 0);
      return an - bn;
    });
  const parts: string[] = [];
  for (const name of slideNames) {
    const xml: string = await zip.files[name].async('string');
    // <a:t> 之间的纯文本就是 PPT 显示的文字
    const texts = Array.from(xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)).map((m) => m[1]);
    if (texts.length) parts.push(texts.join(' '));
  }
  return parts.join('\n\n');
}

async function extractTextFromEpub(buffer: Buffer): Promise<string> {
  const mod: any = await import('jszip');
  const JSZip = mod.default || mod;
  const zip = await JSZip.loadAsync(buffer);
  // epub 是 zip，内容主要在 *.xhtml / *.html。按名称排序近似阅读顺序。
  const htmlNames = Object.keys(zip.files)
    .filter((name: string) => /\.(x?html?)$/i.test(name))
    .sort();
  const parts: string[] = [];
  for (const name of htmlNames) {
    const html: string = await zip.files[name].async('string');
    const text = stripHtml(html);
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // 动态 import：让 vitest/不需要解析 PDF 的路径不会被 pdfjs 启动开销拖累
  const mod: any = await import('pdf-parse');
  const PDFParse = mod.PDFParse || mod.default?.PDFParse || mod.default;
  if (!PDFParse) {
    throw new Error('pdf-parse module did not expose PDFParse');
  }
  // v2 API: new PDFParse({ data }).getText() => { text, pages }
  const data = new Uint8Array(buffer);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return typeof result?.text === 'string' ? result.text : '';
  } finally {
    if (typeof parser.destroy === 'function') {
      try { await parser.destroy(); } catch { /* swallow */ }
    }
  }
}

// --- Async Job Store ---

type JobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
type JobStage = 'parsing' | 'ocr' | 'extracting' | 'resolving' | 'storing' | 'done';

interface JobState {
  jobId: string;
  status: JobStatus;
  stage?: JobStage;
  filename: string;
  createdAt: number;
  completedAt?: number;
  aborted?: boolean;
  result?: {
    entities: number;
    relationships: number;
    principles: number;
    archivalId: string;
    summary: string;
    documentId?: string;
    chunking?: {
      totalChunks: number;
      processedChunks: number;
      failedChunks: Array<{ chunkId: string; ordinal: number; error: string }>;
      coverage: number;
      truncated: false;
    };
    preprocess?: {
      originalTokens: number;
      cleanedTokens: number;
      reductionRatio: number;
      droppedSections: Array<{ reason: string; preview: string }>;
      sourceMap: {
        urls: Record<string, string>;
        dropped: Array<{ reason: string; preview: string }>;
      };
    };
  };
  importProgress?: { done: number; total: number; entities: number };
  retryProgress?: {
    documentId: string;
    done: number;
    total: number;
    recovered: number;
    failed: number;
    coverage: number;
  };
  error?: string;
}

const MAX_JOBS = 100;
const JOB_TTL_MS = 5 * 60 * 1000; // 5 minutes after completion

const jobStore = new Map<string, JobState>();

function createJob(filename: string): JobState {
  // Capacity protection: remove oldest completed/failed jobs first
  if (jobStore.size >= MAX_JOBS) {
    const entries = [...jobStore.entries()]
      .sort((a, b) => (a[1].completedAt || a[1].createdAt) - (b[1].completedAt || b[1].createdAt));
    for (const [id, job] of entries) {
      if (job.status === 'success' || job.status === 'failed' || job.status === 'cancelled') {
        jobStore.delete(id);
        if (jobStore.size < MAX_JOBS) break;
      }
    }
    // If still over, remove oldest running/queued
    for (const [id] of entries) {
      jobStore.delete(id);
      if (jobStore.size < MAX_JOBS) break;
    }
  }

  const jobId = uuidv4();
  const job: JobState = {
    jobId,
    status: 'queued',
    filename,
    createdAt: Date.now(),
  };
  jobStore.set(jobId, job);
  return job;
}

function updateJob(jobId: string, updates: Partial<JobState>): void {
  const job = jobStore.get(jobId);
  if (job) Object.assign(job, updates);
}

function getJob(jobId: string): JobState | null {
  const job = jobStore.get(jobId);
  if (!job) return null;

  // Cleanup: remove completed/cancelled jobs older than TTL
  if ((job.status === 'success' || job.status === 'failed' || job.status === 'cancelled') && job.completedAt) {
    if (Date.now() - job.completedAt > JOB_TTL_MS) {
      jobStore.delete(jobId);
      return null;
    }
  }
  return job;
}

// --- Async Pipeline Runner ---

async function runIngestPipeline(jobId: string, filename: string, contentType: string, base64: string, buffer: Buffer, ctx: RequestContext): Promise<void> {
  const FAIL = (stage: JobStage, error: string) => {
    updateJob(jobId, { status: 'failed', stage, completedAt: Date.now(), error });
  };

  const CANCEL = () => {
    updateJob(jobId, { status: 'cancelled', stage: undefined, completedAt: Date.now() });
  };

  const CHECK_ABORT = (): boolean => {
    const j = jobStore.get(jobId);
    return !!(j?.aborted);
  };

  const isImage = IMAGE_CONTENT_TYPES.has(contentType) || contentType.startsWith('image/');

  // Stage: parsing
  if (CHECK_ABORT()) return CANCEL();
  updateJob(jobId, { status: 'running', stage: 'parsing' });
  let textContent = '';
  try {
    if (PDF_CONTENT_TYPES.has(contentType)) {
      textContent = await extractTextFromPdf(buffer);
    } else if (contentType === DOCX_CT) {
      textContent = await extractTextFromDocx(buffer);
    } else if (contentType === XLSX_CT) {
      textContent = await extractTextFromXlsx(buffer);
    } else if (contentType === PPTX_CT) {
      textContent = await extractTextFromPptx(buffer);
    } else if (contentType === EPUB_CT) {
      textContent = await extractTextFromEpub(buffer);
    } else if (HTML_CTS.has(contentType)) {
      // 传递完整的 HTML 字符串，留给后面的 preprocess 进行正文提取
      textContent = buffer.toString('utf-8');
    } else if (isImage) {
      // Stage: ocr
      updateJob(jobId, { stage: 'ocr' });
      const ocr = new OCRPipeline();
      try {
        const dataUrl = `data:${contentType};base64,${base64}`;
        const ocrResult = await ocr.extractText(dataUrl);
        textContent = ocrResult.text;
      } finally {
        await ocr.dispose();
      }
    } else {
      textContent = buffer.toString('utf-8');
    }
  } catch (err: any) {
    return FAIL(isImage ? 'ocr' : 'parsing', `Failed to read file content: ${err?.message || err}`);
  }

  textContent = textContent.trim();
  if (!textContent) {
    const message = isImage
      ? 'No text recognized in the image'
      : 'No text content extracted from file';
    return FAIL(isImage ? 'ocr' : 'parsing', message);
  }

  // 接入 TokenJuice 预处理管线
  let cleanedText = textContent;
  let preprocessMeta: any = null;

  try {
    let sourceType: 'html' | 'markdown' | 'plain' = 'plain';
    if (HTML_CTS.has(contentType)) {
      sourceType = 'html';
    } else if (contentType === 'text/markdown' || contentType === 'text/x-markdown' || filename.endsWith('.md')) {
      sourceType = 'markdown';
    }

    const preprocessResult = await preprocess(textContent, { sourceType });
    cleanedText = preprocessResult.cleaned;
    preprocessMeta = {
      originalTokens: preprocessResult.originalTokens,
      cleanedTokens: preprocessResult.cleanedTokens,
      reductionRatio: preprocessResult.reductionRatio,
      droppedSections: preprocessResult.droppedSections,
      sourceMap: preprocessResult.sourceMap
    };
  } catch (err: any) {
    console.warn('[Ingest] Preprocess failed, falling back to raw text:', err);
    // 降级兜底：如果是 HTML 且 preprocess 失败，进行一次 stripHtml 提取纯文本
    if (HTML_CTS.has(contentType)) {
      cleanedText = stripHtml(textContent);
    }
  }

  // Stage: extracting (LLM)
  if (CHECK_ABORT()) return CANCEL();
  updateJob(jobId, { stage: 'extracting' });
  let extractResult;
  try {
    extractResult = await ctx.extractor.extract({
      textContent: `Source file: ${filename}\n${cleanedText}`,
      timestamp: new Date().toISOString(),
      sourceType: 'manual',
      sourceMap: preprocessMeta?.sourceMap,
      documentId: jobId,
      source: filename,
      forceChunking: true,
    });
  } catch (err: any) {
    return FAIL('extracting', `LLM extraction failed: ${err?.message || err}`);
  }

  if (extractResult.chunking) {
    const now = new Date().toISOString();
    const failures = new Map(extractResult.chunking.failed_chunks.map((failure) => [failure.chunk_id, failure.error]));
    const documentStatus = extractResult.chunking.processed_chunks === 0
      ? 'failed'
      : extractResult.chunking.failed_chunks.length > 0 ? 'partial' : 'success';
    try {
      await ctx.db.withTransaction(async () => {
        await ctx.db.run(
          `INSERT OR REPLACE INTO ingestion_documents (
             id, source, title, content_sha256, character_count, total_chunks,
             processed_chunks, failed_chunks, coverage, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            extractResult.chunking!.document_id,
            filename,
            filename,
            createHash('sha256').update(cleanedText).digest('hex'),
            cleanedText.length,
            extractResult.chunking!.total_chunks,
            extractResult.chunking!.processed_chunks,
            extractResult.chunking!.failed_chunks.length,
            extractResult.chunking!.coverage,
            documentStatus,
            now,
            now,
          ]
        );
        for (const chunk of extractResult.chunking!.chunks) {
          const error = failures.get(chunk.chunk_id);
          await ctx.db.run(
            `INSERT OR REPLACE INTO ingestion_chunks (
               id, document_id, ordinal, source, content, source_span, start_offset,
               end_offset, source_timestamp, status, attempts, error, extracted_at,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              chunk.chunk_id,
              chunk.document_id,
              chunk.ordinal,
              chunk.source,
              chunk.content,
              chunk.source_span,
              chunk.start_offset,
              chunk.end_offset,
              chunk.timestamp,
              error ? 'failed' : 'success',
              1,
              error || null,
              error ? null : now,
              now,
              now,
            ]
          );
        }
      });
    } catch (err: any) {
      return FAIL('storing', `Failed to persist extraction chunks: ${err?.message || err}`);
    }
  }

  // Stage: resolving
  if (CHECK_ABORT()) return CANCEL();
  updateJob(jobId, { stage: 'resolving' });
  const resolution = await resolveEntities(extractResult.entities, extractResult.relationships, ctx.db, ctx.embeddingService);

  for (const entity of resolution.entitiesToCreate) {
    await ctx.db.addEntity(entity);
  }

  for (const update of resolution.entitiesToUpdate) {
    await ctx.db.updateEntity(update.id, {
      description: update.description,
      tags: update.tags,
      embedding: update.embedding,
      metadata: update.metadata,
      created_at: update.created_at,
      access_count: update.access_count,
    });
  }

  try {
    await resolveConflicts(resolution.relationshipsToCreate, ctx.db, ctx.extractor);
  } catch (err) {
    return FAIL('resolving', `Transactional conflict resolution failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Stage: storing
  if (CHECK_ABORT()) return CANCEL();
  updateJob(jobId, { stage: 'storing' });

  // Principles
  const principleNow = new Date().toISOString();
  const principleEntities = extractResult.principles.map((principle): Entity => ({
    id: uuidv4(),
    name: principle.title,
    type: 'principle',
    description: principle.content,
    created_at: principleNow,
    updated_at: principleNow,
    last_accessed: principleNow,
    access_count: 0,
    tags: ['auto_extracted', principle.type, 'uploaded-file'],
    metadata: {
      isCore: principle.isCore,
      version: principle.version || 1,
      principleType: principle.type,
      sourceFile: filename,
    },
  }));
  const principleResolution = await resolveEntities(principleEntities, [], ctx.db, ctx.embeddingService);
  for (const entity of principleResolution.entitiesToCreate) {
    await ctx.db.addEntity(entity);
  }
  for (const update of principleResolution.entitiesToUpdate) {
    await ctx.db.updateEntity(update.id, {
      description: update.description,
      tags: update.tags,
      embedding: update.embedding,
      metadata: update.metadata,
      created_at: update.created_at,
      access_count: update.access_count,
    });
  }

  // Archival memory
  let archivalEmbedding: number[] | undefined;
  try {
    const embRes = await ctx.embeddingService.embed(cleanedText);
    archivalEmbedding = embRes.embedding;
  } catch (err) {
    console.warn('[Ingest] archival embedding failed:', err);
  }

  const archival = await ctx.archivalMemory.add(cleanedText, {
    tags: ['uploaded-file', filename],
    importance: 0.5,
    embedding: archivalEmbedding,
  });

  const summary = await ctx.extractor.summarizeEntities(extractResult.entities);

  // Done
  updateJob(jobId, {
    status: 'success',
    stage: 'done',
    completedAt: Date.now(),
    result: {
      entities: extractResult.entities.length,
      relationships: extractResult.relationships.length,
      principles: extractResult.principles.length,
      archivalId: archival.id,
      summary,
      documentId: extractResult.chunking?.document_id,
      chunking: extractResult.chunking ? {
        totalChunks: extractResult.chunking.total_chunks,
        processedChunks: extractResult.chunking.processed_chunks,
        failedChunks: extractResult.chunking.failed_chunks.map((failure) => ({
          chunkId: failure.chunk_id,
          ordinal: failure.ordinal,
          error: failure.error,
        })),
        coverage: extractResult.chunking.coverage,
        truncated: false,
      } : undefined,
      preprocess: preprocessMeta || undefined,
    },
  });
}

// 导入：把解析好的对话逐段喂抽取管线。把会话原始时间写进 created_at（历史也能时间召回），
// 打 provenance.source='import'。逐段容错，单段失败不影响其余。
async function runImportPipeline(jobId: string, conversations: ParsedConversation[], platform: string, ctx: RequestContext): Promise<void> {
  updateJob(jobId, { status: 'running', stage: 'extracting', importProgress: { done: 0, total: conversations.length, entities: 0 } });
  let done = 0;
  let entityCount = 0;
  for (const conv of conversations) {
    const job = jobStore.get(jobId);
    if (!job || job.aborted) { updateJob(jobId, { status: 'cancelled', completedAt: Date.now() }); return; }
    if (conv.text && conv.text.trim().length >= 10) {
      try {
        const extractResult = await ctx.extractor.extract({
          textContent: `对话标题：${conv.title}\n${conv.text}`,
          timestamp: conv.time || new Date().toISOString(),
          sourceType: 'manual',
          documentId: `${jobId}:${done}`,
          source: `import:${platform}:${conv.title}`,
        });
        const prov = { source: 'import', platform, title: conv.title, at: new Date().toISOString() };
        const resolution = await resolveEntities(extractResult.entities, extractResult.relationships, ctx.db, ctx.embeddingService);
        for (const e of resolution.entitiesToCreate) {
          if (conv.time) e.created_at = conv.time;
          e.tags = Array.from(new Set([...(e.tags || []), 'imported', `import:${platform}`]));
          e.metadata = { ...(e.metadata || {}), provenance: prov };
          await ctx.db.addEntity(e);
          entityCount++;
        }
        for (const u of resolution.entitiesToUpdate) {
          await ctx.db.updateEntity(u.id, { description: u.description, tags: u.tags, embedding: u.embedding, metadata: u.metadata, created_at: u.created_at, access_count: u.access_count });
        }
        for (const r of resolution.relationshipsToCreate) { await ctx.db.addRelationship(r); }
        const pnow = conv.time || new Date().toISOString();
        for (const p of extractResult.principles) {
          const pe: Entity = {
            id: uuidv4(), name: p.title, type: 'principle', description: p.content,
            created_at: pnow, updated_at: pnow, last_accessed: pnow, access_count: 0,
            tags: ['imported', `import:${platform}`, p.type],
            metadata: { isCore: false, principleType: p.type, provenance: prov },
          };
          const pr = await resolveEntities([pe], [], ctx.db, ctx.embeddingService);
          for (const e of pr.entitiesToCreate) { await ctx.db.addEntity(e); entityCount++; }
        }
      } catch (err: any) {
        console.warn('[Import] 跳过一段对话:', err?.message || err);
      }
    }
    done++;
    updateJob(jobId, { importProgress: { done, total: conversations.length, entities: entityCount } });
  }
  updateJob(jobId, { status: 'success', stage: 'done', completedAt: Date.now(), importProgress: { done, total: conversations.length, entities: entityCount } });
}

interface StoredChunk {
  id: string;
  document_id: string;
  ordinal: number;
  source: string;
  content: string;
  source_span: string;
  start_offset: number;
  end_offset: number;
  source_timestamp: string;
  attempts: number;
}

async function runFailedChunkRetry(jobId: string, documentId: string, ctx: RequestContext): Promise<void> {
  const chunks = await ctx.db.all<StoredChunk>(
    `SELECT * FROM ingestion_chunks
     WHERE document_id = ? AND status = 'failed'
     ORDER BY ordinal`,
    [documentId]
  );
  let recovered = 0;
  let failed = 0;
  updateJob(jobId, {
    status: 'running',
    stage: 'extracting',
    retryProgress: { documentId, done: 0, total: chunks.length, recovered, failed, coverage: 0 },
  });

  for (const [index, chunk] of chunks.entries()) {
    const job = jobStore.get(jobId);
    if (!job || job.aborted) {
      updateJob(jobId, { status: 'cancelled', completedAt: Date.now() });
      return;
    }
    const now = new Date().toISOString();
    await ctx.db.run(
      `UPDATE ingestion_chunks
       SET status = 'processing', attempts = attempts + 1, error = NULL, updated_at = ?
       WHERE id = ?`,
      [now, chunk.id]
    );
    try {
      const result = await ctx.extractor.extract({
        textContent: chunk.content,
        timestamp: chunk.source_timestamp,
        sourceType: 'manual',
        documentId,
        source: chunk.source,
        requireLlmSuccess: true,
      });
      const provenance = {
        document_id: documentId,
        chunk_id: chunk.id,
        source: chunk.source,
        source_span: chunk.source_span,
        start_offset: chunk.start_offset,
        end_offset: chunk.end_offset,
        timestamp: chunk.source_timestamp,
        retry_attempt: chunk.attempts + 1,
      };
      for (const entity of result.entities) {
        entity.metadata = {
          ...(entity.metadata || {}),
          extraction_chunks: [provenance],
        };
      }
      for (const relationship of result.relationships) {
        relationship.provenance = { ...(relationship.provenance || {}), ...provenance };
      }
      const resolution = await resolveEntities(result.entities, result.relationships, ctx.db, ctx.embeddingService);
      for (const entity of resolution.entitiesToCreate) await ctx.db.addEntity(entity);
      for (const update of resolution.entitiesToUpdate) {
        await ctx.db.updateEntity(update.id, {
          description: update.description,
          tags: update.tags,
          embedding: update.embedding,
          metadata: update.metadata,
          created_at: update.created_at,
          access_count: update.access_count,
        });
      }
      await resolveConflicts(resolution.relationshipsToCreate, ctx.db, ctx.extractor);

      const principleNow = new Date().toISOString();
      const principles = result.principles.map((principle): Entity => ({
        id: uuidv4(),
        name: principle.title,
        type: 'principle',
        description: principle.content,
        created_at: principleNow,
        updated_at: principleNow,
        last_accessed: principleNow,
        access_count: 0,
        tags: ['auto_extracted', principle.type, 'retry'],
        metadata: { isCore: principle.isCore, principleType: principle.type, extraction_chunks: [provenance] },
      }));
      const principleResolution = await resolveEntities(principles, [], ctx.db, ctx.embeddingService);
      for (const entity of principleResolution.entitiesToCreate) await ctx.db.addEntity(entity);
      for (const update of principleResolution.entitiesToUpdate) {
        await ctx.db.updateEntity(update.id, {
          description: update.description,
          tags: update.tags,
          embedding: update.embedding,
          metadata: update.metadata,
          created_at: update.created_at,
          access_count: update.access_count,
        });
      }
      await ctx.db.run(
        `UPDATE ingestion_chunks
         SET status = 'success', error = NULL, extracted_at = ?, updated_at = ?
         WHERE id = ?`,
        [now, now, chunk.id]
      );
      recovered++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.db.run(
        `UPDATE ingestion_chunks SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
        [message, now, chunk.id]
      );
      failed++;
    }

    const successful = await ctx.db.all<{ start_offset: number; end_offset: number }>(
      `SELECT start_offset, end_offset FROM ingestion_chunks
       WHERE document_id = ? AND status = 'success'`,
      [documentId]
    );
    const document = await ctx.db.get<{ character_count: number; total_chunks: number }>(
      'SELECT character_count, total_chunks FROM ingestion_documents WHERE id = ?',
      [documentId]
    );
    const coverage = document && document.character_count > 0
      ? Math.min(1, coveredCharacterCount(successful) / document.character_count)
      : 0;
    const remainingFailed = await ctx.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ingestion_chunks WHERE document_id = ? AND status = 'failed'`,
      [documentId]
    );
    const processed = await ctx.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM ingestion_chunks WHERE document_id = ? AND status = 'success'`,
      [documentId]
    );
    const status = (remainingFailed?.count || 0) === 0 ? 'success' : (processed?.count || 0) > 0 ? 'partial' : 'failed';
    await ctx.db.run(
      `UPDATE ingestion_documents
       SET processed_chunks = ?, failed_chunks = ?, coverage = ?, status = ?, updated_at = ?
       WHERE id = ?`,
      [processed?.count || 0, remainingFailed?.count || 0, coverage, status, now, documentId]
    );
    updateJob(jobId, {
      retryProgress: { documentId, done: index + 1, total: chunks.length, recovered, failed, coverage },
    });
  }
  updateJob(jobId, { status: 'success', stage: 'done', completedAt: Date.now() });
}

export const handleIngestRoutes = [
  {
    method: 'POST' as const,
    path: '/api/ingest/file',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<IngestFilePayload>(req);

      const filename = (body.filename || '').toString().trim();
      const contentType = normalizeContentType(body.contentType || '');
      const base64 = body.base64 || '';

      if (!filename) return sendError(res, 400, 'filename is required');
      if (!contentType) return sendError(res, 400, 'contentType is required');
      if (!base64) return sendError(res, 400, 'base64 content is required');

      if (!isAcceptedContentType(contentType)) {
        return sendError(res, 415, `Unsupported contentType: ${contentType}`);
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64, 'base64');
      } catch {
        return sendError(res, 400, 'Invalid base64 payload');
      }

      if (buffer.length === 0) return sendError(res, 400, 'Decoded file is empty');
      if (buffer.length > MAX_INGEST_BYTES) return sendError(res, 413, `File too large. Limit is ${MAX_INGEST_BYTES} bytes`);

      const job = createJob(filename);

      // Fire-and-forget async pipeline
      setImmediate(() => {
        runIngestPipeline(job.jobId, filename, contentType, base64, buffer, ctx);
      });

      sendResponse(res, 200, { jobId: job.jobId, status: job.status, filename: job.filename });
    },
  },
  {
    method: 'POST' as const,
    path: '/api/ingest/job/:jobId/cancel',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, _ctx: RequestContext, params: Record<string, string>) => {
      const jobId = params.jobId;
      if (!jobId) return sendError(res, 400, 'jobId is required');

      const job = jobStore.get(jobId);
      if (!job) return sendError(res, 404, 'Job not found or expired');

      if (job.status !== 'running' && job.status !== 'queued') {
        return sendError(res, 409, `Cannot cancel job in status: ${job.status}`);
      }

      job.aborted = true;
      sendResponse(res, 200, { jobId, status: 'cancelling' });
    },
  },
  {
    method: 'GET' as const,
    path: '/api/ingest/job/:jobId',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, _ctx: RequestContext, params: Record<string, string>) => {
      const jobId = params.jobId;
      if (!jobId) return sendError(res, 400, 'jobId is required');

      const job = getJob(jobId);
      if (!job) return sendError(res, 404, 'Job not found or expired');

      sendResponse(res, 200, {
        jobId: job.jobId,
        status: job.status,
        stage: job.stage,
        filename: job.filename,
        result: job.result,
        importProgress: job.importProgress,
        retryProgress: job.retryProgress,
        error: job.error,
      });
    },
  },
  {
    method: 'POST' as const,
    path: '/api/ingest/document/:documentId/retry',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const documentId = params.documentId;
      const document = await ctx.db.get<{ source: string }>(
        'SELECT source FROM ingestion_documents WHERE id = ?',
        [documentId]
      );
      if (!document) return sendError(res, 404, 'Ingestion document not found');
      const failed = await ctx.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ingestion_chunks WHERE document_id = ? AND status = 'failed'`,
        [documentId]
      );
      if (!failed?.count) return sendResponse(res, 200, { documentId, retried: 0, status: 'already_complete' });
      const job = createJob(`retry:${document.source}`);
      setImmediate(() => runFailedChunkRetry(job.jobId, documentId, ctx));
      sendResponse(res, 202, { jobId: job.jobId, documentId, retrying: failed.count });
    },
  },
  {
    method: 'POST' as const,
    path: '/api/import/chat',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{ base64?: string; text?: string; maxConversations?: number }>(req);
      let raw = '';
      if (body.text) raw = body.text;
      else if (body.base64) {
        try { raw = Buffer.from(body.base64, 'base64').toString('utf-8'); } catch { return sendError(res, 400, 'Invalid base64'); }
      } else return sendError(res, 400, '需要 base64 或 text');

      let parsed;
      try { parsed = parseChatExport(raw); } catch (e: any) { return sendError(res, 400, e?.message || '解析失败'); }

      const convs = parsed.conversations.filter((c) => c.text && c.text.trim());
      if (convs.length === 0) return sendError(res, 400, '没有可导入的对话');
      // 新→旧，截断（默认最多 100 段，避免一次性几百次 LLM 抽取）
      convs.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      // 默认全部导入（用户用便宜模型）；可指定 maxConversations 限制。绝对上限 5000 防跑飞。
      const cap = body.maxConversations
        ? Math.max(1, Math.min(Number(body.maxConversations), 5000))
        : Math.min(convs.length, 5000);
      const capped = convs.slice(0, cap);

      const job = createJob(`import:${parsed.platform}`);
      setImmediate(() => runImportPipeline(job.jobId, capped, parsed.platform, ctx));
      sendResponse(res, 200, { jobId: job.jobId, platform: parsed.platform, parsed: convs.length, importing: capped.length });
    },
  },
];
