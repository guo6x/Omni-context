const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const installDir = process.env.OMNI_E2E_INSTALL_DIR;
const profileDir = process.env.OMNI_E2E_PROFILE_DIR;
const evidenceDir = process.env.OMNI_E2E_EVIDENCE_DIR;
if (!installDir || !profileDir || !evidenceDir) {
  throw new Error('OMNI_E2E_INSTALL_DIR, OMNI_E2E_PROFILE_DIR and OMNI_E2E_EVIDENCE_DIR are required');
}
const executable = path.join(installDir, 'Omni-Context.exe');
const fixturePath = path.join(evidenceDir, '15-windows-ui-fixture.txt');
const exportPath = path.join(evidenceDir, '15-windows-export.json');
const cdpPort = 9223;
const mockPort = 3413;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await predicate().catch(() => null);
    if (result) return result;
    await wait(250);
  }
  throw new Error(`condition timed out after ${timeoutMs}ms`);
}

function stopTree(pid) {
  if (!pid) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}

function mockResponse(request) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const system = String(messages.find((message) => message.role === 'system')?.content || '');
  const user = String([...messages].reverse().find((message) => message.role === 'user')?.content || '');
  if (system.includes('information extractor for a knowledge graph')) {
    return JSON.stringify({
      entities: [
        { name: 'Project Aurora', type: 'project', description: 'A local-first memory project used by the installed E2E.' },
        { name: 'Option A', type: 'concept', description: 'The first candidate architecture.' },
      ],
      facts: [{
        subject: 'Project Aurora', predicate: 'uses', object: 'Option A', confidence: 0.96,
        source_span: 'Project Aurora currently uses Option A for its local-first architecture.',
      }],
      principles: [],
    });
  }
  if (system.includes('只输出 JSON')) {
    const isDecision = /should|choose|instead|应该|选择/i.test(user);
    const isRevision = /option b|instead|修改/i.test(user);
    return JSON.stringify({
      conclusion: isRevision
        ? 'Decision B: revise the plan and choose Option B.'
        : isDecision
          ? 'Decision A: keep Option A for the initial release.'
          : 'Project Aurora is grounded in the imported local-first fixture.',
      reasons: [{ text: '+ The imported Project Aurora evidence supports this answer.', refs: [1] }],
      questions: [],
      is_decision: isDecision,
    });
  }
  return 'Project Aurora is grounded in the imported local-first fixture. [1]';
}

async function startMock() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'omni-installed-e2e-mock' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        const request = JSON.parse(raw || '{}');
        res.end(JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: mockResponse(request) } }],
        }));
      });
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(mockPort, '127.0.0.1', resolve);
  });
  return server;
}

async function startInstalledApp() {
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      LOCALAPPDATA: path.join(profileDir, 'Local'),
      APPDATA: path.join(profileDir, 'Roaming'),
      OMNI_UDP_BIND: '127.0.0.1:19090',
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
      LLM_API_URL: `http://127.0.0.1:${mockPort}/v1`,
      LLM_MODEL: 'omni-installed-e2e-mock',
    },
    detached: false,
    stdio: 'ignore',
    windowsHide: false,
  });
  await waitFor(async () => {
    const [health, cdp] = await Promise.all([
      fetch('http://127.0.0.1:3001/health').then((response) => response.ok),
      fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((response) => response.ok),
    ]);
    return health && cdp;
  });
  return child;
}

async function connectMainPage() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const context = browser.contexts()[0];
  const page = await waitFor(async () => {
    for (const candidate of context.pages()) {
      const text = await candidate.locator('body').innerText().catch(() => '');
      if (text.includes('全域物理级 AI 记忆操作系统')) return candidate;
    }
    return null;
  });
  return { browser, page };
}

async function closeConnection(browser) {
  // For a CDP attachment, disconnect the transport without asking WebView2 to exit.
  await browser.close().catch(() => {});
}

async function run() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(profileDir, 'Local'), { recursive: true });
  fs.mkdirSync(path.join(profileDir, 'Roaming'), { recursive: true });
  fs.writeFileSync(
    fixturePath,
    'Project Aurora currently uses Option A for its local-first architecture. Option B remains the revision candidate.\n',
    'utf8',
  );
  fs.rmSync(exportPath, { force: true });

  const mock = await startMock();
  let app = null;
  let browser = null;
  try {
    app = await startInstalledApp();
    let connection = await connectMainPage();
    browser = connection.browser;
    let page = connection.page;
    page.on('dialog', (dialog) => dialog.accept());

    await page.getByRole('button', { name: /^设置$|^Settings$/ }).click();
    await page.getByRole('button', { name: /大模型配置|LLM Provider|模型服务/i }).click();
    const llmPanel = page.getByRole('heading', { name: /大模型配置|LLM Provider|模型服务/i }).locator('..').locator('..');
    const llmTextInputs = llmPanel.locator('input[type="text"]');
    await llmTextInputs.first().fill(`http://127.0.0.1:${mockPort}/v1`);
    await llmTextInputs.last().fill('omni-installed-e2e-mock');
    await page.getByRole('button', { name: /测试连接|Test connection/i }).click();
    await page.getByText(/连接成功|Connection successful/i).last().waitFor({ timeout: 30_000 });
    const settingsHeading = page.getByRole('heading', { name: /^设置$|^Settings$/ });
    await settingsHeading.locator('..').locator('..').locator('button').click();
    console.log('installed-ui-local-llm-config=PASS');

    const demo = page.getByRole('button', { name: /加载示例图谱|Onboarding Demo/ });
    if (await demo.isVisible().catch(() => false)) {
      await demo.click();
      await page.getByText(/24 个实体|24 nodes/).first().waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
    }
    console.log('installed-ui-launch-onboarding=PASS');

    await page.getByRole('button', { name: /上传文件|Upload file/i }).click();
    const uploadInput = page.locator('input[type="file"]').first();
    await uploadInput.setInputFiles(fixturePath);
    const uploadTask = page.locator('li').filter({ hasText: path.basename(fixturePath) });
    await uploadTask.waitFor({ timeout: 20_000 });
    await page.waitForFunction(
      (filename) => {
        const item = [...document.querySelectorAll('li')].find((node) => node.textContent?.includes(filename));
        if (!item) return false;
        if (item.querySelector('svg[class*="text-red-400"]')) {
          throw new Error(`Import failed: ${item.textContent}`);
        }
        return Boolean(item.querySelector('svg[class*="text-green-400"]'));
      },
      path.basename(fixturePath),
      { timeout: 90_000 },
    );
    console.log('installed-ui-import=PASS');
    const uploadOverlay = page.locator('div.absolute.inset-0.z-30').filter({ has: uploadTask });
    await uploadOverlay.getByRole('button', { name: 'close' }).click();
    await uploadOverlay.waitFor({ state: 'hidden' });

    const search = page.locator('input[placeholder*="搜索节点"]');
    await search.fill('Project Aurora');
    await search.press('Enter');
    await page.getByText('Project Aurora', { exact: true }).first().waitFor({ timeout: 30_000 });
    console.log('installed-ui-search=PASS');

    const ask = page.locator('input[placeholder*="问问你的大脑"]');
    await ask.fill('What is Project Aurora?');
    await ask.press('Enter');
    await page.getByText('Project Aurora is grounded in the imported local-first fixture.', { exact: false }).waitFor({ timeout: 60_000 });
    console.log('installed-ui-qa=PASS');

    await ask.fill('Should we choose Option A for Project Aurora?');
    await ask.press('Enter');
    await page.getByText('Decision A: keep Option A for the initial release.', { exact: false }).waitFor({ timeout: 60_000 });
    const saveDecision = page.getByRole('button', { name: /我已决定|保存.*决|Save.*decision/i });
    await saveDecision.click();
    await page.getByText(/已存为决策|Saved as decision/i).last().waitFor({ timeout: 30_000 });
    console.log('installed-ui-decision-a=PASS');

    const followUp = page.locator('input[placeholder*="继续讨论"], input[placeholder*="follow-up"]');
    await followUp.fill('Update: should we choose Option B instead?');
    await followUp.press('Enter');
    await page.getByText('Decision B: revise the plan and choose Option B.', { exact: false }).waitFor({ timeout: 60_000 });
    const relation = page.locator('select:has(option[value="revises"])');
    await relation.selectOption('revises');
    await page.getByRole('button', { name: /我已决定|保存.*决|Save.*decision/i }).click();
    await page.getByText(/已存为决策|Saved as decision/i).last().waitFor({ timeout: 30_000 });
    console.log('installed-ui-decision-b-lineage=PASS');

    await page.getByTitle(/更多|More/).click();
    await page.getByRole('button', { name: /决策复盘|Decision log/i }).click();
    await page.getByText('Decision A: keep Option A for the initial release.', { exact: false }).first().waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: /Decision B: revise the plan/ }).click();
    await page.screenshot({ path: path.join(evidenceDir, '15-windows-decision-lineage.png'), fullPage: true });
    const timelineText = await page.locator('body').innerText();
    assert.match(timelineText, /Decision A: keep Option A/);
    assert.match(timelineText, /Decision B: revise the plan/);
    console.log('installed-ui-lineage-view=PASS');

    await page.screenshot({ path: path.join(evidenceDir, '15-windows-before-restart.png'), fullPage: true });
    await closeConnection(browser);
    browser = null;
    stopTree(app.pid);
    app = null;
    await waitFor(async () => fetch('http://127.0.0.1:3001/health').then(() => false).catch(() => true), 20_000);

    app = await startInstalledApp();
    connection = await connectMainPage();
    browser = connection.browser;
    page = connection.page;
    page.on('dialog', (dialog) => dialog.accept());
    const restartSearch = page.locator('input[placeholder*="搜索节点"]');
    await page.waitForTimeout(3_000);
    await waitFor(async () => {
      await restartSearch.fill('Project Aurora');
      await restartSearch.press('Enter');
      return page.getByText('Project Aurora', { exact: true }).first().isVisible();
    }, 60_000);
    console.log('installed-ui-restart-persistence=PASS');

    await page.getByRole('button', { name: /^设置$|^Settings$/ }).click();
    await page.getByRole('button', { name: /数据管理|Data management/i }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /导出 JSON|Export JSON/i }).click();
    const download = await downloadPromise;
    await download.saveAs(exportPath);
    assert.ok(fs.statSync(exportPath).size > 1000);
    console.log('installed-ui-export=PASS');

    const restoreInput = page.locator('input[type="file"][accept*="json"]').last();
    await restoreInput.setInputFiles(exportPath);
    await page.getByText(/恢复成功|Restore succeeded/i).waitFor({ timeout: 60_000 });
    console.log('installed-ui-restore=PASS');
    await page.screenshot({ path: path.join(evidenceDir, '15-windows-after-restore.png'), fullPage: true });
  } finally {
    if (browser) await closeConnection(browser);
    if (app) stopTree(app.pid);
    await new Promise((resolve) => mock.close(resolve));
  }
}

run().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
