import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { LLMClient } from '../src/llm-client.mjs';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('freezes strict JSON requests to the configured thinking and token settings', async () => {
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
    }), { status: 200 });
  };
  const client = new LLMClient({
    answerApiUrl: 'https://provider.invalid',
    answerApiKey: 'fixture',
    answerModel: 'fixture-model',
    thinkingMode: 'disabled',
    answerMaxTokens: 2048,
    judgeMaxTokens: 2048,
  });
  await client.chat({
    ...client.answerConfig,
    messages: [{ role: 'user', content: 'json' }],
    maxTokens: client.answerMaxTokens,
    responseFormat: { type: 'json_object' },
  });
  assert.deepStrictEqual(requestBody.thinking, { type: 'disabled' });
  assert.strictEqual(requestBody.max_tokens, 2048);
  assert.deepStrictEqual(requestBody.response_format, { type: 'json_object' });
});
