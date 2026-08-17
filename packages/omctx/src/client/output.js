/**
 * Unified output contract. Every real command supports --json with the
 * envelope { ok, command, status, data, error, meta } and defaults to
 * human-readable text. All output passes through redactSecrets.
 */

import { CLI_VERSION } from './omni-local-client.js';
import { redactSecrets, safeStringify } from './redact.js';

export function printResult({ command, status = 'ok', data = null, error = null, meta = {}, human = '', json = false }) {
  const envelope = {
    ok: error === null,
    command,
    status,
    data: data === undefined ? null : data,
    error,
    meta: { cli_version: CLI_VERSION, server_version: meta.server_version ?? null },
  };
  if (json) {
    process.stdout.write(redactSecrets(safeStringify(envelope)) + '\n');
    return;
  }
  if (human) process.stdout.write(redactSecrets(human) + '\n');
}

export function printError(command, omctxError, json) {
  const detail = {
    code: omctxError.code || 'INTERNAL_ERROR',
    message: omctxError.message || 'internal error',
  };
  if (json) {
    process.stdout.write(redactSecrets(safeStringify({
      ok: false,
      command,
      status: 'error',
      data: null,
      error: detail,
      meta: { cli_version: CLI_VERSION, server_version: null },
    })) + '\n');
  } else {
    process.stderr.write(redactSecrets(`omctx: ${detail.code}: ${detail.message}`) + '\n');
  }
}

export function humanKeyValue(lines) {
  return lines
    .map(([key, value]) => `${String(key).padEnd(20)} ${value === undefined || value === null ? 'NOT_AVAILABLE' : String(value)}`)
    .join('\n');
}
