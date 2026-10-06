import fs from 'node:fs';

const ACTIONS = new Set(["DECIDE","PROPOSE_CONFIRM","CLARIFY","DEFER","REQUEST_APPROVAL","REVISE_OR_INVALIDATE","HONOR_OVERRIDE","REFUSE"]);
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
  if (!s.world_spec || !Array.isArray(s.world_spec.facts) || !s.world_spec.decision_contract) fail(`${s.sample_id}: world_spec missing`);

  const eventIds = new Set();
  for (const e of s.source_events) {
    if (eventIds.has(e.event_id)) fail(`${s.sample_id}: duplicate event ${e.event_id}`);
    eventIds.add(e.event_id);
    if (Number.isNaN(Date.parse(e.at))) fail(`${s.sample_id}: invalid event date ${e.event_id}`);
  }

  const candidateIds = new Set(s.candidates.map((c) => c.candidate_id));
  if (candidateIds.size !== s.candidates.length) fail(`${s.sample_id}: duplicate candidate ids`);

  const factIds = new Set();
  const factMap = new Map();
  for (const fact of s.world_spec.facts) {
    if (factIds.has(fact.fact_id)) fail(`${s.sample_id}: duplicate world fact ${fact.fact_id}`);
    factIds.add(fact.fact_id);
    factMap.set(fact.fact_id, fact);
    if (!eventIds.has(fact.source_event_id)) fail(`${s.sample_id}: world fact ${fact.fact_id} missing source event`);
    if (fact.candidate_id && !candidateIds.has(fact.candidate_id)) fail(`${s.sample_id}: world fact ${fact.fact_id} unknown candidate ${fact.candidate_id}`);
  }

  const evidenceIds = new Set();
  for (const e of s.evidence) {
    if (evidenceIds.has(e.evidence_id)) fail(`${s.sample_id}: duplicate evidence ${e.evidence_id}`);
    evidenceIds.add(e.evidence_id);
    if (!eventIds.has(e.source_event_id)) fail(`${s.sample_id}: evidence ${e.evidence_id} missing source event`);
    if (!Array.isArray(e.world_fact_ids) || !e.world_fact_ids.length) fail(`${s.sample_id}: evidence ${e.evidence_id} missing world_fact_ids`);
    for (const fid of e.world_fact_ids) {
      if (!factIds.has(fid)) fail(`${s.sample_id}: evidence ${e.evidence_id} unknown world fact ${fid}`);
      if (factMap.get(fid).source_event_id !== e.source_event_id) fail(`${s.sample_id}: evidence ${e.evidence_id} source mismatches world fact ${fid}`);
    }
    for (const id of e.supports_candidates ?? []) if (!candidateIds.has(id)) fail(`${s.sample_id}: evidence ${e.evidence_id} unknown candidate ${id}`);
  }

  const contract=s.world_spec.decision_contract;
  for(const fid of contract.required_fact_ids ?? []) if(!factIds.has(fid)) fail(`${s.sample_id}: contract unknown required fact ${fid}`);
  for(const a of [...(contract.full_action_families ?? []), ...(contract.coverage_aware_action_families ?? [])]) {
    if(!ACTIONS.has(a)) fail(`${s.sample_id}: contract invalid action family ${a}`);
  }
  for(const fid of contract.required_fact_ids ?? []) {
    if(!s.evidence.some(e=>(e.world_fact_ids??[]).includes(fid))) fail(`${s.sample_id}: required world fact ${fid} has no evidence mapping`);
  }

  const p = s.constructor_proposal;
  if (!p || !evidenceIds.has(p.treatment_target_evidence_id)) fail(`${s.sample_id}: invalid treatment target`);
  for (const a of [...(p.full_acceptable_action_families ?? []), ...(p.coverage_aware_safe_action_families ?? [])]) {
    if (!ACTIONS.has(a)) fail(`${s.sample_id}: invalid action family ${a}`);
  }

  const q = Date.parse(s.query_time);
  if (Number.isNaN(q)) fail(`${s.sample_id}: invalid query_time`);
  for (const e of s.source_events) if (Date.parse(e.at) > q) fail(`${s.sample_id}: future source event ${e.event_id}`);

  return true;
}

export function validateAnnotation(a, sample) {
  if (a.schema_version !== 'evidence-surface-v1-annotation') fail('bad annotation schema');
  if (a.sample_id !== sample.sample_id) fail('annotation sample mismatch');
  const ev = new Set(sample.evidence.map((x) => x.evidence_id));
  for (const id of a.mandatory_evidence_ids ?? []) if (!ev.has(id)) fail(`${a.sample_id}: annotation unknown evidence ${id}`);
  for (const x of [
    ...(a.full_source_acceptable_action_families ?? []),
    ...(a.reduced_surface_acceptable_action_families ?? []),
    ...(a.coverage_aware_acceptable_action_families ?? [])
  ]) if (!ACTIONS.has(x)) fail(`${a.sample_id}: annotation bad action ${x}`);
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('validate-p1-contract.mjs') && process.argv[2]) {
  const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  for (const s of rows) validateBaseSample(s);
  console.log(`VALID ${rows.length} base samples`);
}
