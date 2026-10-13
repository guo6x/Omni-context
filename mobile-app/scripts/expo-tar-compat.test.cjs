const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const tar = require('tar');

// Exercise Expo's consumers, not just tar.c/x. No downloads, devices or APIs.
test('Expo CLI extracts local npm templates with patched tar', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-expo-tar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'package'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package', 'package.json'), JSON.stringify({ name: 'compat-fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(source, 'package', 'fixture.txt'), 'local template archive');
  fs.writeFileSync(path.join(source, 'package', 'HelloWorld.txt'), 'Hello App Display Name / HelloWorld / helloworld');
  fs.writeFileSync(path.join(source, 'package', 'gitignore'), 'node_modules/');
  const binary = Buffer.from([0, 255, 1, 254]);
  fs.writeFileSync(path.join(source, 'package', 'asset.png'), binary);
  const archive = path.join(root, 'template.tgz');
  await tar.c({ gzip: true, cwd: source, file: archive }, ['package']);
  const { extractLocalNpmTarballAsync } = require('@expo/cli/build/src/utils/npm.js');
  const output = path.join(root, 'template');
  await extractLocalNpmTarballAsync(archive, { cwd: output, name: 'RecoveryApp' });
  assert.equal(fs.readFileSync(path.join(output, 'RecoveryApp.txt'), 'utf8'), 'RecoveryApp / RecoveryApp / recoveryapp');
  assert.equal(fs.readFileSync(path.join(output, '.gitignore'), 'utf8'), 'node_modules/');
  assert.deepEqual(fs.readFileSync(path.join(output, 'asset.png')), binary);
  assert.equal(fs.readFileSync(path.join(output, 'fixture.txt'), 'utf8'), 'local template archive');
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8')).version, '1.0.0');
});

test('Expo CLI archive extraction works on the current platform', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-expo-extract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), output = path.join(root, 'output');
  fs.mkdirSync(source); fs.mkdirSync(output);
  fs.writeFileSync(path.join(source, 'fixture.txt'), 'archive roundtrip');
  const archive = path.join(root, 'fixture.tgz');
  await tar.c({ gzip: true, cwd: source, file: archive }, ['fixture.txt']);
  const { extractAsync } = require('@expo/cli/build/src/utils/tar.js');
  await extractAsync(archive, output);
  assert.equal(fs.readFileSync(path.join(output, 'fixture.txt'), 'utf8'), 'archive roundtrip');
});
