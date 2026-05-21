import http from 'http';
import { RequestContext, parseBody, sendResponse, sendError } from '../routes.js';

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
];
