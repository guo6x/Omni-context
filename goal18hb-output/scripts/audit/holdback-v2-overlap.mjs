// Goal 18HB - Holdback V2 overlap audit vs known data (development / regression / validation).
//
// CLI:
//   node holdback-v2-overlap.mjs --fixtures <abs path to holdback fixtures jsonl> \
//        --spec-dir <abs path to goal14-output> --out <abs output dir>
//        [--validation-dir <abs path to goal18-output>]
//
// Known data sources:
//   * development -> <spec-dir>/development-fixtures.jsonl
//   * regression  -> <spec-dir>/regression-fixtures.jsonl
//   * validation  -> <validation-dir>/validation-set.jsonl joined with
//                    <validation-dir>/validation-gold.jsonl on sample_id.
//                    --validation-dir defaults to $GOAL18_OUTPUT_DIR, then
//                    <cwd>/goal18-output when it exists, else validation is skipped
//                    with a warning (dev/reg only).
//
// Per-metric comparison (every fixture sample vs every known sample; same-sample_id
// self pairs are excluded so auditing the validation split against itself stays clean):
//   exact_sample_hash        sha256(JSON.stringify(sample)) of the parsed object
//   normalized_scenario_hash sha256 of the sample after dropping sample_id/split/task_type/
//                            title/domain/construction_provenance and ALL gold fields
//                            (expected_action, acceptable_explanations, severe_failure_labels,
//                            scoring), then recursively stripping keys named id/event_id/
//                            source_ref/derived_from/targets/at/valid_from/valid_until/
//                            query_time/made_at/revisit_at
//   decision_question_hash   sha256(decision_question ?? scenario.prompt)
//   timeline_hash            sha256(memory_timeline contents joined)
//   option_set_hash          sha256(candidate labels+descriptions, sorted)
//   near-duplicate           normalized 8-gram Jaccard over decision_question + all timeline
//                            contents + option labels; pairs >= 0.5 are flagged (diagnostic
//                            only, never a failure)
//
// Outputs: <out>/holdback-v2-overlap-report.md (Chinese, Goal 18 report style) and
//          <out>/holdback-v2-overlap-results.json
// Exit code: 0 when exact_overlap == 0, 1 otherwise.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HELP = `Usage:
  node holdback-v2-overlap.mjs --fixtures <abs path> --spec-dir <abs path to goal14-output> --out <abs output dir>
                               [--validation-dir <abs path to goal18-output>]
`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      args[k] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      if (typeof args[k] !== 'string') args[k] = true;
      else i++;
      if (k.includes('-')) { const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); args[camel] = args[k]; }
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(HELP); process.exit(0); }
if (!args.fixtures || !args.specDir || !args.out) {
  console.error('missing required flags: --fixtures --spec-dir --out');
  console.error(HELP);
  process.exit(1);
}
const FIXTURES_PATH = path.resolve(args.fixtures);
const SPEC_DIR = path.resolve(args.specDir);
const OUT_DIR = path.resolve(args.out);
if (!fs.existsSync(FIXTURES_PATH)) { console.error('fixtures not found: ' + FIXTURES_PATH); process.exit(1); }
if (!fs.statSync(SPEC_DIR).isDirectory()) { console.error('spec-dir not found: ' + SPEC_DIR); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });

const FLAG_THRESHOLD = 0.5;

function sha256(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

function readJsonl(absPath) {
  if (!fs.existsSync(absPath)) return null;
  const raw = fs.readFileSync(absPath, 'utf8').replace(/^\uFEFF/, '');
  return raw.split(/\r?\n/).filter((l) => l.trim().length > 0).map((line, i) => {
    try { return JSON.parse(line); }
    catch (e) { throw new Error(`Bad JSON at ${absPath}:${i + 1}: ${e.message}`); }
  });
}

// ---------- hash metrics ----------
const GOLD_FIELDS = ['expected_action', 'acceptable_explanations', 'severe_failure_labels', 'scoring'];
const TOP_DROP = new Set(['sample_id', 'split', 'task_type', 'title', 'domain', 'construction_provenance', ...GOLD_FIELDS]);
const STRIP_KEYS = new Set(['id', 'event_id', 'source_ref', 'derived_from', 'targets', 'at', 'valid_from', 'valid_until', 'query_time', 'made_at', 'revisit_at']);

function stripKeys(o) {
  if (Array.isArray(o)) { for (const x of o) stripKeys(x); return o; }
  if (o && typeof o === 'object') {
    for (const k of Object.keys(o)) {
      if (STRIP_KEYS.has(k)) delete o[k];
      else stripKeys(o[k]);
    }
  }
  return o;
}

function exactSampleHash(s) { return sha256(JSON.stringify(s)); }
function normalizedScenarioHash(s) {
  const copy = structuredClone(s);
  for (const k of TOP_DROP) delete copy[k];
  return sha256(JSON.stringify(stripKeys(copy)));
}
function decisionQuestion(s) { return String(s.decision_question ?? s.scenario?.prompt ?? '').trim(); }
function decisionQuestionHash(s) { return sha256(decisionQuestion(s)); }
function timelineHash(s) {
  const joined = (s.memory_timeline || []).map((e) => String(e.content).trim()).join('\n');
  return sha256(joined);
}
function optionSetHash(s) {
  const opts = (s.candidates || []).map((c) => JSON.stringify([String(c.label).trim(), String(c.description).trim()])).sort();
  return sha256(opts.join('\n'));
}

// ---------- near-duplicate similarity ----------
function normText(s) {
  return String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
function sampleNormText(s) {
  const parts = [decisionQuestion(s)];
  for (const e of s.memory_timeline || []) parts.push(e.content);
  for (const c of s.candidates || []) parts.push(c.label);
  return normText(parts.join(' '));
}
function shingles(s, k = 8) {
  const out = new Set();
  for (let i = 0; i + k <= s.length; i++) out.add(s.slice(i, i + k));
  return out;
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// ---------- load known data ----------
const dev = readJsonl(path.join(SPEC_DIR, 'development-fixtures.jsonl')) || [];
const reg = readJsonl(path.join(SPEC_DIR, 'regression-fixtures.jsonl')) || [];
if (dev.length === 0 && reg.length === 0) {
  console.error('no development/regression fixtures found under --spec-dir ' + SPEC_DIR);
  process.exit(1);
}
if (dev.length === 0) console.warn('warning: development-fixtures.jsonl not found under ' + SPEC_DIR);
if (reg.length === 0) console.warn('warning: regression-fixtures.jsonl not found under ' + SPEC_DIR);

let validationDir = null;
if (args.validationDir) validationDir = path.resolve(args.validationDir);
else if (process.env.GOAL18_OUTPUT_DIR) validationDir = path.resolve(process.env.GOAL18_OUTPUT_DIR);
else {
  const cwdCandidate = path.join(process.cwd(), 'goal18-output');
  if (fs.existsSync(path.join(cwdCandidate, 'validation-set.jsonl')) && fs.existsSync(path.join(cwdCandidate, 'validation-gold.jsonl'))) validationDir = cwdCandidate;
}
let validation = [];
if (validationDir) {
  const setPath = path.join(validationDir, 'validation-set.jsonl');
  const goldPath = path.join(validationDir, 'validation-gold.jsonl');
  const setRecs = readJsonl(setPath);
  const goldRecs = readJsonl(goldPath);
  if (!setRecs || !goldRecs) console.warn('warning: validation-set.jsonl / validation-gold.jsonl not found under ' + validationDir + '; comparing against dev/reg only');
  else {
    const byId = new Map(goldRecs.map((g) => [g.sample_id, g]));
    validation = setRecs.map((s) => {
      const g = byId.get(s.sample_id);
      if (!g) throw new Error(`missing gold for validation sample ${s.sample_id} in ${goldPath}`);
      return { ...s, ...g };
    });
    console.log(`validation source: ${validationDir} (${validation.length} joined records)`);
  }
} else {
  console.warn('warning: validation set not found (pass --validation-dir, set GOAL18_OUTPUT_DIR, or run from a directory containing goal18-output); comparing against dev/reg only');
}
const known = [
  ...dev.map((s) => ({ split: 'development', sample: s })),
  ...reg.map((s) => ({ split: 'regression', sample: s })),
  ...validation.map((s) => ({ split: 'validation', sample: s })),
];

const fixtures = readJsonl(FIXTURES_PATH);
if (!fixtures) { console.error('fixtures not found: ' + FIXTURES_PATH); process.exit(1); }
console.log(`fixtures: ${FIXTURES_PATH} (${fixtures.length} records)`);
console.log(`known: development=${dev.length} regression=${reg.length} validation=${validation.length} (total ${known.length})`);

// ---------- compare ----------
const METRICS = ['exact_sample_hash', 'normalized_scenario_hash', 'decision_question_hash', 'timeline_hash', 'option_set_hash'];
const metricStats = Object.fromEntries(METRICS.map((m) => [m, { pairs: 0, matched_pairs: 0, fixture_samples: new Set(), known_samples: new Set() }]));
let selfExcluded = 0;
const selfPairs = []; // {fixture_id, known_split, identical}
let pairCount = 0;
let simSum = 0;
let simMax = 0;
let bestPair = null;
const flagged = []; // {fixture_id, known_id, similarity}
const exactOverlapIds = new Set();

for (const f of fixtures) {
  const fHashes = {
    exact_sample_hash: exactSampleHash(f),
    normalized_scenario_hash: normalizedScenarioHash(f),
    decision_question_hash: decisionQuestionHash(f),
    timeline_hash: timelineHash(f),
    option_set_hash: optionSetHash(f),
  };
  const fShingles = shingles(sampleNormText(f));
  for (const k of known) {
    if (k.sample.sample_id === f.sample_id) {
      selfExcluded++;
      selfPairs.push({ fixture_id: f.sample_id, known_split: k.split, identical: exactSampleHash(f) === exactSampleHash(k.sample) });
      continue;
    }
    pairCount++;
    const kHashes = {
      exact_sample_hash: exactSampleHash(k.sample),
      normalized_scenario_hash: normalizedScenarioHash(k.sample),
      decision_question_hash: decisionQuestionHash(k.sample),
      timeline_hash: timelineHash(k.sample),
      option_set_hash: optionSetHash(k.sample),
    };
    for (const m of METRICS) {
      metricStats[m].pairs++;
      if (fHashes[m] === kHashes[m]) {
        metricStats[m].matched_pairs++;
        metricStats[m].fixture_samples.add(f.sample_id);
        metricStats[m].known_samples.add(k.sample.sample_id);
        if (m === 'exact_sample_hash') exactOverlapIds.add(f.sample_id);
      }
    }
    const sim = jaccard(fShingles, shingles(sampleNormText(k.sample)));
    simSum += sim;
    if (sim > simMax) { simMax = sim; bestPair = [f.sample_id, k.sample.sample_id, +sim.toFixed(3)]; }
    if (sim >= FLAG_THRESHOLD) flagged.push({ fixture_id: f.sample_id, known_id: k.sample.sample_id, similarity: +sim.toFixed(3) });
  }
}
flagged.sort((a, b) => b.similarity - a.similarity);
const exactOverlapPairs = metricStats.exact_sample_hash.matched_pairs;
const exactOverlapSamples = exactOverlapIds.size;
const selfCollisions = selfPairs.filter((p) => !p.identical);
const simMean = pairCount ? +(simSum / pairCount).toFixed(4) : 0;

// ---------- outputs ----------
const results = {
  generated_at: new Date().toISOString(),
  command: `node holdback-v2-overlap.mjs --fixtures ${FIXTURES_PATH} --spec-dir ${SPEC_DIR} --out ${OUT_DIR}` + (validationDir ? ` --validation-dir ${validationDir}` : ''),
  fixtures: { path: FIXTURES_PATH, count: fixtures.length },
  known: { development: dev.length, regression: reg.length, validation: validation.length, total: known.length },
  validation_source: validationDir,
  self_excluded_pairs: selfExcluded,
  self_excluded: { count: selfExcluded, pairs: selfPairs, content_mismatch_count: selfCollisions.length, content_mismatch: selfCollisions },
  metrics: Object.fromEntries(METRICS.map((m) => [m, {
    pairs: metricStats[m].pairs,
    matched_pairs: metricStats[m].matched_pairs,
    fixture_samples: metricStats[m].fixture_samples.size,
    fixture_sample_ids: [...metricStats[m].fixture_samples].sort(),
    known_sample_ids: [...metricStats[m].known_samples].sort(),
  }])),
  exact_overlap: { pairs: exactOverlapPairs, samples: exactOverlapSamples, sample_ids: [...exactOverlapIds].sort() },
  near_duplicates: {
    threshold: FLAG_THRESHOLD,
    pairs_compared: pairCount,
    max: +simMax.toFixed(3),
    mean: simMean,
    best_pair: bestPair,
    flagged: flagged,
    flagged_count: flagged.length,
  },
};

const rows = METRICS.map((m) => {
  const st = metricStats[m];
  const status = st.matched_pairs === 0 ? 'PASS' : (m === 'exact_sample_hash' ? 'FAIL' : 'CHECK');
  return `| ${m} | ${st.pairs} | ${st.matched_pairs} | ${st.fixture_samples.size} | ${status} |`;
}).join('\n');

const mismatchRows = selfCollisions.length === 0
  ? '（无）'
  : selfCollisions.map((p) => `| ${p.fixture_id} | ${p.known_split} | 同 sample_id 但内容不一致（疑似复制后修改） |`).join('\n');

const flagRows = flagged.length === 0
  ? '（无）'
  : flagged.map((p) => `| ${p.fixture_id} | ${p.known_id} | ${p.similarity.toFixed(3)} |`).join('\n');

const report = [
  '# Goal 18HB — Holdback V2 与已知数据重叠审计报告',
  '',
  `- 审计对象（--fixtures）：\`${FIXTURES_PATH}\`（${fixtures.length} 条记录）`,
  `- 已知数据：development（${dev.length}）、regression（${reg.length}）、validation（${validation.length}），共 ${known.length} 条`,
  `  - development / regression 来源：\`${SPEC_DIR}\``,
  `  - validation 来源：${validationDir ? '`' + validationDir + '`（validation-set.jsonl 与 validation-gold.jsonl 按 sample_id 连接）' : '未加载（仅比较 dev/reg）'}`,
  `- 自比较排除：相同 sample_id 的样本对不参与统计（${selfExcluded} 对）；仅当审计对象与已知数据同源（如用 validation 自身做代理测试）时才会触发。`,
  `- 方法：exact_sample_hash = sha256(JSON.stringify(解析后对象))；normalized_scenario_hash 删除 sample_id/split/task_type/title/domain/construction_provenance 与全部 gold 字段（expected_action/acceptable_explanations/severe_failure_labels/scoring）后，递归删除 id/event_id/source_ref/derived_from/targets/at/valid_from/valid_until/query_time/made_at/revisit_at 键再取 sha256；decision_question_hash = sha256(decision_question ?? scenario.prompt)；timeline_hash = sha256(memory_timeline 全部 content 连接)；option_set_hash = sha256(候选 label+description 排序后连接)。near-duplicate 使用归一化文本（decision_question + 全部 timeline 内容 + 候选 label）的 8-gram Jaccard 相似度。`,
  '',
  '## 1. Hash 重叠指标',
  '',
  '| 指标 | 比较对数 | 命中对数 | 涉及审计样本数 | 状态 |',
  '| --- | --- | --- | --- | --- |',
  rows,
  '',
  '## 2. 断言',
  '',
  '```text',
  `exact_overlap = ${exactOverlapSamples}`,
  '```',
  '',
  `- exact 重叠对数：${exactOverlapPairs}；exact 重叠审计样本数：${exactOverlapSamples}${exactOverlapIds.size ? '（' + [...exactOverlapIds].sort().join('、') + '）' : ''}`,
  `- 结论：${exactOverlapSamples === 0 ? '**exact_overlap = 0 ✓ PASS**' : '**exact_overlap ≠ 0 ✗ FAIL**'}`,
  '',
  '## 3. Near-duplicate 诊断（仅标记，不判失败）',
  '',
  `- 归一化文本：decision_question（v1 样本回退到 scenario.prompt）+ 全部 memory_timeline 内容 + 候选方案 label`,
  `- 8-gram Jaccard 相似度阈值：>= ${FLAG_THRESHOLD} 标记为人工复核；比较对数 ${pairCount}；max ${+simMax.toFixed(3)}；mean ${simMean}`,
  `- 标记对数：${flagged.length}`,
  '',
  '| 审计样本 | 已知样本 | 相似度 |',
  '| --- | --- | --- |',
  flagRows,
  '',
  '## 4. 结论',
  '',
  `- exact_overlap = 0 断言：${exactOverlapSamples === 0 ? 'PASS' : 'FAIL'}`,
  `- near-duplicate 标记数：${flagged.length}（仅诊断项，不影响通过/失败）`,
  `- 退出码：${exactOverlapSamples === 0 ? '0' : '1'}`,
  '',
].join('\n');

fs.writeFileSync(path.join(OUT_DIR, 'holdback-v2-overlap-report.md'), report, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'holdback-v2-overlap-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');

console.log(`exact_overlap = ${exactOverlapSamples} (pairs ${exactOverlapPairs}); self-pair content mismatches = ${selfCollisions.length}`);
console.log(`near-duplicate flagged pairs (>= ${FLAG_THRESHOLD}): ${flagged.length}; max ${+simMax.toFixed(3)}, mean ${simMean}`);
console.log(`report: ${path.join(OUT_DIR, 'holdback-v2-overlap-report.md')}`);
process.exit(exactOverlapSamples === 0 && selfCollisions.length === 0 ? 0 : 1);



