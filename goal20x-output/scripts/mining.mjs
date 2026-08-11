// Goal20X mining: tuple-711 forensics + EMPTY_CONTENT census + neighbor comparison.
// Artifact-only. Zero provider calls. Reads preserved run dirs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const readJsonl = (p) => fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const OUT = 'D:\\ai_code\\Omni-context\\goal20x-output';

const RUNS = {
  v2:   { epoch: 'v2',   run_id: '2026-08-10T03-46-57-389Z-f0d8ce6b', dir: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\runs\\goal20-formal-validation-v1\\2026-08-10T03-46-57-389Z-f0d8ce6b', fixture: 'D:\\ai_code\\Omni-context\\goal18he-output\\validation-v2-fixture.jsonl' },
  v21:  { epoch: 'v2',   run_id: '2026-08-10T06-20-39-825Z-ae92ac4b', dir: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\runs\\goal20-formal-validation-v1\\2026-08-10T06-20-39-825Z-ae92ac4b', fixture: 'D:\\ai_code\\Omni-context\\goal18he-output\\validation-v2-fixture.jsonl' },
  v22:  { epoch: 'v2',   run_id: '2026-08-10T11-42-57-026Z-5c9e078d', dir: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\runs\\goal20-formal-validation-v1\\2026-08-10T11-42-57-026Z-5c9e078d', fixture: 'D:\\ai_code\\Omni-context\\goal18he-output\\validation-v2-fixture.jsonl' },
  v23:  { epoch: 'v2',   run_id: '2026-08-10T17-00-02-942Z-9fbdc16a', dir: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\runs\\goal20-formal-validation-v1\\2026-08-10T17-00-02-942Z-9fbdc16a', fixture: 'D:\\ai_code\\Omni-context\\goal18he-output\\validation-v2-fixture.jsonl' },
  v24:  { epoch: 'v2',   run_id: '2026-08-11T02-59-40-231Z-1ab5e55f', dir: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-r1\\runs\\goal20-formal-validation-v1\\2026-08-11T02-59-40-231Z-1ab5e55f', fixture: 'D:\\ai_code\\Omni-context\\goal18he-output\\validation-v2-fixture.jsonl' },
  v3r1: { epoch: 'v3',   run_id: '2026-08-11T10-41-53-720Z-518b14f2', dir: 'D:\\ai_code\\Omni-context\\goal20-formal-execution-governance-v3\\runs\\goal20-formal-validation-v1\\2026-08-11T10-41-53-720Z-518b14f2', fixture: 'D:\\ai_code\\Omni-context\\goal20r-output\\validation-v3-r1-fixture.jsonl' },
};

function loadAttempts(runDir) {
  const attemptsRoot = path.join(runDir, 'attempts');
  const out = [];
  if (!fs.existsSync(attemptsRoot)) return out;
  for (const tupleDir of fs.readdirSync(attemptsRoot, { withFileTypes: true })) {
    if (!tupleDir.isDirectory()) continue;
    const tPath = path.join(attemptsRoot, tupleDir.name);
    for (const f of fs.readdirSync(tPath).sort()) {
      const m = f.match(/^attempt-(\d+)\.json$/);
      if (!m) continue;
      const rec = JSON.parse(fs.readFileSync(path.join(tPath, f), 'utf8'));
      const idx = Number(tupleDir.name.split('.')[0]);
      out.push({ tuple_index: idx, sample_id: tupleDir.name.split('.').slice(1, -1).join('.'), arm: tupleDir.name.split('.').pop(), attempt: Number(m[1]), file: tupleDir.name + '/' + f, record: rec });
    }
  }
  return out;
}

function fixtureIndex(fixtureFile) {
  const map = new Map();
  for (const s of readJsonl(fixtureFile)) map.set(s.sample_id, s);
  return map;
}

function structural(s) {
  if (!s) return null;
  return {
    task_type: s.task_type,
    authority_level: s.scenario?.authority_level ?? null,
    risk_level: s.scenario?.risk_classification?.level ?? null,
    reversibility: s.scenario?.risk_classification?.reversibility ?? null,
    candidates_count: (s.candidates ?? []).length,
    hard_constraints_count: (s.hard_constraints ?? []).length,
    soft_preferences_count: (s.soft_preferences ?? []).length,
    timeline_events_count: (s.memory_timeline ?? []).length,
    evidence_qualified_count: (s.evidence?.qualified ?? []).length,
    evidence_expired_count: (s.evidence?.expired ?? []).length,
    evidence_other_count: (s.evidence?.other ?? []).length,
    has_historical_decision: !!s.historical_decision,
    has_execution_outcome: !!s.execution_outcome,
    has_revisit: !!(s.revisit ?? s.scenario?.revisit),
    options_shown: (s.scenario?.options_shown_in_order ?? []).length,
  };
}

function classifyEmpty(meta) {
  // E1-E6 per Goal20X section 5
  if (!meta) return 'UNKNOWN';
  const fr = meta.finish_reason;
  const rcLen = meta.reasoning_content_length ?? 0;
  const http = meta.http_status;
  const raw = meta.raw ?? '';
  if (fr === 'length') return 'E3_LENGTH';
  if (fr === 'content_filter') return 'E5_FILTER';
  if (/insufficient_system_resource|resource_exhausted|insufficient resource/i.test(raw)) return 'E4_RESOURCE';
  if (http === 200 && rcLen > 0) return 'E1_JSON_FINAL_EMPTY_AFTER_REASONING';
  if (http === 200 && rcLen === 0) return 'E2_COMPLETELY_EMPTY_SUCCESS';
  return 'E6_MALFORMED_OTHER';
}

const census = [];
const forensics = {};
const neighbors = {};
const runsSummary = {};

for (const [key, run] of Object.entries(RUNS)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(run.dir, 'run-manifest.json'), 'utf8'));
  const rawRows = readJsonl(path.join(run.dir, 'raw-results.jsonl'));
  const retries = readJsonl(path.join(run.dir, 'retries.jsonl'));
  const errors = readJsonl(path.join(run.dir, 'errors.jsonl'));
  const ledger = JSON.parse(fs.readFileSync(path.join(run.dir, 'budget-ledger.json'), 'utf8'));
  const attempts = loadAttempts(run.dir);
  const fx = fixtureIndex(run.fixture);

  const rawByTuple = new Map(rawRows.map((r) => [`${r.tuple.tuple_index}|${r.arm}`, r]));
  const retryByTuple = new Map();
  for (const r of retries) {
    const k = `${r.tuple_index}|${r.arm}`;
    if (!retryByTuple.has(k)) retryByTuple.set(k, []);
    retryByTuple.get(k).push(r);
  }

  // --- tuple 711 / A3 forensics ---
  const k711 = '711|A3';
  const t711Attempts = attempts.filter((a) => a.tuple_index === 711 && a.arm === 'A3');
  const raw711 = rawByTuple.get(k711);
  const retries711 = retryByTuple.get(k711) ?? [];
  const errors711 = errors.filter((e) => e.tuple_index === 711 && e.arm === 'A3');
  const ledger711 = (ledger.records ?? []).filter((r) => r.tuple_index === 711 && r.arm === 'A3');
  const sample711 = t711Attempts[0]?.sample_id ?? retries711[0]?.sample_id ?? raw711?.tuple?.sample_id ?? null;
  const tt = sample711 ? (sample711.match(/tt(\d+)/) ?? [])[1] : null;
  const slot = sample711 ? (sample711.match(/-(\d{3})$/) ?? [])[1] : null;

  const attemptsDetail = t711Attempts.map((a) => {
    const rec = a.record;
    const meta = rec.provider_error_meta ?? null;
    const usage = meta?.usage ?? rec.usage ?? null;
    return {
      attempt: a.attempt,
      status: rec.status ?? rec.parse_status ?? (rec.error_state ? 'attempt_failed' : 'ok'),
      error_code: rec.error_state?.code ?? rec.detail?.code ?? null,
      error_classified: rec.error_state?.classified ?? null,
      at: rec.at ?? rec.timestamps?.completed_at ?? null,
      http_status: meta?.http_status ?? null,
      model_identity: meta?.model_identity ?? rec.provider_model_identity ?? null,
      finish_reason: meta?.finish_reason ?? (rec.response_raw_text ? (rec.response_raw_text.match(/"finish_reason":"(\w+)"/) || [])[1] : null) ?? null,
      content_length: meta?.content_length ?? (rec.parsed_structural_output ? null : null),
      reasoning_content_length: meta?.reasoning_content_length ?? null,
      usage: usage ? {
        prompt_tokens: usage.prompt_tokens ?? null,
        completion_tokens: usage.completion_tokens ?? null,
        total_tokens: usage.total_tokens ?? null,
        cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? null,
        noncached_tokens: usage.prompt_cache_miss_tokens ?? null,
        reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
      } : null,
      provider_request_id: meta?.provider_request_id ?? rec.provider_request_id ?? null,
      latency_ms: meta?.latency_ms ?? rec.latency_ms ?? null,
      raw_sha256: meta?.raw_sha256 ?? rec.response_raw_sha256 ?? null,
      reasoning_content_text: meta?.raw ? extractReasoning(meta.raw) : (rec.response_raw_text ? extractReasoning(rec.response_raw_text) : null),
      subtype: classifyEmpty(meta),
    };
  });
  // retry intervals
  for (let i = 1; i < attemptsDetail.length; i++) {
    const t0 = attemptsDetail[i - 1].at ? Date.parse(attemptsDetail[i - 1].at) : null;
    const t1 = attemptsDetail[i].at ? Date.parse(attemptsDetail[i].at) : null;
    attemptsDetail[i].retry_interval_ms = (t0 && t1) ? t1 - t0 : null;
  }

  forensics[key] = {
    epoch: run.epoch,
    run_id: run.run_id,
    terminal: fs.existsSync(path.join(run.dir, 'COMPLETED')) ? 'COMPLETED' : 'FAILED',
    finalized_at: fs.existsSync(path.join(run.dir, 'COMPLETED')) ? JSON.parse(fs.readFileSync(path.join(run.dir, 'COMPLETED'), 'utf8')).finalized_at : JSON.parse(fs.readFileSync(path.join(run.dir, 'FAILED'), 'utf8')).finalized_at,
    tuple_index: 711,
    sample_id: sample711,
    task_type: tt ? `TT${tt}` : null,
    slot_index: slot,
    arm: 'A3',
    model_parameters: {
      model: manifest.model?.requested_model_id,
      max_output_tokens: manifest.model?.confirmed_parameters?.max_output_tokens,
      thinking: manifest.model?.confirmed_parameters?.thinking,
      reasoning_effort: manifest.model?.confirmed_parameters?.reasoning_effort,
      temperature: manifest.model?.confirmed_parameters?.temperature,
      retry_max_attempts: manifest.model?.confirmed_parameters?.retry_max_attempts,
      empty_content_retry_max_attempts: manifest.model?.confirmed_parameters?.empty_content_retry_max_attempts,
      transport_retry_max_attempts: manifest.model?.confirmed_parameters?.transport_retry_max_attempts,
      timeout_ms: manifest.model?.confirmed_parameters?.timeout_ms,
    },
    request_identity: raw711 ? {
      prompt_sha256: raw711.prompt_sha256 ?? null,
      serialized_request_sha256: raw711.serialized_request_sha256 ?? null,
      serialized_request_bytes: raw711.serialized_request_bytes ?? null,
      generation_parameter_identity: raw711.generation_parameter_identity ?? null,
    } : null,
    final_disposition: raw711 ? raw711.status : (errors711.length ? 'provider_failed' : (t711Attempts.length ? 'unknown' : 'not_processed')),
    attempt_count: t711Attempts.length,
    empty_content_count: attemptsDetail.filter((a) => a.error_code === 'EMPTY_CONTENT' || a.error_classified === 'EMPTY_CONTENT').length,
    consecutive_empties_max: maxConsecutive(attemptsDetail.map((a) => (a.error_code === 'EMPTY_CONTENT' ? 1 : 0))),
    empty_subtypes: countBy(attemptsDetail, 'subtype'),
    retry_records: retries711.map((r) => ({ attempt: r.attempt, code: r.detail?.code, at: r.at })),
    fatal_errors: errors711.map((e) => ({ attempt: e.attempt, code: e.detail?.code, at: e.at, fatal: e.fatal })),
    ledger_records: ledger711.map((r) => ({ attempt: r.attempt, cost_cny: r.cost_cny, provider_request_id: r.provider_request_id, at: r.at })),
    attempts: attemptsDetail,
    structural: structural(fx.get(sample711)),
    input_tokens_all_attempts: attemptsDetail.map((a) => a.usage?.prompt_tokens ?? null),
  };

  // --- EMPTY_CONTENT census (from attempt files; cross-checked vs retries.jsonl) ---
  const emptyEvents = [];
  for (const a of attempts) {
    const rec = a.record;
    const code = rec.error_state?.code ?? rec.detail?.code ?? null;
    const classified = rec.error_state?.classified ?? null;
    if (code !== 'EMPTY_CONTENT' && classified !== 'EMPTY_CONTENT') continue;
    const meta = rec.provider_error_meta ?? null;
    const usage = meta?.usage ?? rec.usage ?? null;
    const sampleId = a.sample_id;
    const ttS = (sampleId.match(/tt(\d+)/) ?? [])[1];
    const slotS = (sampleId.match(/-(\d{3})$/) ?? [])[1];
    // recovery: does this tuple+arm eventually complete?
    const accepted = rawByTuple.get(`${a.tuple_index}|${a.arm}`);
    const recovered = !!(accepted && accepted.status === 'completed');
    const nextAttempt = attempts.filter((x) => x.tuple_index === a.tuple_index && x.arm === a.arm && x.attempt === a.attempt + 1)[0];
    const consecutive = consecutiveEmpties(attempts, a.tuple_index, a.arm, a.attempt);
    emptyEvents.push({
      run: key,
      epoch: run.epoch,
      run_id: run.run_id,
      tuple: a.tuple_index,
      sample: sampleId,
      TT: ttS ? `TT${ttS}` : null,
      arm: a.arm,
      slot: slotS,
      attempt: a.attempt,
      timestamp: rec.at ?? null,
      finish_reason: meta?.finish_reason ?? null,
      http_status: meta?.http_status ?? null,
      content_length: meta?.content_length ?? 0,
      reasoning_content_length: meta?.reasoning_content_length ?? null,
      reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
      prompt_tokens: usage?.prompt_tokens ?? null,
      cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? usage?.prompt_cache_hit_tokens ?? null,
      noncached_tokens: usage?.prompt_cache_miss_tokens ?? null,
      provider_request_id: meta?.provider_request_id ?? null,
      request_sha256: accepted ? (accepted.serialized_request_sha256 ?? null) : null,
      request_bytes: accepted ? (accepted.serialized_request_bytes ?? null) : null,
      prompt_sha256: accepted ? (accepted.prompt_sha256 ?? null) : null,
      recovered: recovered,
      next_attempt_recovered: !!(nextAttempt && !nextAttempt.record.error_state),
      consecutive_empties: consecutive,
      subtype: classifyEmpty(meta),
      raw_sha256: meta?.raw_sha256 ?? null,
      latency_ms: meta?.latency_ms ?? null,
    });
  }
  const retryEmptyCount = retries.filter((r) => r.detail?.code === 'EMPTY_CONTENT').length;
  census.push(...emptyEvents);

  // --- neighbor comparison ---
  // tuple_index -> (sample_id, arm) is a 1:1 precommit mapping (6 arms per sample).
  // Groups:
  //  G1 same-sample siblings of tuple 711 (tt15-006 A0..A5) = indices 708..713
  //  G2 A3 arm across all 8 TT15 samples = indices 675,681,687,693,699,705,711,717
  //  G3 full TT15 block = indices 672..719 (all arms)
  //  G4 A3 arm across all 120 validation samples = indices where arm==A3
  const indexMap = new Map(); // tuple_index -> {sample_id, arm}
  for (const a of attempts) {
    if (!indexMap.has(a.tuple_index)) indexMap.set(a.tuple_index, { sample_id: a.sample_id, arm: a.arm });
  }
  for (const r of rawRows) {
    indexMap.set(r.tuple.tuple_index, { sample_id: r.tuple.sample_id, arm: r.arm });
  }
  const rowOf = (idx, arm) => rawByTuple.get(`${idx}|${arm}`);
  const block = [];
  const want = new Set([
    ...Array.from({ length: 6 }, (_, i) => 708 + i),          // tt15-006 A0..A5
    ...Array.from({ length: 48 }, (_, i) => 672 + i),          // full TT15 block
  ]);
  for (const idx of want) {
    const info = indexMap.get(idx);
    if (!info) continue;
    const row = rowOf(idx, info.arm);
    const atts = attempts.filter((a) => a.tuple_index === idx && a.arm === info.arm);
    const sampleId = info.sample_id;
    const emptyAtts = atts.filter((a) => (a.record.error_state?.code ?? a.record.detail?.code) === 'EMPTY_CONTENT');
    block.push({
      tuple_index: idx,
      arm: info.arm,
      sample_id: sampleId,
      task_type: (sampleId.match(/tt(\d+)/) ?? [])[1] ? `TT${(sampleId.match(/tt(\d+)/) ?? [])[1]}` : null,
      slot: (sampleId.match(/-(\d{3})$/) ?? [])[1],
      status: row?.status ?? (atts.length ? 'attempt_failed_or_missing' : 'not_processed'),
      attempt_count: atts.length,
      empty_attempts: emptyAtts.length,
      prompt_bytes: row?.audit?.prompt_bytes ?? null,
      input_tokens: row?.usage?.prompt_tokens ?? null,
      reasoning_tokens: row?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
      completion_tokens: row?.usage?.completion_tokens ?? null,
      latency_ms: row?.latency_ms ?? null,
      serialized_request_bytes: row?.serialized_request_bytes ?? null,
      serialized_request_sha256: row?.serialized_request_sha256 ?? null,
      prompt_sha256: row?.prompt_sha256 ?? null,
      context_ids: row?.audit?.context_ids?.length ?? null,
      gate_route: row?.audit?.gate_route ?? null,
      structural: structural(fx.get(sampleId)),
    });
  }
  neighbors[key] = block;

  runsSummary[key] = {
    epoch: run.epoch,
    terminal: fs.existsSync(path.join(run.dir, 'COMPLETED')) ? 'COMPLETED' : 'FAILED',
    raw_rows: rawRows.length,
    retries_total: retries.length,
    retries_empty: retryEmptyCount,
    attempts_files: attempts.length,
    empty_events_from_attempts: emptyEvents.length,
    provider_rows_accepted: rawRows.filter((r) => r.provider_call === true).length,
    ledger_calls: ledger.calls,
    spent_cny: ledger.spent_cny,
  };
}

function extractReasoning(raw) {
  try {
    const obj = JSON.parse(raw);
    return obj?.choices?.[0]?.message?.reasoning_content ?? null;
  } catch {
    const m = raw.match(/"reasoning_content":"((?:[^"\\]|\\.)*)"/);
    return m ? m[1] : null;
  }
}
function countBy(arr, keyFn) {
  const out = {};
  for (const x of arr) { const k = typeof keyFn === 'function' ? keyFn(x) : x[keyFn]; out[k] = (out[k] || 0) + 1; }
  return out;
}
function maxConsecutive(bits) {
  let mx = 0, cur = 0;
  for (const b of bits) { cur = b ? cur + 1 : 0; mx = Math.max(mx, cur); }
  return mx;
}
function consecutiveEmpties(attempts, tupleIndex, arm, attempt) {
  const chain = attempts.filter((a) => a.tuple_index === tupleIndex && a.arm === arm).sort((a, b) => a.attempt - b.attempt);
  let n = 0;
  for (const a of chain) {
    if (a.attempt > attempt) break;
    const code = a.record.error_state?.code ?? a.record.detail?.code ?? null;
    if (code === 'EMPTY_CONTENT') n += 1; else if (a.attempt === attempt) n += 1; else n = 0;
    if (a.attempt === attempt) break;
  }
  return n;
}

// --- aggregation + outlier analysis ---
const totalEmpty = census.length;
const byPosition = {};
const byArm = {}; const byTT = {}; const bySlot = {}; const byRun = {}; const bySubtype = {};
for (const e of census) {
  byPosition[e.tuple] = (byPosition[e.tuple] || 0) + 1;
  byArm[e.arm] = (byArm[e.arm] || 0) + 1;
  byTT[e.TT] = (byTT[e.TT] || 0) + 1;
  const slotKey = `${e.TT}-${e.slot}`;
  bySlot[slotKey] = (bySlot[slotKey] || 0) + 1;
  byRun[e.run] = (byRun[e.run] || 0) + 1;
  bySubtype[e.subtype] = (bySubtype[e.subtype] || 0) + 1;
}
// Poisson tail for position 711 under uniform position null
function poissonTail(lambda, k) {
  let sum = 0, term = Math.exp(-lambda);
  for (let i = 0; i <= k; i++) { sum += term; term *= lambda / (i + 1); }
  return 1 - sum + Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
function factorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
const lambdaPos = totalEmpty / 720;
const pos711Count = byPosition[711] ?? 0;
const pos711PoissonTail = poissonTail(lambdaPos, pos711Count);
// arm concentration (provider arms A0-A3 only; 480 provider positions over 6 runs = 2880 arm-slots? no: per-run provider positions = 480 across 4 arms => 120 per arm per run)
const providerSlotsPerArm = 120 * 6; // 6 runs
const armExpected = totalEmpty * (providerSlotsPerArm / (720 * 6));
// simpler: events per arm, expected = totalEmpty * (provider positions in arm / total provider positions across runs)
// total provider positions across runs = 480*6 = 2880
const totalProviderSlots = 480 * 6;
const byArmExpected = {};
for (const a of ['A0','A1','A2','A3']) byArmExpected[a] = totalEmpty * (120 * 6) / totalProviderSlots;

const analysis = {
  total_empty_events: totalEmpty,
  by_run: byRun,
  by_arm: byArm,
  by_arm_expected_uniform_provider: byArmExpected,
  by_task_type: byTT,
  by_slot_tt_idx: bySlot,
  by_subtype: bySubtype,
  by_position_counts: byPosition,
  position_711: { count: pos711Count, poisson_tail_uniform_position: pos711PoissonTail, lambda: lambdaPos },
  tuple_711_arm_A3_slots: census.filter((e) => e.tuple === 711 && e.arm === 'A3'),
  tt15_006_all_arms: census.filter((e) => e.TT === 'TT15' && e.slot === '006'),
  input_token_buckets: bucket(census, (e) => e.prompt_tokens, [0, 1000, 1500, 2000, 2500, 3000, 4000, Infinity]),
  reasoning_token_buckets: bucket(census, (e) => e.reasoning_tokens, [0, 1, 100, 300, 500, 1000, 2000, Infinity]),
  time_windows_utc: bucket(census, (e) => e.timestamp ? new Date(e.timestamp).getUTCHours() : null, Array.from({ length: 25 }, (_, i) => i)),
};
function bucket(events, valFn, edges) {
  const out = {};
  for (const e of events) {
    const v = valFn(e);
    if (v === null || v === undefined) { out['null'] = (out['null'] || 0) + 1; continue; }
    for (let i = 0; i < edges.length - 1; i++) {
      if (v >= edges[i] && v < edges[i + 1]) { const k = `${edges[i]}-${edges[i + 1] === Infinity ? 'inf' : edges[i + 1]}`; out[k] = (out[k] || 0) + 1; break; }
    }
  }
  return out;
}

const out = {
  schema_version: 1,
  purpose: 'GOAL20X_TUPLE_711_FORENSICS_AND_EMPTY_CENSUS',
  created_at: new Date().toISOString(),
  provider_calls_made: 0,
  runs: runsSummary,
  forensics: forensics,
  neighbors: neighbors,
  census_summary: analysis,
};
fs.mkdirSync(OUT + '/scripts', { recursive: true });
fs.writeFileSync(OUT + '/tuple-711-cross-run-forensics.json', JSON.stringify(out, null, 2) + '\n', 'utf8');
fs.writeFileSync(OUT + '/empty-content-census.jsonl', census.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
fs.writeFileSync(OUT + '/empty-content-census-summary.json', JSON.stringify(analysis, null, 2) + '\n', 'utf8');
console.log('census events:', totalEmpty);
console.log('forensics keys:', Object.keys(forensics).join(','));
console.log('by_run:', JSON.stringify(byRun));
console.log('by_arm:', JSON.stringify(byArm));
console.log('by_subtype:', JSON.stringify(bySubtype));
console.log('pos711:', pos711Count, 'poisson tail:', pos711PoissonTail.toExponential(3));
console.log('by_slot top:', JSON.stringify(Object.entries(bySlot).sort((a, b) => b[1] - a[1]).slice(0, 8)));