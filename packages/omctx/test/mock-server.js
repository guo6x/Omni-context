import http from 'node:http';

/**
 * Tiny local mock Brain HTTP server for CLI transport tests.
 * mode: 'ok' | 'unauthorized' | 'forbidden' | 'error500' | 'malformed' |
 * 'redirect-remote' | 'slow' | 'notfound' | 'health-missing-service' |
 * 'wrong-service'
 */
export function startMockServer(mode, onRequest) {
  const server = http.createServer((req, res) => {
    if (typeof onRequest === 'function') onRequest(req);
    if (mode === 'redirect-remote') {
      res.statusCode = 302;
      res.setHeader('Location', 'http://192.168.1.50:9999/health');
      res.end();
      return;
    }
    if (mode === 'slow') {
      setTimeout(() => { res.statusCode = 200; res.end(JSON.stringify({ ok: true })); }, 30_000);
      return;
    }
    if (mode === 'malformed') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end('{not json');
      return;
    }
    if (mode === 'unauthorized') { res.statusCode = 401; res.end(JSON.stringify({ error: 'Unauthorized' })); return; }
    if (mode === 'forbidden') { res.statusCode = 403; res.end(JSON.stringify({ error: 'Forbidden' })); return; }
    if (mode === 'error500') { res.statusCode = 500; res.end(JSON.stringify({ error: 'boom' })); return; }
    if (mode === 'notfound') { res.statusCode = 404; res.end(JSON.stringify({ error: 'Not Found' })); return; }
    if (req.url === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      if (mode === 'health-missing-service') {
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (mode === 'wrong-service') {
        // Deliberately valid, reachable, unrelated HTTP service. Doctor must
        // reject this before accepting an authenticated MCP ping.
        res.end(JSON.stringify({ ok: true, service: 'not-omni' }));
        return;
      }
      res.end(JSON.stringify({ ok: true, service: 'omni-context-brain-server', timestamp: new Date().toISOString() }));
      return;
    }
    if (req.url === '/mcp') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const msg = JSON.parse(body);
        if (msg.method === 'ping') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
          return;
        }
        if (msg.method === 'tools/call') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } }));
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
      });
      return;
    }
    if (req.url && req.url.startsWith('/api/decisions')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ decisions: [
        { id: 'd-2', title: 'Second', conclusion: 'B', created_at: '2026-08-16T10:00:00.000Z', updated_at: '2026-08-16T10:00:00.000Z', outcome_status: null, revision_indicator: null },
        { id: 'd-1', title: 'First', conclusion: 'A', created_at: '2026-08-15T10:00:00.000Z', updated_at: '2026-08-15T10:00:00.000Z', outcome_status: 'done', revision_indicator: null },
      ], count: 2, limit: 20 }));
      return;
    }
    if (req.url === '/api/control/verify') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: { plan_id: 'plan-12345678', status: 'VERIFIED', execution_started: false } }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not Found' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}
