import http from 'http';
import { RequestContext, parseBody, sendError, sendResponse } from '../routes.js';
import { AgentPilotAdapter, AgentAskSchema } from '../../agent/pilot.js';

function adapterOf(ctx: RequestContext): AgentPilotAdapter {
  if (!ctx.agentPilot) throw new Error('AGENT_PILOT_UNAVAILABLE');
  return ctx.agentPilot;
}

export const handleAgentRoutes = [
  {
    method: 'GET' as const,
    path: '/api/control/plans',
    handler: async (_req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      // Desktop receives a dedicated local decision-read projection, including
      // bounded expected-vs-observed facts. Agent inspect/history remain more
      // constrained and never receive those state payloads.
      sendResponse(res, 200, { plans: await adapterOf(ctx).desktopHistory() });
    },
  },
  {
    method: 'POST' as const,
    path: '/api/agent/ask',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      try {
        const body = await parseBody<unknown>(req);
        const parsed = AgentAskSchema.safeParse(body);
        if (!parsed.success) return sendError(res, 400, 'AGENT_INPUT_INVALID');
        sendResponse(res, 200, await adapterOf(ctx).ask(parsed.data));
      } catch (error) {
        sendError(res, error instanceof Error && error.message === 'AGENT_PILOT_UNAVAILABLE' ? 503 : 400,
          error instanceof Error ? error.message : 'AGENT_ASK_FAILED');
      }
    },
  },
  {
    method: 'GET' as const,
    path: '/api/agent/inspect/:planId',
    handler: async (_req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const result = await adapterOf(ctx).inspect(params.planId);
      if (!result) return sendError(res, 404, 'PLAN_NOT_FOUND');
      sendResponse(res, 200, result);
    },
  },
  {
    method: 'GET' as const,
    path: '/api/agent/history',
    handler: async (_req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      sendResponse(res, 200, { decisions: await adapterOf(ctx).history() });
    },
  },
  {
    method: 'GET' as const,
    path: '/api/agent/outcome/:planId',
    handler: async (_req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      const result = adapterOf(ctx).outcome(params.planId);
      if (!result) return sendError(res, 404, 'PLAN_NOT_FOUND');
      sendResponse(res, 200, result);
    },
  },
  {
    method: 'GET' as const,
    path: '/api/control/revisions/:decisionId',
    handler: async (_req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext, params: Record<string, string>) => {
      // This is a fixed, read-only bounded projection for the Desktop. It is
      // not a generic control mutation and cannot reveal revision context,
      // approvals, grants, receipt internals, or native bridge material.
      const result = await adapterOf(ctx).revisionProjection(params.decisionId);
      if (!result) return sendError(res, 404, 'REVISION_NOT_FOUND');
      sendResponse(res, 200, { revision: result });
    },
  },
];
