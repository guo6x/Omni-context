const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

if (process.platform !== 'win32') {
  throw new Error('vNext installed Control Center gate is Windows-only');
}

const installDir = process.env.OMNI_VNEXT_E2E_INSTALL_DIR;
const profileDir = process.env.OMNI_VNEXT_E2E_PROFILE_DIR;
const evidenceDir = process.env.OMNI_VNEXT_E2E_EVIDENCE_DIR;
const expectedHeadSha = process.env.OMNI_VNEXT_E2E_EXPECTED_SHA || null;
if (!installDir || !profileDir || !evidenceDir) {
  throw new Error('OMNI_VNEXT_E2E_INSTALL_DIR, OMNI_VNEXT_E2E_PROFILE_DIR and OMNI_VNEXT_E2E_EVIDENCE_DIR are required');
}

const executable = path.join(installDir, 'Omni-Context.exe');
const brainPort = 3001;
const cdpPort = 9237;
const fixtureOutput = path.join(evidenceDir, 'vnext-d1b1-controlled-fixture.json');
const screenshotPath = path.join(evidenceDir, 'vnext-control-center-installed.png');
const resultPath = path.join(evidenceDir, 'vnext-control-center-installed-result.json');

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

async function portInUse(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function stopTree(pid) {
  if (!pid) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  try { process.kill(pid); } catch { /* already gone */ }

  try {
    const pidFile = path.join(profileDir, 'Local', 'omni-context', 'data', 'brain-server.pid');
    const brainPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (Number.isInteger(brainPid) && brainPid > 0 && brainPid !== process.pid && brainPid !== pid) {
      spawnSync('taskkill', ['/PID', String(brainPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      try { process.kill(brainPid); } catch { /* already gone */ }
    }
  } catch {
    // The fixture profile may already be stopped or may never have started Brain.
  }
}

async function startInstalledApp() {
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      LOCALAPPDATA: path.join(profileDir, 'Local'),
      APPDATA: path.join(profileDir, 'Roaming'),
      OMNI_D1B1_E2E_FIXTURE: '1',
      OMNI_D1B1_E2E_FIXTURE_OUTPUT: fixtureOutput,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
    },
    detached: false,
    stdio: 'ignore',
    windowsHide: false,
  });

  await waitFor(async () => {
    const [health, cdp, fixtureReady] = await Promise.all([
      fetch(`http://127.0.0.1:${brainPort}/health`).then((response) => response.ok),
      fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((response) => response.ok),
      Promise.resolve(fs.existsSync(fixtureOutput)),
    ]);
    return health && cdp && fixtureReady;
  }, 120_000);
  return child;
}

async function connectMainPage() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const context = browser.contexts()[0];
  const page = await waitFor(async () => {
    for (const candidate of context.pages()) {
      const text = await candidate.locator('body').innerText().catch(() => '');
      if (text.includes('Omni-Context') || text.includes('全域物理级 AI 记忆操作系统')) return candidate;
    }
    return null;
  });
  return { browser, page };
}

async function run() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(profileDir, 'Local'), { recursive: true });
  fs.mkdirSync(path.join(profileDir, 'Roaming'), { recursive: true });
  fs.rmSync(fixtureOutput, { force: true });
  fs.rmSync(resultPath, { force: true });
  fs.rmSync(screenshotPath, { force: true });

  assert.equal(fs.existsSync(executable), true, `installed executable not found: ${executable}`);
  assert.equal(await portInUse(brainPort), false, `127.0.0.1:${brainPort} is already in use; close the running Omni-Context instance before this gate`);
  assert.equal(await portInUse(cdpPort), false, `127.0.0.1:${cdpPort} is already in use`);

  const startedAt = new Date().toISOString();
  const checkpoints = [];
  let app = null;
  let browser = null;
  let page = null;

  const pass = (id, details = undefined) => {
    checkpoints.push({ id, status: 'PASS', ...(details ? { details } : {}) });
    console.log(`vnext-installed-${id}=PASS`);
  };

  const writeResult = (status, errorMessage = null) => {
    const result = {
      schema_version: '1.0',
      gate_id: 'vnext-control-center-installed-e2e',
      status,
      verification_level: 'INSTALLED_WINDOWS_LOCAL_CONTROLLED',
      expected_head_sha: expectedHeadSha,
      executable_sha256: fs.existsSync(executable) ? sha256File(executable) : null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      fixture: 'D1B1_CONTROLLED_LOCAL_ONLY',
      authority_invariants: {
        approve_clicked: false,
        execution_started: false,
        github_writes: 0,
        receipts_created: 0,
        readback_started: false,
        outcome_finalized: false,
      },
      checkpoints,
      screenshot: fs.existsSync(screenshotPath) ? path.basename(screenshotPath) : null,
      error: errorMessage,
    };
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  };

  try {
    app = await startInstalledApp();
    pass('packaged-app-start');

    const fixture = JSON.parse(fs.readFileSync(fixtureOutput, 'utf8'));
    assert.equal(fixture.fixture, 'D1B1_CONTROLLED_LOCAL_ONLY');
    assert.equal(fixture.primary?.plan_state, 'awaiting_approval');
    assert.equal(fixture.concurrency?.plan_state, 'awaiting_approval');
    assert.equal(fixture.execution_started, false);
    assert.equal(fixture.github_writes, 0);
    assert.equal(fixture.receipts_created, 0);
    assert.equal(fixture.readback_started, false);
    assert.equal(fixture.outcome_finalized, false);
    pass('controlled-fixture', { plan_count: 2 });

    const connection = await connectMainPage();
    browser = connection.browser;
    page = connection.page;

    const skip = page.getByRole('button', { name: /跳过|Skip/i });
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
      await skip.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    }

    await page.getByTitle(/更多|More/i).click();
    await page.getByRole('button', { name: 'Control Center', exact: true }).click();
    await page.getByRole('heading', { name: 'Decision Control Center', exact: true }).waitFor({ timeout: 30_000 });
    pass('control-center-open');

    const planCount = await page.getByText('github.issue.close', { exact: true }).count();
    assert.ok(planCount >= 2, `expected at least two controlled plan cards, found ${planCount}`);
    await page.getByText(/Human approval required/i).first().waitFor({ timeout: 30_000 });
    assert.equal(await page.getByRole('button', { name: /Run approved action/i }).count(), 0);
    pass('awaiting-approval-state', { visible_plan_cards: planCount });

    await page.getByText('Live Guard trace', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.getByText('proceed', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.getByText(/d1b1-controlled-cp6-fixture@1\.0\.0/i).first().waitFor({ timeout: 30_000 });
    await page.getByText(/Source:\s*d1b1-controlled-local-fixture/i).first().waitFor({ timeout: 30_000 });
    pass('live-guard-provenance');

    await page.getByText('Bound plan snapshot', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.getByText(/Immutable authorization snapshot/i).first().waitFor({ timeout: 30_000 });
    await page.getByText('repository.current_state', { exact: true }).first().waitFor({ timeout: 30_000 });
    await page.getByText('issue.current_state', { exact: true }).first().waitFor({ timeout: 30_000 });
    pass('bound-plan-snapshot');

    await page.getByText(/Approved ≠ Executed/i).first().waitFor({ timeout: 30_000 });
    pass('authority-copy');

    await page.screenshot({ path: screenshotPath, fullPage: true });
    pass('screenshot-evidence', { file: path.basename(screenshotPath) });

    writeResult('PASS');
  } catch (error) {
    if (page) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    }
    writeResult('FAIL', error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (app) stopTree(app.pid);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
