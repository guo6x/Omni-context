import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { LLMClient } from '../src/llm-client.mjs';
import { formatEvidenceContext } from '../src/answer/evidence-context.mjs';

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

test('renders readable assertion evidence while keeping UUIDs out of fact text', () => {
  const subjectId = '11111111-1111-4111-8111-111111111111';
  const rendered = formatEvidenceContext([{
    id: 'assertion-1', type: 'assertion', fact: 'Caroline plans to study counseling.',
    subjectId, subjectName: 'Caroline', originalPredicate: 'has_goal',
    literalValue: 'counseling certification', source_span: 'I want to study counseling.',
    temporal_status: 'current', valid_from: '2023-01-01T00:00:00.000Z',
    valid_until: null, invalidated_at: null, confidence: 0.96,
  }]);
  assert.match(rendered, /Evidence ID: assertion-1/);
  assert.match(rendered, /Fact: Caroline plans to study counseling\./);
  assert.match(rendered, /Subject: Caroline/);
  assert.match(rendered, /Relation: has_goal/);
  assert.doesNotMatch(rendered, new RegExp(subjectId));
});

test('answer request uses labeled evidence blocks and preserves strict JSON mode', async () => {
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      answer: 'Caroline has a counseling goal.',
      claims: [{ text: 'Caroline has a counseling goal.', evidence_ids: ['a1'] }],
      abstained: false, abstention_reason: null,
    }) } }] }), { status: 200 });
  };
  const client = new LLMClient({
    answerApiUrl: 'https://provider.invalid', answerApiKey: 'fixture', answerModel: 'fixture-model',
    thinkingMode: 'disabled',
  });
  await client.answer('What is Caroline planning?', { evidence: [{
    id: 'a1', fact: 'Caroline plans to study counseling.', subjectName: 'Caroline',
    originalPredicate: 'has_goal', literalValue: 'counseling certification',
    source_span: 'I want to study counseling.', temporal_status: 'current', confidence: 0.9,
  }] }, 'strict prompt');
  const userContent = requestBody.messages[1].content;
  assert.match(userContent, /Evidence ID: a1/);
  assert.match(userContent, /Fact: Caroline plans to study counseling\./);
  assert.doesNotMatch(userContent, /"subjectId"/);
  assert.deepStrictEqual(requestBody.response_format, { type: 'json_object' });
  assert.deepStrictEqual(requestBody.thinking, { type: 'disabled' });
});
