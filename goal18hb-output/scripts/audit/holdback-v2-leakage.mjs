// Goal 18HB - Holdback V2 leakage audit.
//
// CLI:
//   node holdback-v2-leakage.mjs --fixtures <abs path to full-record fixtures jsonl> --out <abs output dir>
//
// The fixtures are FULL records: gold fields present at top level (expected_action,
// acceptable_explanations, severe_failure_labels, scoring, construction_provenance).
//
// The check: gold/answer material must appear ONLY in those top-level gold fields.
// The model-visible input fields must NOT contain:
//   * gold field names as substrings (expected_action / acceptable_explanations /
//     severe_failure_labels / scoring / preferred_action) — text values and object keys
//   * action codes used as hints (DECIDE, PROPOSE_CONFIRM, CLARIFY, APPROVAL_REQUEST,
//     DEFER, REJECT, KEEP, CONTINUE, REVISE, REVERSE, INVALIDATE, SUPERSEDE, OVERRIDE_HONOR)
//   * answer-template phrases / gold markers (Chinese + English)
//   * severe-failure label ids / policy rule ids (e.g. UNNECESSARY-REFUSAL,
//     NO-UNJUSTIFIED-REFUSAL — hyphenated uppercase ids)
//   * scorer metric names (scorer-specific hints)
//   * model names (GPT/Claude/Gemini/DeepSeek/Qwen/Llama/Kernel/...)
//   * dev/validation result markers and numeric score hints
//
// Model-visible fields scanned: scenario.prompt, scenario.distractor_variables,
// decision_question, goal.text, memory_timeline[].content, candidates[].label,
// candidates[].description, hard_constraints[].text, soft_preferences[].text,
// evidence.qualified[].fact, evidence.expired[].fact, evidence.conflicting[].fact,
// historical_decision.question, historical_decision.conclusion,
// execution_outcome.actual_outcome.
//
// Outputs: <out>/holdback-v2-leakage-audit.md (Chinese, Goal 18 report style) and
//          <out>/holdback-v2-leakage-results.json
// Exit code: 0 when findings == 0, 1 otherwise.
import fs from 'node:fs';
import path from 'node:path';

const HELP = `Usage:
  node holdback-v2-leakage.mjs --fixtures <abs path to full-record fixtures jsonl> --out <abs output dir>
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
if (!args.fixtures || !args.out) {
  console.error('missing required flags: --fixtures --out');
  console.error(HELP);
  process.exit(1);
}
const FIXTURES_PATH = path.resolve(args.fixtures);
const OUT_DIR = path.resolve(args.out);
if (!fs.existsSync(FIXTURES_PATH)) { console.error('fixtures not found: ' + FIXTURES_PATH); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });

function readJsonl(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8').replace(/^\uFEFF/, '');
  return raw.split(/\r?\n/).filter((l) => l.trim().length > 0).map((line, i) => {
    try { return JSON.parse(line); }
    catch (e) { throw new Error(`Bad JSON at ${absPath}:${i + 1}: ${e.message}`); }
  });
}

// ---------- token categories ----------
// mode: 'substring-ci' -> case-insensitive substring; 'word-cs' -> case-sensitive
// whole token (bounded by non-alphanumeric); 'regex' -> regex test.
const METRIC_NAMES = [
  'decision_accuracy', 'hard_constraint_violation_rate', 'warranted_decisiveness',
  'unnecessary_abstention_rate', 'clarification_efficiency', 'evidence_support_rate',
  'temporal_validity_rate', 'revision_precision', 'revision_recall',
  'decision_stability', 'outcome_adaptation', 'approval_boundary_compliance',
  'actionability', 'explanation_traceability',
  'correct_refusal_rate', 'over_questioning_rate', 'missed_revision_rate',
  'unwarranted_flapping_rate', 'clear_correct_rate', 'arbitrary_decisiveness_rate',
  'clarification_permissibility', 'approval_requirement_compliance', 'mandatory_constraints_honored',
  'lineage_operation_acceptability', 'approval_boundary_violation_rate', 'unsupported_decision_rate',
  'invalid_revision_rate', 'temporal_invalid_evidence_use_rate', 'user_override_violation_rate',
];
const TOKEN_CATEGORIES = [
  { name: 'gold_field_name', mode: 'substring-ci', tokens: ['expected_action', 'acceptable_explanations', 'severe_failure_labels', 'scoring', 'preferred_action'] },
  { name: 'action_code', mode: 'word-cs', tokens: ['DECIDE', 'PROPOSE_CONFIRM', 'CLARIFY', 'APPROVAL_REQUEST', 'DEFER', 'REJECT', 'KEEP', 'CONTINUE', 'REVISE', 'REVERSE', 'INVALIDATE', 'SUPERSEDE', 'OVERRIDE_HONOR'] },
  { name: 'answer_marker', mode: 'substring-ci', tokens: ['答案', '金标', 'gold', 'golden', '评分', '预期动作', '参考答案', '标准答案', '正确答案', '答案模板', '必须包含', '必须引用', '必须提及', '可接受答案'] },
  { name: 'failure_label_or_rule_id', mode: 'regex', tokens: [/[A-Z]{2,}(?:-[A-Z0-9]+)+/] },
  { name: 'scorer_metric', mode: 'substring-ci', tokens: METRIC_NAMES },
  { name: 'model_name', mode: 'substring-ci', tokens: ['gpt', 'chatgpt', 'claude', 'gemini', 'deepseek', 'qwen', 'llama', 'kernel'] },
  { name: 'split_or_result_marker', mode: 'substring-ci', tokens: ['validation', 'holdback', 'benchmark', 'devset', 'goldset'] },
  { name: 'result_hint', mode: 'regex', tokens: [
    /(?:accuracy|acc|f1|precision|recall|score|pass|fail)\s*[:：=]?\s*\d+(?:\.\d+)?/i,
    /(?:准确率|通过率|得分|正确率|评分)\s*[:：]?\s*\d+(?:\.\d+)?/,
  ] },
];
const GOLD_KEY_NAMES = ['expected_action', 'acceptable_explanations', 'severe_failure_labels', 'scoring', 'preferred_action'];

function matchToken(value, category) {
  const s = String(value);
  if (category.mode === 'word-cs') {
    for (const t of category.tokens) {
      if (new RegExp(`(?<![A-Za-z0-9_])${t}(?![A-Za-z0-9_])`).test(s)) return t;
    }
  } else if (category.mode === 'regex') {
    for (const re of category.tokens) {
      const m = s.match(re);
      if (m) return m[0];
    }
  } else {
    for (const t of category.tokens) {
      if (s.toLowerCase().includes(String(t).toLowerCase())) return t;
    }
  }
  return null;
}

const GOLD_FIELDS = ['expected_action', 'acceptable_explanations', 'severe_failure_labels', 'scoring'];
const SCANNED_FIELDS = [
  { label: 'scenario.prompt', get: (s) => [[`scenario.prompt`, s.scenario?.prompt]] },
  { label: 'scenario.distractor_variables', get: (s) => (s.scenario?.distractor_variables ?? []).map((v, i) => [`scenario.distractor_variables[${i}]`, v]) },
  { label: 'decision_question', get: (s) => [[`decision_question`, s.decision_question]] },
  { label: 'goal.text', get: (s) => [[`goal.text`, s.goal?.text]] },
  { label: 'memory_timeline[].content', get: (s) => (s.memory_timeline ?? []).map((e, i) => [`memory_timeline[${i}].content`, e?.content]) },
  { label: 'candidates[].label', get: (s) => (s.candidates ?? []).map((c, i) => [`candidates[${i}].label`, c?.label]) },
  { label: 'candidates[].description', get: (s) => (s.candidates ?? []).map((c, i) => [`candidates[${i}].description`, c?.description]) },
  { label: 'hard_constraints[].text', get: (s) => (s.hard_constraints ?? []).map((h, i) => [`hard_constraints[${i}].text`, h?.text]) },
  { label: 'soft_preferences[].text', get: (s) => (s.soft_preferences ?? []).map((p, i) => [`soft_preferences[${i}].text`, p?.text]) },
  { label: 'evidence.qualified[].fact', get: (s) => (s.evidence?.qualified ?? []).map((e, i) => [`evidence.qualified[${i}].fact`, e?.fact]) },
  { label: 'evidence.expired[].fact', get: (s) => (s.evidence?.expired ?? []).map((e, i) => [`evidence.expired[${i}].fact`, e?.fact]) },
  { label: 'evidence.conflicting[].fact', get: (s) => (s.evidence?.conflicting ?? []).map((e, i) => [`evidence.conflicting[${i}].fact`, e?.fact]) },
  { label: 'historical_decision.question', get: (s) => (s.historical_decision ? [[`historical_decision.question`, s.historical_decision.question]] : []) },
  { label: 'historical_decision.conclusion', get: (s) => (s.historical_decision ? [[`historical_decision.conclusion`, s.historical_decision.conclusion]] : []) },
  { label: 'execution_outcome.actual_outcome', get: (s) => (s.execution_outcome ? [[`execution_outcome.actual_outcome`, s.execution_outcome.actual_outcome]] : []) },
];
const KEY_SCAN_CONTAINERS = [
  { label: 'scenario', get: (s) => (s.scenario ? [['scenario', s.scenario]] : []) },
  { label: 'goal', get: (s) => (s.goal ? [['goal', s.goal]] : []) },
  { label: 'memory_timeline[].writer', get: (s) => (s.memory_timeline ?? []).map((e, i) => [`memory_timeline[${i}].writer`, e?.writer]) },
  { label: 'candidates[]', get: (s) => (s.candidates ?? []).map((c, i) => [`candidates[${i}]`, c]) },
  { label: 'hard_constraints[]', get: (s) => (s.hard_constraints ?? []).map((h, i) => [`hard_constraints[${i}]`, h]) },
  { label: 'soft_preferences[]', get: (s) => (s.soft_preferences ?? []).map((p, i) => [`soft_preferences[${i}]`, p]) },
  { label: 'evidence.qualified[]', get: (s) => (s.evidence?.qualified ?? []).map((e, i) => [`evidence.qualified[${i}]`, e]) },
  { label: 'evidence.expired[]', get: (s) => (s.evidence?.expired ?? []).map((e, i) => [`evidence.expired[${i}]`, e]) },
  { label: 'evidence.conflicting[]', get: (s) => (s.evidence?.conflicting ?? []).map((e, i) => [`evidence.conflicting[${i}]`, e]) },
  { label: 'historical_decision', get: (s) => (s.historical_decision ? [['historical_decision', s.historical_decision]] : []) },
  { label: 'execution_outcome', get: (s) => (s.execution_outcome ? [['execution_outcome', s.execution_outcome]] : []) },
];

const fixtures = readJsonl(FIXTURES_PATH);
console.log(`fixtures: ${FIXTURES_PATH} (${fixtures.length} records)`);
const missingGold = fixtures.filter((s) => !GOLD_FIELDS.every((f) => f in s)).length;
if (missingGold > 0) console.warn(`warning: ${missingGold}/${fixtures.length} records are missing top-level gold fields (expected_action/acceptable_explanations/severe_failure_labels/scoring); the fixture file should contain FULL records`);

// ---------- scan ----------
const findings = []; // {sample_id, field_path, token, category}
const fieldStats = Object.fromEntries(SCANNED_FIELDS.map((f) => [f.label, { values: 0, findings: 0 }]));
const catStats = Object.fromEntries(TOKEN_CATEGORIES.map((c) => [c.name, { findings: 0 }]));

for (const s of fixtures) {
  const id = s.sample_id ?? '?';
  const seenTokens = new Set();
  for (const f of SCANNED_FIELDS) {
    for (const [fieldPath, value] of f.get(s)) {
      fieldStats[f.label].values++;
      if (typeof value !== 'string' || value.length === 0) continue;
      for (const cat of TOKEN_CATEGORIES) {
        const token = matchToken(value, cat);
        if (token) {
          const key = fieldPath + '\u0000' + token + '\u0000' + cat.name;
          if (!seenTokens.has(key)) {
            seenTokens.add(key);
            findings.push({ sample_id: id, field_path: fieldPath, token, category: cat.name });
            fieldStats[f.label].findings++;
            catStats[cat.name].findings++;
          }
        }
      }
    }
  }
  // structural: gold field names must not appear as keys inside model-visible containers
  for (const c of KEY_SCAN_CONTAINERS) {
    for (const [containerPath, obj] of c.get(s)) {
      if (!obj || typeof obj !== 'object') continue;
      for (const k of Object.keys(obj)) {
        if (GOLD_KEY_NAMES.includes(k)) {
          const key = containerPath + '\u0000' + k + '\u0000gold_field_key';
          if (!seenTokens.has(key)) {
            seenTokens.add(key);
            findings.push({ sample_id: id, field_path: containerPath + '.' + k, token: k, category: 'gold_field_key' });
          }
        }
      }
    }
  }
}
findings.sort((a, b) => a.sample_id.localeCompare(b.sample_id) || a.field_path.localeCompare(b.field_path));

// ---------- outputs ----------
const results = {
  generated_at: new Date().toISOString(),
  command: `node holdback-v2-leakage.mjs --fixtures ${FIXTURES_PATH} --out ${OUT_DIR}`,
  fixtures: { path: FIXTURES_PATH, count: fixtures.length },
  scanned_fields: Object.fromEntries(Object.entries(fieldStats).map(([k, v]) => [k, v])),
  findings_by_category: catStats,
  gold_leakage_findings: findings.length,
  findings: findings,
};

const fieldRows = SCANNED_FIELDS.map((f) => `| ${f.label} | ${fieldStats[f.label].values} | ${fieldStats[f.label].findings} |`).join('\n');
const catRows = Object.entries(catStats).map(([name, v]) => `| ${name} | ${v.findings} |`).join('\n');
const findingRows = findings.length === 0
  ? '（无发现）'
  : findings.map((f) => `| ${f.sample_id} | \`${f.field_path}\` | \`${f.token}\` | ${f.category} |`).join('\n');

const report = [
  '# Goal 18HB — Holdback V2 泄漏审计报告',
  '',
  `- 审计对象（--fixtures）：\`${FIXTURES_PATH}\`（${fixtures.length} 条完整记录）`,
  `- 方法：gold/答案材料只允许出现在顶层 gold 字段（expected_action、acceptable_explanations、severe_failure_labels、scoring）；扫描全部模型可见输入字段，检查 gold 字段名（含 preferred_action）、动作码（DECIDE/PROPOSE_CONFIRM/CLARIFY/APPROVAL_REQUEST/DEFER/REJECT/KEEP/CONTINUE/REVISE/REVERSE/INVALIDATE/SUPERSEDE/OVERRIDE_HONOR）、答案模板短语、严重失败标签/策略规则 id、scorer 指标名、模型名、dev/validation 结果标记与数值评分线索，并检查可见容器内不得出现 gold 字段名作为键。`,
  `- 扫描字段数：${SCANNED_FIELDS.length}；扫描值总数：${Object.values(fieldStats).reduce((a, v) => a + v.values, 0)}`,
  '',
  '## 1. 扫描字段',
  '',
  '| 字段路径 | 扫描值数量 | 发现数 |',
  '| --- | --- | --- |',
  fieldRows,
  '',
  '## 2. 发现（按样本）',
  '',
  '| 样本 | 字段路径 | 匹配 token | 类别 |',
  '| --- | --- | --- | --- |',
  findingRows,
  '',
  '## 3. 发现（按类别）',
  '',
  '| 类别 | 发现数 |',
  '| --- | --- |',
  catRows,
  '',
  '## 4. 断言',
  '',
  '```text',
  `gold_leakage_findings = ${findings.length}`,
  '```',
  '',
  `- 结论：${findings.length === 0 ? '**gold_leakage_findings = 0 ✓ PASS**' : '**gold_leakage_findings ≠ 0 ✗ FAIL**'}`,
  `- 退出码：${findings.length === 0 ? '0' : '1'}`,
  '',
].join('\n');

fs.writeFileSync(path.join(OUT_DIR, 'holdback-v2-leakage-audit.md'), report, 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'holdback-v2-leakage-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');

console.log(`gold_leakage_findings = ${findings.length}`);
if (findings.length > 0) {
  for (const f of findings.slice(0, 20)) console.log(`  ${f.sample_id}  ${f.field_path}  token=${f.token}  (${f.category})`);
  if (findings.length > 20) console.log(`  ... and ${findings.length - 20} more`);
}
console.log(`report: ${path.join(OUT_DIR, 'holdback-v2-leakage-audit.md')}`);
process.exit(findings.length === 0 ? 0 : 1);




