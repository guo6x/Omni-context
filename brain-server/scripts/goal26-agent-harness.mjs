#!/usr/bin/env node
/** Protocol-real Agent Pilot smoke harness. The token is read only from env. */
const base = process.env.OMNI_BRAIN_URL || 'http://127.0.0.1:3001';
const token = process.env.OMNI_AGENT_TOKEN;
if (!token) {
  console.error('AGENT_TOKEN_REQUIRED');
  process.exit(2);
}
async function rpc(id, method, params = {}) {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-omni-client': 'goal26-agent-harness' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return { status: response.status, body: await response.json() };
}
const listed = await rpc(1, 'tools/list');
const names = listed.body?.result?.tools?.map((tool) => tool.name) || [];
if (JSON.stringify(names) !== JSON.stringify(['agent_ask', 'agent_inspect', 'agent_history', 'agent_outcome'])) {
  throw new Error(`AGENT_ALLOWLIST_UNEXPECTED:${JSON.stringify(names)}`);
}
const denied = await rpc(2, 'tools/call', { name: 'add_entity', arguments: { name: 'probe', type: 'concept' } });
if (!denied.body?.error) throw new Error('AGENT_WRITE_NOT_BLOCKED');
console.log(JSON.stringify({ status: 'PASS', agent_runtime: 'protocol-real-mcp-harness', tools: names, write_probe: 'BLOCKED' }));
