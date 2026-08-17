import { EXIT, errorFor } from '../client/errors.js';
import { printResult } from '../client/output.js';
import { CLI_VERSION } from '../client/omni-local-client.js';

export async function cmdVersion({ json, args }) {
  if (args.length > 0) throw errorFor.usage('version takes no arguments');
  const data = { name: 'omctx', version: CLI_VERSION };
  printResult({
    command: 'version',
    status: 'ok',
    data,
    human: `omctx ${CLI_VERSION}`,
    json,
  });
  return EXIT.SUCCESS;
}
