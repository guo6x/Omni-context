// Builds validation-manifest.json (stats, hashes, seeds, review refs).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadValidation, loadSchema } from '../benchmark-integrity-tests/fixtures-loader.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT, f))).digest('hex');

const { set, gold, all } = loadValidation();
const schema = loadSchema('schema/decision-benchmark-v2-schema.json');
const seed = process.env.VAL_SEED || 'goal18-validation-seed-7f3a9c2e';
const seedHash = crypto.createHash('sha256').update(seed, 'utf8').digest('hex');

const perTt = {};
for (const tt of ['TT01', 'TT02', 'TT03', 'TT04', 'TT05', 'TT06', 'TT07', 'TT08', 'TT09', 'TT10', 'TT11', 'TT12', 'TT13', 'TT14', 'TT15']) {
  perTt[tt] = all.filter((s) => s.task_type === tt).length;
}
const sourceTypes = {};
for (const s of all) sourceTypes[s.construction_provenance.source_type] = (sourceTypes[s.construction_provenance.source_type] || 0) + 1;
const domains = {};
for (const s of all) domains[s.domain] = (domains[s.domain] || 0) + 1;
const riskLevels = {};
for (const s of all) riskLevels[s.scenario.risk_classification.level] = (riskLevels[s.scenario.risk_classification.level] || 0) + 1;
const authorities = {};
for (const s of all) authorities[s.scenario.authority_level] = (authorities[s.scenario.authority_level] || 0) + 1;

const manifest = {
  schemaVersion: 'validation-manifest-v2',
  split: 'validation',
  goal: 'Goal 18',
  generated_at: '2026-08-07T00:00:00Z',
  generator_version: 'goal18-generator/v2.0.0',
  seed: seed,
  seed_hash: seedHash,
  schema_sha256: sha('schema/decision-benchmark-v2-schema.json'),
  counts: { total: all.length, per_task_type: perTt, per_source_type: sourceTypes, per_domain: domains, risk_levels: riskLevels, authorities },
  files: {
    'validation-set.jsonl': { sha256: sha('validation-set.jsonl'), lines: set.length },
    'validation-gold.jsonl': { sha256: sha('validation-gold.jsonl'), lines: gold.length }
  },
  review_refs: {
    reviewer_agreement_report: 'reviewer-agreement-report.md',
    adjudication_log: 'adjudication-log.jsonl',
    coverage_matrix: 'coverage-matrix.csv',
    leakage_analysis: 'leakage-analysis.md'
  },
  integrity: { suite: 'benchmark-integrity-tests/run.mjs', status: 'SEE commands-and-results.log' },
  immutability: { edits_forbidden_after_freeze: true, note: 'validation split is frozen for system-level checks; sample-level method patching is not allowed after validation' }
};
fs.writeFileSync(path.join(OUT, 'validation-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('validation-manifest.json written');
