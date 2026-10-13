const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { patchContent, ORIGINAL, REPLACEMENT } = require('./patch-expo-tar.cjs');
const hash = (text) => createHash('sha256').update(text).digest('hex');
test('patch changes only the audited import and is idempotent', () => {
  const original = 'before\n' + ORIGINAL + '\nafter';
  const patched = patchContent(original, hash(original));
  assert.equal(patched, 'before\n' + REPLACEMENT + '\nafter');
  assert.equal(patchContent(patched, hash(original)), patched);
});
test('unknown, modified and multiply patched consumers fail closed', () => {
  const h = hash(ORIGINAL);
  for (const source of ['', ORIGINAL + '\nchanged', REPLACEMENT + '\nchanged', ORIGINAL + ORIGINAL, REPLACEMENT + REPLACEMENT]) {
    assert.throws(() => patchContent(source, h), /review required/);
  }
});
