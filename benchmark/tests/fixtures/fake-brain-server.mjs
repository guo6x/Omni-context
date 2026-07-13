import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';

const dbPath = process.env.DB_PATH;
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT);
let entities = [];

try {
  entities = JSON.parse(await readFile(dbPath, 'utf8')).entities || [];
} catch {
  await writeFile(dbPath, JSON.stringify({ entities }));
}

async function persist() {
  await writeFile(dbPath, JSON.stringify({ entities }));
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/health') {
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'GET' && req.url === '/entities') {
    res.end(JSON.stringify({ entities }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/stats') {
    res.end(JSON.stringify({ database: { entities: entities.length } }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/admin/embedding/status') {
    res.end(JSON.stringify({ mode: 'semantic', model: 'fake-semantic-v1', healthy: true, status: 'ready' }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/graph/extract') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    entities.push({ id: `extracted-${entities.length + 1}`, name: parsed.source, text: parsed.text });
    await persist();
    res.end(JSON.stringify({
      entities: 1,
      relationships: 0,
      principles: 0,
      diagnostics: {
        session_id: parsed.session_id,
        timestamp: parsed.timestamp,
        evaluation_mode: parsed.evaluation_mode,
        extraction: {
          input_characters: parsed.text.length,
          chunks: 1,
          llm_calls: [{ http_status: 200, raw_response_sha256: 'f'.repeat(64) }],
        },
        database_delta: { entities: 1, relationships: 0 },
      },
    }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/mcp/tool/unified_memory_search') {
    res.end(JSON.stringify({
      results: entities.map(({ id, name }) => ({ id, name, type: 'entity', description: name })),
      evidence: entities.map(({ id }) => ({
        id, type: 'entity', source_span: null, temporal_status: 'current',
        valid_from: null, valid_until: null, invalidated_at: null, provenance: null,
      })),
      temporalQuery: { mode: 'current', as_of: null },
    }));
    return;
  }
  if (req.method === 'POST' && req.url === '/entities') {
    let body = '';
    for await (const chunk of req) body += chunk;
    entities.push(JSON.parse(body));
    await persist();
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, host);

async function shutdown() {
  await new Promise((resolve) => server.close(resolve));
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('message', (message) => {
  if (message?.type === 'omni-evaluation-shutdown') shutdown();
});
