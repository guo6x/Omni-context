/**
 * Offline retrieval testbed on LoCoMo Conversation 1 ONLY (audit tasks 4-6).
 *
 * Uses dialogue turns as the passage corpus (ideal-substrate isolation of the
 * embedding model from extraction quality). Queries are the 199 conv1 QA
 * questions; gold labels are the official reference evidence dia_ids.
 * Reads conversation 1 via the benchmark's split-guarded loader so held-out
 * conversations 2-10 are never parsed.
 *
 * Usage:
 *   node retrieval-testbed.mjs --model Xenova/multilingual-e5-small --variant noprefix
 *   node retrieval-testbed.mjs --model Xenova/multilingual-e5-small --variant e5prefix
 *   node retrieval-testbed.mjs --model <candidate> --variant e5prefix --remote
 * Variants: noprefix | e5prefix (query:/passage:) | bgestyle (no doc prefix, query instruction none)
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import { performance } from 'perf_hooks';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../..');
const require = createRequire(join(REPO, 'brain-server/package.json'));
const transformers = await import('file://' + require.resolve('@xenova/transformers'));
const { pipeline, env } = transformers;

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const MODEL = flag('model', 'Xenova/multilingual-e5-small');
const VARIANT = flag('variant', 'noprefix');
const POOLING = flag('pooling', 'mean'); // bge-m3 dense requires 'cls'
const REMOTE = args.includes('--remote');
const DATED = !args.includes('--undated');

if (REMOTE) {
  env.allowRemoteModels = true;
  env.cacheDir = join(HERE, 'model-cache');
} else if (args.includes('--cache')) {
  env.allowRemoteModels = false;
  env.localModelPath = join(HERE, 'model-cache');
} else {
  env.allowRemoteModels = false;
  env.localModelPath = join(REPO, 'brain-server/models');
}

const PREFIXES = {
  noprefix: { q: '', p: '' },
  e5prefix: { q: 'query: ', p: 'passage: ' },
  bgestyle: { q: '', p: '' }, // bge-m3 needs no instruction for queries or passages
};
const prefixes = PREFIXES[VARIANT];
if (!prefixes) throw new Error(`unknown variant ${VARIANT}`);

// ---- load conv1 only, via split-guarded loader ----
const { loadLoCoMoConversation } = await import('file://' + join(REPO, 'benchmark/src/dataset.mjs').replace(/\\/g, '/'));
const DATASET = join(REPO, '../locomo/data/locomo10.json');
const conv = await loadLoCoMoConversation(DATASET, 1);

const conversation = conv.conversation;
const passages = [];
for (const key of Object.keys(conversation)) {
  const m = key.match(/^session_(\d+)$/);
  if (!m) continue;
  const dateTime = conversation[`session_${m[1]}_date_time`] || '';
  for (const turn of conversation[key]) {
    const text = DATED
      ? `[${dateTime}] ${turn.speaker}: ${turn.text}`
      : `${turn.speaker}: ${turn.text}`;
    passages.push({ dia_id: turn.dia_id, text });
  }
}

const CATEGORY_NAMES = { 1: 'single_hop', 2: 'temporal', 3: 'multi_hop', 4: 'open_domain', 5: 'adversarial' };
const qa = conv.qa.map((item, i) => ({
  idx: i,
  question: item.question,
  category: CATEGORY_NAMES[item.category] || String(item.category),
  gold: (item.evidence || []).map(String),
  adversarial: item.category === 5,
}));

console.log(`model=${MODEL} variant=${VARIANT} pooling=${POOLING} dated=${DATED} passages=${passages.length} questions=${qa.length}`);

// ---- embed ----
const t0 = performance.now();
const pipe = await pipeline('feature-extraction', MODEL, { quantized: true });
const loadMs = performance.now() - t0;
console.log(`model load: ${loadMs.toFixed(0)}ms`);

async function embed(text) {
  const out = await pipe(text, { pooling: POOLING, normalize: true });
  return Float32Array.from(out.data);
}

const passageLatencies = [];
const pVecs = [];
for (const p of passages) {
  const s = performance.now();
  pVecs.push(await embed(prefixes.p + p.text));
  passageLatencies.push(performance.now() - s);
}

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

const K_LIST = [1, 3, 5, 10, 20];
const answerable = qa.filter((q) => !q.adversarial && q.gold.length > 0);
const stats = {};
const ensure = (cat) => (stats[cat] = stats[cat] || {
  n: 0, mrr10: 0, ndcg10: 0, hit: 0,
  recallAny: Object.fromEntries(K_LIST.map((k) => [k, 0])),
  recallFull: Object.fromEntries(K_LIST.map((k) => [k, 0])),
});

const queryLatencies = [];
const perQuestion = [];
for (const q of answerable) {
  const s = performance.now();
  const qv = await embed(prefixes.q + q.question);
  queryLatencies.push(performance.now() - s);
  const scored = passages.map((p, i) => ({ dia_id: p.dia_id, score: dot(qv, pVecs[i]) }))
    .sort((a, b) => b.score - a.score);
  const goldSet = new Set(q.gold);
  const ranks = [];
  scored.forEach((item, rank) => { if (goldSet.has(item.dia_id)) ranks.push(rank + 1); });
  const firstRank = ranks.length ? ranks[0] : Infinity;

  const buckets = ['ALL', q.category];
  for (const cat of buckets) {
    const st = ensure(cat);
    st.n++;
    for (const k of K_LIST) {
      const inTop = scored.slice(0, k).filter((x) => goldSet.has(x.dia_id)).length;
      if (inTop > 0) st.recallAny[k]++;
      if (inTop >= goldSet.size) st.recallFull[k]++;
    }
    if (firstRank <= 10) {
      st.mrr10 += 1 / firstRank;
      st.hit++;
      // NDCG@10 binary relevance
      let dcg = 0, idcg = 0;
      scored.slice(0, 10).forEach((x, i) => { if (goldSet.has(x.dia_id)) dcg += 1 / Math.log2(i + 2); });
      for (let i = 0; i < Math.min(goldSet.size, 10); i++) idcg += 1 / Math.log2(i + 2);
      st.ndcg10 += idcg ? dcg / idcg : 0;
    }
  }
  perQuestion.push({ idx: q.idx, category: q.category, gold: q.gold, firstRank: ranks.length ? ranks[0] : null, top5: scored.slice(0, 5).map((x) => x.dia_id) });
}

for (const cat of Object.keys(stats)) {
  const st = stats[cat];
  for (const k of K_LIST) {
    st.recallAny[k] = +(st.recallAny[k] / st.n).toFixed(4);
    st.recallFull[k] = +(st.recallFull[k] / st.n).toFixed(4);
  }
  st.mrr10 = +(st.mrr10 / st.n).toFixed(4);
  st.ndcg10 = +(st.ndcg10 / st.n).toFixed(4);
  st.hitRate10 = +(st.hit / st.n).toFixed(4);
  delete st.hit;
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return +(s[Math.min(s.length - 1, Math.floor(p * s.length))]).toFixed(1);
};

const report = {
  model: MODEL, variant: VARIANT, pooling: POOLING, dated: DATED,
  passages: passages.length, answerableQuestions: answerable.length,
  dimensions: pVecs[0].length,
  modelLoadMs: +loadMs.toFixed(0),
  latency: {
    passageP50: pct(passageLatencies, 0.5), passageP95: pct(passageLatencies, 0.95),
    queryP50: pct(queryLatencies, 0.5), queryP95: pct(queryLatencies, 0.95),
  },
  peakRssMb: +(process.memoryUsage().rss / 1048576).toFixed(0),
  stats,
};

const safe = MODEL.replace(/[\/]/g, '_');
const outPath = join(HERE, `retrieval-${safe}-${VARIANT}${DATED ? '' : '-undated'}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));
writeFileSync(outPath.replace('.json', '-perq.json'), JSON.stringify(perQuestion, null, 1));
console.log(JSON.stringify({ ALL: stats.ALL }, null, 2));
console.log('written:', outPath);
