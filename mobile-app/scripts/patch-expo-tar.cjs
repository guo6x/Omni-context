// Expo 49's generated default import predates tar 7's named CommonJS exports.
// Preserve patched tar; change only the two known consumers, with fail-closed hashes.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ORIGINAL = 'var _tar = _interopRequireDefault(require("tar"));';
const REPLACEMENT = 'var _tar = { default: require("tar") }; // Omni: Expo 49 / tar 7 namespace compatibility';
const PATCHES = [
  ['tar.js', '922c6c83037f68258dbe613a45c6c899a02b8c735d1899b4fd42086b2a60eb30'],
  ['npm.js', 'ba23b10f9e018413b09e463b501f5ad19dd1f9c26f4ef6220306eb2e5d41fc10'],
];
const hash = (text) => createHash('sha256').update(text).digest('hex');
function patchContent(source, originalHash) {
  if (hash(source) === originalHash && source.split(ORIGINAL).length === 2) {
    return source.replace(ORIGINAL, REPLACEMENT);
  }
  if (source.split(REPLACEMENT).length === 2 && hash(source.replace(REPLACEMENT, ORIGINAL)) === originalHash) return source;
  throw new Error('Expo tar consumer differs from the audited original or exact patch; review required');
}
function applyPatch(root = path.resolve(__dirname, '..')) {
  const dependencies = fs.realpathSync(path.join(root, 'node_modules'));
  const cli = fs.realpathSync(path.join(dependencies, '@expo', 'cli'));
  if (!cli.startsWith(dependencies + path.sep)) throw new Error('Expo CLI resolves outside project dependencies');
  const version = JSON.parse(fs.readFileSync(path.join(cli, 'package.json'), 'utf8')).version;
  const tarVersion = JSON.parse(fs.readFileSync(path.join(dependencies, 'tar', 'package.json'), 'utf8')).version;
  if (version !== '0.10.17' || tarVersion !== '7.5.22') throw new Error('Re-audit compatibility patch before changing Expo CLI or tar versions');
  // Preflight both files before writing either. Unknown source fails install.
  const planned = PATCHES.map(([name, originalHash]) => {
    const file = path.join(cli, 'build', 'src', 'utils', name);
    if (fs.realpathSync(file) !== file) throw new Error('Refusing redirected Expo source file');
    const before = fs.readFileSync(file, 'utf8');
    return { file, before, after: patchContent(before, originalHash) };
  });
  for (const { file, before, after } of planned) if (after !== before) fs.writeFileSync(file, after);
  console.log('[expo-tar-compat] verified Expo CLI 0.10.17 + tar 7.5.22; both consumers patched');
}
module.exports = { patchContent, ORIGINAL, REPLACEMENT };
if (require.main === module) applyPatch();
