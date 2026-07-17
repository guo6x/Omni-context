import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveFullOmniRuntimeOptions } from '../src/runtime-options.mjs';

describe('full_omni runtime options', () => {
  it('requires an explicit external Brain Server root and exact product commit', () => {
    assert.throws(() => resolveFullOmniRuntimeOptions({}), /--brain-server-root/);
    assert.throws(() => resolveFullOmniRuntimeOptions({ brainServerRoot: 'D:/product/brain-server' }), /--expected-product-commit/);
    assert.throws(() => resolveFullOmniRuntimeOptions({
      brainServerRoot: 'D:/product/brain-server',
      expectedProductCommit: 'abc',
    }), /40-character Git SHA/);
  });

  it('normalizes an explicitly selected runtime and pins the selector version', () => {
    const result = resolveFullOmniRuntimeOptions({
      brainServerRoot: 'D:/product/brain-server',
      expectedProductCommit: '2e300acad083626285ff43b650717e66a04671dd',
      expectedSelectorVersion: 'evidence-selector-v2',
    });
    assert.strictEqual(result.brainServerRoot, path.resolve('D:/product/brain-server'));
    assert.strictEqual(result.expectedProductCommit, '2e300acad083626285ff43b650717e66a04671dd');
    assert.strictEqual(result.expectedSelectorVersion, 'evidence-selector-v2');
  });
});
