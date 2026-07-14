/**
 * E5 correctness smoke test (audit task 2).
 * Compares three usage variants of the locally installed Xenova/multilingual-e5-small:
 *   A. current    — no prefix, mean pooling, L2 normalize (exact brain-server implementation)
 *   B. prefixed   — "query: " / "passage: " prefixes, mean pooling, L2 normalize (official E5 usage)
 *   C. cls-nonorm — CLS pooling, no normalize (deliberately wrong control)
 * Metrics per variant: mean positive similarity, mean hardest-negative similarity,
 * margin, and Top-1 retrieval accuracy over the full passage set.
 *
 * Run from repo root:  node docs/embedding-audit-v1/evidence/e5-smoke-test.mjs
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../../brain-server/package.json'));
const transformers = await import('file://' + require.resolve('@xenova/transformers'));
const { pipeline, env } = transformers;
env.allowRemoteModels = false;
env.localModelPath = join(dirname(fileURLToPath(import.meta.url)), '../../../brain-server/models');

const MODEL = 'Xenova/multilingual-e5-small';

// 24 query/passage pairs: EN, ZH, cross-lingual, temporal, same-person-different-event
const PAIRS = [
  // English factual
  { q: 'When did Caroline go to the LGBTQ support group?', p: 'Caroline attended an LGBTQ support group meeting on 7 May 2023.', tag: 'en' },
  { q: 'What kind of career is Caroline interested in?', p: "Caroline said she is keen on counseling or working in mental health.", tag: 'en' },
  { q: 'Where did Melanie go camping?', p: 'Melanie went camping with her family near a lake in the mountains last weekend.', tag: 'en' },
  { q: 'What instrument does Melanie play?', p: 'Melanie plays the violin and practices every evening after work.', tag: 'en' },
  { q: 'What did Caroline study in school?', p: 'Caroline studied psychology at university before switching to social work.', tag: 'en' },
  { q: 'Who adopted a rescue dog?', p: 'Last month Melanie adopted a rescue dog from the local shelter and named it Biscuit.', tag: 'en' },
  { q: 'What surgery did Melanie have?', p: 'Melanie underwent knee surgery in March and is still doing physical therapy.', tag: 'en' },
  { q: 'What fundraiser did Caroline organize?', p: 'Caroline organized a charity bake sale to raise money for transgender youth.', tag: 'en' },
  // Chinese
  { q: 'Caroline 什么时候参加了 LGBTQ 互助小组？', p: 'Caroline 在 2023 年 5 月 7 日参加了 LGBTQ 互助小组的聚会。', tag: 'zh' },
  { q: '谁领养了一只流浪狗？', p: '上个月 Melanie 从本地收容所领养了一只流浪狗，取名 Biscuit。', tag: 'zh' },
  { q: 'Melanie 会演奏什么乐器？', p: 'Melanie 会拉小提琴，每天下班后都会练习。', tag: 'zh' },
  { q: '公司的年度预算会议是什么时候？', p: '公司的年度预算会议定在十二月的第一个星期五举行。', tag: 'zh' },
  { q: '项目的数据库迁移方案是什么？', p: '项目决定采用双写方案逐步把数据从 MySQL 迁移到 PostgreSQL。', tag: 'zh' },
  { q: '他为什么辞职？', p: '他因为长期加班和缺乏晋升机会而决定辞去现在的工作。', tag: 'zh' },
  // Cross-lingual (zh query, en passage)
  { q: 'Caroline 对什么职业感兴趣？', p: 'Caroline said she is keen on counseling or working in mental health.', tag: 'xling' },
  { q: 'Melanie 的膝盖手术是什么时候做的？', p: 'Melanie underwent knee surgery in March and is still doing physical therapy.', tag: 'xling' },
  { q: 'Who organized the charity bake sale?', p: 'Caroline 组织了一场慈善义卖，为跨性别青少年筹款。', tag: 'xling' },
  { q: 'What pet did Melanie adopt?', p: '上个月 Melanie 从收容所领养了一只流浪狗，取名 Biscuit。', tag: 'xling' },
  // Temporal discrimination (same subject, different times)
  { q: 'Where did Caroline work in 2021?', p: 'In 2021 Caroline worked as a barista at a coffee shop downtown.', tag: 'temporal', hard: 'Since January 2023 Caroline has been working as a counselor at a community center.' },
  { q: 'Where does Caroline work now, in 2023?', p: 'Since January 2023 Caroline has been working as a counselor at a community center.', tag: 'temporal', hard: 'In 2021 Caroline worked as a barista at a coffee shop downtown.' },
  { q: 'What did Melanie do on 8 May 2023?', p: 'On 8 May 2023 Melanie hosted a pottery class for beginners.', tag: 'temporal', hard: 'On 25 June 2023 Melanie ran a half marathon for charity.' },
  { q: 'What did Melanie do on 25 June 2023?', p: 'On 25 June 2023 Melanie ran a half marathon for charity.', tag: 'temporal', hard: 'On 8 May 2023 Melanie hosted a pottery class for beginners.' },
  // Same-person different-event discrimination
  { q: "What class did Caroline teach?", p: 'Caroline taught a weekend painting class for kids at the community center.', tag: 'person-event', hard: 'Caroline attended a seminar about transgender rights on 8 May 2023.' },
  { q: 'What seminar did Caroline attend?', p: 'Caroline attended a seminar about transgender rights on 8 May 2023.', tag: 'person-event', hard: 'Caroline taught a weekend painting class for kids at the community center.' },
];

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function cosine(a, b) {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return s / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

const pipe = await pipeline('feature-extraction', MODEL, { quantized: true });

async function embed(text, { prefix = null, pooling = 'mean', normalize = true } = {}) {
  const input = prefix ? `${prefix}${text}` : text;
  const out = await pipe(input, { pooling, normalize });
  return Array.from(out.data);
}

const variants = {
  'A-current-noprefix': { qOpt: {}, pOpt: {} },
  'B-e5-prefixed': { qOpt: { prefix: 'query: ' }, pOpt: { prefix: 'passage: ' } },
  'C-cls-nonorm': { qOpt: { pooling: 'cls', normalize: false }, pOpt: { pooling: 'cls', normalize: false } },
};

const allPassages = PAIRS.map((x) => x.p);
const report = { model: MODEL, pairs: PAIRS.length, variants: {} };

for (const [name, v] of Object.entries(variants)) {
  const pVecs = [];
  for (const p of allPassages) pVecs.push(await embed(p, v.pOpt));
  let posSum = 0, negSum = 0, hardSum = 0, hardCount = 0, top1 = 0;
  const perTag = {};
  for (let i = 0; i < PAIRS.length; i++) {
    const pair = PAIRS[i];
    const qv = await embed(pair.q, v.qOpt);
    const sims = pVecs.map((pv) => cosine(qv, pv));
    const pos = sims[i];
    const negs = sims.filter((_, j) => j !== i);
    const maxNeg = Math.max(...negs);
    posSum += pos;
    negSum += negs.reduce((a, b) => a + b, 0) / negs.length;
    if (pair.hard) {
      const hv = await embed(pair.hard, v.pOpt);
      hardSum += cosine(qv, hv);
      hardCount++;
    }
    const isTop1 = pos >= maxNeg;
    if (isTop1) top1++;
    const t = pair.tag;
    perTag[t] = perTag[t] || { n: 0, top1: 0, pos: 0 };
    perTag[t].n++; perTag[t].top1 += isTop1 ? 1 : 0; perTag[t].pos += pos;
  }
  for (const t of Object.keys(perTag)) {
    perTag[t].top1Rate = +(perTag[t].top1 / perTag[t].n).toFixed(3);
    perTag[t].meanPos = +(perTag[t].pos / perTag[t].n).toFixed(4);
    delete perTag[t].pos;
  }
  report.variants[name] = {
    meanPositive: +(posSum / PAIRS.length).toFixed(4),
    meanNegative: +(negSum / PAIRS.length).toFixed(4),
    margin: +((posSum - negSum) / PAIRS.length).toFixed(4),
    meanHardNegative: hardCount ? +(hardSum / hardCount).toFixed(4) : null,
    top1Accuracy: +(top1 / PAIRS.length).toFixed(4),
    perTag,
  };
  console.log(name, JSON.stringify(report.variants[name], null, 2));
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), 'e5-smoke-results.json');
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log('written:', outPath);
