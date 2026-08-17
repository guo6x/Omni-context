/**
 * Read-only decision history endpoint for the omctx CLI (D1A).
 *
 * GET /api/decisions?limit=1..100 (default 20) returns the newest-first
 * decision list with bounded fields. This is a NARROW history query - it is
 * NOT a generic database query API and accepts no filters, no search text
 * and no arbitrary entity types.
 *
 * Scope: the global auth layer maps paths containing '/decision' to
 * 'decision:read' for GET, so this route is authenticated and scoped by
 * the existing Brain auth pipeline.
 */
import http from 'http';
import { RequestContext, sendResponse, sendError } from '../routes.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const handleDecisionHistoryRoutes = [
  {
    method: 'GET' as const,
    path: '/api/decisions',
    handler: async (req: http.IncomingMessage, res: http.ServerResponse, ctx: RequestContext) => {
      const rawLimit = new URL(req.url || '', 'http://localhost').searchParams.get('limit');
      let limit = DEFAULT_LIMIT;
      if (rawLimit !== null) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
          sendError(res, 400, 'limit must be an integer in 1..100');
          return;
        }
        limit = parsed;
      }
      const decisions = await ctx.db.listEntitiesByType('decision', limit);
      const items = decisions.map((entity) => {
        const metadata = (entity.metadata || {}) as Record<string, unknown>;
        const outcomes = Array.isArray(metadata.outcomes) ? metadata.outcomes : [];
        const latest = outcomes[outcomes.length - 1] as Record<string, unknown> | undefined;
        return {
          id: entity.id,
          title: typeof entity.name === 'string' ? entity.name : null,
          conclusion: typeof metadata.conclusion === 'string' ? metadata.conclusion : null,
          created_at: entity.created_at ?? null,
          updated_at: entity.updated_at ?? null,
          outcome_status: latest && typeof latest.actual_outcome === 'string'
            ? (latest.actual_outcome.length > 120 ? `${latest.actual_outcome.slice(0, 120)}...` : latest.actual_outcome)
            : null,
          revision_indicator: metadata.supersedes_decision_id || metadata.previous_decision_id || null,
        };
      });
      sendResponse(res, 200, { decisions: items, count: items.length, limit });
    },
  },
];
