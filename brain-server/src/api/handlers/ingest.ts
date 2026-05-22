import http from 'http';
import { RequestContext, parseBody, sendResponse, sendError } from '../routes.js';
import { OCRPipeline } from '../../ocr/pipeline.js';
import { resolveConflicts } from '../../graphrag/conflict-resolver.js';
import { resolveEntities } from '../../graphrag/entity-resolver.js';
import { v4 as uuidv4 } from 'uuid';
import { Entity } from '../../shared-types.js';

// 文件上传抽取管线（v1：仅文本类）
// 入参形态：JSON { filename, contentType, base64 }
// 复用既有的 parseBody（JSON-only），避免引入 multipart 依赖。
// 5MB 软上限；同时受 routes.ts 的 MAX_BODY_BYTES 硬上限保护。
const MAX_INGEST_BYTES = Number(process.env.INGEST_MAX_BYTES || 5 * 1024 * 1024);

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
  // text/* 全开（text/x-yaml 之类用户也可能拖进来）
  if (ct.startsWith('text/')) return true;
  // image/* 兜底（image/webp 等）
  if (ct.startsWith('image/')) return true;
  return false;
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

export const handleIngestRoutes = [
  {
    method: 'POST' as const,
    path: '/api/ingest/file',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<IngestFilePayload>(req);

      const filename = (body.filename || '').toString().trim();
      const contentType = normalizeContentType(body.contentType || '');
      const base64 = body.base64 || '';

      if (!filename) {
        return sendError(res, 400, 'filename is required');
      }
      if (!contentType) {
        return sendError(res, 400, 'contentType is required');
      }
      if (!base64) {
        return sendError(res, 400, 'base64 content is required');
      }

      if (!isAcceptedContentType(contentType)) {
        return sendError(res, 415, `Unsupported contentType: ${contentType}`);
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(base64, 'base64');
      } catch {
        return sendError(res, 400, 'Invalid base64 payload');
      }

      if (buffer.length === 0) {
        return sendError(res, 400, 'Decoded file is empty');
      }
      if (buffer.length > MAX_INGEST_BYTES) {
        return sendError(res, 413, `File too large. Limit is ${MAX_INGEST_BYTES} bytes`);
      }

      const isImage = IMAGE_CONTENT_TYPES.has(contentType) || contentType.startsWith('image/');
      let textContent = '';
      try {
        if (PDF_CONTENT_TYPES.has(contentType)) {
          textContent = await extractTextFromPdf(buffer);
        } else if (isImage) {
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
        return sendError(res, 422, `Failed to read file content: ${err?.message || err}`);
      }

      textContent = textContent.trim();
      if (!textContent) {
        const message = isImage
          ? 'No text recognized in the image'
          : 'No text content extracted from file';
        return sendError(res, 422, message);
      }

      // 抽取链路：复用现有 extractor，与 /api/graph/extract 保持一致
      const result = await ctx.extractor.extract({
        textContent: `Source file: ${filename}\n${textContent}`,
        timestamp: new Date().toISOString(),
        sourceType: 'manual',
      });

      // 实体消解与重映射
      const resolution = await resolveEntities(result.entities, result.relationships, ctx.db);

      for (const entity of resolution.entitiesToCreate) {
        await ctx.db.addEntity(entity);
      }

      for (const update of resolution.entitiesToUpdate) {
        await ctx.db.updateEntity(update.id, {
          description: update.description,
          tags: update.tags,
        });
      }

      // 自动冲突检测与消解
      try {
        await resolveConflicts(resolution.relationshipsToCreate, ctx.db, ctx.extractor);
      } catch (err) {
        console.error('[Ingest] Conflict resolution failed:', err);
      }

      for (const relationship of resolution.relationshipsToCreate) {
        await ctx.db.addRelationship(relationship);
      }

      // 原则实体同样走消解，避免重复 ingest 产生重复原则
      const principleNow = new Date().toISOString();
      const principleEntities = result.principles.map((principle): Entity => ({
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
      const principleResolution = await resolveEntities(principleEntities, [], ctx.db);
      for (const entity of principleResolution.entitiesToCreate) {
        await ctx.db.addEntity(entity);
      }
      for (const update of principleResolution.entitiesToUpdate) {
        await ctx.db.updateEntity(update.id, {
          description: update.description,
          tags: update.tags,
        });
      }

      // 原文落 archival memory，方便事后检索
      let archivalEmbedding: number[] | undefined;
      try {
        const embRes = await ctx.embeddingService.embed(textContent);
        archivalEmbedding = embRes.embedding;
      } catch (err) {
        console.warn('[Ingest] archival embedding failed:', err);
      }

      const archival = await ctx.archivalMemory.add(textContent, {
        tags: ['uploaded-file', filename],
        importance: 0.5,
        embedding: archivalEmbedding,
      });

      const summary = await ctx.extractor.summarizeEntities(result.entities);

      sendResponse(res, 200, {
        entities: result.entities.length,
        relationships: result.relationships.length,
        principles: result.principles.length,
        archivalId: archival.id,
        summary,
      });
    },
  },
];
