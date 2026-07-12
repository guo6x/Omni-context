import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const [mode, syncService, componentExports] = await Promise.all([
  readFile(new URL('../src/config/productMode.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/syncService.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/index.ts', import.meta.url), 'utf8'),
]);

assert.match(mode, /MOBILE_PRODUCT_MODE = 'read-mostly-companion'/);
assert.match(mode, /MOBILE_WRITES_ENABLED = false/);
assert.doesNotMatch(componentExports, /QuickCapture/);
for (const method of ['addEntity', 'updateEntity', 'deleteEntity']) {
  const section = syncService.slice(syncService.indexOf(`async ${method}`));
  assert.match(section.slice(0, 240), /throw new Error\(READ_ONLY_ERROR\)/, `${method} must fail closed`);
}
assert.doesNotMatch(syncService.slice(syncService.indexOf('async sync()'), syncService.indexOf('async pullFromServer')), /api\.addEntity/);

console.log('mobile read-mostly product mode verified');
