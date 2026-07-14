#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SYNTHETIC_HELDOUT_GATE_CASES,
  executeSyntheticHeldOutGateCase,
} from '../tests/helpers/heldout-gate-fixture.mjs';

const outputIndex = process.argv.indexOf('--output');
if (outputIndex < 0 || !process.argv[outputIndex + 1]) {
  throw new Error('Usage: node scripts/heldout-gate-synthetic.mjs --output <path>');
}

const outputPath = path.resolve(process.argv[outputIndex + 1]);
const results = [];
for (const testCase of SYNTHETIC_HELDOUT_GATE_CASES) {
  const result = await executeSyntheticHeldOutGateCase(testCase.id);
  results.push({ name: testCase.name, expected: testCase.expected_status, ...result });
}

const failures = results.filter((result) => result.status !== result.expected);
const evidence = {
  schema_version: 1,
  suite: 'Omni-Context Evaluation Freeze v1 held-out gate synthetic tests',
  generated_at: new Date().toISOString(),
  fixture: 'synthetic-only',
  conversation_2_to_10_loaded: false,
  answer_called: false,
  judge_called: false,
  total: results.length,
  passed: results.length - failures.length,
  failed: failures.length,
  status: failures.length === 0 ? 'SYNTHETIC_GATE_PASS' : 'SYNTHETIC_GATE_FAIL',
  results,
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ status: evidence.status, total: evidence.total, passed: evidence.passed, failed: evidence.failed }));
if (failures.length > 0) process.exitCode = 1;
