import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('answer.max_tokens is 1200 after proven truncation fix', () => {
  const configPath = path.join(ROOT, 'config', 'default.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.answer.max_tokens, 1200, 'answer.max_tokens must be 1200 after PROVEN_TOKEN_TRUNCATION fix');
});

test('answer.max_tokens is not 900 (previous truncated value)', () => {
  const configPath = path.join(ROOT, 'config', 'default.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.notEqual(config.answer.max_tokens, 900, 'answer.max_tokens must not be 900 (caused PROVEN_TOKEN_TRUNCATION)');
});
