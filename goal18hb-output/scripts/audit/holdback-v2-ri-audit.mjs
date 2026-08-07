// Goal 18H-R - Referential Integrity + semantic audit over ALL 120 validation samples.
// Rules:
//   RI-01 options[].evidence_refs must reference existing evidence ids (qualified|expired|conflicting)
//   RI-02 evidence[].supports must reference existing option ids / constraint ids / decision ids
//   RI-03 semantics of options[].evidence_refs vs evidence[].supports (analysis, not pass/fail)
//   RI-04 qualified evidence provenance: source_ref referencing a deleted timeline event is flagged.
//        TT15 is a designed GHOST-CITATION trap (gold requires detecting the deleted source_ref and
//        cascade-invalidating; see validation-semantic-anomaly-report.md) -> INFO.
//        Any non-TT15 occurrence would be a real defect -> ERROR.
//   RI-05 (bonus) all source_refs (evidence/historical/goal) must reference existing timeline events
//   RI-06 (bonus) historical_decision.evidence_snapshot must reference existing evidence ids
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..', '..');

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
const args = parseArgs(process.argv);
if (!args.fixtures) { console.error('missing --fixtures <holdback v2 plaintext jsonl>'); process.exit(1); }
const OUT_DIR = args.out ? path.resolve(args.out) : OUT;
const set = fs.readFileSync(args.fixtures, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
if (set.length !== 180) throw new Error('expected 180 holdback V2 samples, got ' + set.length);

const violations = []; // {rule, sample_id, task_type, path, detail, severity, root_cause}
const exceptions = []; // per-item RI-04 exception justifications (TT15 designed traps)
function add(rule, sample, p, detail, severity, rootCause) {
  violations.push({ rule, sample_id: sample.sample_id, task_type: sample.task_type, field_path: p, detail, severity, root_cause: rootCause });
}

for (const s of set) {
  const tt = s.task_type;
  const evAll = new Set([...(s.evidence.qualified || []), ...(s.evidence.expired || []), ...(s.evidence.conflicting || [])].map((e) => e.id));
  const evById = new Map([...(s.evidence.qualified || []), ...(s.evidence.expired || []), ...(s.evidence.conflicting || [])].map((e) => [e.id, e]));
  const optIds = new Set((s.candidates || []).map((c) => c.id));
  const conIds = new Set((s.hard_constraints || []).map((c) => c.id));
  const softIds = new Set((s.soft_preferences || []).map((sp) => sp.id));
  const decIds = new Set();
  if (s.historical_decision && s.historical_decision.decision_id) decIds.add(s.historical_decision.decision_id);
  for (const e of s.memory_timeline || []) if (e.type === 'decision' && e.event_id) decIds.add(e.event_id);
  const eventsById = new Map((s.memory_timeline || []).map((e) => [e.event_id, e]));
  const deletedEventIds = new Set((s.memory_timeline || []).filter((e) => e.type === 'delete').flatMap((e) => e.targets || []));

  // RI-01
  for (const c of s.candidates || []) {
    for (const ref of c.evidence_refs || []) {
      if (!evAll.has(ref)) add('RI-01', s, 'candidates[' + c.id + '].evidence_refs', 'references missing evidence id ' + ref, 'ERROR', 'fixture data');
    }
  }
  // RI-02
  for (const ev of [...(s.evidence.qualified || []), ...(s.evidence.expired || []), ...(s.evidence.conflicting || [])]) {
    for (const sup of ev.supports || []) {
      if (!optIds.has(sup) && !conIds.has(sup) && !softIds.has(sup) && !decIds.has(sup)) {
        add('RI-02', s, 'evidence[' + ev.id + '].supports', 'references missing id ' + sup + ' (known options=' + [...optIds].join(',') + ' constraints=' + [...conIds].join(',') + ' soft_preferences=' + [...softIds].join(',') + ' decisions=' + [...decIds].join(',') + ')', 'ERROR', 'generator builder omitted the referenced constraint/option/soft-preference/decision from the sample');
      }
    }
  }
  // RI-03 analysis per option
  for (const c of s.candidates || []) {
    for (const ref of c.evidence_refs || []) {
      const ev = evById.get(ref);
      if (ev && !(ev.supports || []).includes(c.id)) {
        add('RI-03', s, 'candidates[' + c.id + '].evidence_refs', 'cites ' + ref + ' whose supports=[' + (ev.supports || []).join(',') + '] does not include ' + c.id, 'INFO', 'evidence_refs semantics under-defined in schema/docs (generator uses it as relevant-evidence in some builders, supporting-evidence in others)');
      }
    }
  }
  // RI-04 qualified provenance
  for (const ev of s.evidence.qualified || []) {
    if (!ev.source_ref) { add('RI-04', s, 'evidence[' + ev.id + '].source_ref', 'missing source_ref', 'ERROR', 'fixture data'); continue; }
    const src = eventsById.get(ev.source_ref);
    if (!src) { add('RI-04', s, 'evidence[' + ev.id + '].source_ref', 'references missing event ' + ev.source_ref, 'ERROR', 'fixture data'); continue; }
    if (deletedEventIds.has(ev.source_ref)) {
      const delAt = (s.memory_timeline || []).find((e) => e.type === 'delete' && (e.targets || []).includes(ev.source_ref));
      const evAt = ev.at;
      const afterDelete = delAt && evAt >= delAt.at;
      const isTT15 = s.task_type === 'TT15';
      if (isTT15) {
        // Designed ghost-citation trap (GHOST-CITATION failure label; gold must_cite ev001 and requires
        // detecting the deleted source_ref -> INVALIDATE/cascade). Not a fixture defect.
        add('RI-04', s, 'evidence[' + ev.id + '].source_ref', 'TT15 designed trap: qualified evidence source_ref=' + ev.source_ref + ' is a DELETED event (delete at ' + (delAt ? delAt.at : '?') + '); evidence at ' + evAt + ' claims current info without a revalidation event. Gold GHOST-CITATION semantics require detecting this.', 'INFO', 'TT15 ghost-citation trap by design (confirmed vs gold + plans.mjs + frozen v1 convention)');
        exceptions.push({ rule: 'RI-04', sample_id: s.sample_id, task_type: s.task_type, field_path: 'evidence[' + ev.id + '].source_ref', justification: 'TT15 is the designed GHOST-CITATION trap: qualified ev001 claims current info but its source_ref e001 was deleted with no revalidation event; the gold requires INVALIDATE + cascade invalidation and failure labels GHOST-CITATION/CASCADE-INVALIDATION-MISS. Schema/task-type definition explicitly permits this pattern for TT15 only (Goal 18HB RI-04 exception).' });
      } else {
        add('RI-04', s, 'evidence[' + ev.id + '].source_ref', 'qualified evidence source_ref=' + ev.source_ref + ' is a DELETED event (delete at ' + (delAt ? delAt.at : '?') + '); evidence at ' + evAt + (afterDelete ? ' (dated AFTER deletion, no revalidation event found)' : '') + '. Only the expired artifact may reference a deleted source.', afterDelete ? 'ERROR' : 'WARN', 'generator builder did not add a revalidation event after source deletion');
      }
    }
  }
  // RI-05 source_ref integrity (all evidence kinds + goal + constraints + prefs)
  const allEv = [...(s.evidence.qualified || []), ...(s.evidence.expired || []), ...(s.evidence.conflicting || [])];
  for (const ev of allEv) {
    if (ev.source_ref && !eventsById.has(ev.source_ref)) add('RI-05', s, 'evidence[' + ev.id + '].source_ref', 'references missing event ' + ev.source_ref, 'ERROR', 'fixture data');
  }
  if (s.goal && s.goal.source_ref && !eventsById.has(s.goal.source_ref)) add('RI-05', s, 'goal.source_ref', 'references missing event ' + s.goal.source_ref, 'ERROR', 'fixture data');
  for (const c of s.hard_constraints || []) {
    if (c.source_ref && !eventsById.has(c.source_ref)) add('RI-05', s, 'hard_constraints[' + c.id + '].source_ref', 'references missing event ' + c.source_ref, 'ERROR', 'fixture data');
  }
  for (const sp of s.soft_preferences || []) {
    if (sp.source_ref && !eventsById.has(sp.source_ref)) add('RI-05', s, 'soft_preferences[' + sp.id + '].source_ref', 'references missing event ' + sp.source_ref, 'ERROR', 'fixture data');
  }
  // RI-06 historical snapshot
  if (s.historical_decision && s.historical_decision.evidence_snapshot) {
    for (const sid of s.historical_decision.evidence_snapshot) {
      if (!evAll.has(sid)) add('RI-06', s, 'historical_decision.evidence_snapshot', 'references missing evidence ' + sid, 'ERROR', 'fixture data');
    }
  }
  // RI-07 deleted-event hygiene
  for (const did of deletedEventIds) {
    const hasExpired = (s.evidence.expired || []).some((e) => e.source_ref === did && e.expiry_reason === 'source_deleted');
    if (!hasExpired) add('RI-07', s, 'memory_timeline delete targets ' + did, 'deleted event has no expired artifact with expiry_reason=source_deleted', 'WARN', 'fixture data');
  }
  // RI-08 conflicting evidence hygiene
  for (const ev of s.evidence.conflicting || []) {
    if (ev.conflicts_with && !evAll.has(ev.conflicts_with)) add('RI-08', s, 'evidence[' + ev.id + '].conflicts_with', 'references missing evidence ' + ev.conflicts_with, 'ERROR', 'fixture data');
  }
}

// ---------- summary ----------
const byRule = {};
for (const v of violations) byRule[v.rule] = (byRule[v.rule] || 0) + 1;
const bySeverity = {};
for (const v of violations) bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
const samplesAffected = new Set(violations.map((v) => v.sample_id));
const report = {
  schema_version: 'holdback-v2-ri-audit-v1',
  scope: 'holdback V2 full plaintext auto-audit pre-seal (180 samples); Goal 18HB section 6/20',
  generated_at: new Date().toISOString(),
  totals: { violations: violations.length, samples_affected: samplesAffected.size, by_rule: byRule, by_severity: bySeverity },
  notes: [
    'RI-01: options[].evidence_refs must exist among qualified+expired+conflicting evidence ids.',
    'RI-02: evidence[].supports must reference an existing option/hard-constraint/soft-preference/decision id (0 dangling required).',
    'RI-03: RESOLVED - evidence_refs = RELEVANT evidence (qualified-only at kernel encode time), may include evidence that opposes the option or expired/conflicting traps; confirmed by frozen v1.1 fixtures (16 analogous cases) and spec context-encoding ("filtered evidence_refs (qualified ids only)"). Schema/docs/UI must document this.',
    'RI-04: TT15 qualified evidence with deleted source_ref is a DESIGNED GHOST-CITATION trap (gold GHOST-CITATION/CASCADE-INVALIDATION); INFO for TT15 with per-sample justification in exceptions[], ERROR otherwise.',
    'RI-05/06/07/08: bonus referential hygiene checks.'
  ],
  violations,
  exceptions
};
fs.writeFileSync(path.join(OUT_DIR, 'holdback-v2-referential-integrity.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ total: violations.length, samples_affected: samplesAffected.size, by_rule: byRule, by_severity: bySeverity, exceptions: exceptions.length }, null, 2));