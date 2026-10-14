const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

if (process.platform !== 'win32') {
  throw new Error('vNext installed supersession gate is Windows-only');
}

const installDir = process.env.OMNI_VNEXT_SUPERSESSION_INSTALL_DIR;
const profileDir = process.env.OMNI_VNEXT_SUPERSESSION_PROFILE_DIR;
const evidenceDir = process.env.OMNI_VNEXT_SUPERSESSION_EVIDENCE_DIR;
const buildExecutable = process.env.OMNI_VNEXT_SUPERSESSION_BUILD_EXE
  ? path.resolve(process.env.OMNI_VNEXT_SUPERSESSION_BUILD_EXE)
  : null;
const expectedHeadSha = String(process.env.OMNI_VNEXT_SUPERSESSION_EXPECTED_SHA || '').trim().toLowerCase();
if (!installDir || !profileDir || !evidenceDir || !buildExecutable || !expectedHeadSha) {
  throw new Error('OMNI_VNEXT_SUPERSESSION_INSTALL_DIR, OMNI_VNEXT_SUPERSESSION_PROFILE_DIR, OMNI_VNEXT_SUPERSESSION_EVIDENCE_DIR, OMNI_VNEXT_SUPERSESSION_BUILD_EXE and OMNI_VNEXT_SUPERSESSION_EXPECTED_SHA are required');
}

const repoRoot = path.resolve(__dirname, '..');
const executable = path.join(installDir, 'Omni-Context.exe');
const brainPort = 3001;
const cdpPort = 9238;
const d1b1FixtureOutput = path.join(evidenceDir, 'vnext-supersession-d1b1-fixture.json');
const supersessionFixtureOutput = path.join(evidenceDir, 'vnext-supersession-fixture.json');
const originalScreenshotPath = path.join(evidenceDir, 'vnext-supersession-original-card.png');
const currentScreenshotPath = path.join(evidenceDir, 'vnext-supersession-current-card.png');
const overviewScreenshotPath = path.join(evidenceDir, 'vnext-supersession-installed.png');
const resultPath = path.join(evidenceDir, 'vnext-supersession-installed-result.json');

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

function gitRun(args) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    windowsHide: true,
    encoding: 'utf8',
  });
}

function gitText(args) {
  const result = gitRun(args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || result.stdout || '').trim()}`);
  }
  return String(result.stdout || '').trim();
}

function gitQuiet(args) {
  const result = gitRun(args);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || result.stdout || '').trim()}`);
  }
  return result.status === 0;
}

function splitNonEmptyLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
    // The isolated profile may already be stopped or may never have started Brain.
  }
}

async function startInstalledApp() {
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      LOCALAPPDATA: path.join(profileDir, 'Local'),
      APPDATA: path.join(profileDir, 'Roaming'),
      OMNI_D1B1_E2E_FIXTURE: '1',
      OMNI_D1B1_E2E_FIXTURE_OUTPUT: d1b1FixtureOutput,
      OMNI_VNEXT_SUPERSESSION_E2E_FIXTURE: '1',
      OMNI_VNEXT_SUPERSESSION_E2E_FIXTURE_OUTPUT: supersessionFixtureOutput,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
    },
    detached: false,
    stdio: 'ignore',
    windowsHide: false,
  });

  await waitFor(async () => {
    const [health, cdp, d1b1Ready, supersessionReady] = await Promise.all([
      fetch(`http://127.0.0.1:${brainPort}/health`).then((response) => response.ok),
      fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((response) => response.ok),
      Promise.resolve(fs.existsSync(d1b1FixtureOutput)),
      Promise.resolve(fs.existsSync(supersessionFixtureOutput)),
    ]);
    return health && cdp && d1b1Ready && supersessionReady;
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
  for (const file of [
    d1b1FixtureOutput,
    supersessionFixtureOutput,
    originalScreenshotPath,
    currentScreenshotPath,
    overviewScreenshotPath,
    resultPath,
  ]) {
    fs.rmSync(file, { force: true });
  }

  const startedAt = new Date().toISOString();
  const checkpoints = [];
  let app = null;
  let browser = null;
  let page = null;
  let currentSourceHeadSha = null;
  let trackedTreeClean = null;
  let sourceIndexMatchesHead = null;
  let sourceWorktreeMatchesHead = null;
  let sourceUntrackedNonIgnored = [];
  let sourcePorcelainAdvisory = [];
  let statOnlyPorcelainDifferenceIgnored = false;
  let buildExecutableSha256 = null;
  let installedExecutableSha256 = null;

  const pass = (id, details = undefined) => {
    checkpoints.push({ id, status: 'PASS', ...(details ? { details } : {}) });
    console.log(`vnext-supersession-${id}=PASS`);
  };

  const screenshotFiles = () => [overviewScreenshotPath, originalScreenshotPath, currentScreenshotPath]
    .filter((file) => fs.existsSync(file))
    .map((file) => path.basename(file));

  const writeResult = (status, errorMessage = null) => {
    const result = {
      schema_version: '1.0',
      gate_id: 'vnext-revision-supersession-installed-e2e',
      status,
      verification_level: 'INSTALLED_WINDOWS_LOCAL_CONTROLLED',
      declared_source_head_sha: expectedHeadSha || null,
      observed_source_head_sha: currentSourceHeadSha,
      tracked_source_tree_clean: trackedTreeClean,
      source_index_matches_head: sourceIndexMatchesHead,
      source_worktree_matches_head: sourceWorktreeMatchesHead,
      source_untracked_nonignored: sourceUntrackedNonIgnored,
      source_porcelain_advisory: sourcePorcelainAdvisory,
      stat_only_porcelain_difference_ignored: statOnlyPorcelainDifferenceIgnored,
      source_head_binding: 'HEAD_PLUS_CONTENT_DIFFS_PLUS_BUILD_TO_INSTALLED_BINARY_SHA256',
      build_executable_sha256: buildExecutableSha256,
      installed_executable_sha256: installedExecutableSha256,
      executable_hash_match: Boolean(
        buildExecutableSha256
        && installedExecutableSha256
        && buildExecutableSha256 === installedExecutableSha256
      ),
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      fixture: 'VNEXT_SUPERSESSION_CONTROLLED_LOCAL_ONLY',
      authority_invariants: {
        ui_mutation_clicked: false,
        native_execution_started: false,
        external_github_writes: 0,
        synthetic_receipt_registered: true,
        synthetic_readback_registered: true,
        old_approval_reused: false,
        old_grant_reused: false,
        old_plan_reused: false,
      },
      checkpoints,
      screenshots: screenshotFiles(),
      error: errorMessage,
    };
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  };

  try {
    assert.match(expectedHeadSha, /^[0-9a-f]{40}$/, 'OMNI_VNEXT_SUPERSESSION_EXPECTED_SHA must be a full 40-character Git SHA');
    assert.equal(fs.existsSync(buildExecutable), true, `build executable not found: ${buildExecutable}`);
    assert.equal(fs.existsSync(executable), true, `installed executable not found: ${executable}`);

    currentSourceHeadSha = gitText(['rev-parse', 'HEAD']).toLowerCase();
    sourceIndexMatchesHead = gitQuiet(['diff', '--cached', '--quiet', '--no-ext-diff', 'HEAD', '--']);
    sourceWorktreeMatchesHead = gitQuiet(['diff', '--quiet', '--no-ext-diff', 'HEAD', '--']);
    sourceUntrackedNonIgnored = splitNonEmptyLines(gitText(['ls-files', '--others', '--exclude-standard']));
    sourcePorcelainAdvisory = splitNonEmptyLines(gitText(['status', '--porcelain=v2', '--untracked-files=no']));
    trackedTreeClean = sourceIndexMatchesHead && sourceWorktreeMatchesHead && sourceUntrackedNonIgnored.length === 0;
    statOnlyPorcelainDifferenceIgnored = trackedTreeClean && sourcePorcelainAdvisory.length > 0;

    assert.equal(currentSourceHeadSha, expectedHeadSha, `working tree HEAD ${currentSourceHeadSha} does not match declared build head ${expectedHeadSha}`);
    assert.equal(sourceIndexMatchesHead, true, 'staged source content differs from HEAD');
    assert.equal(sourceWorktreeMatchesHead, true, 'working-tree source content differs from HEAD');
    assert.deepEqual(sourceUntrackedNonIgnored, [], 'non-ignored untracked source files are present; exact-source binding is ambiguous');
    pass('source-content-identity', {
      porcelain_advisory_count: sourcePorcelainAdvisory.length,
      stat_only_porcelain_difference_ignored: statOnlyPorcelainDifferenceIgnored,
    });

    buildExecutableSha256 = sha256File(buildExecutable);
    installedExecutableSha256 = sha256File(executable);
    assert.equal(
      installedExecutableSha256,
      buildExecutableSha256,
      'installed Omni-Context.exe does not match the exact build executable by SHA-256',
    );
    pass('artifact-identity', {
      source_head_sha: currentSourceHeadSha,
      executable_sha256: installedExecutableSha256,
    });

    assert.equal(await portInUse(brainPort), false, `127.0.0.1:${brainPort} is already in use; close the running Omni-Context instance before this gate`);
    assert.equal(await portInUse(cdpPort), false, `127.0.0.1:${cdpPort} is already in use`);
    pass('isolated-runtime-preflight');

    app = await startInstalledApp();
    pass('packaged-app-start');

    const fixture = JSON.parse(fs.readFileSync(supersessionFixtureOutput, 'utf8'));
    assert.equal(fixture.fixture, 'VNEXT_SUPERSESSION_CONTROLLED_LOCAL_ONLY');
    assert.equal(fixture.original_outcome_status, 'MISMATCH');
    assert.equal(fixture.current_plan_state, 'awaiting_approval');
    assert.equal(fixture.requires_new_approval, true);
    assert.equal(fixture.native_execution_started, false);
    assert.equal(fixture.external_github_writes, 0);
    assert.equal(fixture.synthetic_receipt_registered, true);
    assert.equal(fixture.synthetic_readback_registered, true);
    assert.equal(fixture.reopen_execution_count, 0);
    assert.equal(fixture.old_approval_reused, false);
    assert.equal(fixture.old_grant_reused, false);
    assert.equal(fixture.old_plan_reused, false);
    pass('controlled-supersession-fixture', {
      original_decision_id: fixture.original_decision_id,
      current_decision_id: fixture.current_decision_id,
    });

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

    const originalCard = page.locator(`article[data-decision-id="${fixture.original_decision_id}"]`);
    const currentCard = page.locator(`article[data-decision-id="${fixture.current_decision_id}"]`);
    await originalCard.waitFor({ timeout: 30_000 });
    await currentCard.waitFor({ timeout: 30_000 });

    assert.equal(await originalCard.getAttribute('data-decision-role'), 'superseded');
    assert.equal(await currentCard.getAttribute('data-decision-role'), 'current');
    await originalCard.getByText('Superseded judgment', { exact: true }).waitFor({ timeout: 30_000 });
    await originalCard.getByText(/Historical judgment · superseded/i).waitFor({ timeout: 30_000 });
    await originalCard.getByText(new RegExp(fixture.current_decision_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).waitFor({ timeout: 30_000 });
    await originalCard.getByText(/Outcome:\s*MISMATCH/i).waitFor({ timeout: 30_000 });
    pass('superseded-card-visible');

    for (const name of ['Approve', 'Run approved action', 'Verify reality', 'Reopen with current evidence', 'Reconsider judgment']) {
      assert.equal(await originalCard.getByRole('button', { name, exact: true }).count(), 0, `superseded card must not expose mutation control '${name}'`);
    }
    await originalCard.getByText(/mutation controls disabled/i).waitFor({ timeout: 30_000 });
    pass('superseded-card-audit-only');

    await currentCard.getByText('Current judgment', { exact: true }).first().waitFor({ timeout: 30_000 });
    await currentCard.getByText(/Revision history/i).waitFor({ timeout: 30_000 });
    await currentCard.getByText(/r1\s*·/i).waitFor({ timeout: 30_000 });
    assert.equal(await currentCard.getByRole('button', { name: 'Approve', exact: true }).count(), 1);
    assert.equal(await currentCard.getByRole('button', { name: /Run approved action/i }).count(), 0);
    pass('current-card-authority-preserved');

    await originalCard.screenshot({ path: originalScreenshotPath });
    await currentCard.screenshot({ path: currentScreenshotPath });
    await page.screenshot({ path: overviewScreenshotPath, fullPage: true });
    pass('screenshot-evidence', { files: screenshotFiles() });

    writeResult('PASS');
  } catch (error) {
    if (page) {
      await page.screenshot({ path: overviewScreenshotPath, fullPage: true }).catch(() => {});
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
