// Tauri's resource glob copies existing files; it does not compile the Brain.
// Always compile fresh output, then replace only this checkout's generated dist.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REQUIRED_OUTPUTS = ['api-server.js', 'mcp-server.js', 'mcp-proxy.js'];
const SQLITE_BINDING = 'node_modules/sqlite3/build/Release/node_sqlite3.node';
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function assertInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Refusing a generated-resource operation outside its exact directory');
  }
  let current = path.resolve(root);
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('Generated-resource paths must not contain symbolic links or junctions');
    }
  }
}

function filesIn(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      if (entry.isSymbolicLink()) throw new Error('Bundle inputs must not contain symbolic links');
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? filesIn(path.join(dir, entry.name), relative) : [relative];
    });
}

function hashFiles(dir, files) {
  return Object.fromEntries(files.map((file) => [file, sha256(path.join(dir, file))]));
}

function assertProductionDependencies(brainRoot, staging) {
  const lock = readJson(path.join(brainRoot, 'package-lock.json'));
  const installedPath = path.join(staging, 'node_modules', '.package-lock.json');
  const help = 'Prepare the generated src-tauri/brain-server package.json and package-lock.json from brain-server, '
    + 'then run npm ci --omit=dev --no-audit --no-fund in that generated directory. No install was attempted.';
  if (!fs.existsSync(installedPath)) throw new Error(`Brain production dependencies are missing. ${help}`);
  const installed = readJson(installedPath);
  if (!lock.packages || !installed.packages) throw new Error(`A package-lock v2/v3 is required. ${help}`);
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name || entry.dev || (entry.optional && !installed.packages[name])) continue;
    const folder = path.resolve(staging, name);
    assertInside(staging, folder);
    const actual = installed.packages[name];
    const manifest = path.join(folder, 'package.json');
    if (!actual || actual.version !== entry.version || actual.integrity !== entry.integrity
      || !fs.existsSync(manifest) || readJson(manifest).version !== entry.version) {
      throw new Error(`Brain production dependency does not match its lock: ${name}. ${help}`);
    }
  }
  for (const name of Object.keys(installed.packages)) {
    if (!lock.packages[name] || lock.packages[name].dev) {
      throw new Error(`Unexpected or development-only dependency in the Brain bundle: ${name}. ${help}`);
    }
  }
  assertInside(staging, path.join(staging, SQLITE_BINDING));
  if (!fs.existsSync(path.join(staging, SQLITE_BINDING))) {
    throw new Error(`The native sqlite3 binding is missing. ${help}`);
  }
}

function runNode(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd, stdio: 'inherit', windowsHide: true,
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
  });
  if (result.error || result.status !== 0) throw new Error('Brain bundle compilation or runtime validation failed');
}

function gitValue(root, ref) {
  const result = spawnSync('git', ['rev-parse', ref], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Cannot record the source commit/tree for this bundle');
  return result.stdout.trim();
}

function worktreeClean(root) {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('Cannot verify the source worktree state');
  return !result.stdout.trim();
}

function prepareBundle(root, { compile, validateRuntime, metadata } = {}) {
  root = fs.realpathSync(root);
  const brainRoot = path.join(root, 'brain-server');
  const staging = path.join(root, 'desktop-daemon', 'src-tauri', 'brain-server');
  assertInside(root, staging);
  if (readJson(path.join(brainRoot, 'package.json')).name !== 'omni-context-brain-server'
    || !fs.existsSync(path.join(root, 'desktop-daemon', 'src-tauri', 'tauri.conf.json'))) {
    throw new Error('Not an Omni-context checkout; refusing to modify generated resources');
  }
  const manifestPath = path.join(staging, 'bundle-inputs.json');
  assertInside(staging, manifestPath);
  fs.rmSync(manifestPath, { force: true });
  assertProductionDependencies(brainRoot, staging);
  const sourceHashesNow = () => hashFiles(brainRoot, [
    'package.json', 'package-lock.json', 'tsconfig.json',
    ...filesIn(path.join(brainRoot, 'src')).map((f) => `src/${f}`),
  ]);
  const sourceHashes = sourceHashesNow();
  const temp = fs.mkdtempSync(path.join(staging, '.prepare-'));
  try {
    const output = path.join(temp, 'dist');
    if (compile) compile(output);
    else runNode([require.resolve('typescript/bin/tsc', { paths: [brainRoot] }), '--project', 'tsconfig.json', '--outDir', output], brainRoot);
    for (const file of REQUIRED_OUTPUTS) {
      if (!fs.existsSync(path.join(output, file))) throw new Error(`Fresh Brain output is missing ${file}`);
    }
    if (JSON.stringify(sourceHashes) !== JSON.stringify(sourceHashesNow())) {
      throw new Error('Brain sources changed while compiling; retry from the intended clean commit');
    }
    const outputHashes = hashFiles(output, filesIn(output));
    const dist = path.join(staging, 'dist');
    assertInside(staging, dist);
    fs.rmSync(dist, { recursive: true, force: true });
    fs.renameSync(output, dist);
    for (const file of ['package.json', 'package-lock.json']) {
      assertInside(staging, path.join(staging, file));
      fs.copyFileSync(path.join(brainRoot, file), path.join(staging, file));
    }
    const runtime = path.join(staging, process.platform === 'win32' ? 'node.exe' : 'node');
    assertInside(staging, runtime);
    fs.copyFileSync(process.execPath, runtime);
    if (validateRuntime) validateRuntime(runtime, staging);
    else {
      const result = spawnSync(runtime, ['-e', "const sqlite = require('sqlite3'); if (!sqlite.Database) process.exit(1); console.log('Bundled Node/sqlite3 native binding: PASS');"], {
        cwd: staging, stdio: 'inherit', windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
      });
      if (result.error || result.status !== 0) throw new Error('Bundled Node cannot load its sqlite3 native binding');
    }
    const manifest = {
      schema_version: 1,
      source_commit: metadata?.commit || gitValue(root, 'HEAD'),
      source_tree: metadata?.tree || gitValue(root, 'HEAD^{tree}'),
      source_worktree_clean: metadata?.clean ?? worktreeClean(root),
      built_at_utc: new Date().toISOString(),
      node_version: process.version,
      node_sha256: sha256(runtime),
      sqlite_binding_sha256: sha256(path.join(staging, SQLITE_BINDING)),
      source_sha256: sourceHashes,
      dist_sha256: outputHashes,
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Fresh Brain bundle prepared: ${Object.keys(outputHashes).length} files; source ${manifest.source_commit}`);
    return manifest;
  } finally {
    assertInside(staging, temp);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { prepareBundle(path.resolve(__dirname, '..', '..')); }
  catch (error) { console.error(`[Brain bundle] ${error.message}`); process.exitCode = 1; }
}

module.exports = { assertInside, assertProductionDependencies, prepareBundle };
