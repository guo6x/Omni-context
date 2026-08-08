// Goal 18HB - Holdback V2 coverage-matrix analysis.
//
// CLI:
//   node holdback-v2-coverage.mjs --fixtures <abs path to fixtures jsonl> --out <abs output dir>
//        [--gold <abs path to gold jsonl>] [--splitTag hb|val]
//
// --gold joins gold fields onto fixture records by sample_id (same semantics as
// fixtures-loader.mjs loadValidation: { ...fixture, ...gold }); used when the fixtures
// file carries no gold fields (e.g. the Goal 18 validation split).
// --splitTag selects the pre-registered plan array (default 'hb' = Holdback V2 plans).
//
// Outputs:
//   <out>/holdback-v2-coverage-matrix.csv   (UTF-8 with BOM, Excel friendly)
//   <out>/holdback-v2-coverage-report.md    (Chinese, Goal 18 report style)
//
// The script is strictly read-only with respect to samples: it never modifies,
// reorders or drops fixtures, and it never rebalances factor distributions. Per
// Goal 18HB section 9, pre-registered distributions must not be broken to force
// perfect balance; any imbalance is reported, not fixed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLANS_PATH = path.resolve(here, '..', '..', '..', 'goal18-output', 'scripts', 'generator', 'plans.mjs');

const TASK_TYPES = ['TT01', 'TT02', 'TT03', 'TT04', 'TT05', 'TT06', 'TT07', 'TT08', 'TT09', 'TT10', 'TT11', 'TT12', 'TT13', 'TT14', 'TT15'];
const REVISION_ACTIONS = new Set(['REVISE', 'REVERSE', 'INVALIDATE', 'SUPERSEDE']);
const KEEP_ACTIONS = new Set(['KEEP', 'CONTINUE']);
const CSV_COLUMNS = ['sample_id', 'task_type', 'domain', 'risk_level', 'reversibility', 'authority', 'history', 'approval_required', 'evidence_sufficient', 'expired_count', 'conflicting_count', 'revision_type', 'user_override', 'plan_risk', 'plan_reversibility', 'plan_authority', 'plan_match'];
const EXPECTED_PER_TT = 12;
const EXPECTED_TOTAL = TASK_TYPES.length * EXPECTED_PER_TT;

// ---------- planFor ----------
// Import the frozen generator plan source. plans.mjs has no side effects (it only
// exports constants/functions), so importing it never runs generation.
let planFor;
try {
  const mod = await import(pathToFileURL(PLANS_PATH).href);
  planFor = mod.planFor;
} catch (importErr) {
  // Fallback: regex-extracted static copy of the PLANS constant from the frozen
  // generator. Source: goal18-output/scripts/generator/plans.mjs (Goal 18H-R frozen
  // generator), extracted 2026-08-08. planFor semantics match the original
  // (idx % arr.length when idx exceeds the plan array length).
  const src = fs.readFileSync(PLANS_PATH, 'utf8');
  const m = src.match(/const R_LOW = [\s\S]*?\n\nexport const PLANS = \{[\s\S]*?\n\};/);
  if (!m) throw new Error(`plans.mjs import failed and static extraction failed: ${importErr.message}`);
  const body = m[0].replace(/^export const /gm, 'const ');
  const PLANS = new Function(`${body}\nreturn PLANS;`)();
  planFor = (tt, splitTag, idx) => {
    const p = PLANS[tt];
    const arr = splitTag === 'val' ? p.val : p.hb;
    const auth = splitTag === 'val' ? p.authVal : p.authHb;
    const f = arr[idx % arr.length];
    return { risk: f.risk, reversibility: f.rev, authority: auth[idx % auth.length] };
  };
}

// ---------- CLI ----------
function usage() {
  console.log('Usage: node holdback-v2-coverage.mjs --fixtures <abs jsonl> --out <abs dir> [--gold <abs gold jsonl>] [--splitTag hb|val]');
}

function parseArgs(argv) {
  const args = { fixtures: null, out: null, gold: null, splitTag: 'hb' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--fixtures') args.fixtures = next();
    else if (a === '--out') args.out = next();
    else if (a === '--gold') args.gold = next();
    else if (a === '--splitTag') args.splitTag = next();
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.fixtures || !args.out) throw new Error('--fixtures and --out are required');
  if (args.splitTag !== 'hb' && args.splitTag !== 'val') throw new Error(`--splitTag must be hb or val, got ${args.splitTag}`);
  return args;
}

// ---------- loading ----------
function loadJsonl(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    try { return JSON.parse(line); }
    catch (e) { throw new Error(`Bad JSON at ${file}:${i + 1}: ${e.message}`); }
  });
}

function joinGold(fixtures, goldPath) {
  const gold = loadJsonl(goldPath);
  const byId = new Map(gold.map((g) => [g.sample_id, g]));
  const missingGold = [];
  const joined = fixtures.map((s) => {
    const g = byId.get(s.sample_id);
    if (!g) { missingGold.push(s.sample_id); return s; }
    return { ...s, ...g };
  });
  const goldWithoutFixture = gold.filter((g) => !fixtures.some((s) => s.sample_id === g.sample_id)).map((g) => g.sample_id);
  return { joined, missingGold, goldWithoutFixture };
}

// ---------- factor extraction ----------
function extractFactors(sample, tt, idx, splitTag) {
  const gold = sample.expected_action ?? {};
  const action = gold.action ?? 'UNKNOWN';
  const risk = sample.scenario?.risk_classification?.level ?? 'unknown';
  const rev = sample.scenario?.risk_classification?.reversibility ?? 'unknown';
  const auth = sample.scenario?.authority_level ?? 'unknown';
  const qualified = sample.evidence?.qualified ?? [];
  const expired = sample.evidence?.expired ?? [];
  const conflicting = sample.evidence?.conflicting ?? [];
  const qualifiedIds = new Set(qualified.map((e) => e.id));
  const timelineIds = new Set((sample.memory_timeline ?? []).map((e) => e.event_id));
  const required = Array.isArray(gold.required_evidence) ? gold.required_evidence : [];
  const available = new Set([...qualifiedIds, ...timelineIds]);
  const evidenceSufficient = qualifiedIds.size >= 1 && required.every((id) => available.has(id));
  const history = sample.historical_decision ? 'present' : 'absent';
  const approvalRequired = action === 'APPROVAL_REQUEST' || action === 'PROPOSE_CONFIRM' || gold.approval_requirement?.required === true;
  // revision factor per Goal 18 conventions (F10): only REVISE/REVERSE/INVALIDATE/SUPERSEDE
  // (revise_family) vs KEEP/CONTINUE (keep_family) carry revision semantics when history is
  // present; everything else is n/a by design (e.g. TT13 OVERRIDE_HONOR).
  let revisionType = 'n/a';
  if (history === 'present') {
    if (REVISION_ACTIONS.has(action)) revisionType = 'revise_family';
    else if (KEEP_ACTIONS.has(action)) revisionType = 'keep_family';
  }
  const userOverride = action === 'OVERRIDE_HONOR';
  const plan = planFor(tt, splitTag, idx);
  const planMatch = plan.risk === risk && plan.reversibility === rev && plan.authority === auth;
  return {
    sample,
    tt,
    idx,
    risk,
    reversibility: rev,
    authority: auth,
    history,
    approvalRequired,
    evidenceSufficient,
    expiredCount: expired.length,
    conflictingCount: conflicting.length,
    revisionType,
    userOverride,
    plan,
    planMatch,
    action
  };
}

function analyze(fixtures, goldPath, splitTag) {
  const anomalies = [];
  let { joined, missingGold, goldWithoutFixture } = { joined: fixtures, missingGold: [], goldWithoutFixture: [] };
  if (goldPath) {
    ({ joined, missingGold, goldWithoutFixture } = joinGold(fixtures, goldPath));
  }

  const ordinals = {};
  const rows = [];
  const seenIds = new Set();
  for (const s of joined) {
    if (seenIds.has(s.sample_id)) anomalies.push(`duplicate sample_id: ${s.sample_id}`);
    seenIds.add(s.sample_id);
    const idm = /-tt(\d{2})-(\d{3})$/.exec(s.sample_id ?? '');
    let tt, idx, idParsed;
    if (idm) {
      tt = `TT${idm[1]}`;
      idx = parseInt(idm[2], 10);
      idParsed = true;
      if (s.task_type && s.task_type !== tt) anomalies.push(`sample_id task_type mismatch: ${s.sample_id} (id says ${tt}, field says ${s.task_type})`);
    } else {
      ordinals[s.task_type] = (ordinals[s.task_type] ?? -1) + 1;
      tt = s.task_type;
      idx = ordinals[s.task_type];
      idParsed = false;
      anomalies.push(`sample_id pattern not parseable, used ordinal index: ${s.sample_id ?? '(missing sample_id)'}`);
    }
    if (!TASK_TYPES.includes(tt)) anomalies.push(`unknown task_type: ${tt} (${s.sample_id})`);
    const action = s.expected_action?.action;
    if (s.historical_decision && !REVISION_ACTIONS.has(action) && !KEEP_ACTIONS.has(action) && action !== 'OVERRIDE_HONOR') {
      anomalies.push(`history present with unexpected gold action ${action}: ${s.sample_id}`);
    }
    rows.push(extractFactors(s, tt, idx, splitTag));
  }
  if (missingGold.length) anomalies.push(`fixtures without gold (${missingGold.length}): ${missingGold.join(', ')}`);
  if (goldWithoutFixture.length) anomalies.push(`gold records without fixture (${goldWithoutFixture.length}): ${goldWithoutFixture.join(', ')}`);

  const byTT = {};
  for (const r of rows) (byTT[r.tt] ??= []).push(r);
  for (const tt of TASK_TYPES) if (!byTT[tt]) byTT[tt] = [];

  const totalCount = rows.length;
  const totalOk = totalCount === EXPECTED_TOTAL;
  const perTT = Object.fromEntries(TASK_TYPES.map((tt) => [tt, byTT[tt].length]));
  const perTTOk = TASK_TYPES.every((tt) => perTT[tt] === EXPECTED_PER_TT);

  const missingIndices = {};
  for (const tt of TASK_TYPES) {
    const present = new Set(byTT[tt].map((r) => r.idx));
    missingIndices[tt] = [];
    for (let i = 0; i < EXPECTED_PER_TT; i++) if (!present.has(i)) missingIndices[tt].push(i);
  }

  return { rows, byTT, totalCount, totalOk, perTT, perTTOk, missingIndices, anomalies, splitTag };
}

// ---------- CSV ----------
function csvEscape(v) {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([
      r.sample.sample_id, r.tt, r.sample.domain ?? '', r.risk, r.reversibility, r.authority,
      r.history, r.approvalRequired ? 'yes' : 'no', r.evidenceSufficient ? 'yes' : 'no',
      r.expiredCount, r.conflictingCount, r.revisionType, r.userOverride ? 'yes' : 'no',
      r.plan.risk, r.plan.reversibility, r.plan.authority, r.planMatch ? 'yes' : 'no'
    ].map(csvEscape).join(','));
  }
  return '\uFEFF' + lines.join('\n') + '\n';
}

// ---------- report ----------
function countBy(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.entries(out).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function hist(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0]));
}

function fmtCounts(entries) {
  return entries.map(([k, v]) => `${k}: ${v}`).join('; ') || '-';
}

function buildReport(ctx) {
  const { rows, byTT, totalCount, totalOk, perTT, perTTOk, missingIndices, anomalies, splitTag, fixturesPath, goldPath, outDir } = ctx;
  const now = new Date().toISOString();
  const L = [];
  L.push('# Holdback V2 覆盖矩阵分析报告');
  L.push('');
  L.push(`- 生成时间: ${now}`);
  L.push(`- fixtures 数据源: \`${fixturesPath}\``);
  L.push(goldPath ? `- gold 数据源（按 sample_id 合并）: \`${goldPath}\`` : '- gold: fixtures 已内嵌 expected_action 等 gold 字段');
  L.push(`- 预登记计划: \`plans.mjs\` (planFor splitTag=\`${splitTag}\`)`);
  L.push(`- 样本总数: ${totalCount}（预期 ${EXPECTED_TOTAL} = 15 task types x 12）→ ${totalOk ? 'PASS' : 'FAIL'}`);
  L.push('');

  L.push('## 1. 总体校验（15 × 12 = 180）');
  L.push('');
  L.push('| task_type | 样本数 | 预期 | 状态 | 缺失 idx |');
  L.push('|---|---|---|---|---|');
  for (const tt of TASK_TYPES) {
    const n = perTT[tt];
    const status = n === EXPECTED_PER_TT ? 'PASS' : 'MISMATCH';
    const missing = missingIndices[tt].length ? missingIndices[tt].join(', ') : '-';
    L.push(`| ${tt} | ${n} | ${EXPECTED_PER_TT} | ${status} | ${missing} |`);
  }
  L.push(`| **合计** | **${totalCount}** | **${EXPECTED_TOTAL}** | ${totalOk ? 'PASS' : 'MISMATCH'} | |`);
  L.push('');

  L.push('## 2. 因子分布总览');
  L.push('');
  L.push('| 因子 | 取值分布 |');
  L.push('|---|---|');
  L.push(`| risk_level（风险等级） | ${fmtCounts(countBy(rows, (r) => r.risk))} |`);
  L.push(`| reversibility（可逆性） | ${fmtCounts(countBy(rows, (r) => r.reversibility))} |`);
  L.push(`| authority（权限等级） | ${fmtCounts(countBy(rows, (r) => r.authority))} |`);
  L.push(`| history（历史决策） | ${fmtCounts(countBy(rows, (r) => r.history))} |`);
  L.push(`| approval_required（审批要求） | ${fmtCounts(countBy(rows, (r) => (r.approvalRequired ? 'yes' : 'no')))} |`);
  L.push(`| evidence_sufficient（证据充分） | ${fmtCounts(countBy(rows, (r) => (r.evidenceSufficient ? 'yes' : 'no')))} |`);
  L.push(`| expired_count（过期证据数） | ${fmtCounts(hist(rows, (r) => r.expiredCount))} |`);
  L.push(`| conflicting_count（冲突证据数） | ${fmtCounts(hist(rows, (r) => r.conflictingCount))} |`);
  L.push(`| revision_type（修订类型） | ${fmtCounts(countBy(rows, (r) => r.revisionType))} |`);
  L.push(`| user_override（用户覆盖） | ${fmtCounts(countBy(rows, (r) => (r.userOverride ? 'yes' : 'no')))} |`);
  L.push('');

  L.push('### 2.1 覆盖维度核对（规范第 9 节要求至少分析）');
  L.push('');
  L.push('| 规范要求维度 | 对应因子 | 本批观测 |');
  L.push('|---|---|---|');
  const currency = (r) => (r.conflictingCount > 0 ? 'conflicting_present' : (r.expiredCount > 0 ? 'stale_present' : 'current'));
  const riskBand = (r) => (['high', 'critical'].includes(r.risk) ? 'higher' : (r.risk === 'low' ? 'low' : (r.risk === 'medium' ? 'medium' : 'negligible')));
  const goldSufficiency = (r) => (['CLARIFY', 'REJECT', 'DEFER'].includes(r.action) ? 'insufficient' : 'sufficient');
  L.push(`| sufficient / insufficient evidence（可用性判定） | evidence_sufficient | ${fmtCounts(countBy(rows, (r) => (r.evidenceSufficient ? 'sufficient' : 'insufficient')))} |`);
  L.push(`| sufficient / insufficient evidence（gold action 约定） | gold.action ∈ CLARIFY/REJECT/DEFER | ${fmtCounts(countBy(rows, goldSufficiency))} |`);
  L.push(`| history / no history | history | ${fmtCounts(countBy(rows, (r) => r.history))} |`);
  L.push(`| approval / no approval | approval_required | ${fmtCounts(countBy(rows, (r) => (r.approvalRequired ? 'approval' : 'no_approval')))} |`);
  L.push(`| stale / current / conflicting evidence | expired_count, conflicting_count | ${fmtCounts(countBy(rows, currency))} |`);
  L.push(`| revision / no revision | revision_type | ${fmtCounts(countBy(rows, (r) => r.revisionType))} |`);
  L.push(`| reversible / less reversible | reversibility | ${fmtCounts(countBy(rows, (r) => r.reversibility))} |`);
  L.push(`| low / higher risk | risk_level | ${fmtCounts(countBy(rows, riskBand))} |`);
  L.push(`| authority variation | authority | ${fmtCounts(countBy(rows, (r) => r.authority))} |`);
  L.push(`| user override（适用处） | user_override | ${fmtCounts(countBy(rows, (r) => (r.userOverride ? 'yes' : 'no')))} |`);
  L.push('');

  L.push('## 3. 各任务类型因子汇总');
  L.push('');
  L.push('| task_type | n | sufficient | history | approval | stale | conflicting | revise | keep | override | risk_levels | reversibility | authority |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const tt of TASK_TYPES) {
    const rr = byTT[tt];
    if (rr.length === 0) {
      L.push(`| ${tt} | 0 | - | - | - | - | - | - | - | - | - | - | - |`);
      continue;
    }
    const n = (x) => rr.filter((r) => x(r)).length;
    const cells = [
      tt, rr.length,
      n((r) => r.evidenceSufficient), n((r) => r.history === 'present'),
      n((r) => r.approvalRequired), n((r) => r.expiredCount > 0), n((r) => r.conflictingCount > 0),
      n((r) => r.revisionType === 'revise_family'), n((r) => r.revisionType === 'keep_family'),
      n((r) => r.userOverride),
      [...new Set(rr.map((r) => r.risk))].sort().join(';'),
      [...new Set(rr.map((r) => r.reversibility))].sort().join(';'),
      [...new Set(rr.map((r) => r.authority))].sort().join(';')
    ];
    L.push(`| ${cells.join(' | ')} |`);
  }
  L.push('');

  L.push('## 4. 预登记组合 vs 实际（plan vs actual，逐 TT）');
  L.push('');
  L.push(`按 \`planFor(tt, '${splitTag}', idx)\`（idx 越界时按 \`idx % 数组长度\` 回绕）对比每个样本的 risk / reversibility / authority。`);
  L.push('');
  for (const tt of TASK_TYPES) {
    L.push(`### ${tt}`);
    L.push('');
    L.push('| idx | plan_risk | plan_reversibility | plan_authority | actual_risk | actual_reversibility | actual_authority | 匹配 |');
    L.push('|---|---|---|---|---|---|---|---|');
    const byIdx = new Map(byTT[tt].map((r) => [r.idx, r]));
    for (let i = 0; i < EXPECTED_PER_TT; i++) {
      const p = planFor(tt, splitTag, i);
      const r = byIdx.get(i);
      if (!r) {
        L.push(`| ${i} | ${p.risk} | ${p.reversibility} | ${p.authority} | -（缺样本） | - | - | - |`);
      } else {
        L.push(`| ${i} | ${p.risk} | ${p.reversibility} | ${p.authority} | ${r.risk} | ${r.reversibility} | ${r.authority} | ${r.planMatch ? '是' : '否'} |`);
      }
    }
    L.push('');
  }

  const mismatches = rows.filter((r) => !r.planMatch);
  L.push('## 5. 预登记计划与实际不符清单');
  L.push('');
  if (mismatches.length === 0) {
    L.push('无。全部样本的 risk / reversibility / authority 均与预登记计划一致。');
  } else {
    L.push(`共 ${mismatches.length} 条（占 ${rows.length} 条的 ${((mismatches.length / Math.max(rows.length, 1)) * 100).toFixed(1)}%）。`);
    L.push('');
    L.push('| sample_id | task_type | idx | plan_risk | actual_risk | plan_rev | actual_rev | plan_auth | actual_auth |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of mismatches) {
      L.push(`| ${r.sample.sample_id} | ${r.tt} | ${r.idx} | ${r.plan.risk} | ${r.risk} | ${r.plan.reversibility} | ${r.reversibility} | ${r.plan.authority} | ${r.authority} |`);
    }
  }
  L.push('');

  L.push('## 6. 预登记分布保持说明');
  L.push('');
  L.push('- 本脚本为只读分析：不修改、不重排、不删除、不新增任何样本，也不调整任何因子分布。');
  L.push('- 覆盖矩阵仅如实报告实际分布；预登记分布由已冻结 generator 的 `plans.mjs` hb 数组（risk / reversibility / authority）及各 TT 构造规则决定。');
  L.push('- 按 Goal 18HB 规范第 9 节：**禁止为了追求完美均衡而破坏预登记分布**。本报告不执行任何平衡性调整；若分布与预登记计划存在差异，仅在上文列出，不进行修补。');
  L.push('');

  L.push('## 7. 数据异常清单');
  L.push('');
  if (anomalies.length === 0) {
    L.push('无异常。');
  } else {
    for (const a of anomalies) L.push(`- ${a}`);
  }
  L.push('');

  L.push(`## 附：输出文件`);
  L.push('');
  L.push(`- \`${path.join(outDir, 'holdback-v2-coverage-matrix.csv')}\``);
  L.push(`- \`${path.join(outDir, 'holdback-v2-coverage-report.md')}\``);
  L.push('');
  return L.join('\n');
}

// ---------- main ----------
function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixturesPath = path.resolve(args.fixtures);
  const outDir = path.resolve(args.out);
  if (!fs.existsSync(fixturesPath)) throw new Error(`fixtures file not found: ${fixturesPath}`);
  const fixtures = loadJsonl(fixturesPath);
  const goldPath = args.gold ? path.resolve(args.gold) : null;
  if (goldPath && !fs.existsSync(goldPath)) throw new Error(`gold file not found: ${goldPath}`);

  const ctx = analyze(fixtures, goldPath, args.splitTag);
  ctx.fixturesPath = fixturesPath;
  ctx.goldPath = goldPath;
  ctx.outDir = outDir;

  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, 'holdback-v2-coverage-matrix.csv');
  const mdPath = path.join(outDir, 'holdback-v2-coverage-report.md');
  fs.writeFileSync(csvPath, buildCsv(ctx.rows), 'utf8');
  fs.writeFileSync(mdPath, buildReport(ctx), 'utf8');

  const planMismatchCount = ctx.rows.filter((r) => !r.planMatch).length;
  const missingCount = Object.values(ctx.missingIndices).reduce((a, x) => a + x.length, 0);
  const perTTSummary = TASK_TYPES.map((tt) => `${tt}=${ctx.perTT[tt]}`).join(' ');

  // stdout: ASCII only
  console.log('Holdback V2 coverage analysis complete');
  console.log(`  fixtures: ${fixturesPath}`);
  console.log(`  gold: ${goldPath ?? '(embedded in fixtures)'}`);
  console.log(`  splitTag: ${args.splitTag}`);
  console.log(`  samples: ${ctx.totalCount} (expected ${EXPECTED_TOTAL}) -> total_count_ok: ${ctx.totalOk ? 'yes' : 'no'}`);
  console.log(`  per-tt 12-count check: ${ctx.perTTOk ? 'PASS' : 'FAIL'}`);
  console.log(`  per_tt_counts: ${perTTSummary}`);
  console.log(`  plan mismatches: ${planMismatchCount}/${ctx.rows.length}`);
  console.log(`  missing plan indices (0-11): ${missingCount}`);
  console.log(`  anomalies: ${ctx.anomalies.length}`);
  console.log(`  csv: ${csvPath}`);
  console.log(`  report: ${mdPath}`);
}

try {
  main();
} catch (err) {
  console.error(`holdback-v2-coverage: ${err.message}`);
  process.exit(1);
}
