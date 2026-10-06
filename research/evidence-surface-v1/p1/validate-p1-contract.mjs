import fs from 'node:fs';

const ACTIONS = new Set(['DECIDE','PROPOSE_CONFIRM','CLARIFY','DEFER','REQUEST_APPROVAL','REVISE_OR_INVALIDATE','HONOR_OVERRIDE','REFUSE']);
const FAMILIES = new Set(['F1','F2','F3','F4','F5','F6']);

function fail(msg) { throw new Error(msg); }

export function validateBaseSample(s) {
  if (!s || typeof s !== 'object') fail('sample must be object');
  if (s.schema_version !== 'evidence-surface-v1') fail(`${s.sample_id}: bad schema_version`);
  if (!/^es-v1-f[1-6]-\d{3}$/.test(s.sample_id || '')) fail('bad sample_id');
  if (!FAMILIES.has(s.family)) fail(`${s.sample_id}: bad family`);
  if (!Array.isArray(s.source_events) || s.source_events.length < 2) fail(`${s.sample_id}: source_events<2`);
  if (!Array.isArray(s.evidence) || s.evidence.length < 2) fail(`${s.sample_id}: evidence<2`);
  if (!Array.isArray(s.candidates) || s.candidates.length < 2) fail(`${s.sample_id}: candidates<2`);

  const eventIds = new Set();
  for (const e of s.source_events) {
    if (eventIds.has(e.event_id)) fail(`${s.sample_id}: duplicate event ${e.event_id}`);
    eventIds.add(e.event_id);
    if (Number.isNaN(Date.parse(e.at))) fail(`${s.sample_id}: invalid event date ${e.event_id}`);
  }

  const candidateIds = new Set(s.candidates.map((c) => c.candidate_id));
  if (candidateIds.size !== s.candidates.length) fail(`${s.sample_id}: duplicate candidate ids`);

  const evidenceIds = new Set();
  for (const e of s.evidence) {
    if (evidenceIds.has(e.evidence_id)) fail(`${s.sample_id}: duplicate evidence ${e.evidence_id}`);
    evidenceIds.add(e.evidence_id);
    if (!eventIds.has(e.source_event_id)) fail(`${s.sample_id}: evidence ${e.evidence_id} missing source event`);
    for (const id of e.supports_candidates ?? []) {
      if (!candidateIds.has(id)) fail(`${s.sample_id}: evidence ${e.evidence_id} unknown candidate ${id}`);
    }
  }

  const p = s.constructor_proposal;
  if (!p || !evidenceIds.has(p.treatment_target_evidence_id)) fail(`${s.sample_id}: invalid treatment target`);
  for (const a of [...(p.full_acceptable_action_families ?? []), ...(p.hidden_safe_action_families ?? [])]) {
    if (!ACTIONS.has(a)) fail(`${s.sample_id}: invalid action family ${a}`);
  }

  const q = Date.parse(s.query_time);
  if (Number.isNaN(q)) fail(`${s.sample_id}: invalid query_time`);
  for (const e of s.source_events) {
    if (Date.parse(e.at) > q) fail(`${s.sample_id}: future source event ${e.event_id}`);
  }

  return true;
}

export function validateAnnotation(a, sample) {
  if (a.schema_version !== 'evidence-surface-v1-annotation') fail('bad annotation schema');
  if (a.sample_id !== sample.sample_id) fail('annotation sample mismatch');
  const ev = new Set(sample.evidence.map((x) => x.evidence_id));
  for (const id of a.mandatory_evidence_ids ?? []) if (!ev.has(id)) fail(`${a.sample_id}: annotation unknown evidence ${id}`);
  for (const x of [...(a.full_acceptable_action_families ?? []), ...(a.hidden_acceptable_action_families ?? [])]) {
    if (!ACTIONS.has(x)) fail(`${a.sample_id}: annotation bad action ${x}`);
  }
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('validate-p1-contract.mjs') && process.argv[2]) {
  const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  for (const s of rows) validateBaseSample(s);
  console.log(`VALID ${rows.length} base samples`);
}
