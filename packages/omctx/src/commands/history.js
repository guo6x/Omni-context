/**
 * omctx history: judgment history via the fixed read-only endpoint
 * GET /api/decisions (newest first, deterministic sort, bounded page).
 * Not shell history. Never opens the database directly.
 */

import { EXIT, errorFor } from '../client/errors.js';
import { printResult } from '../client/output.js';

export async function cmdHistory({ client, json }, limit) {
  const clamped = Math.max(1, Math.min(100, Math.trunc(limit) || 20));
  const decisions = await client.decisionHistory(clamped);
  const items = decisions.slice(0, clamped).map((row) => ({
    decision_id: row.id ?? null,
    title: row.title ?? row.conclusion ?? row.name ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    outcome_status: row.outcome_status ?? null,
    revision_indicator: row.revision_indicator ?? null,
  }));
  const human = [
    'Judgment history (newest first)',
    ...items.map((item, index) => {
      const title = item.title ?? '(untitled)';
      const status = item.outcome_status ? ` [${item.outcome_status}]` : '';
      const revision = item.revision_indicator ? ` (${item.revision_indicator})` : '';
      return `${String(index + 1).padStart(3)}. ${item.decision_id ?? '?'}  ${item.created_at ?? ''}  ${title}${status}${revision}`;
    }),
    items.length === 0 ? '(no decisions recorded)' : '',
  ].filter((line) => line !== '').join('\n');
  printResult({ command: 'history', status: 'ok', data: { decisions: items, count: items.length, limit: clamped }, human, json });
  return EXIT.SUCCESS;
}
