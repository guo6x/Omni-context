// Goal20X offline request reconstruction for tuple 711/A3 (+ controls) across runs.
// Imports the frozen executor + harness builders. Zero provider calls.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const OUT = 'D:\\ai_code\\Omni-context\\goal20x-output';
const EXEC = 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\executor\\src';
const HARNESS = 'D:\\ai_code\\Omni-context\\goal20-cross-machine-handoff\\execution-snapshot\\experiments\\decision-benchmark\\ablation';
const PRODUCT = 'D:\\ai_code\\Omni-context-decision-kernel-v1';

const { buildArmContext } = await import(pathToFileURL(path.join(EXEC, 'arm-execution.mjs')));
const { renderPrompt, buildRequestBody } = await import(pathToFileURL(path.join(EXEC, 'prompt-renderer.mjs')));

const RUNS = {
  v22: { epoch: 'v2', run_id: '2026-08-10T11-42-57-026Z-5c9e078d', dir: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\runs\\goal20-formal-validation-v1\\2026-08-10T11-42-57-026Z-5c9e078d', fixture: 'D:\\ai_code\\Omni-context\\goal18he-output\\validation-v2-fixture.jsonl', precommit: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\governance\\goal20-formal-tuple-precommit.jsonl', sealed: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\governance\\sealed-harness-module-hashes.json' },
  v24: { epoch: 'v2', run_id: '2026-08-11T02-59-40-231Z-1ab5e55f', dir: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\runs\\goal20-formal-validation-v1\\2026-08-11T02-59-40-231Z-1ab5e55f', fixture: 'D:\\ai_code\\Omni-context\\goal18he-output\\validation-v2-fixture.jsonl', precommit: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\governance\\goal20-formal-tuple-precommit.jsonl', sealed: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\governance\\sealed-harness-module-hashes.json' },
  v3r1: { epoch: 'v3', run_id: '2026-08-11T10-41-53-720Z-518b14f2', dir: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-v3\\runs\\goal20-formal-validation-v1\\2026-08-11T10-41-53-720Z-518b14f2', fixture: 'D:\\ai_code\\Omni-context\\goal20r-output\\validation-v3-r1-fixture.jsonl', precommit: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-v3\\governance\\goal20-formal-tuple-precommit.jsonl', sealed: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-v3\\governance\\sealed-harness-module-hashes.json' },
};

const readJsonl = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

async function reconstruct(runKey, tupleIndex, arm) {
  const run = RUNS[runKey];
  const precommit = readJsonl(run.precommit).find((t) => t.tuple_index === tupleIndex && t.arm === arm);
  if (!precommit) throw new Error(`no precommit row ${tupleIndex}|${arm}`);
  const fixture = readJsonl(run.fixture).find((s) => s.sample_id === precommit.sample_id);
  if (!fixture) throw new Error(`no fixture ${precommit.sample_id}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(run.dir, 'run-manifest.json'), 'utf8'));
  const confirmedParams = manifest.model?.confirmed_parameters ?? {};
  const sealedHashes = JSON.parse(fs.readFileSync(run.sealed, 'utf8')).modules;
  const ctx = await buildArmContext({ armId: arm, fixture, harnessRoot: HARNESS, productRoot: PRODUCT, sealedHashes });
  const rendered = renderPrompt({ armId: arm, promptDir: path.join(HARNESS, 'prompts', arm), current: ctx.current, evidence: ctx.evidence, route: ctx.route });
  const body = buildRequestBody({ modelId: 'deepseek-v4-flash', system: rendered.system, user: rendered.user, maxOutputTokens: confirmedParams.max_output_tokens ?? 4096, confirmedParams });
  return {
    run: runKey, epoch: run.epoch, tuple_index: tupleIndex, arm, sample_id: precommit.sample_id, task_type: precommit.task_type,
    prompt_sha256: sha(Buffer.from(rendered.user, 'utf8')),
    serialized_request_sha256: sha(Buffer.from(body, 'utf8')),
    serialized_request_bytes: Buffer.byteLength(body, 'utf8'),
    prompt_bytes: rendered.bytes,
    system_len: rendered.system.length, user_len: rendered.user.length,
    context_ids: ctx.evidence.map((e) => e.id),
    gate_route: ctx.route,
    retrieval_used: ctx.evidence.length,
    request_body_structure: JSON.parse(body),
    body: body,
  };
}

const targets = [];
for (const r of ['v22', 'v24', 'v3r1']) {
  targets.push([r, 711, 'A3']);
  targets.push([r, 711, 'A2']); // same sample, sibling arm
  targets.push([r, 710, 'A3']); // neighbor A3 (tt15-006 A2? no: 710 is A2) -> use 705|A3 and 717|A3 instead
  targets.push([r, 705, 'A3']);
  targets.push([r, 717, 'A3']);
  targets.push([r, 675, 'A3']); // TT15-000 A3
  targets.push([r, 699, 'A3']); // TT15-004 A3
  targets.push([r, 3, 'A3']);   // TT01-000 A3 control (non-TT15)
  targets.push([r, 708, 'A0']); // tt15-006 A0 (V3-R1 had 3 empties here)
  targets.push([r, 512, 'A2']); // V2.4 other empty tuple (tt10-005/A2)
}
const results = [];
const errors = [];
for (const [r, idx, arm] of targets) {
  try {
    const rec = await reconstruct(r, idx, arm);
    results.push(rec);
    console.log(`${r} ${idx}|${arm} ${rec.sample_id} req_sha=${rec.serialized_request_sha256.slice(0, 12)} bytes=${rec.serialized_request_bytes} promptBytes=${rec.prompt_bytes.total} ctx=${rec.context_ids.length} route=${rec.gate_route}`);
  } catch (e) {
    errors.push({ run: r, tuple: idx, arm, error: String(e && e.stack || e) });
    console.log(`${r} ${idx}|${arm} ERROR: ${String(e).slice(0, 200)}`);
  }
}

// verification against stored accepted-row shas
const verify = [];
for (const rec of results) {
  const run = RUNS[rec.run];
  const rows = readJsonl(path.join(run.dir, 'raw-results.jsonl')).filter((x) => x.tuple.tuple_index === rec.tuple_index && x.arm === rec.arm && x.provider_call === true);
  for (const row of rows) {
    verify.push({
      run: rec.run, tuple_index: rec.tuple_index, arm: rec.arm,
      reconstructed_sha: rec.serialized_request_sha256,
      stored_sha: row.serialized_request_sha256,
      match: rec.serialized_request_sha256 === row.serialized_request_sha256,
      reconstructed_bytes: rec.serialized_request_bytes,
      stored_bytes: row.serialized_request_bytes,
    });
  }
}
const allMatch = verify.length > 0 && verify.every((v) => v.match);
fs.writeFileSync(OUT + '/request-reconstruction.json', JSON.stringify({ schema_version: 1, purpose: 'GOAL20X_OFFLINE_REQUEST_RECONSTRUCTION', created_at: new Date().toISOString(), provider_calls_made: 0, verification: { n: verify.length, all_match: allMatch, rows: verify }, reconstructed: results.map(({ body, ...rest }) => rest), errors }, null, 2) + '\n', 'utf8');
console.log('verification rows:', verify.length, 'all match:', allMatch);