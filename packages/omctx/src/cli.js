/**
 * omctx CLI entry. Manual argv parsing (zero dependencies), fixed command
 * allowlist, no shell, no subprocess, no generic passthrough.
 */

import { errorFor, EXIT, OmctxError } from './client/errors.js';
import { printError } from './client/output.js';
import { tokenArgumentPresent, resolveLocalToken } from './client/token.js';
import { assertLoopbackUrl, DEFAULT_API_URL, OmniLocalClient } from './client/omni-local-client.js';
import { cmdHelp, cmdVersion, cmdDoctor, cmdAsk, cmdInspect, cmdHistory, cmdApprove, cmdVerify, cmdReopen } from './commands/index.js';

const COMMANDS = new Set(['--help', 'help', 'version', 'doctor', 'ask', 'inspect', 'history', 'approve', 'verify', 'reopen']);

/**
 * Split argv into command + flags. Only a fixed flag set exists:
 * --json, --limit <n>, --api-url <url>. Everything else is a usage error.
 */
export function parseArgs(argv) {
  const args = [...argv];
  const flags = { json: false, limit: 20, apiUrl: null };
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') flags.json = true;
    else if (arg === '--help' || arg === '-h') flags.help = true;
    else if (arg === '--limit') {
      const next = args[i + 1];
      if (next === undefined || !/^\d+$/.test(next)) throw errorFor.usage('--limit requires a positive integer');
      flags.limit = Number(next);
      if (!Number.isInteger(flags.limit) || flags.limit < 1) throw errorFor.usage('--limit requires a positive integer');
      i += 1;
    } else if (arg.startsWith('--limit=')) {
      const value = arg.slice('--limit='.length);
      if (!/^\d+$/.test(value)) throw errorFor.usage('--limit requires a positive integer');
      flags.limit = Number(value);
      if (!Number.isInteger(flags.limit) || flags.limit < 1) throw errorFor.usage('--limit requires a positive integer');
    } else if (arg === '--api-url') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) throw errorFor.usage('--api-url requires a value');
      flags.apiUrl = next;
      i += 1;
    } else if (arg.startsWith('--api-url=')) {
      flags.apiUrl = arg.slice('--api-url='.length);
    } else if (arg === '--token' || arg.startsWith('--token=') || arg === '--control-token' || arg.startsWith('--control-token=')) {
      throw errorFor.usage('tokens must never be passed as CLI arguments (shell history leak); use the Desktop security session or local token file');
    } else if (arg.startsWith('--')) {
      throw errorFor.usage(`unknown flag '${arg}'`);
    } else {
      positionals.push(arg);
    }
  }
  return { command: positionals[0] ?? null, args: positionals.slice(1), flags };
}

export async function run(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    printError(parsedCommandHint(argv), toOmctxError(error), false);
    return error.exitCode ?? EXIT.USAGE_ERROR;
  }

  const { command, args, flags } = parsed;
  const json = flags.json;

  if (command === null || command === '--help' || command === 'help' || flags.help) {
    return cmdHelp({ json });
  }
  if (!COMMANDS.has(command)) {
    printError(command, errorFor.usage(`unknown command '${command}'`), json);
    return EXIT.USAGE_ERROR;
  }

  try {
    switch (command) {
      case 'version':
        return await cmdVersion({ json, args });
      case 'approve':
        return await cmdApprove({ json, args, apiUrl: flags.apiUrl || DEFAULT_API_URL });
      case 'verify':
        return await cmdVerify({ json, args });
      case 'reopen':
        return await cmdReopen({ json, args });
      case 'doctor': {
        const ctx = buildContext(flags, json);
        return await cmdDoctor(ctx);
      }
      case 'ask': {
        const ctx = buildContext(flags, json);
        return await cmdAsk(ctx, args);
      }
      case 'inspect': {
        const ctx = buildContext(flags, json);
        return await cmdInspect(ctx, args);
      }
      case 'history': {
        const ctx = buildContext(flags, json);
        return await cmdHistory(ctx, flags.limit);
      }
      default:
        throw errorFor.usage(`unknown command '${command}'`);
    }
  } catch (error) {
    const omctxError = toOmctxError(error);
    printError(command, omctxError, json);
    return omctxError.exitCode ?? EXIT.INTERNAL_ERROR;
  }
}

function parsedCommandHint(argv) {
  const first = argv.find((arg) => !arg.startsWith('-'));
  return first || 'omctx';
}

function toOmctxError(error) {
  if (error instanceof OmctxError) return error;
  return new OmctxError('OMCTX_UNEXPECTED_RESPONSE', error instanceof Error ? error.message : String(error), EXIT.INTERNAL_ERROR);
}

/** Build the client context only when a network command needs it. The
 * loopback assertion runs BEFORE any token resolution so a remote API URL is
 * rejected without ever touching credential material. */
function buildContext(flags, json) {
  assertLoopbackUrl(flags.apiUrl || DEFAULT_API_URL);
  const resolved = resolveLocalToken();
  if (!resolved) throw errorFor.authMissing();
  const client = new OmniLocalClient({ apiUrl: flags.apiUrl, token: resolved.token });
  return { client, tokenSource: resolved.source, json, apiUrl: flags.apiUrl || DEFAULT_API_URL };
}

export async function main(argv) {
  return run(argv);
}
