/** Public control commands. approve is enabled only through the ephemeral
 * Desktop-minted control session; verify remains permanently locked here. */

import { EXIT, errorFor } from '../client/errors.js';
import { printError, printResult } from '../client/output.js';
import { resolveControlSession } from '../client/token.js';

export async function cmdApprove({ json, args, apiUrl, fetchImpl }) {
  if (args.length === 0) {
    printError('approve', errorFor.usage('approve requires a plan id'), json);
    return EXIT.USAGE_ERROR;
  }
  if (args.length !== 1) {
    printError('approve', errorFor.usage('approve takes exactly one plan id'), json);
    return EXIT.USAGE_ERROR;
  }
  if (!/^plan-[0-9a-f-]{8,}$/i.test(args[0])) {
    printError('approve', errorFor.usage('approve requires a valid plan id'), json);
    return EXIT.USAGE_ERROR;
  }
  const session = resolveControlSession();
  if (!session) {
    printError('approve', errorFor.controlAuthMissing(), json);
    return EXIT.AUTH_ERROR;
  }
  const { OmniLocalClient } = await import('../client/omni-local-client.js');
  const client = new OmniLocalClient({ apiUrl, fetchImpl, token: undefined });
  const result = await client.approvePlan(args[0], session.token);
  printResult({
    command: 'approve',
    status: 'ok',
    data: result,
    human: `APPROVED\nExecution: NOT STARTED`,
    json,
  });
  return EXIT.SUCCESS;
}

export async function cmdVerify({ json, args }) {
  if (args.length > 0) {
    // --success/--verified/--expected/--predicate/--regex/--jsonpath are
    // rejected by the parser as unknown flags; any positional is an error.
    printError('verify', errorFor.usage('verify takes no arguments in this Alpha'), json);
    return EXIT.USAGE_ERROR;
  }
  printError('verify', errorFor.controlSurfaceLocked('verify'), json);
  return EXIT.FEATURE_LOCKED;
}

export async function cmdReopen({ json, args }) {
  if (args.length > 0) {
    printError('reopen', errorFor.usage('reopen takes no arguments'), json);
    return EXIT.USAGE_ERROR;
  }
  printError('reopen', errorFor.featureNotAvailable('reopen'), json);
  return EXIT.FEATURE_LOCKED;
}
