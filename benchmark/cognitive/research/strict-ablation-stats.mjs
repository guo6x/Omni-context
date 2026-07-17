#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { aggregateResults } from '../src/scoring.mjs';
import { readJsonl, writeJson } from '../src/runner.mjs';
import { pairedSummary } from './paired-statistics.mjs';
import { CONDITION_TO_ENV, STRICT_ABLATION_CONDITIONS } from './strict-ablation-plan.mjs';

function flag(name, fallback = undefined) {
  const assigned = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  if (assigned) return assigned.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function percentile(values, fraction) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(fraction * ordered.length))];
}

function normalized(value) {
  return String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function valuesForScenario(scenario) {
  const gold = scenario.gold || {};
  return [...new Set([
    ...(gold.required_facts || []),
    ...(gold.current_facts || []),
    ...(gold.historical_facts || []),
    ...(gold.invalidated_facts || []),
    ...(gold.required_constraints || []),
    ...(gold.required_sources || []),
    ...(gold.suppress || []),
    ...(gold.transitions || []).flatMap((transition) => [transition.from_value, transition.to_value]),
  ].map(String).filter(Boolean))];
}

function itemText(item) {
  return normalized([
    item?.passage,
    item?.fact,
    item?.text,
    item?.description,
    item?.reranker_summary,
    item?.source_agents,
    item?.state_keys,
  ].flat().filter(Boolean).join(' '));
}

function coverage(values, items) {
  const text = items.map(itemText).join(' ');
  const hits = values.filter((value) => text.includes(normalized(value)));
  return { hits: hits.length, total: values.length, values: hits };
}

function canonicalEvidence(item) {
  const eventIds = Array.isArray(item?.source_event_ids) ? [...item.source_event_ids].map(String).sort() : [];
  if (eventIds.length) return `events:${eventIds.join('|')}`;
  return `text:${itemText(item)}`;
}

function duplicateRate(items) {
  if (!items.length) return 0;
  return (items.length - new Set(items.map(canonicalEvidence)).size) / items.length;
}

function noiseRate(items) {
  if (!items.length) return 0;
  const noisy = items.filter((item) => {
    const sources = Array.isArray(item?.sources) ? item.sources.map((source) => source?.source || source) : [];
    const keys = Array.isArray(item?.state_keys) ? item.state_keys.map(String) : [];
    return sources.includes('graph') || keys.some((key) => /^support_note_/i.test(key)) || /support note/i.test(itemText(item));
  }).length;
  return noisy / items.length;
}

function sumUsage(records) {
  const result = { input_tokens: 0, output_tokens: 0, cache_hit_input_tokens: 0, cache_miss_input_tokens: 0, total_tokens: 0 };
  for (const record of records) {
    for (const part of [record.usage?.answer, record.usage?.judge]) {
      if (!part) continue;
      for (const key of Object.keys(result)) result[key] += Number(part[key] || 0);
    }
  }
  return result;
}

async function conditionReport(outputRoot, condition, scenariosById) {
  const rows = await readJsonl(path.join(outputRoot, 'conditions', condition, 'results.jsonl'));
  const latest = new Map();
  for (const row of rows) if (row.status !== 'retry') latest.set(row.scenario_id, row);
  const records = [...latest.values()];
  const completed = records.filter((record) => record.status === 'completed');
  const coverageRows = completed.map((record) => {
    const scenario = scenariosById.get(record.scenario_id);
    const expected = valuesForScenario(scenario);
    const evidence = record.diagnostics?.strict_ablation || {};
    return {
      scenario_id: record.scenario_id,
      candidate_pool: coverage(expected, evidence.candidate_pool || []),
      final_20: coverage(expected, evidence.final_20 || []),
      answer_top_10: coverage(expected, evidence.answer_top_10 || []),
      candidate_duplicate_rate: duplicateRate(evidence.candidate_pool || []),
      final_20_duplicate_rate: duplicateRate(evidence.final_20 || []),
      answer_top_10_duplicate_rate: duplicateRate(evidence.answer_top_10 || []),
      candidate_noise_rate: noiseRate(evidence.candidate_pool || []),
      final_20_noise_rate: noiseRate(evidence.final_20 || []),
      answer_top_10_noise_rate: noiseRate(evidence.answer_top_10 || []),
    };
  });
  const aggregateCoverage = (key) => {
    const hits = coverageRows.reduce((sum, row) => sum + row[key].hits, 0);
    const total = coverageRows.reduce((sum, row) => sum + row[key].total, 0);
    return { hits, total, recall: total ? hits / total : null };
  };
  const latencies = completed.map((record) => Number(record.latency_ms?.total || 0));
  const retrievalLatencies = completed.map((record) => Number(record.latency_ms?.retrieval || 0));
  return {
    condition,
    ablation: CONDITION_TO_ENV[condition],
    completed: completed.length,
    errors: records.filter((record) => record.status === 'error').length,
    retries: rows.filter((record) => record.status === 'retry').length,
    metrics: aggregateResults(records),
    evidence: {
      candidate_pool: aggregateCoverage('candidate_pool'),
      final_20: aggregateCoverage('final_20'),
      answer_top_10: aggregateCoverage('answer_top_10'),
      duplicate_rate: {
        candidate_pool: average(coverageRows.map((row) => row.candidate_duplicate_rate)),
        final_20: average(coverageRows.map((row) => row.final_20_duplicate_rate)),
        answer_top_10: average(coverageRows.map((row) => row.answer_top_10_duplicate_rate)),
      },
      graph_or_support_noise_rate: {
        candidate_pool: average(coverageRows.map((row) => row.candidate_noise_rate)),
        final_20: average(coverageRows.map((row) => row.final_20_noise_rate)),
        answer_top_10: average(coverageRows.map((row) => row.answer_top_10_noise_rate)),
      },
      per_scenario: coverageRows,
    },
    latency_ms: {
      answer_mean: average(completed.map((record) => Number(record.latency_ms?.answer || 0))),
      retrieval_mean: average(retrievalLatencies),
      retrieval_p50: percentile(retrievalLatencies, 0.5),
      retrieval_p95: percentile(retrievalLatencies, 0.95),
      total_p50: percentile(latencies, 0.5),
      total_p95: percentile(latencies, 0.95),
    },
    provider_calls: {
      answer_logical: completed.reduce((sum, record) => sum + Number(record.usage?.answer_calls || 0), 0),
      answer_schema_attempts: completed.reduce((sum, record) => sum + Number(record.answer_schema_validation_attempts || 1), 0),
      judge_logical: completed.reduce((sum, record) => sum + Number(record.usage?.judge_calls || 0), 0),
      judge_physical: completed.reduce((sum, record) => sum + Number(record.usage?.judge_physical_attempts || 0), 0),
      extraction: completed.reduce((sum, record) => sum + Number(record.usage?.extraction_calls || 0), 0),
      reranker: completed.reduce((sum, record) => sum + Number(record.usage?.reranker_calls || 0), 0),
    },
    token_usage: sumUsage(completed),
  };
}

async function main() {
  const outputRoot = path.resolve(flag('--output-root'));
  const datasetPath = path.resolve(flag('--dataset'));
  const outputPath = path.resolve(flag('--output', path.join(outputRoot, 'strict-ablation-statistics.json')));
  const datasetText = await readFile(datasetPath, 'utf8');
  const scenarios = await readJsonl(datasetPath);
  const scenariosById = new Map(scenarios.map((scenario) => [scenario.scenario_id, scenario]));
  const conditions = {};
  for (const condition of STRICT_ABLATION_CONDITIONS) conditions[condition] = await conditionReport(outputRoot, condition, scenariosById);
  const fullRows = await readJsonl(path.join(outputRoot, 'conditions', 'full_omni_fresh_control', 'results.jsonl'));
  const fullLatest = new Map();
  for (const row of fullRows) if (row.status === 'completed') fullLatest.set(row.scenario_id, row.score.core_score);
  const paired = {};
  for (const condition of STRICT_ABLATION_CONDITIONS.filter((value) => value !== 'full_omni_fresh_control')) {
    const rows = await readJsonl(path.join(outputRoot, 'conditions', condition, 'results.jsonl'));
    const latest = new Map();
    for (const row of rows) if (row.status === 'completed') latest.set(row.scenario_id, row.score.core_score);
    paired[`full_minus_${condition}`] = pairedSummary(fullLatest, latest, { iterations: 10_000, seed: 2026071702 });
  }
  const report = {
    schema_version: 1,
    status: Object.values(conditions).every((condition) => condition.completed === 35 && condition.errors === 0) ? 'completed' : 'partial',
    interpretation_scope: 'internal Development-35 strict component ablation only',
    prohibited_interpretation: 'not external generalization evidence',
    dataset_sha256: createHash('sha256').update(datasetText).digest('hex'),
    bootstrap_iterations: 10_000,
    bootstrap_seed: 2026071702,
    conditions,
    paired,
  };
  await writeJson(outputPath, report);
  process.stdout.write(`${JSON.stringify({ status: report.status, output: outputPath, overall: Object.fromEntries(Object.entries(conditions).map(([key, value]) => [key, value.metrics.overall_cognitive_score])) })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ event: 'strict_ablation_stats_failed', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
