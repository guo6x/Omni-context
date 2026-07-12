import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { assertPackagingSucceeded } = require('./package-guard.js');

test('packaging succeeds only when every required component completed', () => {
  assert.doesNotThrow(() => assertPackagingSucceeded([]));
  assert.throws(
    () => assertPackagingSucceeded(['desktop-app', 'browser-extension']),
    /desktop-app, browser-extension/,
  );
});
