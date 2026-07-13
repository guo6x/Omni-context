const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash, randomInt } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const extensionDir = __dirname;
const repoDir = path.resolve(extensionDir, '..');
const evidenceDir = path.join(repoDir, 'docs', 'delivery-v3.1', 'evidence');
const workDir = path.join(evidenceDir, '.browser-e2e-profile');
const dbPath = path.join(evidenceDir, 'browser-extension-e2e.db');
const pairCodePath = path.join(evidenceDir, '.browser-pair-code');
const serverLogPath = path.join(evidenceDir, '15-browser-brain-server.log');
const chromePath = process.env.OMNI_CHROME_PATH;
if (!chromePath) {
  throw new Error('OMNI_CHROME_PATH is required; point it to an existing Chromium browser without downloading one');
}
const localToken = `local-e2e-${createHash('sha256').update(String(Date.now())).digest('hex')}`;

function freshPairCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

async function waitFor(predicate, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`condition timed out after ${timeoutMs}ms`);
}

async function api(pathname, token, options = {}) {
  return fetch(`http://127.0.0.1:3001${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

async function openExtension(profileDir) {
  return chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    // Use Chrome's modern headless implementation directly. Playwright's generic
    // headless launch path disables extension service workers on some stable builds.
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--headless=new',
      '--no-first-run',
      '--disable-component-update',
    ],
  });
}

async function getWorker(context) {
  return context.serviceWorkers()[0]
    || context.waitForEvent('serviceworker', { timeout: 15_000 });
}

async function pairFromPopup(context, extensionId, pairCode, screenshotName) {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.locator('#tokenInput').fill(pairCode);
  await popup.locator('#saveTokenBtn').click();
  await popup.waitForFunction(() => document.querySelector('#tokenSetup')?.classList.contains('hidden'));
  await popup.screenshot({ path: path.join(evidenceDir, screenshotName), fullPage: true });
  await popup.close();
}

async function sendExtensionMessage(context, extensionId, message) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const result = await page.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
  await page.close();
  return result;
}

async function captureFixture(worker, fixtureUrl) {
  return worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    let fixtureTabId = null;
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        const candidate = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' });
        if (candidate?.url === url) {
          fixtureTabId = tab.id;
          break;
        }
      } catch {}
    }
    if (!fixtureTabId) throw new Error('conversation extractor returned no result');
    return chrome.tabs.sendMessage(fixtureTabId, { type: 'PREVIEW_CAPTURE_PAGE' });
  }, fixtureUrl);
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.rmSync(workDir, { recursive: true, force: true });
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  const firstPairCode = freshPairCode();
  fs.writeFileSync(pairCodePath, firstPairCode, 'utf8');

  const mockLlm = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'omni-browser-e2e-mock' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      res.end(JSON.stringify({
        choices: [{
          finish_reason: 'stop',
          message: { content: JSON.stringify({ entities: [], facts: [], principles: [] }) },
        }],
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve, reject) => {
    mockLlm.once('error', reject);
    mockLlm.listen(3412, '127.0.0.1', resolve);
  });

  const serverLog = fs.createWriteStream(serverLogPath, { flags: 'w' });
  const server = spawn(process.execPath, ['dist/api-server.js'], {
    cwd: path.join(repoDir, 'brain-server'),
    env: {
      ...process.env,
      PORT: '3001',
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      LOCAL_API_TOKEN: localToken,
      PAIR_CODE_FILE: pairCodePath,
      PAIR_CODE_TTL_MS: '600000',
      OMNI_EVALUATION_MODE: '1',
      INSIGHT_INTERVAL_MS: '3600000',
      LLM_API_URL: 'http://127.0.0.1:3412/v1',
      LLM_MODEL: 'omni-browser-e2e-mock',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const scrub = (chunk) => serverLog.write(String(chunk).split(repoDir).join('<repo>'));
  server.stdout.on('data', scrub);
  server.stderr.on('data', scrub);

  let context;
  try {
    await waitFor(async () => (await fetch('http://127.0.0.1:3001/health')).ok);
    console.log('brain-server health=PASS');
    context = await openExtension(workDir);
    let worker = await getWorker(context);
    const extensionId = new URL(worker.url()).host;

    const initialSettings = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('settings');
      return OmniPrivacy.mergeSettings(stored.settings);
    });
    assert.equal(initialSettings.autoCapture, false);
    console.log('unpacked-loaded default-auto-capture-off=PASS');

    await pairFromPopup(context, extensionId, firstPairCode, '15-browser-pairing.png');
    const paired = await worker.evaluate(async () => chrome.storage.local.get([
      'localApiToken',
      'browserDeviceId',
    ]));
    assert.match(paired.localApiToken, /^ocd_/);
    assert.match(paired.browserDeviceId, /^browser-/);
    console.log('pairing extension-token=PASS');

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        settings: OmniPrivacy.mergeSettings({
          autoCapture: false,
          previewBeforeCapture: false,
          redactSensitiveFields: true,
          allowedDomains: ['chatgpt.com'],
          blockedDomains: [],
        }),
      });
    });

    const fixtureUrl = 'https://chatgpt.com/c/omni-context-e2e';
    const longText = `Decision evidence sk-${'A'.repeat(24)} ${'x'.repeat(25000)}`;
    await context.route('https://chatgpt.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><title>Omni E2E Fixture</title>
        <style>body{max-width:960px;margin:32px auto;font:16px sans-serif}article{overflow-wrap:anywhere;margin:16px 0;padding:16px;border:1px solid #ccc}</style>
        <main>
          <article data-message-author-role="user"><div class="whitespace-pre-wrap">Remember Project Aurora uses option A.</div></article>
          <article data-message-author-role="assistant"><div class="markdown">${longText}</div></article>
        </main>`,
    }));
    const fixture = await context.newPage();
    fixture.on('dialog', (dialog) => dialog.accept());
    await fixture.goto(fixtureUrl);
    await fixture.waitForLoadState('networkidle');
    await fixture.waitForSelector('#omni-floating-container', { timeout: 10_000 });
    await fixture.screenshot({ path: path.join(evidenceDir, '15-browser-chatgpt-fixture.png'), fullPage: true });
    await fixture.bringToFront();

    const capture = await captureFixture(worker, fixtureUrl);
    console.log('fixture capture response', JSON.stringify(capture));
    assert.equal(capture.ok, true);
    assert.equal(capture.payloadChunks, 2);
    assert.equal(capture.jobIds.length, 2);
    assert.ok(capture.redactedCount >= 1);
    for (const jobId of capture.jobIds) {
      const receipt = await api(`/api/ingest/job/${jobId}`, paired.localApiToken);
      assert.equal(receipt.status, 200);
    }
    console.log('fixture-capture brain-receipt chunks=2 redaction=PASS');

    const blocked = await sendExtensionMessage(context, extensionId, {
      type: 'CAPTURE_PAGE',
      data: {
        url: 'https://mail.google.com/mail/u/0',
        title: 'blocked fixture',
        content: 'must not be sent',
        previewConfirmed: true,
      },
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, 'Capture blocked: sensitive-domain');
    console.log('unauthorized-domain-no-capture=PASS');

    const revoke = await api(
      `/api/auth/devices/${encodeURIComponent(paired.browserDeviceId)}/revoke`,
      localToken,
      { method: 'POST', body: '{}' },
    );
    assert.equal(revoke.status, 200);
    const revokedCapture = await sendExtensionMessage(context, extensionId, {
      type: 'CAPTURE_PAGE',
      data: {
        url: 'https://chatgpt.com/c/revoked',
        title: 'revoked fixture',
        content: 'revoked request',
        previewConfirmed: true,
      },
    });
    assert.equal(revokedCapture.ok, false);
    console.log('revoked-token-request-fails=PASS');

    const secondPairCode = freshPairCode();
    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(pairCodePath, secondPairCode, 'utf8');
    await pairFromPopup(context, extensionId, secondPairCode, '15-browser-repairing.png');
    const repaired = await worker.evaluate(async () => chrome.storage.local.get('localApiToken'));
    assert.match(repaired.localApiToken, /^ocd_/);
    assert.notEqual(repaired.localApiToken, paired.localApiToken);
    const repairedHealth = await api('/api/stats', repaired.localApiToken);
    assert.equal(repairedHealth.status, 200);
    console.log('repairing-restores-access=PASS');

    await fixture.close();
    await context.close();
    context = await openExtension(workDir);
    worker = await getWorker(context);
    const persisted = await worker.evaluate(async () => chrome.storage.local.get([
      'settings',
      'localApiToken',
    ]));
    assert.equal(persisted.settings.allowedDomains.includes('chatgpt.com'), true);
    assert.equal(persisted.settings.autoCapture, false);
    assert.equal(persisted.localApiToken, repaired.localApiToken);
    console.log('browser-restart-settings-token-persist=PASS');

    const exported = await waitFor(async () => {
      const response = await api('/api/admin/export', localToken);
      if (!response.ok) return null;
      const body = await response.json();
      return body.ingestionDocuments?.length ? body : null;
    }, 20_000);
    const empty = {
      ...exported,
      mode: 'replace',
      entities: [], relationships: [], assertions: [], coreMemory: [], archivalMemory: [],
      notifications: [], discussions: [], appMeta: [], ingestionDocuments: [], ingestionChunks: [],
      entityMergeCandidates: [], entityMergeAudit: [], assertionConflictAudit: [], behaviorEvents: [],
      proactiveInsights: [], deviceConfigurations: [],
    };
    const remove = await api('/api/admin/import', localToken, {
      method: 'POST',
      body: JSON.stringify(empty),
    });
    assert.equal(remove.status, 200);
    const afterDelete = await (await api('/api/admin/export', localToken)).json();
    assert.equal(afterDelete.ingestionDocuments.length, 0);
    console.log('captured-content-delete=PASS');
  } finally {
    if (context) await context.close().catch(() => {});
    server.kill();
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (server.exitCode === null) server.kill('SIGKILL');
    await new Promise((resolve) => mockLlm.close(resolve));
    serverLog.end();
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(pairCodePath, { force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
