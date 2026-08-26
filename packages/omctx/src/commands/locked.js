/** Public control commands. approve and verify are enabled only through
 * separate ephemeral Desktop-minted control sessions. */

import { EXIT, errorFor } from '../client/errors.js';
import { printError, printResult } from '../client/output.js';
import { resolveControlSession, resolveVerificationSession } from '../client/token.js';

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

export async function cmdVerify({ json, args, apiUrl, fetchImpl }) {
  if (args.length === 0) {
    printError('verify', errorFor.usage('verify requires a plan id'), json);
    return EXIT.USAGE_ERROR;
  }
  if (args.length !== 1) {
    printError('verify', errorFor.usage('verify takes exactly one plan id'), json);
    return EXIT.USAGE_ERROR;
  }
  if (!/^plan-[A-Za-z0-9_-]{8,}$/i.test(args[0])) {
    printError('verify', errorFor.usage('verify requires a valid plan id'), json);
    return EXIT.USAGE_ERROR;
  }
  const session = resolveVerificationSession();
  if (!session) {
    printError('verify', errorFor.verificationAuthMissing(), json);
    return EXIT.AUTH_ERROR;
  }
  const { OmniLocalClient } = await import('../client/omni-local-client.js');
  const client = new OmniLocalClient({ apiUrl, fetchImpl, token: undefined });
  const result = await client.verifyPlan(args[0], session.token);
  printResult({
    command: 'verify',
    status: result?.status || 'INCONCLUSIVE',
    data: result,
    human: `${result?.status || 'INCONCLUSIVE'}\nExecution: NOT STARTED`,
    json,
  });
  return EXIT.SUCCESS;
}

export async function cmdReopen({ json, args }) {
  if (args.length > 0) {
    printError('reopen', errorFor.usage('reopen takes no arguments'), json);
    return EXIT.USAGE_ERROR;
  }
  printError('reopen', errorFor.featureNotAvailable('reopen'), json);
  return EXIT.FEATURE_LOCKED;
}
