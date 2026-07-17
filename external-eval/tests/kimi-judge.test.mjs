import assert from 'node:assert/strict';
import test from 'node:test';
import {
  scoreWithDeps,
  buildJudgeInput,
  KIMI_JUDGE_MODEL,
  KIMI_MAX_RETRIES,
  KIMI_MAX_OUTPUT_TOKENS,
  METRIC_NAME,
} from '../scorers/kimi-longmemeval-v1.mjs';

function makeResult(questionId, hypothesis, abstained = false) {
  return { question_id: questionId, hypothesis, abstained };
}

function makeGold(questionId, questionType, question, answer) {
  return { question_id: questionId, question_type: questionType, question, answer };
}

function makeMockMoonshot(responses) {
  let callIndex = 0;
  return async () => {
    const response = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    if (response.error) throw new Error(response.error);
    return { content: response.content, usage: response.usage || { total_tokens: 10 } };
  };
}

test('Kimi judge: single-session-user correct answer labeled yes', async () => {
  const results = [makeResult('q1', 'Teal notebook')];
  const gold = [makeGold('q1', 'single-session-user', 'Which color?', 'Teal notebook')];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 1);
  assert.equal(metrics.metric_value, 1);
  assert.equal(metrics.metric_name, METRIC_NAME);
});

test('Kimi judge: single-session-assistant correct answer labeled yes', async () => {
  const results = [makeResult('q1', 'North Quay Map Museum')];
  const gold = [makeGold('q1', 'single-session-assistant', 'Which museum?', 'North Quay Map Museum')];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 1);
});

test('Kimi judge: multi-session correct answer labeled yes', async () => {
  const results = [makeResult('q1', 'Red flashlight and warm clothes')];
  const gold = [makeGold('q1', 'multi-session', 'What to pack?', 'Red flashlight and warm clothes')];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 1);
});

test('Kimi judge: knowledge-update correct latest answer labeled yes', async () => {
  const results = [makeResult('q1', 'Dock 7')];
  const gold = [makeGold('q1', 'knowledge-update', 'Where to deliver?', 'Dock 7')];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 1);
});

test('Kimi judge: single-session-preference correct answer labeled yes', async () => {
  const results = [makeResult('q1', 'Mint tea without sugar')];
  const gold = [makeGold('q1', 'single-session-preference', 'What drink?', 'Mint tea without sugar')];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 1);
});

test('Kimi judge: abstention with null hypothesis labeled yes', async () => {
  const results = [makeResult('q1', null, true)];
  const gold = [makeGold('q1', 'abstention', 'What is the passport number?', 'I do not know')];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 1);
});

test('Kimi judge: abstention with fabricated answer labeled no', async () => {
  const results = [makeResult('q1', 'ABC123456')];
  const gold = [makeGold('q1', 'abstention', 'What is the passport number?', 'I do not know')];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"no"}' }]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 0);
});

test('Kimi judge: temporal-reasoning off-by-one accepted', async () => {
  const results = [makeResult('q1', 'January 11')];
  const gold = [makeGold('q1', 'temporal-reasoning', 'Which date?', 'January 12')];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 1);
});

test('Kimi judge: non-yes/no output fails with schema validation', async () => {
  const results = [makeResult('q1', 'Some answer')];
  const gold = [makeGold('q1', 'single-session-user', 'What?', 'Some answer')];
  const callMoonshot = makeMockMoonshot([
    { content: '{"label":"maybe"}' },
    { content: '{"label":"maybe"}' },
    { content: '{"label":"maybe"}' },
  ]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.errors, 1);
  assert.equal(metrics.correct, 0);
});

test('Kimi judge: non-JSON output fails', async () => {
  const results = [makeResult('q1', 'Some answer')];
  const gold = [makeGold('q1', 'single-session-user', 'What?', 'Some answer')];
  const callMoonshot = makeMockMoonshot([
    { content: 'I think the answer is yes' },
    { content: 'I think the answer is yes' },
    { content: 'I think the answer is yes' },
  ]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.errors, 1);
});

test('Kimi judge: output with additional properties fails', async () => {
  const results = [makeResult('q1', 'Some answer')];
  const gold = [makeGold('q1', 'single-session-user', 'What?', 'Some answer')];
  const callMoonshot = makeMockMoonshot([
    { content: '{"label":"yes","confidence":0.9}' },
    { content: '{"label":"yes","confidence":0.9}' },
    { content: '{"label":"yes","confidence":0.9}' },
  ]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.errors, 1);
});

test('Kimi judge: wrong answer does not trigger retry (score-based retry forbidden)', async () => {
  const results = [makeResult('q1', 'Wrong answer')];
  const gold = [makeGold('q1', 'single-session-user', 'What?', 'Correct answer')];
  let callCount = 0;
  const callMoonshot = async () => {
    callCount++;
    return { content: '{"label":"no"}', usage: { total_tokens: 10 } };
  };
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(callCount, 1);
  assert.equal(metrics.correct, 0);
  assert.equal(metrics.scored, 1);
  assert.equal(metrics.errors, 0);
});

test('Kimi judge: 429 error triggers retry then success', async () => {
  const results = [makeResult('q1', 'Correct answer')];
  const gold = [makeGold('q1', 'single-session-user', 'What?', 'Correct answer')];
  const callMoonshot = makeMockMoonshot([
    { error: 'MOONSHOT_API_ERROR:429:rate limited' },
    { content: '{"label":"yes"}' },
  ]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 1);
});

test('Kimi judge: 5xx error triggers retry then success', async () => {
  const results = [makeResult('q1', 'Correct answer')];
  const gold = [makeGold('q1', 'single-session-user', 'What?', 'Correct answer')];
  const callMoonshot = makeMockMoonshot([
    { error: 'MOONSHOT_API_ERROR:500:server error' },
    { content: '{"label":"yes"}' },
  ]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 1);
});

test('Kimi judge: three failures result in error', async () => {
  const results = [makeResult('q1', 'Some answer')];
  const gold = [makeGold('q1', 'single-session-user', 'What?', 'Correct answer')];
  const callMoonshot = makeMockMoonshot([
    { error: 'MOONSHOT_API_ERROR:429:rate limited' },
    { error: 'MOONSHOT_API_ERROR:429:rate limited' },
    { error: 'MOONSHOT_API_ERROR:429:rate limited' },
  ]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.errors, 1);
  assert.equal(metrics.correct, 0);
});

test('Kimi judge: official_gpt4o_scoring_performed is false', async () => {
  const results = [makeResult('q1', 'Answer')];
  const gold = [makeGold('q1', 'single-session-user', 'What?', 'Answer')];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.official_gpt4o_scoring_performed, false);
  assert.equal(metrics.leaderboard_comparable, false);
});

test('Kimi judge: model and config constants are correct', () => {
  assert.equal(KIMI_JUDGE_MODEL, 'kimi-k2.6');
  assert.equal(KIMI_MAX_RETRIES, 2);
  assert.equal(KIMI_MAX_OUTPUT_TOKENS, 10);
});

test('buildJudgeInput only includes allowed fields', () => {
  const result = makeResult('q1', 'Answer');
  const gold = makeGold('q1', 'single-session-user', 'Question?', 'Reference');
  const input = buildJudgeInput(result, gold);
  assert.deepEqual(Object.keys(input).sort(), ['abstained', 'hypothesis', 'question', 'question_id', 'question_type', 'reference_answer'].sort());
});

test('Kimi judge: temperature_parameter_sent tracked when accepted', async () => {
  const results = [makeResult('q1', 'Answer')];
  const gold = [makeGold('q1', 'single-session-user', 'What?', 'Answer')];
  const callMoonshot = async () => ({ content: '{"label":"yes"}', usage: { total_tokens: 10 } });
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.temperature_parameter_sent, true);
  assert.equal(metrics.temperature_control, '0');
});

test('Kimi judge: temperature fallback when API rejects temperature=0', async () => {
  const results = [makeResult('q1', 'Answer')];
  const gold = [makeGold('q1', 'single-session-user', 'What?', 'Answer')];
  let firstCall = true;
  const callMoonshot = async ({ sendTemperature }) => {
    if (firstCall && sendTemperature) {
      firstCall = false;
      throw new Error('MOONSHOT_API_ERROR:400:temperature parameter not supported');
    }
    return { content: '{"label":"yes"}', usage: { total_tokens: 10 } };
  };
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.temperature_parameter_sent, false);
  assert.equal(metrics.temperature_control, 'provider_default_non_configurable');
  assert.equal(metrics.correct, 1);
});
