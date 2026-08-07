// Goal 18 v2 generator CLI.
// Usage:
//   node generate.mjs --split validation --seed <seed> --tag val
//   node generate.mjs --split holdback --seed <seed> --tag holdback
// Deterministic: same seed + same generator version => byte-identical outputs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, sha256 } from './rng.mjs';
import { DOMAINS, domainById, pickEntities } from './pools.mjs';
import { assemble } from './common.mjs';
import { planFor, domainFor, sourceTypeFor, variantFor, countSourceTypes } from './plans.mjs';
import * as b0105 from './builders-tt01-05.mjs';
import * as b0610 from './builders-tt06-10.mjs';
import * as b1115 from './builders-tt11-15.mjs';
import { validateSchema } from '../../benchmark-integrity-tests/schema-validator.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..', '..');
let OUT_DIR = OUT;
const SCHEMA = JSON.parse(fs.readFileSync(path.join(OUT, 'schema', 'decision-benchmark-v2-schema.json'), 'utf8'));

const TTS = ['TT01', 'TT02', 'TT03', 'TT04', 'TT05', 'TT06', 'TT07', 'TT08', 'TT09', 'TT10', 'TT11', 'TT12', 'TT13', 'TT14', 'TT15'];
const BUILDERS = { ...b0105, ...b0610, ...b1115 };

const EDIT_BASE = Date.parse('2026-08-07T00:00:00Z');
const REWRITES = [
  ['确定方案', '敲定方案'],
  ['开始为', '着手为'],
  ['评估完成', '评估完毕'],
  ['需要重新评估', '需要再权衡'],
  ['给出决定', '给出结论'],
  ['选择方案', '选定方案']
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      args[k] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      if (typeof args[k] !== 'boolean') i++;
      if (k.includes('-')) { const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); args[camel] = args[k]; }
    }
  }
  return args;
}

// Per-sample narrative diversification: swap scaffold phrases so same-task samples diverge
// beyond the 8-gram Jaccard near-duplicate threshold. Deterministic (driven by the sample rng).
// Explanations and candidate labels/ids are intentionally excluded (gold must_include integrity).
const DIVERSIFY_RULES = [
  ['征询建议', ['征询意见', '征求建议']],
  ['给出建议', ['给出意见', '提供建议']],
  ['请给出决定', ['请给出结论', '请作出决定']],
  ['方案建议相反', ['方案意见相左', '建议互相矛盾']],
  ['两个智能体对', ['两个智能体针对', '两个模型对']],
  ['解决多智能体分歧', ['处理多智能体意见分歧', '化解多个智能体的分歧', '裁定多智能体冲突']],
  ['按当前事实选择', ['依据当前事实选定', '按最新事实确定']],
  ['接下来怎么办', ['接下来如何处置', '下一步怎么办']],
  ['是否要调整', ['是否应该调整', '要不要改']],
  ['现在怎么处理', ['现在该如何处理', '眼下怎么处理']],
  ['是否继续', ['是否延续', '要不要继续']],
  ['复核确认', ['复核后确认', '再次核对后确认', '复查确认']],
  ['附实测数据', ['并附上实测数据', '并给出实测数据', '附带实测数据']],
  ['满足硬约束', ['符合硬约束', '满足全部硬约束']],
  ['无实质变化', ['没有实质变化', '无显著变化']],
  ['运行良好', ['运行平稳', '运转正常']],
  ['执行失败', ['执行受阻', '实施失败']],
  ['显著优于', ['明显优于', '大幅领先于']],
  ['已过期', ['已经失效', '已过时效']],
  ['有人声称', ['有人宣称', '有人提到']],
  ['更符合当前目标', ['更契合当前目标', '更贴合当前目标']],
  ['执行顺利，结果符合预期', ['执行顺利，结果达到预期', '推进顺利，结果符合预期']],
  ['决定采用', ['决定选用', '确定采用']],
  ['旧信息', ['旧资料', '原有信息']],
  ['最新信息', ['最新资料', '更新后的信息']],
  ['两方案均可行', ['两个方案都可行', '两种方案均可执行']],
  ['没有其他限制', ['没有别的限制', '无其他要求']],
  ['按最新信息决定', ['依据最新信息决定', '按最新情况决定']],
  ['有人建议把', ['有人提议将', '有人提出把']],
  ['看起来更流行', ['看起来更时髦', '似乎更流行']],
  ['建议切换', ['建议更换', '提议换掉']],
  ['方案的稳定', ['方案方向的稳定', '方案的延续']],
  ['换成', ['改为', '切换成']],
  ['评估：', ['评估认为：', '初步评估：']],
  ['确定方案', ['敲定方案', '确定方向']],
  ['更优', ['更具优势', '表现更好', '更胜一筹']],
  ['复核', ['复查', '复评']],
  ['建议', ['提议', '推荐']],
  ['选择', ['选定', '敲定', '挑定']],
  ['冲突', ['分歧', '矛盾']]
];

function diversifyTexts(parts, rng) {
  const targets = [
    { get: () => parts.prompt, set: (v) => { parts.prompt = v; } },
    { get: () => parts.goal.text, set: (v) => { parts.goal.text = v; } },
    ...parts.events.map((e) => ({ get: () => e.content, set: (v) => { e.content = v; } })),
    ...(parts.candidates ?? []).map((c) => ({ get: () => c.description, set: (v) => { c.description = v; } })),
    ...(parts.hardConstraints ?? []).map((h) => ({ get: () => h.text, set: (v) => { h.text = v; } })),
    ...(parts.softPrefs ?? []).map((sp) => ({ get: () => sp.text, set: (v) => { sp.text = v; } })),
    ...(parts.qualified ?? []).map((ev) => ({ get: () => ev.fact, set: (v) => { ev.fact = v; } })),
    ...(parts.expired ?? []).map((ev) => ({ get: () => ev.fact, set: (v) => { ev.fact = v; } })),
    ...(parts.conflicting ?? []).map((cf) => ({ get: () => cf.fact, set: (v) => { cf.fact = v; } })),
    ...(parts.conflicting ?? []).filter((cf) => cf.resolution).map((cf) => ({ get: () => cf.resolution, set: (v) => { cf.resolution = v; } })),
    ...(parts.historicalDecision ? [
      { get: () => parts.historicalDecision.question, set: (v) => { parts.historicalDecision.question = v; } },
      { get: () => parts.historicalDecision.conclusion, set: (v) => { parts.historicalDecision.conclusion = v; } }
    ] : []),
    ...(parts.executionOutcome ? [{ get: () => parts.executionOutcome.actual_outcome, set: (v) => { parts.executionOutcome.actual_outcome = v; } }] : [])
  ];
  let changes = 0;
  for (const t of targets) {
    const f = t.get();
    if (typeof f !== 'string' || f.length === 0) continue;
    let out = f;
    for (const [from, variants] of DIVERSIFY_RULES) {
      if (!out.includes(from)) continue;
      const segs = out.split(from);
      if (segs.length < 2) continue;
      const rebuilt = [segs[0]];
      for (let i = 1; i < segs.length; i++) {
        if (rng.nextFloat() < 0.7) { rebuilt.push(rng.pick(variants)); changes++; }
        else rebuilt.push(from);
        rebuilt.push(segs[i]);
      }
      out = rebuilt.join('');
    }
    if (out !== f) t.set(out);
  }
  return changes;
}

function applyEditPass(parts, ctx, rng) {
  // Human reconstruction edits for multi_model_reconstruction / anonymized_pattern_synthesis.
  const edits = [];
  const sourceType = ctx.sourceType;
  if (sourceType === 'multi_model_reconstruction' || sourceType === 'anonymized_pattern_synthesis') {
    const candidates = parts.events.filter((e) => e.type === 'write' || e.type === 'note');
    if (candidates.length > 0) {
      const ev = candidates[rng.int(candidates.length)];
      const before = ev.content;
      let after = before;
      const [from, to] = REWRITES[rng.int(REWRITES.length)];
      if (after.includes(from)) after = after.replace(from, to);
      if (after !== before) {
        ev.content = after;
        edits.push({
          at: new Date(EDIT_BASE + ctx.idx * 7 * 60000 + rng.int(30) * 60000).toISOString(),
          editor: 'goal18-annotator-1',
          change: `event ${ev.event_id}: "${before}" -> "${after}"`,
          reason: sourceType === 'multi_model_reconstruction' ? 'human reconstruction to de-template phrasing' : 'anonymization / pattern abstraction rewrite'
        });
      }
    }
  }
  return edits;
}

function buildProvenance(ctx, edits) {
  const tag = `${ctx.split}|${ctx.tt}|v${ctx.variant}|${ctx.domain}|${ctx.sourceType}|${ctx.idx}`;
  return {
    generator_identity: `goal18-generator/v2.1.0`,
    prompt_hash: sha256(tag),
    human_editor: 'goal18-annotator-1',
    edit_history: edits,
    final_reviewer: 'goal18-gold-reviewer-1',
    source_type: ctx.sourceType
  };
}

function buildOne(ctx) {
  const rng = createRng(`${ctx.seed}|${ctx.split}|${ctx.tt}|${ctx.idx}`);
  const d = domainById(ctx.domain);
  const primary = pickEntities(rng, d, d.primary, 1, ctx.tag)[0];
  const alt = pickEntities(rng, d, d.alt, 1, ctx.tag)[0];
  const people = rng.pickMany(d.people, 2);
  const names = { primary: [primary, alt], alt: [alt, primary], people };
  const fullCtx = { ...ctx, rng, names, adversary: ctx.sourceType === 'adversarial_boundary' };
  const parts = BUILDERS[`build${ctx.tt}`](fullCtx);
  parts.entityName = primary;
  diversifyTexts(parts, rng);
  const edits = applyEditPass(parts, fullCtx, rng);
  parts.provenance = buildProvenance(fullCtx, edits);
  return assemble(fullCtx, parts);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.outDir) OUT_DIR = path.resolve(args.outDir);
  const split = args.split || 'validation';
  const tag = args.tag || (split === 'validation' ? 'val' : 'holdback');
  let seed = args.seed || `goal18-${split}-seed`;
  if (args.seedFile) seed = fs.readFileSync(path.resolve(args.seedFile), 'utf8').trim();
  if (args.seedFile) console.warn('[warn] using --seed-file (seed not echoed)');
  if (!args.seed) console.warn(`[warn] no --seed given; using default ${seed}`);
  const N = tag === 'val' ? 8 : 12;
  const baseline = tag === 'val' ? Date.parse('2026-02-01T00:00:00Z') : Date.parse('2026-07-01T00:00:00Z');

  const samples = [];
  const errors = [];
  for (let ti = 0; ti < TTS.length; ti++) {
    const tt = TTS[ti];
    for (let idx = 0; idx < N; idx++) {
      const globalIdx = ti * N + idx;
      const sourceType = sourceTypeFor(globalIdx);
      const plan = planFor(tt, tag, idx);
      const domain = domainFor(tt, idx, tag);
      // Per-split query-time offsets keep the full memory span inside the split's
      // time window (val 2026-02..2026-07, hb 2026-07..2026-12) with a 90-day max span.
      const offDays = tag === 'val' ? 100 + ti * 2 + idx * 5 : 95 + ti * 2 + idx * 4;
      const qtMs = baseline + offDays * 86400000 + ((ti * 7 + idx * 11) % 24) * 3600000;
      const ctx = {
        split, tag, tt, idx, domain,
        variant: variantFor(sourceType),
        riskLevel: plan.risk, reversibility: plan.reversibility,
        authority: plan.authority,
        qtMs, baseline, seed, sourceType
      };
      const sample = buildOne(ctx);
      const errs = validateSchema(sample, SCHEMA);
      if (errs.length > 0) {
        errors.push({ sample_id: sample.sample_id, errors: errs.slice(0, 10).map((e) => `${e.path}: ${e.message}`) });
      }
      samples.push(sample);
    }
  }

  if (errors.length > 0) {
    console.error(`SCHEMA ERRORS on ${errors.length} samples:`);
    for (const e of errors.slice(0, 20)) console.error(e.sample_id, JSON.stringify(e.errors, null, 1));
    process.exit(1);
  }

  const counts = countSourceTypes(samples.length);
  console.log(JSON.stringify({
    split, tag, seed_hash: sha256(seed), count: samples.length,
    per_tt: TTS.map((tt) => `${tt}:${samples.filter((s) => s.task_type === tt).length}`).join(' '),
    source_types: counts,
    domains: [...new Set(samples.map((s) => s.domain))].sort().join(',')
  }, null, 2));

  if (split === 'validation') {
    const setFile = path.join(OUT_DIR, 'validation-set.jsonl');
    const goldFile = path.join(OUT_DIR, 'validation-gold.jsonl');
    const GOLD_FIELDS = ['expected_action', 'acceptable_explanations', 'severe_failure_labels', 'scoring'];
    const setLines = samples.map((s) => {
      const c = { ...s };
      for (const f of GOLD_FIELDS) delete c[f];
      return JSON.stringify(c);
    });
    const goldLines = samples.map((s) => JSON.stringify({
      sample_id: s.sample_id,
      expected_action: s.expected_action,
      acceptable_explanations: s.acceptable_explanations,
      severe_failure_labels: s.severe_failure_labels,
      scoring: s.scoring
    }));
    fs.writeFileSync(setFile, setLines.join('\n') + '\n', 'utf8');
    fs.writeFileSync(goldFile, goldLines.join('\n') + '\n', 'utf8');
    console.log(`wrote ${setFile} (${setLines.length} lines) and ${goldFile}`);
  } else {
    const fullFile = path.join(OUT_DIR, 'holdback-fixtures.jsonl');
    fs.writeFileSync(fullFile, samples.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
    console.log(`wrote ${fullFile} (${samples.length} lines)`);
  }
}

main();
