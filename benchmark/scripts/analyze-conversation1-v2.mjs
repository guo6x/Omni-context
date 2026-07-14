import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLoCoMoConversation } from '../src/dataset.mjs';

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchScore(spanText, turnText) {
  const span = normalize(spanText);
  const turn = normalize(turnText);
  if (!span || !turn) return 0;
  if (span.length >= 8 && (span.includes(turn) || turn.includes(span))) return 1;
  const a = new Set(span.split(' ').filter((word) => word.length > 2));
  const b = new Set(turn.split(' ').filter((word) => word.length > 2));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / (a.size + b.size - overlap);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 0;
}

function coveredGold(evidence, gold, turnById) {
  const spans = evidence
    .filter((item) => item?.source_span)
    .map((item) => String(item.source_span));
  return gold.filter((id) => {
    const turn = turnById.get(id);
    return Boolean(turn && spans.some((span) => matchScore(span, turn) >= 0.5));
  });
}

function summarize(rows) {
  const present = rows.filter((row) => row.final_context_present);
  return {
    n: rows.length,
    recall_at_10: rows.length ? rows.filter((row) => row.top10_present).length / rows.length : 0,
    final_context_recall: rows.length ? present.length / rows.length : 0,
    gold_evidence_present_count: present.length,
    gold_evidence_present_accuracy: present.length
      ? present.reduce((sum, row) => sum + row.correct, 0) / present.length
      : 0,
  };
}

export async function analyzeConversation1(runDir, datasetPath) {
  const resultsPath = path.join(runDir, 'conversation-1', 'results.jsonl');
  const lines = (await readFile(resultsPath, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const latest = new Map();
  for (const row of lines) latest.set(row.question_id, row);
  const completed = [...latest.values()].filter((row) => row.status === 'completed');
  if (completed.length !== 199) throw new Error(`Expected 199 latest completed records, got ${completed.length}`);

  const conversation = await loadLoCoMoConversation(datasetPath, 1);
  const qaById = new Map(conversation.qa.map((qa, index) => [`conv1-q${index}`, qa]));
  const turnById = new Map();
  for (const [key, value] of Object.entries(conversation.conversation || {})) {
    if (!/^session_\d+$/.test(key) || !Array.isArray(value)) continue;
    for (const turn of value) turnById.set(String(turn.dia_id), String(turn.text || ''));
  }

  const rows = [];
  for (const record of completed) {
    const qa = qaById.get(record.question_id);
    const gold = (qa?.evidence || []).map(String);
    if (record.subset !== 'answerable' || gold.length === 0) continue;
    const evidence = Array.isArray(record.evidence) ? record.evidence : [];
    const top10 = coveredGold(evidence.slice(0, 10), gold, turnById);
    const final = coveredGold(evidence, gold, turnById);
    rows.push({
      question_id: record.question_id,
      category: record.category_name,
      gold,
      top10_covered: top10,
      final_context_covered: final,
      top10_present: top10.length > 0,
      final_context_present: final.length > 0,
      correct: Number(record.metrics?.binary_accuracy || 0),
    });
  }
  const categories = Object.fromEntries(
    [...new Set(rows.map((row) => row.category))].map((category) => [category, summarize(rows.filter((row) => row.category === category))]),
  );
  const result = {
    schema_version: 1,
    run_id: path.basename(runDir),
    completed_questions: completed.length,
    answerable_with_gold: rows.length,
    all: summarize(rows),
    categories,
    latency_ms: {
      retrieval_p50: percentile(completed.map((row) => row.retrieval_latency_ms), 0.5),
      retrieval_p95: percentile(completed.map((row) => row.retrieval_latency_ms), 0.95),
      answer_p50: percentile(completed.map((row) => row.answer_latency_ms), 0.5),
      answer_p95: percentile(completed.map((row) => row.answer_latency_ms), 0.95),
      total_p50: percentile(completed.map((row) => row.total_latency_ms), 0.5),
      total_p95: percentile(completed.map((row) => row.total_latency_ms), 0.95),
    },
    rows,
  };
  await writeFile(path.join(runDir, 'conversation1-analysis.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [runDir, datasetPath] = process.argv.slice(2);
  if (!runDir || !datasetPath) throw new Error('Usage: node scripts/analyze-conversation1-v2.mjs <run-dir> <dataset>');
  const result = await analyzeConversation1(path.resolve(runDir), path.resolve(datasetPath));
  process.stdout.write(`${JSON.stringify({ ...result, rows: undefined }, null, 2)}\n`);
}
