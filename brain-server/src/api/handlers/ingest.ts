import http from 'http';
import { RequestContext, parseBody, sendResponse, sendError } from '../routes.js';

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
  // text/* 全开（text/x-yaml 之类用户也可能拖进来）
  if (ct.startsWith('text/')) return true;
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

      let textContent = '';
      try {
        if (PDF_CONTENT_TYPES.has(contentType)) {
          textContent = await extractTextFromPdf(buffer);
        } else {
          textContent = buffer.toString('utf-8');
        }
      } catch (err: any) {
        return sendError(res, 422, `Failed to read file content: ${err?.message || err}`);
      }

      textContent = textContent.trim();
      if (!textContent) {
        return sendError(res, 422, 'No text content extracted from file');
      }

      // 抽取链路：复用现有 extractor，与 /api/graph/extract 保持一致
      const result = await ctx.extractor.extract({
        textContent: `Source file: ${filename}\n${textContent}`,
        timestamp: new Date().toISOString(),
        sourceType: 'manual',
      });

      for (const entity of result.entities) {
        await ctx.db.addEntity(entity);
      }

      for (const relationship of result.relationships) {
        await ctx.db.addRelationship(relationship);
      }

      for (const principle of result.principles) {
        await ctx.db.addEntity({
          name: principle.title,
          type: 'principle',
          description: principle.content,
          tags: ['auto_extracted', principle.type, 'uploaded-file'],
          metadata: {
            isCore: principle.isCore,
            version: principle.version || 1,
            principleType: principle.type,
            sourceFile: filename,
          },
        });
      }

      // 原文落 archival memory，方便事后检索
      const archival = await ctx.archivalMemory.add(textContent, {
        tags: ['uploaded-file', filename],
        importance: 0.5,
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
