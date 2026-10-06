import fs from 'node:fs';
import path from 'node:path';

function readJsonl(p) {
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function stripConstructor(sample) {
  const {
    constructor_proposal,
    construction_provenance,
    ...visible
  } = sample;
  return visible;
}

function hideTarget(sample, targetEvidenceId) {
  const base = clone(sample);
  const target = base.evidence.find((e) => e.evidence_id === targetEvidenceId);
  if (!target) throw new Error(`${sample.sample_id}: treatment target not found`);

  const sourceId = target.source_event_id;
  base.evidence = base.evidence.filter((e) => e.evidence_id !== targetEvidenceId);
  base.source_events = base.source_events.filter((e) => e.event_id !== sourceId);

  // Remove direct references in optional/free-form structures if present.
  for (const c of base.candidates ?? []) {
    if (Array.isArray(c.evidence_refs)) {
      c.evidence_refs = c.evidence_refs.filter((id) => id !== targetEvidenceId);
    }
  }

  return base;
}

export function buildAnnotationPackets(samples) {
  const out = [];
  for (const sample of samples) {
    const target = sample.constructor_proposal?.treatment_target_evidence_id;
    if (!target) throw new Error(`${sample.sample_id}: constructor treatment target missing`);

    const sourceTruth = stripConstructor(clone(sample));
    const hidden = stripConstructor(hideTarget(sample, target));

    out.push({
      schema_version: 1,
      packet_id: `${sample.sample_id}::SOURCE_TRUTH`,
      sample_id: sample.sample_id,
      annotation_view: 'SOURCE_TRUTH',
      visible_sample: sourceTruth,
    });

    out.push({
      schema_version: 1,
      packet_id: `${sample.sample_id}::REDUCED_SURFACE`,
      sample_id: sample.sample_id,
      annotation_view: 'REDUCED_SURFACE',
      visible_sample: hidden,
    });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('build-annotation-packets.mjs')) {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) {
    console.error('usage: node build-annotation-packets.mjs base-samples.jsonl packets.jsonl');
    process.exit(2);
  }
  const samples = readJsonl(input);
  const packets = buildAnnotationPackets(samples);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, packets.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');
  console.log(`wrote ${packets.length} annotation packets`);
}
