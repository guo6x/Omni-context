/**
 * omctx ask: READ-ONLY JUDGMENT QUERY.
 *
 * Calls exactly one allowlisted read tool (get_decision_context). It never
 * generates an ExecutionPlan, never writes memory/decisions, never calls the
 * broker, never creates an approval and never executes a GitHub write.
 * ACTION_AUTHORITY = NONE is always stated.
 */

import { EXIT, errorFor } from '../client/errors.js';
import { printResult } from '../client/output.js';

export async function cmdAsk({ client, json }, args) {
  if (args.length === 0) throw errorFor.usage("ask requires a situation argument, e.g. omctx ask \"<situation>\"");
  if (args.length > 1) throw errorFor.usage('ask accepts exactly one situation argument');
  const situation = args[0];
  if (situation.trim().length === 0) throw errorFor.usage('the situation argument must not be empty');
  if (situation.length > 4000) throw errorFor.usage('the situation argument is too long');

  const result = await client.callAllowlistedReadTool('get_decision_context', { situation });
  const data = {
    situation,
    context: result,
    action_authority: 'NONE',
    disclaimer: 'This command provides decision context only. It does not authorize or execute an action.',
  };
  const human = [
    'Decision context (read-only judgment query)',
    '',
    redactedContext(result),
    '',
    'ACTION_AUTHORITY = NONE - this command provides decision context only.',
    'It does not authorize or execute an action.',
  ].join('\n');
  printResult({ command: 'ask', status: 'ok', data, human, json });
  return EXIT.SUCCESS;
}

function redactedContext(result) {
  // Format the structured result for humans without inventing fields.
  if (!result || typeof result !== 'object') return 'No decision context returned.';
  const lines = [];
  if (Array.isArray(result.principles)) {
    lines.push('Principles:');
    for (const principle of result.principles.slice(0, 10)) {
      const name = typeof principle?.name === 'string' ? principle.name : typeof principle?.id === 'string' ? principle.id : '(unnamed)';
      lines.push(`  - ${name}`);
    }
  }
  if (Array.isArray(result.precedents)) {
    lines.push('Precedents:');
    for (const precedent of result.precedents.slice(0, 10)) {
      lines.push(`  - ${typeof precedent === 'string' ? precedent : JSON.stringify(precedent).slice(0, 160)}`);
    }
  }
  if (Array.isArray(result.conflicts)) {
    lines.push('Conflicts:');
    for (const conflict of result.conflicts.slice(0, 10)) {
      lines.push(`  - ${typeof conflict === 'string' ? conflict : JSON.stringify(conflict).slice(0, 160)}`);
    }
  }
  if (lines.length === 0) return 'Decision context service returned no recognizable sections.';
  return lines.join('\n');
}
