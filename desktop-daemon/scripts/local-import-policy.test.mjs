import assert from 'node:assert/strict';
import test from 'node:test';
import { getImportErrorCode, responseImportErrorCode } from '../src/lib/import-error.ts';

test('recognizes the Brain local-only 409 snake_case error code', async () => {
  const response = new Response(JSON.stringify({
    error: 'Remote embeddings are not allowed for a local-only import.',
    error_code: 'LOCAL_ONLY_REMOTE_EMBEDDINGS',
  }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  });

  assert.equal(await responseImportErrorCode(response), 'LOCAL_ONLY_REMOTE_EMBEDDINGS');
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'Remote embeddings are not allowed for a local-only import.',
    error_code: 'LOCAL_ONLY_REMOTE_EMBEDDINGS',
  });
});

test('keeps compatibility with camelCase aliases and ignores malformed payloads', () => {
  assert.equal(getImportErrorCode({ code: 'CODE' }), 'CODE');
  assert.equal(getImportErrorCode({ errorCode: 'CAMEL_CODE' }), 'CAMEL_CODE');
  assert.equal(getImportErrorCode({ error_code: 'SNAKE_CODE' }), 'SNAKE_CODE');
  assert.equal(getImportErrorCode({ code: 409, error_code: 'SNAKE_CODE' }), 'SNAKE_CODE');
  assert.equal(getImportErrorCode(null), null);
  assert.equal(getImportErrorCode([]), null);
});
