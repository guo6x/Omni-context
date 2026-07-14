/**
 * Error attribution on the formal Conversation 1 run (audit task 3).
 *
 * Inputs (read-only):
 *   - docs/delivery-v3.1/evidence/benchmark-conv1/results.jsonl (formal per-question records)
 *   - LoCoMo conversation 1 (via split-guarded loader)
 *
 * The formal brain.db was not preserved on disk (only its sha256), so the union
 * of assertion evidence across all 199 questions is used as a proxy for the
 * assertion store (each question surfaced up to 30 assertions; the union is a
 * lower bound on extraction coverage). Classification:
 *   A  gold turn matches NO assertion in the union            -> extraction gap (lower bound)
 *   CDE gold turn matches an assertion, absent from this
 *       question's final context                              -> retrieval/ranking loss
 *   F  gold turn present in final context, binary_accuracy=0  -> answer failure
 *   G  candidate matches reference (loose), judged wrong      -> judge suspect (flag for manual review)
 * Matching: normalized substring either direction, else token-Jaccard >= 0.5 (confidence: high/medium).
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../..');
const { loadLoCoMoConversation } = await import('file://' + join(REPO, 'benchmark/src/dataset.mjs').replace(/\\/g, '/'));

const conv = await loadLoCoMoConversation(join(REPO, '../locomo/data/locomo10.json'), 1);
const turnById = new Map();
for (const key of Object.keys(conv.conversation)) {
  const m = key.match(/^session_(\d+)$/);
  if (!m) continue;
  for (const t of conv.conversation[key]) turnById.set(String(t.dia_id), t.text);
}

const rows = readFileSync(join(REPO, 'docs/delivery-v3.1/evidence/benchmark-conv1/results.jsonl'), 'utf8')
  .trim().split('\n').map(JSON.parse).filter((r) => r.status === 'completed');
// dedupe by question_id keeping last record
const byQ = new Map();
for (const r of rows) byQ.set(r.question_id, r);
const records = [...byQ.values()];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9一-鿿 ]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
function matchScore(spanText, turnText) {
  const a = norm(spanText), b = norm(turnText);
  if (!a || !b) return { match: false };
  if (a.includes(b) || b.includes(a)) return { match: true, confidence: 'high' };
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return { match: false };
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  const containment = inter / Math.min(ta.size, tb.size);
  if (jaccard >= 0.5 || containment >= 0.7) return { match: true, confidence: 'medium', jaccard: +jaccard.toFixed(2) };
  return { match: false };
}

// Union of all assertion spans across the run = proxy assertion store
const allSpans = new Map(); // id -> span
for (const r of records) {
  for (const ev of r.evidence || []) {
    if (ev.type === 'assertion' && ev.source_span) allSpans.set(ev.id, ev.source_span);
  }
}
const spanList = [...allSpans.values()];
console.log(`records=${records.length} uniqueAssertionsSeen=${allSpans.size}`);

function turnCovered(turnText, spans) {
  let best = { match: false, confidence: null };
  for (const span of spans) {
    const m = matchScore(span, turnText);
    if (m.match) {
      if (m.confidence === 'high') return m;
      best = m;
    }
  }
  return best;
}

const attribution = [];
for (const r of records) {
  const evd = conv.qa.find((q) => q.question === r.question)?.evidence || [];
  const gold = evd.map(String).filter((id) => turnById.has(id));
  const isAdv = r.subset === 'adversarial';
  const wrong = r.metrics?.binary_accuracy === 0;
  const finalSpans = (r.evidence || []).filter((e) => e.type === 'assertion' && e.source_span).map((e) => e.source_span);

  let cls = null, detail = {};
  if (isAdv || gold.length === 0) {
    cls = 'H';
    detail.note = isAdv ? 'adversarial (no gold evidence)' : 'no mappable gold evidence';
  } else {
    const perTurn = gold.map((id) => {
      const text = turnById.get(id);
      const inFinal = turnCovered(text, finalSpans);
      const inStore = inFinal.match ? inFinal : turnCovered(text, spanList);
      return { dia_id: id, inFinal: inFinal.match, finalConf: inFinal.confidence || null, inStore: inStore.match, storeConf: inStore.confidence || null };
    });
    const anyFinal = perTurn.some((t) => t.inFinal);
    const allFinal = perTurn.every((t) => t.inFinal);
    const anyStore = perTurn.some((t) => t.inStore);
    detail.perTurn = perTurn;
    if (!wrong) {
      cls = 'OK';
    } else if (!anyStore) {
      cls = 'A'; // no evidence extracted at all (proxy lower bound)
    } else if (!anyFinal) {
      cls = 'CDE'; // extracted somewhere but not in this question's final context
    } else if (anyFinal && !allFinal && gold.length > 1) {
      cls = 'CDE-partial'; // partial context (mainly multi-evidence questions)
    } else {
      // evidence in final context but still wrong
      const refIn = matchScore(r.reference_answer, r.candidate_answer);
      cls = refIn.match ? 'G?' : 'F';
    }
  }
  attribution.push({
    question_id: r.question_id, category: r.category_name, subset: r.subset,
    wrong, class: cls,
    question: r.question, reference: r.reference_answer, candidate: r.candidate_answer,
    ...detail,
  });
}

// summary
const wrongAnswerable = attribution.filter((a) => a.wrong && a.subset === 'answerable' && a.class !== 'H');
const counts = {};
for (const a of wrongAnswerable) counts[a.class] = (counts[a.class] || 0) + 1;
const byCat = {};
for (const a of wrongAnswerable) {
  byCat[a.category] = byCat[a.category] || {};
  byCat[a.category][a.class] = (byCat[a.category][a.class] || 0) + 1;
}

// final-context recall over ALL answerable (right or wrong)
const answerable = attribution.filter((a) => a.subset === 'answerable' && a.class !== 'H' && a.perTurn);
const fcAny = answerable.filter((a) => a.perTurn.some((t) => t.inFinal)).length;
const fcFull = answerable.filter((a) => a.perTurn.every((t) => t.inFinal)).length;
const storeAny = answerable.filter((a) => a.perTurn.some((t) => t.inStore)).length;
const byCatRecall = {};
for (const a of answerable) {
  const c = (byCatRecall[a.category] = byCatRecall[a.category] || { n: 0, fcAny: 0, fcFull: 0, storeAny: 0 });
  c.n++;
  if (a.perTurn.some((t) => t.inFinal)) c.fcAny++;
  if (a.perTurn.every((t) => t.inFinal)) c.fcFull++;
  if (a.perTurn.some((t) => t.inStore)) c.storeAny++;
}

// conditional answer accuracy: gold fully in final context
const fullCtx = answerable.filter((a) => a.perTurn.every((t) => t.inFinal));
const fullCtxCorrect = fullCtx.filter((a) => !a.wrong).length;
const anyCtx = answerable.filter((a) => a.perTurn.some((t) => t.inFinal));
const anyCtxCorrect = anyCtx.filter((a) => !a.wrong).length;
const noCtx = answerable.filter((a) => !a.perTurn.some((t) => t.inFinal));
const noCtxCorrect = noCtx.filter((a) => !a.wrong).length;

const summary = {
  records: records.length,
  uniqueAssertionsSeen: allSpans.size,
  wrongAnswerableCount: wrongAnswerable.length,
  errorClassCounts: counts,
  errorClassByCategory: byCat,
  finalContextRecall: {
    n: answerable.length,
    any: +(fcAny / answerable.length).toFixed(4),
    full: +(fcFull / answerable.length).toFixed(4),
    extractionCoverageAnyProxy: +(storeAny / answerable.length).toFixed(4),
    byCategory: Object.fromEntries(Object.entries(byCatRecall).map(([k, v]) => [k, {
      n: v.n, any: +(v.fcAny / v.n).toFixed(3), full: +(v.fcFull / v.n).toFixed(3), storeAny: +(v.storeAny / v.n).toFixed(3),
    }])),
  },
  answerConditionalAccuracy: {
    goldFullyInContext: { n: fullCtx.length, correct: fullCtxCorrect, acc: +(fullCtxCorrect / (fullCtx.length || 1)).toFixed(4) },
    goldPartiallyInContext: { n: anyCtx.length, correct: anyCtxCorrect, acc: +(anyCtxCorrect / (anyCtx.length || 1)).toFixed(4) },
    goldNotInContext: { n: noCtx.length, correct: noCtxCorrect, acc: +(noCtxCorrect / (noCtx.length || 1)).toFixed(4) },
  },
};

writeFileSync(join(HERE, 'error-attribution-summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(HERE, 'error-attribution-detail.json'), JSON.stringify(attribution, null, 1));
console.log(JSON.stringify(summary, null, 2));
