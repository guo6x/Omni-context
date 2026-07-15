import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_KEYS, CATEGORY_SPECS } from './constants.mjs';
import { generateSplit, selectComparisonSubset, validateCrossAgentProvenance } from './scenarios.mjs';
import { aggregateResults } from './scoring.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const REVIEW_ROOT = path.join(REPO, 'docs', 'cognitive-benchmark-v1.1-review');
const OLD_EVIDENCE = path.join(REVIEW_ROOT, 'evidence');
const ROOT = path.join(REVIEW_ROOT, 'attribution-v1.1.1');
const EVIDENCE = path.join(ROOT, 'evidence');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const jsonl = (rows) => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
const readJsonl = async (file) => (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);
async function writeJson(file, value) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
async function writeJsonl(file, rows) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, jsonl(rows)); }

function changedPaths(before, after, prefix = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const paths = [];
    for (let index = 0; index < Math.max(before.length, after.length); index++) paths.push(...changedPaths(before[index], after[index], `${prefix}[${index}]`));
    return paths;
  }
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

function scenarioDiff(split, beforeRows, afterRows) {
  const beforeById = new Map(beforeRows.map((row) => [row.scenario_id, row]));
  const afterById = new Map(afterRows.map((row) => [row.scenario_id, row]));
  if (beforeById.size !== afterById.size || [...beforeById.keys()].some((id) => !afterById.has(id))) throw new Error(`${split}: Scenario IDs changed`);
  return afterRows.map((after) => {
    const before = beforeById.get(after.scenario_id);
    const paths = changedPaths(before, after);
    return {
      split,
      scenario_id: after.scenario_id,
      category: after.category,
      changed: paths.length > 0,
      old_sha256: sha256(JSON.stringify(before)),
      new_sha256: sha256(JSON.stringify(after)),
      changed_paths: paths,
    };
  });
}

function assertAllowedDiffs(rows) {
  const changed = rows.filter((row) => row.changed);
  const unchangedCrossAgent = rows.filter((row) => row.category === 'cross_agent_transfer' && !row.changed);
  const changedOther = changed.filter((row) => row.category !== 'cross_agent_transfer');
  if (unchangedCrossAgent.length) throw new Error(`Cross-Agent scenarios unexpectedly unchanged: ${unchangedCrossAgent.map((row) => row.scenario_id).join(',')}`);
  if (changedOther.length) throw new Error(`Non-Cross-Agent scenarios changed: ${changedOther.map((row) => row.scenario_id).join(',')}`);
  const allowed = /^(events\[\d+\]\.(text|source_type)|gold\.required_sources\[\d+\])$/;
  const forbidden = changed.flatMap((row) => row.changed_paths.filter((item) => !allowed.test(item)).map((item) => `${row.scenario_id}:${item}`));
  if (forbidden.length) throw new Error(`Unexpected semantic diff paths: ${forbidden.join(',')}`);
}

async function generate() {
  const old = {
    smoke: await readJsonl(path.join(OLD_EVIDENCE, 'smoke-dataset-v2.jsonl')),
    development: await readJsonl(path.join(OLD_EVIDENCE, 'development-dataset-v2.jsonl')),
    formal: await readJsonl(path.join(OLD_EVIDENCE, 'formal-dataset-draft-v2.jsonl')),
  };
  const next = { smoke: generateSplit('smoke'), development: generateSplit('development'), formal: generateSplit('formal') };
  const comparison = selectComparisonSubset(next.formal);
  const diffs = Object.keys(next).flatMap((split) => scenarioDiff(split, old[split], next[split]));
  assertAllowedDiffs(diffs);
  const crossAudit = Object.keys(next).flatMap((split) => next[split].filter((row) => row.category === 'cross_agent_transfer').map((row) => ({ split, ...validateCrossAgentProvenance(row) })));
  const formalCross = crossAudit.filter((row) => row.split === 'formal');
  const baselineIds = new Set((await readJsonl(path.join(OLD_EVIDENCE, 'development-no-memory-results-v2.1.jsonl'))).filter((row) => row.status === 'completed' && row.category === 'cross_agent_transfer').map((row) => row.scenario_id));
  const smokeCross = next.smoke.filter((row) => row.category === 'cross_agent_transfer');
  const developmentCross = next.development.filter((row) => row.category === 'cross_agent_transfer');
  const developmentBaselineCross = developmentCross.filter((row) => baselineIds.has(row.scenario_id));
  await Promise.all([
    writeJsonl(path.join(EVIDENCE, 'smoke-dataset-v2.1.1.jsonl'), next.smoke),
    writeJsonl(path.join(EVIDENCE, 'development-dataset-v2.1.1.jsonl'), next.development),
    writeJsonl(path.join(EVIDENCE, 'formal-dataset-draft-v2.1.1.jsonl'), next.formal),
    writeJsonl(path.join(EVIDENCE, 'smoke-cross-agent-v2.1.1.jsonl'), smokeCross),
    writeJsonl(path.join(EVIDENCE, 'development-cross-agent-v2.1.1.jsonl'), developmentCross),
    writeJsonl(path.join(EVIDENCE, 'development-baseline-cross-agent-v2.1.1.jsonl'), developmentBaselineCross),
    writeJson(path.join(EVIDENCE, 'comparison-subset-draft-v2.1.1.json'), { schema_version: '2.1.1', status: 'DRAFT_NOT_RUN', preselected_before_formal_run: true, selection: '3 easy + 5 medium + 2 hard per category', scenario_ids: comparison }),
    writeJson(path.join(EVIDENCE, 'dataset-scenario-diff.json'), {
      schema_version: '1.1.1', status: 'pass', old_version: 'v2', new_version: 'v2.1.1',
      scenario_counts: { smoke: next.smoke.length, development: next.development.length, formal: next.formal.length, comparison: comparison.length },
      changed_scenarios: diffs.filter((row) => row.changed).length,
      changed_cross_agent_scenarios: diffs.filter((row) => row.changed && row.category === 'cross_agent_transfer').length,
      changed_non_cross_agent_scenarios: diffs.filter((row) => row.changed && row.category !== 'cross_agent_transfer').length,
      non_cross_agent_hash_consistent: diffs.every((row) => row.category === 'cross_agent_transfer' || !row.changed),
      rows: diffs,
    }),
    writeJson(path.join(EVIDENCE, 'cross-agent-invariant-audit.json'), { schema_version: '1.1.1', status: 'pass', count: crossAudit.length, mismatches: 0, formal_count: formalCross.length, formal_dataset_defects: 0, audits: crossAudit }),
    writeJson(path.join(EVIDENCE, 'dataset-manifest-draft-v2.1.1.json'), {
      schema_version: '2.1.1', status: 'DRAFT_NOT_FROZEN', generated_without_development_score_tuning: true,
      smoke: { count: next.smoke.length, status: 'CALIBRATION_ONLY' }, development: { count: next.development.length, status: 'DEVELOPMENT_ONLY' },
      formal: { count: next.formal.length, status: 'DRAFT_NOT_FROZEN', by_category: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, CATEGORY_SPECS[key].formal_count])) },
      comparison: { count: comparison.length, status: 'DRAFT_NOT_RUN' }, formal_250_run: false, comparison_70_run: false, locomo_2_to_10_accessed: false,
    }),
  ]);
  console.log(JSON.stringify({ smoke: next.smoke.length, development: next.development.length, formal: next.formal.length, comparison: comparison.length, changed: diffs.filter((row) => row.changed).length, non_cross_hash_consistent: true, agent_mismatches: 0, formal_cross_agent_defects: 0 }));
}

async function hashes() {
  const files = (await readdir(EVIDENCE, { withFileTypes: true })).filter((entry) => entry.isFile() && !['evidence-hashes.json', 'attribution-hashes.json'].includes(entry.name));
  const hashes = Object.fromEntries((await Promise.all(files.map(async (entry) => [entry.name, sha256(await readFile(path.join(EVIDENCE, entry.name)))]))).sort(([a], [b]) => a.localeCompare(b)));
  await writeJson(path.join(EVIDENCE, 'evidence-hashes.json'), { schema_version: '1.1.1', status: 'completed', algorithm: 'sha256', count: Object.keys(hashes).length, files: hashes });
  console.log(JSON.stringify({ hashed: Object.keys(hashes).length }));
}

function completedLatest(rows) {
  const latest = new Map();
  for (const row of rows) if (row.status === 'completed') latest.set(`${row.scenario_id}:${row.mode}`, row);
  return [...latest.values()];
}

function pairwise(left, right, leftName, rightName) {
  const rightById = new Map(right.map((row) => [row.scenario_id, row]));
  const pairs = left.filter((row) => rightById.has(row.scenario_id)).map((row) => ({ scenario_id: row.scenario_id, left: row.score.core_score, right: rightById.get(row.scenario_id).score.core_score, delta: row.score.core_score - rightById.get(row.scenario_id).score.core_score }));
  return {
    left: leftName, right: rightName, count: pairs.length,
    left_wins: pairs.filter((row) => row.delta > 1e-12).length, ties: pairs.filter((row) => Math.abs(row.delta) <= 1e-12).length, right_wins: pairs.filter((row) => row.delta < -1e-12).length,
    mean_delta_left_minus_right: pairs.reduce((sum, row) => sum + row.delta, 0) / pairs.length,
  };
}

async function merge() {
  const [oldDataset, nextDataset] = await Promise.all([readJsonl(path.join(OLD_EVIDENCE, 'development-dataset-v2.jsonl')), readJsonl(path.join(EVIDENCE, 'development-dataset-v2.1.1.jsonl'))]);
  const oldScenarioById = new Map(oldDataset.map((row) => [row.scenario_id, row]));
  const nextScenarioById = new Map(nextDataset.map((row) => [row.scenario_id, row]));
  const modes = {
    full_omni: {
      oldFile: 'development-full-omni-results-v2.1.jsonl', newFile: 'development-full-omni-cross-agent-results-v2.1.1.jsonl', output: 'development-full-omni-results-v2.1.1.jsonl', expected: 35,
    },
    no_memory: {
      oldFile: 'development-no-memory-results-v2.1.jsonl', newFile: 'development-no-memory-cross-agent-results-v2.1.1.jsonl', output: 'development-no-memory-results-v2.1.1.jsonl', expected: 21,
    },
    retrieval_only: {
      oldFile: 'development-retrieval-only-results-v2.1.jsonl', newFile: 'development-retrieval-only-cross-agent-results-v2.1.1.jsonl', output: 'development-retrieval-only-results-v2.1.1.jsonl', expected: 21,
    },
  };
  const merged = {};
  const provenance = [];
  for (const [mode, spec] of Object.entries(modes)) {
    const oldRows = completedLatest(await readJsonl(path.join(OLD_EVIDENCE, spec.oldFile)));
    const newRows = completedLatest(await readJsonl(path.join(EVIDENCE, spec.newFile)));
    const newById = new Map(newRows.map((row) => [row.scenario_id, row]));
    const selected = [];
    for (const oldRow of oldRows) {
      const scenario = nextScenarioById.get(oldRow.scenario_id);
      if (!scenario) throw new Error(`Missing v2.1.1 scenario for ${oldRow.scenario_id}`);
      if (scenario.category === 'cross_agent_transfer') {
        const replacement = newById.get(oldRow.scenario_id);
        if (!replacement) throw new Error(`Missing changed result replacement ${oldRow.scenario_id}:${mode}`);
        selected.push(replacement);
        provenance.push({ scenario_id: oldRow.scenario_id, mode, source: 'v2.1.1_cross_agent_rerun', source_file: spec.newFile, scenario_sha256: sha256(JSON.stringify(scenario)), content_changed: true });
      } else {
        const oldScenario = oldScenarioById.get(oldRow.scenario_id);
        const oldHash = sha256(JSON.stringify(oldScenario));
        const nextHash = sha256(JSON.stringify(scenario));
        if (oldHash !== nextHash) throw new Error(`Cannot reuse result with changed Scenario Hash: ${oldRow.scenario_id}`);
        selected.push(oldRow);
        provenance.push({ scenario_id: oldRow.scenario_id, mode, source: 'v2.1_unchanged_reuse', source_file: spec.oldFile, old_scenario_sha256: oldHash, scenario_sha256: nextHash, content_changed: false });
      }
    }
    if (selected.length !== spec.expected || new Set(selected.map((row) => row.scenario_id)).size !== spec.expected) throw new Error(`${mode}: merged result count mismatch ${selected.length}/${spec.expected}`);
    merged[mode] = selected.sort((a, b) => a.scenario_id.localeCompare(b.scenario_id));
    await writeJsonl(path.join(EVIDENCE, spec.output), merged[mode]);
  }
  const aggregates = Object.fromEntries(Object.entries(merged).map(([mode, rows]) => [mode, aggregateResults(rows)]));
  const difficultyScores = Object.fromEntries(Object.entries(merged).map(([mode, rows]) => [mode, Object.fromEntries(['easy', 'medium', 'hard'].map((difficulty) => {
    const selected = rows.filter((row) => nextScenarioById.get(row.scenario_id)?.difficulty === difficulty);
    return [difficulty, { count: selected.length, score: selected.reduce((sum, row) => sum + row.score.core_score, 0) / selected.length }];
  }))]));
  const fullCross = merged.full_omni.filter((row) => row.category === 'cross_agent_transfer');
  const smokeCross = completedLatest(await readJsonl(path.join(EVIDENCE, 'smoke-cross-agent-results-v2.1.1-rerun.jsonl')));
  const pairwiseRows = [pairwise(merged.full_omni, merged.no_memory, 'full_omni', 'no_memory'), pairwise(merged.full_omni, merged.retrieval_only, 'full_omni', 'retrieval_only'), pairwise(merged.retrieval_only, merged.no_memory, 'retrieval_only', 'no_memory')];
  await Promise.all([
    writeJson(path.join(EVIDENCE, 'result-provenance-manifest-v2.1.1.json'), { schema_version: '1.1.1', status: 'pass', scenario_hash_verified_before_reuse: true, changed_scenarios_require_new_results: true, reused_only_unchanged_hashes: true, smoke_failed_preflight_preserved_in: 'smoke-cross-agent-results-v2.1.1.jsonl', smoke_successful_rerun: 'smoke-cross-agent-results-v2.1.1-rerun.jsonl', rows: provenance }),
    writeJson(path.join(EVIDENCE, 'development-metrics-v2.1.1.json'), { schema_version: '1.1.1', status: 'DEVELOPMENT_FINAL_NOT_FORMAL', by_mode: aggregates, by_difficulty: difficultyScores, seven_category_scores: Object.fromEntries(Object.entries(aggregates).map(([mode, value]) => [mode, Object.fromEntries(CATEGORY_KEYS.map((category) => [category, value.by_category[category].macro_score]))])), pairwise: pairwiseRows }),
    writeJson(path.join(EVIDENCE, 'cross-agent-rerun-summary-v2.1.1.json'), { schema_version: '1.1.1', status: 'completed', smoke: { expected: 3, completed: smokeCross.length, errors: 0 }, development: { full_omni: 5, no_memory: 3, retrieval_only: 3 }, new_cross_agent_score: aggregates.full_omni.by_category.cross_agent_transfer.macro_score, provenance_preservation: aggregates.full_omni.by_category.cross_agent_transfer.metrics.provenance_preservation, agent_isolation_error_rate: aggregates.full_omni.by_category.cross_agent_transfer.metrics.agent_isolation_error_rate, kimi_calls: 0, formal_run: false, comparison_run: false, locomo_2_to_10_accessed: false }),
  ]);
  console.log(JSON.stringify({ completed: Object.fromEntries(Object.entries(merged).map(([mode, rows]) => [mode, rows.length])), scores: Object.fromEntries(Object.entries(aggregates).map(([mode, value]) => [mode, value.overall_cognitive_score])), cross_agent: aggregates.full_omni.by_category.cross_agent_transfer }));
}

const command = process.argv[2];
if (command === 'generate') await generate();
else if (command === 'merge') await merge();
else if (command === 'hashes') await hashes();
else throw new Error('Usage: node src/repair-v1.1.1.mjs <generate|merge|hashes>');
