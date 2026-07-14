export const ANSWER_EVIDENCE_CONTEXT_VERSION = 'answer-evidence-context-v2';

function oneLine(value, fallback = 'unknown') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim() || fallback;
}

function factFor(evidence) {
  if (evidence.fact) return oneLine(evidence.fact);
  if (evidence.passage) {
    return oneLine(String(evidence.passage).split(/\r?\n/, 1)[0].replace(/^passage:\s*/i, ''));
  }
  if (evidence.source_span) return oneLine(evidence.source_span);
  return oneLine(evidence.description || evidence.name, 'No readable fact supplied');
}

function relationFor(evidence) {
  const relation = evidence.originalPredicate || evidence.original_predicate || evidence.predicate;
  return relation === 'relates_to' ? 'unspecified relation' : oneLine(relation);
}

function objectFor(evidence) {
  return oneLine(evidence.objectName || evidence.object_name || evidence.literalValue || evidence.literal_value);
}

function timeFor(evidence) {
  const parts = [];
  if (evidence.eventTime || evidence.event_time) parts.push(`event=${oneLine(evidence.eventTime || evidence.event_time)}`);
  if (evidence.valid_from) parts.push(`valid_from=${oneLine(evidence.valid_from)}`);
  if (evidence.valid_until) parts.push(`valid_until=${oneLine(evidence.valid_until)}`);
  return parts.length ? parts.join('; ') : 'not specified';
}

export function formatEvidenceContext(evidenceList) {
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) return 'No evidence retrieved.';
  return evidenceList.map((evidence) => [
    `Evidence ID: ${oneLine(evidence.id)}`,
    `Fact: ${factFor(evidence)}`,
    `Source quote: ${oneLine(evidence.source_span, 'not available')}`,
    `Subject: ${oneLine(evidence.subjectName || evidence.subject_name)}`,
    `Relation: ${relationFor(evidence)}`,
    `Object: ${objectFor(evidence)}`,
    `Time: ${timeFor(evidence)}`,
    `Status: ${oneLine(evidence.temporal_status, 'current')}`,
    `Confidence: ${Number.isFinite(Number(evidence.confidence)) ? Number(evidence.confidence).toFixed(3) : 'unknown'}`,
  ].join('\n')).join('\n\n---\n\n');
}

