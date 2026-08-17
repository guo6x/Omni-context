/**
 * omctx inspect <decision-id>: read-only single-decision query via the
 * allowlisted get_decision_lineage tool. Missing fields are rendered as
 * NOT_AVAILABLE, never invented. Decision ids are validated before any
 * network call (no path injection possible - ids are opaque strings).
 */

import { EXIT, errorFor } from '../client/errors.js';
import { printResult, humanKeyValue } from '../client/output.js';

const DECISION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export function validateDecisionId(id) {
  if (typeof id !== 'string' || id.trim().length === 0 || id.length > 200 || !DECISION_ID_PATTERN.test(id)) {
    return null;
  }
  return id;
}

export async function cmdInspect({ client, json }, args) {
  if (args.length === 0) throw errorFor.usage('inspect requires a decision id');
  if (args.length > 1) throw errorFor.usage('inspect accepts exactly one decision id');
  const id = validateDecisionId(args[0]);
  if (!id) throw errorFor.invalidDecisionId(args[0]);

  const lineage = await client.callAllowlistedReadTool('get_decision_lineage', { decision_id: id });
  if (!lineage || typeof lineage !== 'object') throw errorFor.decisionNotFound(id);
  const current = lineage.current || {};
  const outcomes = Array.isArray(current.outcomes) ? current.outcomes : [];
  const latestOutcome = outcomes.length > 0 ? outcomes[outcomes.length - 1] : null;
  const data = {
    decision_id: current.id ?? id,
    situation: current.situation ?? null,
    conclusion: current.conclusion ?? current.name ?? null,
    reasoning: null,
    evidence: Array.isArray(lineage.sources) ? lineage.sources : [],
    outcome: latestOutcome ?? null,
    outcome_count: outcomes.length,
    lineage: Array.isArray(lineage.chain) ? lineage.chain.map((node) => ({ id: node.id, depth: node.depth, relationship: node.relationship ?? null, conclusion: node.conclusion ?? null })) : [],
    risk: null,
    approval: null,
    verification_plan: null,
    created_at: current.timestamp ?? null,
    updated_at: null,
  };
  const human = [
    'Decision',
    humanKeyValue([
      ['Decision', data.decision_id],
      ['Situation', data.situation],
      ['Conclusion', data.conclusion],
      ['Outcome', latestOutcome?.actual_outcome ?? (data.outcome_count > 0 ? '(recorded)' : 'NOT_AVAILABLE')],
      ['Outcomes', data.outcome_count],
      ['Lineage nodes', data.lineage.length],
      ['Risk', 'NOT_AVAILABLE'],
      ['Approval', 'NOT_AVAILABLE'],
      ['Verification Plan', 'NOT_AVAILABLE'],
      ['Created', data.created_at],
    ]),
    '',
    'ACTION_AUTHORITY = NONE - inspection is read-only.',
  ].join('\n');
  printResult({ command: 'inspect', status: 'ok', data, human, json });
  return EXIT.SUCCESS;
}
