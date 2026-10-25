import http from 'http';
import { HttpError, RequestContext, parseBody, sendResponse, sendError } from '../routes.js';
import type { ImportJobReceipt } from '../../db/sqlite.js';
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
  useLocalExtraction?: boolean;
}

type ExtractionMode = 'default' | 'local_only' | 'unknown';
type PersistedExtractionMode = Exclude<ExtractionMode, 'unknown'>;
const LOCAL_ONLY_REMOTE_EMBEDDINGS = 'LOCAL_ONLY_REMOTE_EMBEDDINGS';
const UNKNOWN_EXTRACTION_MODE = 'UNKNOWN_EXTRACTION_MODE_NEEDS_REIMPORT';
const UNKNOWN_EXTRACTION_MODE_MESSAGE = 'This retry was not started because the saved task does not record whether extraction used configured AI or local-only processing. No AI or embedding request was sent. Re-import the source, explicitly choose the processing mode, and confirm before starting again.';

function normalizedExtractionMode(value: unknown): ExtractionMode {
  return value === 'local_only' || value === 'default' ? value : 'unknown';
}

function extractionModeFromRequest(value: unknown): PersistedExtractionMode | null {
  if (value !== undefined && typeof value !== 'boolean') return null;
  return value === true ? 'local_only' : 'default';
}

function isLocalOnly(mode: ExtractionMode): boolean {
  return mode === 'local_only';
}

function rejectRemoteEmbeddingLocalOnly(res: http.ServerResponse): void {
  sendResponse(res, 409, {
    error: LOCAL_ONLY_REMOTE_EMBEDDINGS,
    error_code: LOCAL_ONLY_REMOTE_EMBEDDINGS,
  });
}

function rejectUnknownExtractionMode(res: http.ServerResponse): void {
  sendResponse(res, 409, {
    error: UNKNOWN_EXTRACTION_MODE,
    error_code: UNKNOWN_EXTRACTION_MODE,
    message: UNKNOWN_EXTRACTION_MODE_MESSAGE,
    action: 'reimport_with_explicit_mode',
  });
}

function hasRemoteEmbeddings(ctx: RequestContext): boolean {
  // Local-only is allowed only when the server positively confirms local mode.
  // Missing/stub/unknown capability is not evidence that no network call occurs.
  return ctx.embeddingService.getConfiguredMode?.() !== 'local';
}

function failedTaskExtractionMode(payloadSnapshot: string | null | undefined): ExtractionMode {
  try {
    const payload = JSON.parse(payloadSnapshot || '{}') as { extractionMode?: unknown };
    return normalizedExtractionMode(payload.extractionMode);
  } catch {
    return 'unknown';
  }
}

function commonFailedTaskExtractionMode(tasks: Array<{ payload_snapshot?: string | null }>): ExtractionMode {
  const modes = tasks.map((task) => failedTaskExtractionMode(task.payload_snapshot));
  if (modes.length === 0 || modes[0] === 'unknown' || modes.some((mode) => mode !== modes[0])) return 'unknown';
  return modes[0];
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

type JobStatus = 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled';
type JobStage = 'parsing' | 'ocr' | 'extracting' | 'resolving' | 'storing' | 'done' | 'receipt_unavailable';

interface JobState {
  jobId: string;
  status: JobStatus;
  stage?: JobStage;
  filename: string;
  extractionMode?: ExtractionMode;
  createdAt: number;
  completedAt?: number;
  aborted?: boolean;
  result?: {
    entities: number;
    relationships: number;
    principles: number;
      failure_count?: number;
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
    failed_conversations?: Array<{ title: string; error: string }>;
    conflict_failures?: Array<{ title: string; error: string }>;
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

function receiptFromJob(job: JobState): ImportJobReceipt {
  const chunking = job.result?.chunking;
  const chunkFailures = job.retryProgress?.failed ?? chunking?.failedChunks.length ?? 0;
  const failures = job.result?.failure_count ?? (job.retryProgress
    ? job.retryProgress.failed
    : (job.result?.failed_conversations?.length ?? 0)
      + (job.result?.conflict_failures?.length ?? 0)
      + chunkFailures);
  const hasResult = Boolean(job.result || job.retryProgress);

  return {
    job_id: job.jobId,
    status: job.status,
    extraction_mode: normalizedExtractionMode(job.extractionMode),
    stage: job.stage,
    created_at: job.createdAt,
    completed_at: job.completedAt,
    import_progress: job.importProgress ? { ...job.importProgress } : undefined,
    retry_progress: job.retryProgress ? {
      done: job.retryProgress.done,
      total: job.retryProgress.total,
      recovered: job.retryProgress.recovered,
      failed: job.retryProgress.failed,
      coverage: job.retryProgress.coverage,
    } : undefined,
    result: hasResult ? {
      entities: job.result?.entities ?? job.importProgress?.entities ?? 0,
      relationships: job.result?.relationships ?? 0,
      principles: job.result?.principles ?? 0,
      failure_count: failures,
      ...(chunking ? {
        chunk_total: chunking.totalChunks,
        chunk_processed: chunking.processedChunks,
        chunk_failures: chunkFailures,
        chunk_coverage: chunking.coverage,
      } : {}),
    } : undefined,
    error_code: job.status === 'failed' ? 'job_failed' : undefined,
    updated_at: Date.now(),
  };
}

async function createJob(
  filename: string,
  db: RequestContext['db'],
  extractionMode: ExtractionMode = 'default',
): Promise<JobState> {
  const job = createJobInMemory(filename, extractionMode);
  try {
    await db.saveImportJobReceipt(receiptFromJob(job));
    return job;
  } catch {
    jobStore.delete(job.jobId);
    throw new Error('Could not safely start the import task');
  }
}

function createJobInMemory(filename: string, extractionMode: ExtractionMode = 'default'): JobState {
  // Capacity protection: remove oldest completed/failed jobs first
  if (jobStore.size >= MAX_JOBS) {
    const entries = [...jobStore.entries()]
      .sort((a, b) => (a[1].completedAt || a[1].createdAt) - (b[1].completedAt || b[1].createdAt));
    for (const [id, job] of entries) {
      if (job.status === 'success' || job.status === 'partial' || job.status === 'failed' || job.status === 'cancelled') {
        jobStore.delete(id);
        if (jobStore.size < MAX_JOBS) break;
      }
    }
    // Never evict active work: the pipeline checkpoints through this map and
    // losing an active entry can cancel a write or make a live job look like
    // an app-restart interruption. Back-pressure the caller instead.
    if (jobStore.size >= MAX_JOBS) {
      throw new HttpError(429, 'Too many active import tasks. Wait for a task to finish before starting another.');
    }
  }

  const jobId = uuidv4();
  const job: JobState = {
    jobId,
    status: 'queued',
    filename,
    extractionMode,
    createdAt: Date.now(),
  };
  jobStore.set(jobId, job);
  return job;
}

async function updateJob(jobId: string, updates: Partial<JobState>, db: RequestContext['db']): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job) return;
  Object.assign(job, updates);
  try {
    await db.saveImportJobReceipt(receiptFromJob(job));
  } catch {
    // Receipt persistence is best-effort after the task starts; never echo
    // source data or database details into logs or the API response.
    console.warn('[Ingest] Could not update the privacy-minimal job receipt');
    if (updates.status === 'success' || updates.status === 'partial'
      || updates.status === 'failed' || updates.status === 'cancelled') {
      job.status = 'partial';
      job.stage = 'receipt_unavailable';
      job.error = 'The import finished, but its status could not be safely saved. Review your library before importing again.';
    }
  }
}

function responseFromReceipt(receipt: ImportJobReceipt) {
  const interrupted = receipt.status === 'queued' || receipt.status === 'running'
    || receipt.error_code === 'process_interrupted';
  return {
    jobId: receipt.job_id,
    status: interrupted ? 'partial' : receipt.status,
    stage: interrupted ? 'interrupted' : receipt.stage,
    extractionMode: receipt.extraction_mode ?? 'unknown',
    importProgress: receipt.import_progress,
    retryProgress: receipt.retry_progress,
    result: receipt.result ? {
      entities: receipt.result.entities,
      relationships: receipt.result.relationships,
      principles: receipt.result.principles,
      failure_count: receipt.result.failure_count,
      summary: interrupted
        ? 'This import was interrupted. Review your library before importing again.'
        : receipt.result.failure_count > 0
          ? 'Import completed with some items needing review.'
          : receipt.status === 'success' ? 'Import completed.' : 'Import status restored.',
      ...(receipt.result.chunk_total !== undefined ? {
        chunking: {
          totalChunks: receipt.result.chunk_total,
          processedChunks: receipt.result.chunk_processed ?? 0,
          failedCount: receipt.result.chunk_failures ?? 0,
          coverage: receipt.result.chunk_coverage ?? 0,
        },
      } : {}),
    } : interrupted ? {
      summary: 'This import was interrupted. Review your library before importing again.',
    } : undefined,
    error: interrupted || receipt.error_code === 'process_interrupted'
      ? 'This import was interrupted by an app restart. Review your library before importing again.'
      : receipt.error_code === 'job_failed' ? 'Import failed. Review your library before retrying.' : undefined,
  };
}

async function scheduleJob(jobId: string, db: RequestContext['db'], run: () => Promise<void>): Promise<void> {
  setImmediate(() => {
    void run().catch(async () => {
      await updateJob(jobId, {
        status: 'failed',
        stage: 'done',
        completedAt: Date.now(),
        error: 'Import processing failed unexpectedly',
      }, db);
    });
  });
}

function getJob(jobId: string): JobState | null {
  const job = jobStore.get(jobId);
  if (!job) return null;

  // Cleanup: remove terminal jobs older than the in-memory TTL.
  if ((job.status === 'success' || job.status === 'partial' || job.status === 'failed' || job.status === 'cancelled') && job.completedAt) {
    if (Date.now() - job.completedAt > JOB_TTL_MS) {
      jobStore.delete(jobId);
      return null;
    }
  }
  return job;
}

// --- Async Pipeline Runner ---

async function runIngestPipeline(
  jobId: string,
  filename: string,
  contentType: string,
  base64: string,
  buffer: Buffer,
  extractionMode: PersistedExtractionMode,
  ctx: RequestContext,
): Promise<void> {
  const FAIL = async (stage: JobStage, error: string) => {
    await updateJob(jobId, { status: 'failed', stage, completedAt: Date.now(), error }, ctx.db);
  };

  const CANCEL = async () => {
    await updateJob(jobId, { status: 'cancelled', stage: undefined, completedAt: Date.now() }, ctx.db);
  };

  const CHECK_ABORT = (): boolean => {
    const j = jobStore.get(jobId);
    return !!(j?.aborted);
  };

  const isImage = IMAGE_CONTENT_TYPES.has(contentType) || contentType.startsWith('image/');

  // Stage: parsing
  if (CHECK_ABORT()) return CANCEL();
  await updateJob(jobId, { status: 'running', stage: 'parsing' }, ctx.db);
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
      await updateJob(jobId, { stage: 'ocr' }, ctx.db);
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
  await updateJob(jobId, { stage: 'extracting' }, ctx.db);
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
      useLocalExtraction: isLocalOnly(extractionMode),
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
             processed_chunks, failed_chunks, coverage, status, created_at, updated_at,
             extraction_mode
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            extractionMode,
          ]
        );
        for (const chunk of extractResult.chunking!.chunks) {
          const error = failures.get(chunk.chunk_id);
          await ctx.db.run(
            `INSERT OR REPLACE INTO ingestion_chunks (
               id, document_id, ordinal, source, content, source_span, start_offset,
               end_offset, source_timestamp, status, attempts, error, extracted_at,
               created_at, updated_at, extraction_mode
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
              extractionMode,
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
  await updateJob(jobId, { stage: 'resolving' }, ctx.db);
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
    await resolveConflicts(resolution.relationshipsToCreate, ctx.db, ctx.extractor, {
      localOnly: isLocalOnly(extractionMode),
    });
  } catch (err) {
    return FAIL('resolving', `Transactional conflict resolution failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Assertions：用消解后的实体 ID 写入事实层（实体→实体 或 实体→字面值）
  for (const a of extractResult.assertions || []) {
    const subjectId = resolution.idMap[a.subject_id] || a.subject_id;
    const objectId = a.object_id ? (resolution.idMap[a.object_id] || a.object_id) : undefined;
    try {
      await ctx.db.addAssertion({ ...a, subject_id: subjectId, object_id: objectId });
    } catch (err) {
      console.warn('[Ingest] assertion write failed:', err);
    }
  }

  // Stage: storing
  if (CHECK_ABORT()) return CANCEL();
  await updateJob(jobId, { stage: 'storing' }, ctx.db);

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
  await updateJob(jobId, {
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
  }, ctx.db);
}

// 导入：把解析好的对话逐段喂抽取管线。把会话原始时间写进 created_at（历史也能时间召回），
// 打 provenance.source='import'。逐段容错，单段失败不影响其余。
// 关系写入走 resolveConflicts（内部会 addRelationship + 冲突检测 + 审计），不直接 addRelationship。
async function runImportPipeline(
  jobId: string,
  conversations: ParsedConversation[],
  platform: string,
  extractionMode: PersistedExtractionMode,
  ctx: RequestContext,
): Promise<void> {
  // 幂等键：jobId 本身是 UUID，复用为 import_batch_id。重试同一批次时若已写入则跳过。
  const importBatchId = jobId;
  try {
    const existing = await ctx.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM entities WHERE metadata LIKE ?`,
      [`%"import_batch_id":"${importBatchId}"%`]
    );
    if (existing && existing.count > 0) {
      await updateJob(jobId, {
        status: 'success', stage: 'done', completedAt: Date.now(),
        importProgress: { done: conversations.length, total: conversations.length, entities: 0 },
        result: { entities: 0, relationships: 0, principles: 0, archivalId: '', summary: `Batch ${importBatchId} already imported (idempotent skip)` },
      }, ctx.db);
      return;
    }
  } catch (err) {
    console.warn('[Import] idempotency check failed, proceeding:', err);
  }

  await updateJob(jobId, { status: 'running', stage: 'extracting', importProgress: { done: 0, total: conversations.length, entities: 0 } }, ctx.db);
  let done = 0;
  let entityCount = 0;
  let relationshipCount = 0;
  const savedEntityIds = new Set<string>();
  const recordSavedEntity = (entity: Entity): void => {
    savedEntityIds.add(entity.id);
    entityCount = savedEntityIds.size;
  };
  // This initial-import runner owns its write boundaries and has no outer
  // transaction. Keep the resolver's other callers' transaction semantics intact.
  const persistEntity = (entity: Entity): Promise<Entity> =>
    ctx.db.withTransaction(() => ctx.db.addEntity(entity));
  const resolutionOptions = { persistEntity, onEntityPersisted: recordSavedEntity };
  const failedConversations: Array<{ title: string; error: string }> = [];
  const conflictFailures: Array<{ title: string; error: string }> = [];
  for (const conv of conversations) {
    const job = jobStore.get(jobId);
    if (!job || job.aborted) { await updateJob(jobId, { status: 'cancelled', completedAt: Date.now() }, ctx.db); return; }
    if (conv.text && conv.text.trim().length >= 10) {
      try {
        const documentId = `${jobId}:${done}`;
        const extractResult = await ctx.extractor.extract({
          textContent: `对话标题：${conv.title}\n${conv.text}`,
          timestamp: conv.time || new Date().toISOString(),
          sourceType: 'manual',
          documentId,
          source: `import:${platform}:${conv.title}`,
          useLocalExtraction: isLocalOnly(extractionMode),
        });
        const prov = {
          source: 'import',
          platform,
          title: conv.title,
          at: new Date().toISOString(),
          import_batch_id: importBatchId,
          conversation_id: conv.title,
          document_id: documentId,
          original_timestamp: conv.time,
        };
        const decorateImportedEntity = (e: Entity): void => {
          if (conv.time) e.created_at = conv.time;
          e.tags = Array.from(new Set([...(e.tags || []), 'imported', `import:${platform}`]));
          e.metadata = { ...(e.metadata || {}), provenance: { ...(e.metadata?.provenance || {}), ...prov } };
        };
        // Resolution can persist review candidates itself, so provenance must be
        // attached before entering it, not only to its returned planned creates.
        for (const entity of extractResult.entities) decorateImportedEntity(entity);
        const resolution = await resolveEntities(extractResult.entities, extractResult.relationships, ctx.db, ctx.embeddingService, resolutionOptions);
        for (const e of resolution.entitiesToCreate) {
          decorateImportedEntity(e);
          recordSavedEntity(await persistEntity(e));
        }
        for (const u of resolution.entitiesToUpdate) {
          await ctx.db.updateEntity(u.id, { description: u.description, tags: u.tags, embedding: u.embedding, metadata: u.metadata, created_at: u.created_at, access_count: u.access_count });
        }
        // 关系走冲突消解管线：resolveConflicts 内部会 addRelationship + 检测冲突 + 失效旧关系 + 审计
        for (const r of resolution.relationshipsToCreate) {
          r.provenance = { ...(r.provenance || {}), ...prov };
        }
        try {
          // Each relationship commits independently. Count only completed writes,
          // retaining earlier commits if a later relationship fails and rolls back.
          for (const relationship of resolution.relationshipsToCreate) {
            const saved = await resolveConflicts([relationship], ctx.db, ctx.extractor, {
              localOnly: isLocalOnly(extractionMode),
            });
            relationshipCount += saved.length;
          }
        } catch (err) {
          // Conflict resolution failure is a real failure — record it, do not silently continue.
          const errMsg = err instanceof Error ? err.message : String(err);
          conflictFailures.push({ title: conv.title, error: errMsg });
          const errorKind = err instanceof Error ? err.name : typeof err;
          console.error('[Import] conflict resolution failed:', errorKind);
          // Task 5: Persist to failed_tasks so it survives jobStore TTL and can be retried.
          try {
            await ctx.db.recordFailedTask({
              task_id: uuidv4(),
              batch_id: importBatchId,
              task_type: 'conflict_resolution',
              conversation_title: conv.title,
              stage: 'resolving',
              error: errMsg,
              payload_snapshot: JSON.stringify({
                title: conv.title,
                text: conv.text,
                time: conv.time,
                platform,
                documentId,
                extractionMode,
              }),
            });
          } catch (persistErr) {
            console.warn('[Import] failed to persist conflict_resolution failure:', persistErr);
          }
        }
        for (const a of extractResult.assertions || []) {
          const subjectId = resolution.idMap[a.subject_id] || a.subject_id;
          const objectId = a.object_id ? (resolution.idMap[a.object_id] || a.object_id) : undefined;
          try {
            await ctx.db.addAssertion({ ...a, subject_id: subjectId, object_id: objectId });
          } catch (err) {
            console.warn('[Import] assertion write failed:', err);
          }
        }
        const pnow = conv.time || new Date().toISOString();
        for (const p of extractResult.principles) {
          const pe: Entity = {
            id: uuidv4(), name: p.title, type: 'principle', description: p.content,
            created_at: pnow, updated_at: pnow, last_accessed: pnow, access_count: 0,
            tags: ['imported', `import:${platform}`, p.type],
            metadata: { isCore: false, principleType: p.type, provenance: prov },
          };
          decorateImportedEntity(pe);
          const pr = await resolveEntities([pe], [], ctx.db, ctx.embeddingService, resolutionOptions);
          for (const e of pr.entitiesToCreate) { recordSavedEntity(await persistEntity(e)); }
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        failedConversations.push({ title: conv.title, error: errMsg });
        const errorKind = err instanceof Error ? err.name : typeof err;
        console.error('[Import] conversation processing failed:', errorKind);
        // Task 5: Persist to failed_tasks so it survives jobStore TTL and can be retried.
        try {
          await ctx.db.recordFailedTask({
            task_id: uuidv4(),
            batch_id: importBatchId,
            task_type: 'chat_import',
            conversation_title: conv.title,
            stage: 'extracting',
            error: errMsg,
            payload_snapshot: JSON.stringify({
              title: conv.title,
              text: conv.text,
              time: conv.time,
              platform,
              extractionMode,
            }),
          });
        } catch (persistErr) {
          console.warn('[Import] failed to persist chat_import failure:', persistErr);
        }
      }
    }
    done++;
    await updateJob(jobId, { importProgress: { done, total: conversations.length, entities: entityCount } }, ctx.db);
  }
  // Job status accurately distinguishes success/partial/failed.
  const totalFailures = failedConversations.length + conflictFailures.length;
  const finalStatus = totalFailures === 0
    ? 'success'
    : totalFailures < conversations.length
      ? 'partial'
      : 'failed';
  await updateJob(jobId, {
    status: finalStatus, stage: 'done', completedAt: Date.now(),
    importProgress: { done, total: conversations.length, entities: entityCount },
    result: {
      entities: entityCount, relationships: relationshipCount, principles: 0, archivalId: '',
      failure_count: totalFailures,
      summary: `Imported ${done - totalFailures}/${conversations.length} conversations`,
      failed_conversations: failedConversations,
      conflict_failures: conflictFailures,
    },
  }, ctx.db);
}

// Task 5: Retry persisted chat-import failures from the failed_tasks table.
// Reads pending tasks for a batch, reconstructs the conversation from
// payload_snapshot, re-runs extraction + resolution, and updates task status.
async function runFailedImportRetry(jobId: string, batchId: string, ctx: RequestContext): Promise<void> {
  const tasks = await ctx.db.getFailedTasks(batchId, 'pending');
  const total = tasks.length;
  let recovered = 0;
  let stillFailing = 0;
  let entityCount = 0;
  let relationshipCount = 0;
  const savedEntityIds = new Set<string>();
  const recordSavedEntity = (entity: Entity): void => {
    savedEntityIds.add(entity.id);
    entityCount = savedEntityIds.size;
  };
  const persistEntity = (entity: Entity): Promise<Entity> =>
    ctx.db.withTransaction(() => ctx.db.addEntity(entity));

  await updateJob(jobId, {
    status: 'running',
    stage: 'extracting',
    importProgress: { done: 0, total, entities: entityCount },
  }, ctx.db);

  for (const [index, task] of tasks.entries()) {
    const job = jobStore.get(jobId);
    if (!job || job.aborted) {
      await updateJob(jobId, { status: 'cancelled', completedAt: Date.now() }, ctx.db);
      return;
    }

    let payload: {
      title?: string;
      text?: string;
      time?: string;
      platform?: string;
      documentId?: string;
      extractionMode?: unknown;
    };
    try {
      payload = JSON.parse(task.payload_snapshot || '{}');
    } catch {
      payload = {};
    }

    const extractionMode = normalizedExtractionMode(payload.extractionMode);
    if (extractionMode === 'unknown') {
      await ctx.db.updateFailedTaskStatus(task.task_id, 'pending', UNKNOWN_EXTRACTION_MODE_MESSAGE);
      stillFailing++;
      await updateJob(jobId, { importProgress: { done: index + 1, total, entities: entityCount } }, ctx.db);
      continue;
    }

    await ctx.db.updateFailedTaskStatus(task.task_id, 'retrying');

    try {
      const convTitle = payload.title || task.conversation_title || 'unknown';
      const convText = payload.text || '';
      const convTime = payload.time;
      const platform = payload.platform || 'unknown';
      const documentId = payload.documentId || `${batchId}:retry:${task.task_id}`;
      const localOnly = isLocalOnly(extractionMode);

      const extractResult = await ctx.extractor.extract({
        textContent: `对话标题：${convTitle}\n${convText}`,
        timestamp: convTime || new Date().toISOString(),
        sourceType: 'manual',
        documentId,
        source: `import-retry:${platform}:${convTitle}`,
        useLocalExtraction: localOnly,
      });

      const prov = {
        source: 'import-retry',
        platform,
        title: convTitle,
        at: new Date().toISOString(),
        import_batch_id: batchId,
        conversation_id: convTitle,
        document_id: documentId,
        original_timestamp: convTime,
        retry_of: task.task_id,
      };

      const decorateImportedEntity = (entity: Entity): void => {
        if (convTime) entity.created_at = convTime;
        entity.tags = Array.from(new Set([...(entity.tags || []), 'imported', `import:${platform}`, 'retry']));
        entity.metadata = {
          ...(entity.metadata || {}),
          provenance: { ...(entity.metadata?.provenance || {}), ...prov },
        };
      };
      // The resolver can persist manual-review candidates internally. Attach
      // provenance before resolution so those records are source-verifiable.
      for (const entity of extractResult.entities) decorateImportedEntity(entity);
      const resolution = await resolveEntities(
        extractResult.entities,
        extractResult.relationships,
        ctx.db,
        ctx.embeddingService,
        { persistEntity, onEntityPersisted: recordSavedEntity },
      );
      for (const e of resolution.entitiesToCreate) {
        decorateImportedEntity(e);
        recordSavedEntity(await persistEntity(e));
      }
      for (const u of resolution.entitiesToUpdate) {
        await ctx.db.updateEntity(u.id, { description: u.description, tags: u.tags, embedding: u.embedding, metadata: u.metadata, created_at: u.created_at, access_count: u.access_count });
      }

      if (task.task_type === 'conflict_resolution' || resolution.relationshipsToCreate.length > 0) {
        for (const r of resolution.relationshipsToCreate) {
          r.provenance = { ...(r.provenance || {}), ...prov };
        }
        try {
          // Keep earlier committed relationships in the retry receipt if a later
          // relationship in the same conversation fails.
          for (const relationship of resolution.relationshipsToCreate) {
            relationshipCount += (await resolveConflicts([relationship], ctx.db, ctx.extractor, {
              localOnly,
            })).length;
          }
        } catch (err) {
          // Conflict resolution still failing — keep the task as pending for another attempt.
          const errMsg = err instanceof Error ? err.message : String(err);
          await ctx.db.updateFailedTaskStatus(task.task_id, 'pending', `retry ${task.attempts + 1}: ${errMsg}`);
          stillFailing++;
          await updateJob(jobId, { importProgress: { done: index + 1, total, entities: entityCount } }, ctx.db);
          continue;
        }
      }

      for (const a of extractResult.assertions || []) {
        const subjectId = resolution.idMap[a.subject_id] || a.subject_id;
        const objectId = a.object_id ? (resolution.idMap[a.object_id] || a.object_id) : undefined;
        try {
          await ctx.db.addAssertion({ ...a, subject_id: subjectId, object_id: objectId });
        } catch (err) {
          console.warn('[Import-Retry] assertion write failed:', err);
        }
      }

      await ctx.db.updateFailedTaskStatus(task.task_id, 'resolved');
      recovered++;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      // Mark as permanent_failure after 3 attempts to avoid infinite retry loops.
      const newStatus = task.attempts + 1 >= 3 ? 'permanent_failure' : 'pending';
      await ctx.db.updateFailedTaskStatus(task.task_id, newStatus, `retry ${task.attempts + 1}: ${errMsg}`);
      stillFailing++;
      console.error(`[Import-Retry] task ${task.task_id} still failing:`, errMsg);
    }

    await updateJob(jobId, { importProgress: { done: index + 1, total, entities: entityCount } }, ctx.db);
  }

  const finalStatus = stillFailing === 0 ? 'success' : stillFailing < total ? 'partial' : 'failed';
  await updateJob(jobId, {
    status: finalStatus,
    stage: 'done',
    completedAt: Date.now(),
    importProgress: { done: total, total, entities: entityCount },
    result: {
      entities: entityCount,
      relationships: relationshipCount,
      principles: 0,
      failure_count: stillFailing,
      archivalId: '',
      summary: `Retry: ${recovered}/${total} recovered, ${stillFailing} still failing`,
    },
  }, ctx.db);
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
  extraction_mode?: string | null;
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
  if (chunks.some((chunk) => normalizedExtractionMode(chunk.extraction_mode) === 'unknown')) {
    const message = UNKNOWN_EXTRACTION_MODE_MESSAGE;
    const now = new Date().toISOString();
    await ctx.db.run(
      `UPDATE ingestion_chunks SET error = ?, updated_at = ?
       WHERE document_id = ? AND status = 'failed'
         AND (extraction_mode IS NULL OR extraction_mode NOT IN ('default', 'local_only'))`,
      [message, now, documentId],
    );
    await updateJob(jobId, {
      status: 'failed',
      stage: 'done',
      completedAt: Date.now(),
      error: message,
      retryProgress: { documentId, done: 0, total: chunks.length, recovered, failed: chunks.length, coverage: 0 },
    }, ctx.db);
    return;
  }
  await updateJob(jobId, {
    status: 'running',
    stage: 'extracting',
    retryProgress: { documentId, done: 0, total: chunks.length, recovered, failed, coverage: 0 },
  }, ctx.db);

  for (const [index, chunk] of chunks.entries()) {
    const job = jobStore.get(jobId);
    if (!job || job.aborted) {
      await updateJob(jobId, { status: 'cancelled', completedAt: Date.now() }, ctx.db);
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
      const extractionMode = normalizedExtractionMode(chunk.extraction_mode);
      const localOnly = isLocalOnly(extractionMode);
      const result = await ctx.extractor.extract({
        textContent: chunk.content,
        timestamp: chunk.source_timestamp,
        sourceType: 'manual',
        documentId,
        source: chunk.source,
        requireLlmSuccess: !localOnly,
        useLocalExtraction: localOnly,
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
      await resolveConflicts(resolution.relationshipsToCreate, ctx.db, ctx.extractor, { localOnly });
      for (const a of result.assertions || []) {
        const subjectId = resolution.idMap[a.subject_id] || a.subject_id;
        const objectId = a.object_id ? (resolution.idMap[a.object_id] || a.object_id) : undefined;
        try {
          await ctx.db.addAssertion({ ...a, subject_id: subjectId, object_id: objectId });
        } catch (err) {
          console.warn('[Retry] assertion write failed:', err);
        }
      }

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
    await updateJob(jobId, {
      retryProgress: { documentId, done: index + 1, total: chunks.length, recovered, failed, coverage },
    }, ctx.db);
  }
  const finalStatus = failed === 0 ? 'success' : recovered > 0 ? 'partial' : 'failed';
  const finalCoverage = jobStore.get(jobId)?.retryProgress?.coverage ?? 0;
  await updateJob(jobId, {
    status: finalStatus,
    stage: 'done',
    completedAt: Date.now(),
    result: {
      entities: 0,
      relationships: 0,
      principles: 0,
      failure_count: failed,
      archivalId: '',
      summary: `Retry: ${recovered}/${chunks.length} chunks recovered, ${failed} still failing`,
      chunking: {
        totalChunks: chunks.length,
        processedChunks: recovered,
        failedChunks: [],
        coverage: finalCoverage,
        truncated: false,
      },
    },
  }, ctx.db);
}

export const handleIngestRoutes = [
  {
    method: 'POST' as const,
    path: '/api/ingest/file',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<IngestFilePayload>(req);
      const extractionMode = extractionModeFromRequest(body.useLocalExtraction);
      if (!extractionMode) return sendError(res, 400, 'useLocalExtraction must be a boolean');

      const filename = (body.filename || '').toString().trim();
      const contentType = normalizeContentType(body.contentType || '');
      const base64 = body.base64 || '';

      if (!filename) return sendError(res, 400, 'filename is required');
      if (!contentType) return sendError(res, 400, 'contentType is required');
      if (!base64) return sendError(res, 400, 'base64 content is required');

      if (!isAcceptedContentType(contentType)) {
        return sendError(res, 415, `Unsupported contentType: ${contentType}`);
      }

      if (isLocalOnly(extractionMode) && hasRemoteEmbeddings(ctx)) {
        return rejectRemoteEmbeddingLocalOnly(res);
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64, 'base64');
      } catch {
        return sendError(res, 400, 'Invalid base64 payload');
      }

      if (buffer.length === 0) return sendError(res, 400, 'Decoded file is empty');
      if (buffer.length > MAX_INGEST_BYTES) return sendError(res, 413, `File too large. Limit is ${MAX_INGEST_BYTES} bytes`);

      const job = await createJob(filename, ctx.db, extractionMode);
      await scheduleJob(job.jobId, ctx.db, () => runIngestPipeline(
        job.jobId, filename, contentType, base64, buffer, extractionMode, ctx,
      ));

      sendResponse(res, 200, { jobId: job.jobId, status: job.status, filename: job.filename });
    },
  },
  {
    method: 'POST' as const,
    path: '/api/ingest/job/:jobId/cancel',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const jobId = params.jobId;
      if (!jobId) return sendError(res, 400, 'jobId is required');

      const job = jobStore.get(jobId);
      if (!job) return sendError(res, 404, 'Job not found or expired');

      if (job.status !== 'running' && job.status !== 'queued') {
        return sendError(res, 409, `Cannot cancel job in status: ${job.status}`);
      }

      job.aborted = true;
      await updateJob(jobId, {}, ctx.db);
      sendResponse(res, 200, { jobId, status: 'cancelling' });
    },
  },
  {
    method: 'GET' as const,
    path: '/api/ingest/job/:jobId',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const jobId = params.jobId;
      if (!jobId) return sendError(res, 400, 'jobId is required');

      const job = getJob(jobId);
      if (job) {
        sendResponse(res, 200, {
          jobId: job.jobId,
          status: job.status,
          stage: job.stage,
          filename: job.filename,
          extractionMode: normalizedExtractionMode(job.extractionMode),
          result: job.result,
          importProgress: job.importProgress,
          retryProgress: job.retryProgress,
          error: job.error,
        });
        return;
      }

      let receipt = await ctx.db.getImportJobReceipt(jobId);
      if (!receipt || Date.now() - receipt.updated_at > 30 * 24 * 60 * 60 * 1000) {
        return sendError(res, 404, 'Job not found or expired');
      }

      if (receipt.status === 'queued' || receipt.status === 'running') {
        receipt = {
          ...receipt,
          status: 'partial',
          stage: 'interrupted',
          completed_at: Date.now(),
          error_code: 'process_interrupted',
          updated_at: Date.now(),
        };
        await ctx.db.saveImportJobReceipt(receipt);
      }

      sendResponse(res, 200, responseFromReceipt(receipt));
    },
  },
  {
    method: 'POST' as const,
    path: '/api/ingest/document/:documentId/retry',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const documentId = params.documentId;
      const document = await ctx.db.get<{ source: string; extraction_mode: string | null }>(
        'SELECT source, extraction_mode FROM ingestion_documents WHERE id = ?',
        [documentId]
      );
      if (!document) return sendError(res, 404, 'Ingestion document not found');
      const failed = await ctx.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ingestion_chunks WHERE document_id = ? AND status = 'failed'`,
        [documentId]
      );
      if (!failed?.count) return sendResponse(res, 200, { documentId, retried: 0, status: 'already_complete' });
      const extractionMode = normalizedExtractionMode(document.extraction_mode);
      const failedChunks = await ctx.db.all<{ extraction_mode: string | null }>(
        `SELECT extraction_mode FROM ingestion_chunks WHERE document_id = ? AND status = 'failed'`,
        [documentId],
      );
      if (extractionMode === 'unknown' || failedChunks.some((chunk) => normalizedExtractionMode(chunk.extraction_mode) === 'unknown')) {
        return rejectUnknownExtractionMode(res);
      }
      const hasLocalOnlyChunk = failedChunks.some((chunk) => isLocalOnly(normalizedExtractionMode(chunk.extraction_mode)));
      if ((isLocalOnly(extractionMode) || hasLocalOnlyChunk) && hasRemoteEmbeddings(ctx)) {
        return rejectRemoteEmbeddingLocalOnly(res);
      }
      const job = await createJob(`retry:${document.source}`, ctx.db, extractionMode);
      await scheduleJob(job.jobId, ctx.db, () => runFailedChunkRetry(job.jobId, documentId, ctx));
      sendResponse(res, 202, { jobId: job.jobId, documentId, retrying: failed.count });
    },
  },
  {
    method: 'POST' as const,
    path: '/api/import/chat',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{
        base64?: string;
        text?: string;
        maxConversations?: number;
        useLocalExtraction?: boolean;
      }>(req);
      const extractionMode = extractionModeFromRequest(body.useLocalExtraction);
      if (!extractionMode) return sendError(res, 400, 'useLocalExtraction must be a boolean');
      if (isLocalOnly(extractionMode) && hasRemoteEmbeddings(ctx)) {
        return rejectRemoteEmbeddingLocalOnly(res);
      }
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

      const job = await createJob(`import:${parsed.platform}`, ctx.db, extractionMode);
      await scheduleJob(job.jobId, ctx.db, () => runImportPipeline(
        job.jobId, capped, parsed.platform, extractionMode, ctx,
      ));
      sendResponse(res, 200, { jobId: job.jobId, platform: parsed.platform, parsed: convs.length, importing: capped.length });
    },
  },
  // Task 5: List persisted chat-import failures for a batch (survives jobStore TTL).
  {
    method: 'GET' as const,
    path: '/api/import/chat/failed',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      const batchId = url.searchParams.get('batchId');
      if (!batchId) return sendError(res, 400, 'batchId query parameter is required');
      const status = url.searchParams.get('status') ?? undefined;
      const tasks = await ctx.db.getFailedTasks(batchId, status || undefined);
      sendResponse(res, 200, {
        batchId,
        count: tasks.length,
        tasks: tasks.map(t => ({
          task_id: t.task_id,
          task_type: t.task_type,
          conversation_title: t.conversation_title,
          stage: t.stage,
          error: t.error,
          attempts: t.attempts,
          status: t.status,
          created_at: t.created_at,
          updated_at: t.updated_at,
        })),
      });
    },
  },
  // Task 5: Retry all pending failures for a batch.
  {
    method: 'POST' as const,
    path: '/api/import/chat/failed/:batchId/retry',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const batchId = params.batchId;
      if (!batchId) return sendError(res, 400, 'batchId is required');
      const pending = await ctx.db.getFailedTasks(batchId, 'pending');
      if (pending.length === 0) {
        return sendResponse(res, 200, { batchId, retried: 0, status: 'no_pending_failures' });
      }
      if (pending.some((task) => failedTaskExtractionMode(task.payload_snapshot) === 'unknown')) {
        return rejectUnknownExtractionMode(res);
      }
      const hasLocalOnlyTask = pending.some((task) => isLocalOnly(failedTaskExtractionMode(task.payload_snapshot)));
      if (hasLocalOnlyTask && hasRemoteEmbeddings(ctx)) {
        return rejectRemoteEmbeddingLocalOnly(res);
      }
      const extractionMode = commonFailedTaskExtractionMode(pending);
      const job = await createJob(`import-retry:${batchId}`, ctx.db, extractionMode);
      await scheduleJob(job.jobId, ctx.db, () => runFailedImportRetry(job.jobId, batchId, ctx));
      sendResponse(res, 202, { jobId: job.jobId, batchId, retrying: pending.length });
    },
  },
];
