const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const dgram = require('node:dgram');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { chromium } = require('playwright');

const installDir = process.env.OMNI_E2E_INSTALL_DIR;
const profileDir = process.env.OMNI_E2E_PROFILE_DIR;
const evidenceDir = process.env.OMNI_E2E_EVIDENCE_DIR;
const runnerTemp = process.env.RUNNER_TEMP;
const e2eRoot = process.env.OMNI_E2E_ROOT;
const msiPath = process.env.OMNI_E2E_MSI_PATH;
const buildExecutable = process.env.OMNI_E2E_BUILD_EXE_PATH;
const installRecordPath = process.env.OMNI_E2E_INSTALL_RECORD_PATH;
const legacyDatabasePath = process.env.OMNI_E2E_LEGACY_DB_PATH;
const webviewUserDataDir = path.join(profileDir || '', 'WebView2');
function isChildPath(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('This test may only run on a disposable GitHub-hosted Windows runner');
}
if (!installDir || !profileDir || !evidenceDir || !runnerTemp || !e2eRoot
  || !msiPath || !buildExecutable || !installRecordPath || !legacyDatabasePath) {
  throw new Error('This test requires MSI provenance and isolated RUNNER_TEMP paths from the Windows CI job');
}
if (!isChildPath(runnerTemp, e2eRoot) || !isChildPath(e2eRoot, profileDir)
  || !isChildPath(e2eRoot, evidenceDir) || !isChildPath(e2eRoot, installRecordPath)
  || !isChildPath(e2eRoot, legacyDatabasePath)) {
  throw new Error('Refusing to clean a profile or write evidence outside the unique runner temporary directory');
}
const executable = path.join(installDir, 'Omni-Context.exe');
const fixturePath = path.join(evidenceDir, '15-windows-ui-fixture.txt');
const exportPath = path.join(evidenceDir, '15-windows-export.json');
let brainPort;
let cdpPort;
let mockPort;
let udpPort;
const completedChecks = [];

function pass(check) {
  completedChecks.push(check);
  console.log(`${check}=PASS`);
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifyInstalledMsiProvenance() {
  assert.ok(fs.existsSync(msiPath), 'the MSI used for installation is unavailable');
  assert.ok(fs.existsSync(buildExecutable), 'the build output executable is unavailable');
  assert.ok(fs.existsSync(installRecordPath), 'Windows Installer registry evidence is unavailable');
  const record = JSON.parse(fs.readFileSync(installRecordPath, 'utf8'));
  const msiHash = sha256File(msiPath);
  const builtHash = sha256File(buildExecutable);
  const installedHash = sha256File(executable);
  assert.equal(record.evidence_kind, 'UNSIGNED_PR_MSI_INSTALLED_WINDOWS_FIXTURE_ACCEPTANCE');
  assert.equal(record.source_commit, process.env.GITHUB_SHA);
  assert.equal(record.pull_request_head_sha, process.env.OMNI_E2E_PR_HEAD_SHA);
  assert.equal(record.install_dir && path.resolve(record.install_dir), path.resolve(installDir));
  assert.equal(record.installed_exe && path.resolve(record.installed_exe), path.resolve(executable));
  assert.equal(record.installed_from_windows_installer, true);
  assert.equal(record.registry_product_code_matches_msi, true);
  assert.equal(record.msi_product_name, 'Omni-Context');
  assert.ok(typeof record.msi_product_version === 'string' && record.msi_product_version.length > 0);
  assert.equal(record.installed_exe_matches_build_exe, true);
  assert.equal(record.product_code, process.env.OMNI_E2E_PRODUCT_CODE);
  assert.equal(record.msi_sha256, msiHash);
  assert.equal(record.build_exe_sha256, builtHash);
  assert.equal(record.installed_exe_sha256, installedHash);
  assert.equal(installedHash, builtHash, 'the installed executable differs from the built MSI payload');
  assert.ok(record.registry_key && /^HKLM\\/i.test(record.registry_key), 'MSI registry install record must be machine-scoped');
  pass('installed-msi-registry-and-binary-provenance');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    // Accept both synchronous state predicates and async browser probes.
    // Wrapping the invocation also turns a synchronous throw into a normal
    // retry, matching the behavior of a rejected promise.
    const result = await Promise.resolve().then(predicate).catch(() => null);
    if (result) return result;
    await wait(250);
  }
  throw new Error(`condition timed out after ${timeoutMs}ms`);
}

async function clickAfterRerender(locator, timeoutMs = 30_000) {
  // The first-run panel hydrates settings and locale independently of the
  // native window/CDP readiness gate. During that short interval React may
  // replace the button node while Playwright is waiting for actionability.
  // Reacquire the locator in bounded, short attempts so a transient detached
  // node cannot consume the whole acceptance step or turn into a false app
  // failure. This remains a real pointer click through Playwright.
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const remaining = Math.max(500, deadline - Date.now());
    try {
      await locator.click({ timeout: Math.min(2_000, remaining) });
      return;
    } catch (error) {
      lastError = error;
      await wait(Math.min(250, Math.max(50, deadline - Date.now())));
    }
  }
  throw lastError || new Error('the UI control did not become clickable before the timeout');
}

async function waitForPointerTarget(page, locator, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = 'not-probed';
  while (Date.now() < deadline) {
    const remaining = Math.max(500, deadline - Date.now());
    try {
      await page.bringToFront();
      await locator.waitFor({ state: 'visible', timeout: Math.min(2_000, remaining) });
      await locator.scrollIntoViewIfNeeded({ timeout: Math.min(2_000, remaining) });
      const state = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const x = rect.left + (rect.width / 2);
        const y = rect.top + (rect.height / 2);
        const hit = x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight
          ? document.elementFromPoint(x, y)
          : null;
        return {
          ready: rect.width > 0 && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && style.pointerEvents !== 'none'
            && (hit === element || Boolean(hit && element.contains(hit))),
          rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
          hit: hit?.tagName || null,
          visibility: style.visibility,
          display: style.display,
          pointerEvents: style.pointerEvents,
        };
      });
      lastState = JSON.stringify(state);
      if (state.ready) return;
    } catch (error) {
      lastState = String(error?.message || error);
    }
    await wait(Math.min(250, Math.max(50, deadline - Date.now())));
  }
  throw new Error(`pointer target did not settle before the timeout: ${lastState}`);
}

async function openDecisionLog(page) {
  // The native tray path can restore a WebView before its localized title
  // attributes have rehydrated. The stable product test ids keep this real
  // pointer path independent of the runner's Windows locale.
  const more = page.locator('[data-testid="header-more-menu"]').first();
  await waitForPointerTarget(page, more);
  await clickAfterRerender(more);
  const decisionLog = page.locator('[data-testid="header-decision-log"]').first();
  await waitForPointerTarget(page, decisionLog);
  await clickAfterRerender(decisionLog);
}

async function reserveLoopbackPort(transport = 'tcp', preferredPort = 0) {
  if (transport === 'udp') {
    const socket = dgram.createSocket('udp4');
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, '127.0.0.1', resolve);
    });
    const { port } = socket.address();
    await new Promise((resolve) => socket.close(resolve));
    assert.ok(port > 0, 'failed to reserve a loopback UDP test port');
    return port;
  }
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(preferredPort, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  assert.ok(port > 0, 'failed to reserve a loopback test port');
  return port;
}

async function initializePorts() {
  // The packaged renderer is built with the production loopback default
  // (127.0.0.1:3001). Keep the installed acceptance harness on that same
  // port, while probing it first so we never drive an unrelated local service.
  brainPort = await reserveLoopbackPort('tcp', 3001);
  cdpPort = await reserveLoopbackPort();
  mockPort = await reserveLoopbackPort();
  udpPort = await reserveLoopbackPort('udp');
}

function fixtureApiUrl(route) {
  return `http://127.0.0.1:${brainPort}${route}`;
}

function readInstalledAppToken() {
  const tokenPath = path.join(profileDir, 'Local', 'omni-context', 'local-token.txt');
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  assert.ok(token.length >= 32, 'installed app did not create its local authorization token');
  return token;
}

function getWindowsRuntimeEnvironment() {
  const allowed = [
    'PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'ProgramFiles',
    'ProgramFiles(x86)', 'ProgramData', 'PATHEXT', 'COMSPEC', 'PROCESSOR_ARCHITECTURE',
  ];
  return Object.fromEntries(allowed
    .filter((name) => typeof process.env[name] === 'string')
    .map((name) => [name, process.env[name]]));
}

async function installWindowBounds(pid, width, height) {
  assert.ok(Number.isInteger(pid) && pid > 0);
  assert.ok(width >= 390 && width <= 1600 && height >= 480 && height <= 1200);
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System; using System.Runtime.InteropServices; public static class OmniWindowBounds {',
    '[DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '}',
    '"@',
    `$process = Get-Process -Id ${pid} -ErrorAction Stop`,
    'if ($process.MainWindowHandle -eq 0) { throw "Installed main window handle is unavailable" }',
    `[OmniWindowBounds]::SetWindowPos($process.MainWindowHandle, [IntPtr]::Zero, 80, 80, ${width}, ${height}, 0x0040) | Out-Null`,
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `native installed-window resize failed: ${result.stderr || result.stdout}`);
}

function getInstalledWindowState(pid, windowHandle = null) {
  assert.ok(Number.isInteger(pid) && pid > 0);
  if (windowHandle !== null) assert.ok(Number.isInteger(windowHandle) && windowHandle > 0);
  const handleExpression = windowHandle === null ? '$process.MainWindowHandle' : `[IntPtr]${windowHandle}`;
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System; using System.Runtime.InteropServices; public static class OmniWindowState {',
    '[DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '}',
    '"@',
    `$process = Get-Process -Id ${pid} -ErrorAction Stop`,
    `$windowHandle = ${handleExpression}`,
    'if ($windowHandle -eq [IntPtr]::Zero) { throw "Installed main window handle is unavailable" }',
    '[pscustomobject]@{ handle = [int64]$windowHandle; visible = [OmniWindowState]::IsWindowVisible($windowHandle) } | ConvertTo-Json -Compress',
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  try {
    const state = JSON.parse(String(result.stdout || '').trim());
    const handle = Number(state.handle);
    if (!Number.isInteger(handle) || handle <= 0) return null;
    return { handle, visible: state.visible === true };
  } catch {
    return null;
  }
}

function requestInstalledWindowClose(pid, windowHandle = null) {
  const state = getInstalledWindowState(pid, windowHandle);
  assert.ok(state, 'installed main window handle is unavailable');
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System; using System.Runtime.InteropServices; public static class OmniWindowClose {',
    '[DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);',
    '}',
    '"@',
    `$process = Get-Process -Id ${pid} -ErrorAction Stop`,
    `$windowHandle = [IntPtr]${state.handle}`,
    '$posted = [OmniWindowClose]::PostMessage($windowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)',
    'if (-not $posted) { throw "Could not post WM_CLOSE to the installed main window" }',
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `native installed-window WM_CLOSE failed: ${result.stderr || result.stdout}`);
  return state.handle;
}

function listeningPids(port) {
  if (!Number.isInteger(port) || port <= 0) return [];
  const netstat = spawnSync('C:\\Windows\\System32\\netstat.exe', ['-ano'], {
    windowsHide: true,
    encoding: 'utf8',
  }).stdout || '';
  const pids = new Set();
  for (const line of String(netstat).split(/\r?\n/)) {
    if (!line.includes(`:${port}`) || !line.includes('LISTENING')) continue;
    const match = line.match(/\s(\d+)\s*$/);
    const ownerPid = match ? Number(match[1]) : 0;
    if (Number.isInteger(ownerPid) && ownerPid > 0) pids.add(ownerPid);
  }
  return [...pids];
}

async function waitForPortRelease(port, timeoutMs = 15_000) {
  await waitFor(() => listeningPids(port).length === 0, timeoutMs);
}

async function stopTree(pid) {
  if (!pid) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  try {
    process.kill(pid);
  } catch {
    // The taskkill call may already have terminated the desktop process.
  }
  // The packaged desktop process can leave its Brain child alive after the
  // WebView exits.  This profile is unique to the E2E run, so its pid file is
  // the narrow ownership handle needed to release the Brain process before restart.
  try {
    const pidFile = path.join(profileDir, 'Local', 'omni-context', 'data', 'brain-server.pid');
    const brainPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (Number.isInteger(brainPid) && brainPid > 0 && brainPid !== process.pid && brainPid !== pid) {
      spawnSync('taskkill', ['/PID', String(brainPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      try {
        process.kill(brainPid);
      } catch {
        // taskkill may already have completed the termination.
      }
    }
  } catch {
    // The app may not have started Brain or may already have removed the pid.
  }
  // WebView2's remote-debugging child can outlive the desktop process. Reclaim
  // only the listener on the port reserved by this E2E so the restart launches
  // a fresh WebView instead of attaching to stale application state.
  for (const webviewPid of listeningPids(cdpPort)) {
    if (webviewPid === process.pid || webviewPid === pid) continue;
    // Use taskkill so a WebView2 child that outlives the desktop process is
    // actually terminated before the next launch can claim this reserved CDP
    // port; process.kill alone is not a reliable force-stop on Windows.
    spawnSync('taskkill', ['/PID', String(webviewPid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    try { process.kill(webviewPid); } catch { /* already gone */ }
  }
  // Do not race a second installed launch against a stale WebView2 listener.
  // The port was reserved exclusively for this disposable E2E profile.
  await waitForPortRelease(cdpPort);
}

function verifyTrayAction(action, mainWindowHandle, mainProcessId) {
  assert.ok(Number.isInteger(mainWindowHandle) && mainWindowHandle > 0, 'tray verification requires the cached native main-window handle');
  assert.ok(Number.isInteger(mainProcessId) && mainProcessId > 0, 'tray verification requires the installed process id');
  const script = path.join(__dirname, 'scripts', 'verify-installed-tray.ps1');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Action', action, '-MainWindowHandle', String(mainWindowHandle), '-MainProcessId', String(mainProcessId),
  ], { windowsHide: true, encoding: 'utf8' });
  const output = [result.stderr, result.stdout].filter(Boolean).join('\n');
  assert.equal(result.status, 0, `installed system-tray ${action} failed: ${output}`);
}

function mockResponse(request) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const system = String(messages.find((message) => message.role === 'system')?.content || '');
  const user = String([...messages].reverse().find((message) => message.role === 'user')?.content || '');
  if (system.includes('information extractor for a knowledge graph')) {
    return JSON.stringify({
      entities: [
        { name: 'Project Aurora', type: 'project', description: 'Project Aurora currently uses Option A for its local-first architecture. A local-first memory fixture used by the installed E2E.' },
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
  const state = {
    disconnectExtractors: false,
    holdNextExtraction: false,
    disconnectedRequests: 0,
    heldRequests: 0,
    extractionCalls: 0,
    askCalls: 0,
  };
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
        let request;
        try { request = JSON.parse(raw || '{}'); }
        catch { res.statusCode = 400; res.end(JSON.stringify({ error: 'invalid fixture payload' })); return; }
        const system = String(request.messages?.find((message) => message.role === 'system')?.content || '');
        const isExtraction = system.includes('information extractor for a knowledge graph');
        if (isExtraction && state.disconnectExtractors) {
          state.disconnectedRequests++;
          req.socket.destroy();
          return;
        }
        if (isExtraction && state.holdNextExtraction) {
          state.holdNextExtraction = false;
          state.heldRequests++;
          // The installed process is intentionally stopped by the test while
          // this loopback request is pending, modeling an interrupted import.
          return;
        }
        if (isExtraction) state.extractionCalls++;
        else state.askCalls++;
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
  return {
    server,
    state,
    setDisconnected(value) { state.disconnectExtractors = Boolean(value); },
    holdNext() { state.holdNextExtraction = true; },
  };
}

async function startInstalledApp() {
  const child = spawn(executable, [], {
    env: {
      ...getWindowsRuntimeEnvironment(),
      LOCALAPPDATA: path.join(profileDir, 'Local'),
      APPDATA: path.join(profileDir, 'Roaming'),
      // Keep WebView2's renderer storage in the same unique disposable profile
      // as the native data directory. Without this explicit path, unpackaged
      // WebView2 may resolve its default user-data directory outside the
      // overridden LOCALAPPDATA, making localStorage-backed import recovery
      // disappear across a real process restart.
      WEBVIEW2_USER_DATA_FOLDER: webviewUserDataDir,
      TEMP: path.join(e2eRoot, 'temp'),
      TMP: path.join(e2eRoot, 'temp'),
      OMNI_UDP_BIND: `127.0.0.1:${udpPort}`,
      OMNI_BRAIN_PORT: String(brainPort),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
      LLM_API_URL: `http://127.0.0.1:${mockPort}/v1`,
      LLM_MODEL: 'omni-installed-e2e-mock',
    },
    detached: false,
    stdio: 'ignore',
    windowsHide: false,
  });
  try {
    // A hard-stop recovery can leave the packaged Brain child in its bounded
    // 120 s startup window while Windows releases the isolated profile and
    // native WebView2 resources. Keep the real health + CDP barrier intact,
    // but allow a bounded margin instead of failing before the product's
    // documented startup timeout can elapse.
    await waitFor(async () => {
      if (child.exitCode !== null) return false;
      const [health, cdp] = await Promise.all([
        fetch(fixtureApiUrl('/health')).then((response) => response.ok),
        fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((response) => response.ok),
      ]);
      return health && cdp;
    }, 180_000);
  } catch (error) {
    await stopTree(child.pid);
    throw error;
  }
  return child;
}

async function connectMainPage() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const context = browser.contexts()[0];
  const page = await waitFor(async () => {
    for (const candidate of context.pages()) {
      // The fresh profile can select either locale from the hosted runner's
      // Windows language. The main window has a stable semantic header; avoid
      // tying CDP discovery to one translated subtitle or to transient splash
      // copy, and do not accidentally attach to the HUD window.
      const title = await candidate.locator('header h1').textContent().catch(() => '');
      if (title?.includes('Omni-Context')) return candidate;
    }
    return null;
  });
  return { browser, page };
}

async function closeConnection(browser) {
  // For a CDP attachment, disconnect the transport without asking WebView2 to exit.
  await browser.close().catch(() => {});
}

async function flushRendererStorage(page) {
  // WebView2 commits localStorage asynchronously. Ask the renderer to expose
  // the CDP storage flush when available, then keep the value alive in the
  // page so the following hard process stop cannot race the profile commit.
  const persisted = await page.evaluate(() => {
    const key = 'omni-context.pending-import-jobs.v1';
    const value = window.localStorage.getItem(key);
    if (value !== null) window.localStorage.setItem(key, value);
    return value;
  });
  assert.ok(persisted, 'installed renderer did not expose the pending import recovery record before restart');
  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Storage.flushDataForOrigin', { origin: new URL(page.url()).origin });
    await client.detach().catch(() => {});
  } catch {
    // Older WebView2 builds may not expose this Chromium command. The
    // renderer reload and the bounded settle window remain the fallback gate.
  }
}

function trackUploadSubmissions(page, getCount) {
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/ingest/file') getCount.increment();
  });
}

async function run() {
  await initializePorts();
  assert.ok(fs.existsSync(executable), `MSI-installed executable not found: ${executable}`);
  verifyInstalledMsiProvenance();
  fs.mkdirSync(e2eRoot, { recursive: true });
  assert.ok(!fs.existsSync(profileDir), 'refusing to replace an existing E2E profile directory');
  assert.ok(!fs.existsSync(evidenceDir), 'refusing to replace an existing E2E evidence directory');
  fs.mkdirSync(evidenceDir, { recursive: false });
  fs.mkdirSync(path.join(e2eRoot, 'temp'), { recursive: true });
  const localDataDir = path.join(profileDir, 'Local', 'omni-context', 'data');
  fs.mkdirSync(localDataDir, { recursive: true });
  fs.mkdirSync(path.join(profileDir, 'Roaming'), { recursive: true });
  fs.mkdirSync(webviewUserDataDir, { recursive: true });
  assert.ok(fs.existsSync(legacyDatabasePath), 'synthetic v30 database fixture is unavailable');
  const installedDatabasePath = path.join(localDataDir, 'omni-context.db');
  assert.ok(!fs.existsSync(installedDatabasePath), 'refusing to overwrite the isolated installed-app database');
  fs.copyFileSync(legacyDatabasePath, installedDatabasePath, fs.constants.COPYFILE_EXCL);
  pass('synthetic-v30-database-staged-in-isolated-profile');
  const interruptedFixturePath = path.join(evidenceDir, '15-windows-interrupted-fixture.txt');
  fs.writeFileSync(
    fixturePath,
    'E2E_RECOVERY_OUTAGE Project Aurora currently uses Option A for its local-first architecture. Option B remains the revision candidate.\n',
    'utf8',
  );
  fs.writeFileSync(interruptedFixturePath, 'E2E_HOLD_PENDING_IMPORT A controlled in-progress import used only for restart-recovery verification.\n', 'utf8');
  const mock = await startMock();
  const uploadSubmissions = { value: 0, increment() { this.value++; } };
  let app = null;
  let browser = null;
  try {
    app = await startInstalledApp();
    const localToken = readInstalledAppToken();
    const unauthenticated = await fetch(fixtureApiUrl('/api/entities'));
    assert.ok([401, 403].includes(unauthenticated.status), `unauthenticated local request returned ${unauthenticated.status}`);
    const authenticated = await fetch(fixtureApiUrl('/api/entities'), { headers: { Authorization: `Bearer ${localToken}` } });
    assert.equal(authenticated.status, 200, 'installed local token did not authorize the local API');
    pass('installed-local-api-authorization');

    const unauthenticatedMcp = await fetch(fixtureApiUrl('/mcp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'unauthenticated-list', method: 'tools/list', params: {} }),
    });
    assert.equal(unauthenticatedMcp.status, 401, 'MCP accepted a request without local authorization');
    const mcpHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localToken}`,
    };
    const mcpListResponse = await fetch(fixtureApiUrl('/mcp'), {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 'authorized-list', method: 'tools/list', params: {} }),
    });
    assert.equal(mcpListResponse.status, 200);
    const mcpList = await mcpListResponse.json();
    const mcpTools = mcpList.result?.tools || [];
    assert.ok(mcpTools.some((tool) => tool.name === 'get_entity'), 'authorized MCP tool list omitted get_entity');
    assert.ok(!mcpTools.some((tool) => tool.name.startsWith('agent_')), 'ordinary local authorization exposed Agent Pilot tools');
    const legacyReadResponse = await fetch(fixtureApiUrl('/mcp'), {
      method: 'POST',
      headers: mcpHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'legacy-read', method: 'tools/call',
        params: { name: 'get_entity', arguments: { id: 'legacy-v30-installed-fixture' } },
      }),
    });
    assert.equal(legacyReadResponse.status, 200);
    const legacyRead = await legacyReadResponse.json();
    assert.equal(legacyRead.result?.isError, undefined, `installed MCP could not read the preserved v30 record: ${JSON.stringify(legacyRead.result)}`);
    const legacyText = legacyRead.result?.content?.find((item) => item?.type === 'text')?.text;
    let legacyPayload;
    try { legacyPayload = JSON.parse(legacyText || ''); } catch { legacyPayload = null; }
    assert.equal(
      legacyPayload?.entity?.id,
      'legacy-v30-installed-fixture',
      `installed MCP returned unexpected legacy payload: ${JSON.stringify(legacyRead.result)}`,
    );
    assert.equal(
      legacyPayload?.entity?.description,
      'Synthetic data from the pre-receipt desktop database schema.',
      `installed MCP returned unexpected legacy description: ${JSON.stringify(legacyRead.result)}`,
    );
    pass('installed-mcp-auth-readonly-tools-and-v30-migration');

    let connection = await connectMainPage();
    browser = connection.browser;
    let page = connection.page;
    page.on('dialog', (dialog) => dialog.accept());
    trackUploadSubmissions(page, uploadSubmissions);

    // A fresh installed profile opens the first-run wizard before the main
    // controls can receive pointer events. Dismiss it explicitly so the
    // installed journey exercises the same settings/import surface a user
    // reaches after completing or skipping onboarding.
    const onboardingPanel = page.locator('[data-retained-panel="onboarding"]');
    await onboardingPanel.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    const onboardingSkip = onboardingPanel.getByRole('button', { name: /跳过引导|Skip Tour/i }).first();
    if (await onboardingSkip.isVisible().catch(() => false)) {
      await clickAfterRerender(onboardingSkip);
      await onboardingPanel.waitFor({ state: 'hidden', timeout: 10_000 });
    }

    await page.getByRole('button', { name: /^设置$|^Settings$/ }).click();
    await page.getByRole('button', { name: /大模型配置|LLM Provider|LLM Configuration|模型服务/i }).click();
    const llmPanel = page.getByRole('heading', { name: /大模型配置|LLM Provider|LLM Configuration|模型服务/i }).locator('..').locator('..');
    const llmTextInputs = llmPanel.locator('input[type="text"]');
    await llmTextInputs.first().fill(`http://127.0.0.1:${mockPort}/v1`);
    await llmTextInputs.last().fill('omni-installed-e2e-mock');
    await page.getByRole('button', { name: /测试连接|Test connection/i }).click();
    // The success copy is localized and the English translation is phrased
    // as "Connected successfully! Config saved." rather than the noun phrase
    // "Connection successful". Match the semantic success state across both
    // locales so a healthy provider check cannot be reported as a timeout.
    await page.getByText(/连接成功|Connected successfully|Connection successful/i).last().waitFor({ timeout: 30_000 });
    const settingsHeading = page.getByRole('heading', { name: /^设置$|^Settings$/ });
    await settingsHeading.locator('..').locator('..').locator('button').click();
    pass('installed-ui-local-llm-config');

    const demo = page.getByRole('button', { name: /加载示例图谱|Onboarding Demo/ });
    if (await demo.isVisible().catch(() => false)) {
      const demoResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/admin/seed-demo')
          && response.request().method() === 'POST',
        { timeout: 30_000 },
      );
      await demo.click();
      const demoResponse = await demoResponsePromise;
      const demoPayload = await demoResponse.json().catch(() => null);
      assert.equal(
        demoResponse.ok(),
        true,
        `onboarding demo failed: HTTP ${demoResponse.status()} ${JSON.stringify(demoPayload)}`,
      );
      assert.equal(
        demoPayload?.success === true || demoPayload?.skipped === true,
        true,
        `onboarding demo returned an unexpected payload: ${JSON.stringify(demoPayload)}`,
      );
      await demo.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {});
    }
    pass('installed-ui-launch-onboarding');

    await page.getByRole('button', { name: /上传文件|Upload file/i }).click();
    const uploadInput = page.locator('input[type="file"]').first();
    mock.setDisconnected(true);
    await uploadInput.setInputFiles(fixturePath);
    await waitFor(() => uploadSubmissions.value === 1, 20_000);
    await uploadInput.setInputFiles(fixturePath);
    await page.getByRole('status').filter({ hasText: /已忽略 1 个重复文件/ }).waitFor({ timeout: 20_000 });
    assert.equal(uploadSubmissions.value, 1, 'duplicate selection submitted a second import request');
    const failedUpload = page.locator('ul[aria-label="导入任务"] li').filter({ hasText: path.basename(fixturePath) }).first();
    await failedUpload.getByRole('button', { name: /已核对记忆库，允许重新选择/ }).waitFor({ timeout: 90_000 });
    assert.ok(mock.state.disconnectedRequests > 0, 'the loopback provider outage did not interrupt extraction');
    await page.screenshot({ path: path.join(evidenceDir, '15-windows-import-failure-recovery.png'), fullPage: true });
    pass('installed-ui-import-outage-and-duplicate-guard');

    mock.setDisconnected(false);
    await failedUpload.getByRole('button', { name: /已核对记忆库，允许重新选择/ }).click();
    await uploadInput.setInputFiles(fixturePath);
    await waitFor(() => uploadSubmissions.value === 2, 20_000);
    const completedUpload = page.locator('ul[aria-label="导入任务"] li[data-status="success"]')
      .filter({ hasText: path.basename(fixturePath) }).first();
    await completedUpload.waitFor({ timeout: 90_000 });
    pass('installed-ui-explicit-import-recovery');

    const uploadTask = completedUpload;
    const uploadOverlay = page.locator('div.absolute.inset-0.z-30').filter({ has: uploadTask });
    await uploadOverlay.getByRole('button', { name: 'close' }).click();
    await uploadOverlay.waitFor({ state: 'hidden' });

    const search = page.getByRole('textbox', { name: /搜索节点|Search nodes/i });
    await search.fill('Project Aurora');
    await search.press('Enter');
    await page.getByText('Project Aurora', { exact: true }).first().waitFor({ timeout: 30_000 });
    pass('installed-ui-search');

    const ask = page.getByTestId('ask-primary-input');
    await ask.fill('What is Project Aurora?');
    await ask.press('Enter');
    await page.getByText('Project Aurora is grounded in the imported local-first fixture.', { exact: false }).waitFor({ timeout: 60_000 });
    pass('installed-ui-qa');

    const citation = page.getByTestId('ask-source-citation').first();
    await citation.waitFor({ timeout: 30_000 });
    const citedId = await citation.getAttribute('data-source-id');
    assert.match(citedId || '', /^[0-9a-f-]{36}$/i, 'Ask citation did not carry a persistent entity ID');
    await citation.click();
    const sourceDialog = page.getByTestId('ask-source-dialog');
    await sourceDialog.waitFor({ timeout: 20_000 });
    await waitFor(async () => (await sourceDialog.getAttribute('data-source-status')) === 'ready', 20_000);
    assert.equal(await sourceDialog.getAttribute('data-source-id'), citedId);
    assert.match(await sourceDialog.innerText(), /来源记忆|Source memory/);
    assert.match(await sourceDialog.innerText(), /Project Aurora currently uses Option A/,
      'source details did not match the imported fixture content');
    await page.screenshot({ path: path.join(evidenceDir, '15-windows-source-verification.png'), fullPage: true });
    await sourceDialog.getByRole('button', { name: /关闭来源详情|Close source details/i }).click();
    pass('installed-ui-source-id-readback');

    const followUp = page.getByTestId('ask-follow-input');
    const asksBeforeFollowUp = mock.state.askCalls;
    await followUp.fill('Can you restate what the imported source says?');
    await followUp.press('Enter');
    // The previous turn has the same fixture conclusion. Wait for the new
    // provider request before checking that conclusion, otherwise the locator
    // can match the old answer and make the call-count assertion race.
    await waitFor(() => mock.state.askCalls > asksBeforeFollowUp, 60_000);
    await page.getByText('Project Aurora is grounded in the imported local-first fixture.', { exact: false }).last().waitFor({ timeout: 60_000 });
    pass('installed-ui-continuous-ask');

    await installWindowBounds(app.pid, 420, 540);
    await waitFor(async () => page.evaluate(() => window.innerWidth <= 450 && window.innerHeight <= 600), 20_000);
    const narrowLayout = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    assert.ok(narrowLayout.width <= 450 && narrowLayout.height <= 600, `native window did not enter narrow bounds: ${JSON.stringify(narrowLayout)}`);
    assert.ok(narrowLayout.documentWidth <= narrowLayout.width + 2, `narrow layout has horizontal overflow: ${JSON.stringify(narrowLayout)}`);
    await page.screenshot({ path: path.join(evidenceDir, '15-windows-native-narrow-layout.png'), fullPage: true });
    await installWindowBounds(app.pid, 1400, 900);
    await waitFor(async () => page.evaluate(() => window.innerWidth > 800), 20_000);
    pass('installed-native-window-narrow-layout');

    const mainContext = browser.contexts()[0];
    await page.getByRole('button', { name: /弹出悬浮 HUD|Show floating HUD/i }).click();
    const hudPage = await waitFor(async () => {
      for (const candidate of mainContext.pages()) {
        if (candidate === page) continue;
        if (await candidate.getByRole('heading', { name: 'OMNI-CONTEXT', exact: true }).isVisible().catch(() => false)) return candidate;
      }
      return null;
    }, 20_000);
    await hudPage.getByRole('heading', { name: 'OMNI-CONTEXT', exact: true }).waitFor();
    await hudPage.screenshot({ path: path.join(evidenceDir, '15-windows-installed-hud.png'), fullPage: true });
    await hudPage.getByRole('button', { name: /隐藏悬浮 HUD|Hide floating HUD|Hide HUD/i }).click();
    pass('installed-native-hud-window');

    const mainWindowHandle = requestInstalledWindowClose(app.pid);
    await waitFor(() => getInstalledWindowState(app.pid, mainWindowHandle)?.visible === false, 20_000);
    assert.equal(await fetch(fixtureApiUrl('/health')).then((response) => response.ok), true, 'closing the main window stopped Brain instead of hiding to tray');
    verifyTrayAction('left-click', mainWindowHandle, app.pid);
    await waitFor(() => getInstalledWindowState(app.pid, mainWindowHandle)?.visible === true, 20_000);
    pass('installed-tray-icon-left-click-reopens-main-window');
    requestInstalledWindowClose(app.pid, mainWindowHandle);
    await waitFor(() => getInstalledWindowState(app.pid, mainWindowHandle)?.visible === false, 20_000);
    verifyTrayAction('menu-show', mainWindowHandle, app.pid);
    await waitFor(() => getInstalledWindowState(app.pid, mainWindowHandle)?.visible === true, 20_000);
    // A native tray restore can retain the pre-narrow bounds or return focus
    // to the shell while WebView2 is repainting. Reassert the same real window
    // size used by the product flow, then wait for the restored renderer to be
    // visible before continuing with pointer-driven acceptance.
    await installWindowBounds(app.pid, 1400, 900);
    await page.bringToFront();
    await waitFor(async () => {
      const viewport = await page.evaluate(() => ({
        visible: document.visibilityState === 'visible',
        width: window.innerWidth,
        height: window.innerHeight,
      })).catch(() => null);
      return Boolean(viewport?.visible && viewport.width > 800 && viewport.height > 600
        && await page.locator('header h1').isVisible().catch(() => false));
    }, 20_000);
    assert.equal(await fetch(fixtureApiUrl('/health')).then((response) => response.ok), true,
      'choosing Show Main Window from the tray menu stopped Brain');
    pass('installed-tray-context-menu-show-main-window');

    await ask.fill('Should we choose Option A for Project Aurora?');
    await ask.press('Enter');
    await page.getByText('Decision A: keep Option A for the initial release.', { exact: false }).waitFor({ timeout: 60_000 });
    // The installed runner can select either locale. The English command is
    // currently "I've decided · save to graph" (rather than containing the
    // word "decision"), so keep the assertion tied to the semantic command
    // instead of one translated label.
    const saveDecision = page.getByRole('button', { name: /我已决定|保存.*决|I've decided|save.*(?:decision|graph)/i });
    await saveDecision.click();
    await page.getByText(/已存为决策|Saved as decision/i).last().waitFor({ timeout: 30_000 });
    pass('installed-ui-decision-a');

    await followUp.fill('Update: should we choose Option B instead?');
    await followUp.press('Enter');
    await page.getByText('Decision B: revise the plan and choose Option B.', { exact: false }).waitFor({ timeout: 60_000 });
    const relation = page.locator('select:has(option[value="revises"])');
    await relation.selectOption('revises');
    await page.getByRole('button', { name: /我已决定|保存.*决|I've decided|save.*(?:decision|graph)/i }).click();
    await page.getByText(/已存为决策|Saved as decision/i).last().waitFor({ timeout: 30_000 });
    pass('installed-ui-decision-b-lineage');

    await openDecisionLog(page);
    await page.getByText('Decision A: keep Option A for the initial release.', { exact: false }).first().waitFor({ timeout: 30_000 });
    const decisionBButton = page.getByRole('button', { name: /Decision B: revise the plan/ }).first();
    const waitForDecisionB = () => waitFor(
      () => decisionBButton.isVisible().catch(() => false),
      30_000,
    );
    try {
      // The timeline fetch can observe Decision A before the just-written
      // Decision B is visible through the installed app's read path. Wait for
      // the actual timeline button, not merely the Ask answer text elsewhere.
      await waitForDecisionB();
    } catch {
      // Reopening the real panel forces one fresh list_entities read while
      // retaining the same assertion and bounded timeout.
      await clickAfterRerender(page.getByTitle('Esc'));
      await openDecisionLog(page);
      await waitForDecisionB();
    }
    await clickAfterRerender(decisionBButton);
    await page.screenshot({ path: path.join(evidenceDir, '15-windows-decision-lineage.png'), fullPage: true });
    const timelineText = await page.locator('body').innerText();
    assert.match(timelineText, /Decision A: keep Option A/);
    assert.match(timelineText, /Decision B: revise the plan/);
    pass('installed-ui-lineage-view');

    await page.screenshot({ path: path.join(evidenceDir, '15-windows-before-restart.png'), fullPage: true });
    await closeConnection(browser);
    browser = null;
    await stopTree(app.pid);
    app = null;
    await waitFor(async () => fetch(fixtureApiUrl('/health')).then(() => false).catch(() => true), 20_000);

    app = await startInstalledApp();
    connection = await connectMainPage();
    browser = connection.browser;
    page = connection.page;
    page.on('dialog', (dialog) => dialog.accept());
    trackUploadSubmissions(page, uploadSubmissions);
    const restartSearch = page.getByRole('textbox', { name: /搜索节点|Search nodes/i });
    await page.waitForTimeout(3_000);
    await waitFor(async () => {
      await restartSearch.fill('Project Aurora');
      await restartSearch.press('Enter');
      return page.getByText('Project Aurora', { exact: true }).first().isVisible();
    }, 60_000);
    pass('installed-ui-restart-persistence');

    mock.holdNext();
    await page.getByRole('button', { name: /上传文件|Upload file/i }).click();
    const interruptedInput = page.locator('input[type="file"]').first();
    const interruptedResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/ingest/file') && response.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await interruptedInput.setInputFiles(interruptedFixturePath);
    const interruptedResponse = await interruptedResponsePromise;
    assert.equal(interruptedResponse.ok(), true, `interrupted import submission failed: HTTP ${interruptedResponse.status()}`);
    const interruptedJobId = (await interruptedResponse.json()).jobId;
    assert.equal(typeof interruptedJobId, 'string');
    await waitFor(() => mock.state.heldRequests === 1, 30_000);
    assert.equal(uploadSubmissions.value, 3);
    // Verify the application persisted only the opaque job ID, without injecting
    // test credentials or source data into its local recovery record.
    const recoveryRecords = await page.evaluate(() => JSON.parse(localStorage.getItem('omni-context.pending-import-jobs.v1') || '[]'));
    assert.ok(Array.isArray(recoveryRecords));
    const recoveryRecord = recoveryRecords.find((record) => record.owner === 'file-drop' && record.jobId === interruptedJobId);
    assert.ok(recoveryRecord);
    assert.deepEqual(Object.keys(recoveryRecord).sort(), ['jobId', 'kind', 'owner', 'savedAt']);
    assert.doesNotMatch(JSON.stringify(recoveryRecord), /source|filename|credential|token|E2E_HOLD_PENDING_IMPORT/i);
    const runningReceipt = await waitFor(async () => {
      const response = await fetch(fixtureApiUrl(`/api/ingest/job/${encodeURIComponent(interruptedJobId)}`), {
        headers: { Authorization: `Bearer ${localToken}` },
      });
      if (!response.ok) return null;
      const snapshot = await response.json();
      return snapshot.status === 'running' ? snapshot : null;
    }, 30_000);
    assert.equal(runningReceipt.stage, 'extracting');
    await page.screenshot({ path: path.join(evidenceDir, '15-windows-before-interrupted-restart.png'), fullPage: true });

    const extractionsBeforeRestart = mock.state.extractionCalls;
    // WebView2 applies localStorage writes synchronously to the renderer, but
    // its profile database can commit asynchronously. A renderer reload forces
    // the real installed profile through its normal storage shutdown path before
    // the intentionally hard process stop below; the bounded settle window then
    // keeps the E2E from manufacturing a data-loss result that a normal user
    // close would not observe.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction((jobId) => {
      try {
        const records = JSON.parse(localStorage.getItem('omni-context.pending-import-jobs.v1') || '[]');
        return Array.isArray(records) && records.some((record) => (
          record?.owner === 'file-drop' && record?.kind === 'job' && record?.jobId === jobId
        ));
      } catch {
        return false;
      }
    }, interruptedJobId, { timeout: 30_000 });
    await flushRendererStorage(page);
    await page.waitForTimeout(5_000);
    await closeConnection(browser);
    browser = null;
    await stopTree(app.pid);
    app = null;
    await waitFor(async () => fetch(fixtureApiUrl('/health')).then(() => false).catch(() => true), 20_000);

    app = await startInstalledApp();
    connection = await connectMainPage();
    browser = connection.browser;
    page = connection.page;
    page.on('dialog', (dialog) => dialog.accept());
    trackUploadSubmissions(page, uploadSubmissions);
    await page.waitForFunction((jobId) => {
      try {
        const records = JSON.parse(localStorage.getItem('omni-context.pending-import-jobs.v1') || '[]');
        return Array.isArray(records) && records.some((record) => (
          record?.owner === 'file-drop' && record?.kind === 'job' && record?.jobId === jobId
        ));
      } catch {
        return false;
      }
    }, interruptedJobId, { timeout: 30_000 });
    // The retained import-task panel is mounted by the upload surface. Open
    // that user-facing surface first, then locate the task restored from the
    // interrupted run; querying the list before opening it races the panel's
    // lazy mount on a fresh WebView2 session.
    await page.getByRole('button', { name: /上传文件|Upload file/i }).click();
    const restoredTask = page.getByRole('list', { name: '导入任务' }).locator('li').filter({ hasText: '已恢复的文件导入任务' }).first();
    await restoredTask.getByRole('button', { name: /继续查询/ }).waitFor({ timeout: 30_000 });
    await restoredTask.getByRole('button', { name: /继续查询/ }).click();
    await restoredTask.waitFor({ state: 'visible' });
    await page.getByRole('list', { name: '导入任务' }).locator('li[data-status="partial"]')
      .filter({ hasText: '已恢复的文件导入任务' }).first().waitFor({ timeout: 30_000 });
    const acknowledgement = restoredTask.getByRole('button', { name: /已核对记忆库，允许重新选择/ });
    await acknowledgement.waitFor({ timeout: 30_000 });
    assert.equal(uploadSubmissions.value, 3, 'reopening the app silently re-uploaded the interrupted file');
    assert.equal(mock.state.extractionCalls, extractionsBeforeRestart, 'reopening the app replayed the interrupted source to the provider');
    const recoveredReceipt = await fetch(fixtureApiUrl(`/api/ingest/job/${encodeURIComponent(interruptedJobId)}`), {
      headers: { Authorization: `Bearer ${localToken}` },
    }).then((response) => response.json());
    assert.equal(recoveredReceipt.status, 'partial');
    assert.equal(recoveredReceipt.stage, 'interrupted');
    assert.equal(recoveredReceipt.error, 'This import was interrupted by an app restart. Review your library before importing again.');
    await page.screenshot({ path: path.join(evidenceDir, '15-windows-interrupted-import-recovered.png'), fullPage: true });
    pass('installed-ui-close-reopen-import-recovery-no-replay');

    await page.getByRole('button', { name: /^设置$|^Settings$/ }).click();
    await page.getByRole('button', { name: /数据管理|Data management/i }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /导出 JSON|Export JSON/i }).click();
    const download = await downloadPromise;
    await download.saveAs(exportPath);
    assert.ok(fs.statSync(exportPath).size > 1000);
    pass('installed-ui-export');

    const restoreInput = page.locator('input[type="file"][accept*="json"]').last();
    await restoreInput.setInputFiles(exportPath);
    await page.getByText(/恢复成功|Restored successfully|Restore succeeded/i).waitFor({ timeout: 60_000 });
    pass('installed-ui-restore');
    await page.screenshot({ path: path.join(evidenceDir, '15-windows-after-restore.png'), fullPage: true });
  } finally {
    if (browser) await closeConnection(browser);
    if (app) await stopTree(app.pid);
    await new Promise((resolve) => mock.server.close(resolve));
  }
}

function writeResult(status) {
  if (!evidenceDir || !fs.existsSync(evidenceDir)) return;
  const installRecord = JSON.parse(fs.readFileSync(installRecordPath, 'utf8'));
  const report = {
    evidence_kind: 'WINDOWS_INSTALLED_MSI_FIXTURE_E2E',
    status,
    source_commit: installRecord.source_commit,
    pull_request_head_sha: installRecord.pull_request_head_sha,
    msi_sha256: installRecord.msi_sha256,
    build_exe_sha256: installRecord.build_exe_sha256,
    installed_exe_sha256: installRecord.installed_exe_sha256,
    product_code: installRecord.product_code,
    completed_checks: completedChecks,
    not_verified: [
      'signed release installer and SmartScreen reputation',
      'real third-party model provider quality',
      'human usability study',
    ],
  };
  fs.writeFileSync(path.join(evidenceDir, 'windows-installed-e2e-results.json'),
    `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

run().then(() => {
  writeResult('PASS');
}).catch((error) => {
  try { writeResult('FAIL'); } catch { /* preserve the original acceptance failure */ }
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
