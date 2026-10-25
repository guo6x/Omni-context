const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { assertInside, assertProductionDependencies, prepareBundle } = require('./prepare-brain-bundle.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-brain-bundle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const brain = path.join(root, 'brain-server');
  const staging = path.join(root, 'desktop-daemon', 'src-tauri', 'brain-server');
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const lock = { lockfileVersion: 3, packages: {
    '': { name: 'omni-context-brain-server' },
    'node_modules/sqlite3': { version: '5.1.7', integrity: 'test-integrity' },
    'node_modules/dev-only': { version: '1.0.0', dev: true },
  } };
  write(path.join(brain, 'package.json'), { name: 'omni-context-brain-server', version: '0.1.1' });
  write(path.join(brain, 'package-lock.json'), lock);
  write(path.join(brain, 'tsconfig.json'), {});
  write(path.join(brain, 'src', 'api-server.ts'), "console.log('redacted');");
  write(path.join(staging, '..', 'tauri.conf.json'), {});
  write(path.join(staging, 'node_modules', '.package-lock.json'), { packages: {
    'node_modules/sqlite3': lock.packages['node_modules/sqlite3'],
  } });
  write(path.join(staging, 'node_modules', 'sqlite3', 'package.json'), { version: '5.1.7' });
  write(path.join(staging, 'node_modules', 'sqlite3', 'build', 'Release', 'node_sqlite3.node'), 'fake binding');
  write(path.join(staging, 'dist', 'api-server.js'), 'old private-title logger');
  write(path.join(staging, 'dist', 'obsolete.js'), 'old removed module');
  write(path.join(staging, 'models', 'preserve.txt'), 'existing model');
  const compile = (output) => {
    for (const name of ['api-server.js', 'mcp-server.js', 'mcp-proxy.js']) write(path.join(output, name), "console.log('redacted');");
  };
  const options = { compile, validateRuntime() {}, metadata: { commit: 'commit-fixture', tree: 'tree-fixture', clean: true } };
  return { root, brain, staging, write, options };
}

test('recompiles into fresh output, removes stale JS, preserves models and records non-private provenance', (t) => {
  const f = fixture(t);
  const manifest = prepareBundle(f.root, f.options);
  assert.equal(fs.readFileSync(path.join(f.staging, 'dist', 'api-server.js'), 'utf8'), "console.log('redacted');");
  assert.equal(fs.existsSync(path.join(f.staging, 'dist', 'obsolete.js')), false);
  assert.equal(fs.readFileSync(path.join(f.staging, 'models', 'preserve.txt'), 'utf8'), 'existing model');
  assert.equal(fs.readFileSync(path.join(f.staging, 'package-lock.json'), 'utf8'), fs.readFileSync(path.join(f.brain, 'package-lock.json'), 'utf8'));
  assert.equal(manifest.source_commit, 'commit-fixture');
  assert.equal(manifest.source_tree, 'tree-fixture');
  assert.equal(manifest.source_worktree_clean, true);
  assert.equal(Object.keys(manifest.dist_sha256).length, 3);
  assert.equal(JSON.stringify(manifest).includes(f.root), false);
  assert.equal(fs.readdirSync(f.staging).some((name) => name.startsWith('.prepare-')), false);
});

test('a compile failure or incomplete fresh output cannot silently reuse old dist', (t) => {
  const f = fixture(t);
  assert.throws(() => prepareBundle(f.root, { ...f.options, compile() { throw new Error('compile failed'); } }), /compile failed/);
  assert.throws(() => prepareBundle(f.root, { ...f.options, compile() {} }), /Fresh Brain output is missing/);
  assert.equal(fs.readFileSync(path.join(f.staging, 'dist', 'api-server.js'), 'utf8'), 'old private-title logger');
  assert.equal(fs.existsSync(path.join(f.staging, 'bundle-inputs.json')), false);
  assert.equal(fs.readdirSync(f.staging).some((name) => name.startsWith('.prepare-')), false);
});

test('rejects missing native binding and mismatched production package versions', (t) => {
  const f = fixture(t);
  f.write(path.join(f.staging, 'node_modules', 'sqlite3', 'package.json'), { version: '0.0.0' });
  assert.throws(() => assertProductionDependencies(f.brain, f.staging), /does not match its lock/);
  f.write(path.join(f.staging, 'node_modules', 'sqlite3', 'package.json'), { version: '5.1.7' });
  fs.unlinkSync(path.join(f.staging, 'node_modules', 'sqlite3', 'build', 'Release', 'node_sqlite3.node'));
  assert.throws(() => assertProductionDependencies(f.brain, f.staging), /native sqlite3 binding is missing/);
});

test('rejects development-only dependencies and source changes during compilation', (t) => {
  const f = fixture(t);
  f.write(path.join(f.staging, 'node_modules', '.package-lock.json'), { packages: {
    'node_modules/sqlite3': { version: '5.1.7', integrity: 'test-integrity' },
    'node_modules/dev-only': { version: '1.0.0' },
  } });
  assert.throws(() => prepareBundle(f.root, f.options), /development-only dependency/);
  f.write(path.join(f.staging, 'node_modules', '.package-lock.json'), { packages: {
    'node_modules/sqlite3': { version: '5.1.7', integrity: 'test-integrity' },
  } });
  assert.throws(() => prepareBundle(f.root, { ...f.options, compile(output) {
    f.options.compile(output);
    f.write(path.join(f.brain, 'src', 'api-server.ts'), 'changed during compilation');
  } }), /sources changed while compiling/);
});

test('refuses generated-resource operations on a root or outside directory', () => {
  const root = path.resolve(os.tmpdir(), 'omni-safe-bundle');
  assert.throws(() => assertInside(root, root), /outside its exact directory/);
  assert.throws(() => assertInside(root, path.resolve(root, '..', 'other-project')), /outside its exact directory/);
});

test('a newly added source during compilation also invalidates the bundle', (t) => {
  const f = fixture(t);
  assert.throws(() => prepareBundle(f.root, { ...f.options, compile(output) {
    f.options.compile(output);
    f.write(path.join(f.brain, 'src', 'new-file.ts'), 'new source');
  } }), /sources changed while compiling/);
});

test('a runtime-binding validation failure blocks packaging and does not create a success manifest', (t) => {
  const f = fixture(t);
  f.write(path.join(f.staging, 'bundle-inputs.json'), { stale_success: true });
  assert.throws(() => prepareBundle(f.root, { ...f.options, validateRuntime() { throw new Error('native load failed'); } }), /native load failed/);
  assert.equal(fs.existsSync(path.join(f.staging, 'bundle-inputs.json')), false);
});
