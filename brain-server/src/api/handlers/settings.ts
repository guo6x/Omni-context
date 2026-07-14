import http from 'http';
import fs from 'fs';
import path from 'path';
import { RequestContext, parseBody, sendResponse, sendError } from '../routes.js';
import { fileURLToPath } from 'url';

function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 4) return '****';
  return key.slice(-4).padStart(key.length, '*');
}

export const handleSettingsRoutes = [
  {
    method: 'GET' as const,
    path: '/api/settings/llm',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const config = ctx.extractor.getLlmConfig();
      sendResponse(res, 200, {
        apiUrl: config.apiUrl,
        apiKey: maskApiKey(config.apiKey),
        model: config.model,
      });
    }
  },
  {
    method: 'POST' as const,
    path: '/api/settings/llm',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const body = await parseBody<{ apiUrl?: string; apiKey?: string; model?: string }>(req);
      if (!body.apiUrl) {
        return sendError(res, 400, 'apiUrl is required');
      }
      const config = {
        apiUrl: body.apiUrl,
        apiKey: body.apiKey || '',
        model: body.model || 'qwen2.5:7b',
      };
      const healthy = await ctx.extractor.setLlmConfig(config);
      if (ctx.agentLoop) {
        ctx.agentLoop.setLlmConfig(config);
      }
      sendResponse(res, 200, {
        success: true,
        healthy,
        ...(healthy ? {} : { warning: 'LLM 健康检查失败，LLM 提取已禁用' }),
      });
    }
  },
  {
    method: 'GET' as const,
    path: '/api/status',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      // 1. 检查 OCR Ready 状态
      let ocrReady = false;
      try {
        const tessdataPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../models/tessdata');
        if (fs.existsSync(tessdataPath)) {
          const files = fs.readdirSync(tessdataPath);
          ocrReady = files.some(f => f.endsWith('.traineddata') || f.endsWith('.traineddata.gz'));
        }
      } catch (err) {
        console.warn('[StatusHandler] 检查 OCR 状态出错:', err);
      }

      // 2. 检查 Embedding 状态
      let embeddingStatus = ctx.embeddingService.getStatus();
      if (embeddingStatus === 'pending') {
        try {
          await ctx.embeddingService.embedPassage('healthcheck');
        } catch (err) {
          console.warn('[StatusHandler] 触发冷启动探测失败:', err);
        }
        embeddingStatus = ctx.embeddingService.getStatus();
      }
      const embeddingInfo = ctx.embeddingService.getInfo();

      // 3. 检查 LLM 状态
      const llmConfig = ctx.extractor.getLlmConfig();
      const llmEnabled = ctx.extractor.isLlmEnabled();

      // 4. 检查 Agent 状态
      const agentRunning = ctx.agentLoop ? ctx.agentLoop.isRunning() : false;

      // 5. 检查 Database 状态
      let dbStats = { entities: 0, relationships: 0 };
      try {
        const stats = await ctx.db.getStats();
        dbStats = {
          entities: stats.entities,
          relationships: stats.relationships,
        };
      } catch (err) {
        console.warn('[StatusHandler] 获取数据库状态出错:', err);
      }

      // 6. 汇总总体健康状况（有降级项则 ok 为 false）
      const ok = embeddingStatus !== 'hash-fallback' && llmEnabled;

      sendResponse(res, 200, {
        ok,
        embedding: {
          status: embeddingStatus,
          mode: embeddingInfo.mode,
          model: embeddingInfo.model,
          modelRevision: embeddingInfo.modelRevision,
          dimensions: embeddingInfo.dimensions,
          actualDimension: embeddingInfo.actualDimension,
          usageProfile: embeddingInfo.usageProfile,
          modelSha256Verified: embeddingInfo.modelSha256Verified,
          apiUrl: embeddingInfo.apiUrl,
        },
        llm: {
          enabled: llmEnabled,
          model: llmConfig.model,
          apiUrl: llmConfig.apiUrl,
        },
        ocr: {
          ready: ocrReady,
        },
        agent: {
          running: agentRunning,
        },
        db: dbStats,
      });
    }
  }
];
