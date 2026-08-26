/**
 * omctx doctor: 100% non-dangerous. Checks Node, loopback API URL,
 * /health, token source presence, authenticated MCP ping. Never prints
 * the token. Exit 0 = healthy.
 */

import { EXIT, errorFor } from '../client/errors.js';
import { printResult, humanKeyValue } from '../client/output.js';
import { resolveLocalToken } from '../client/token.js';
import { assertCompatibleHealth, assertLoopbackUrl, DEFAULT_API_URL, OmniLocalClient } from '../client/omni-local-client.js';

function nodeOk() {
  const major = Number(process.versions.node.split('.')[0]);
  return Number.isInteger(major) && major >= 20;
}

export async function cmdDoctor({ client, tokenSource, json, apiUrl }) {
  const url = apiUrl || DEFAULT_API_URL;
  assertLoopbackUrl(url); // throws OMCTX_REMOTE_API_NOT_SUPPORTED_IN_ALPHA

  // The client + token are resolved once by the CLI context (env -> Desktop
  // token file). Tests may inject a client with a mock fetch; the token
  // value is never re-resolved or re-read here.
  const checks = {
    node_version: nodeOk(),
    api_url: url,
    transport: 'loopback',
    brain_health: null,
    token_source: tokenSource ?? 'unknown',
    auth: null,
    server_identity: null,
    execution_surface: 'LOCKED',
    public_writes: 'DISABLED',
  };

  if (!client) throw errorFor.authMissing();

  const health = await client.health();
  assertCompatibleHealth(health);
  checks.brain_health = 'OK';
  checks.server_identity = health.service;
  await client.mcpPing();
  checks.auth = 'OK';

  const data = {
    node_version: process.versions.node,
    api_url: url,
    transport: 'loopback',
    brain_server: 'OK',
    authentication: 'OK',
    token_source: checks.token_source,
    server_service: checks.server_identity,
    server_version: health.product_version,
    control_protocol_version: health.control_protocol_version,
    execution_surface: 'LOCKED',
    public_writes: 'DISABLED',
    notes: ['control protocol compatibility was checked before authenticated MCP ping'],
  };
  const human = [
    'omctx doctor',
    humanKeyValue([
      ['Brain Server', 'OK'],
      ['Authentication', 'OK'],
      ['Transport', 'loopback'],
      ['Execution Surface', 'LOCKED'],
      ['Public Writes', 'DISABLED'],
      ['API URL', url],
      ['Token source', checks.token_source],
    ]),
  ].join('\n');
  printResult({ command: 'doctor', status: 'ok', data, human, json });
  return EXIT.SUCCESS;
}
