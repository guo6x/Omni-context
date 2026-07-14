import { Assertion, Entity } from '../shared-types.js';

export const ENTITY_SERIALIZATION_VERSION = 'entity-passage-v2';
export const ASSERTION_SERIALIZATION_VERSION = 'assertion-passage-v1';

function oneLine(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function temporalStatus(input: Pick<Assertion, 'invalidated_at' | 'valid_until'>, at = new Date()): 'current' | 'historical' | 'invalidated' {
  if (input.invalidated_at) return 'invalidated';
  if (input.valid_until && Date.parse(input.valid_until) <= at.getTime()) return 'historical';
  return 'current';
}

export function serializeEntityPassage(entity: Entity): string {
  const metadata = metadataRecord(entity.metadata);
  const aliases = Array.isArray(metadata.aliases)
    ? metadata.aliases.map((item) => oneLine(item, 100)).filter(Boolean).slice(0, 10)
    : [];
  const chunks = Array.isArray(metadata.extraction_chunks)
    ? metadata.extraction_chunks.map(metadataRecord)
    : [];
  const sourceText = chunks
    .map((chunk) => oneLine(chunk.source_span || chunk.source, 240))
    .filter(Boolean)
    .slice(0, 2)
    .join(' | ');
  const status = metadata.merged_into ? 'merged' : entity.valid_until ? 'historical' : 'current';
  const description = oneLine(entity.description, 1_500);
  const headline = [oneLine(entity.name, 300), description].filter(Boolean).join(' — ');
  return [
    headline,
    `Name: ${oneLine(entity.name, 300)}`,
    `Type: ${entity.type}`,
    `Description: ${description || 'not provided'}`,
    `Aliases: ${aliases.join(', ') || 'none'}`,
    `Relevant source text: ${sourceText || 'not provided'}`,
    `Temporal status: ${status}`,
  ].join('\n');
}

export interface ResolvedAssertionPassage {
  assertion: Assertion;
  subjectName: string;
  objectName?: string;
}

export function serializeAssertionPassage(input: ResolvedAssertionPassage): string {
  const { assertion } = input;
  const provenance = metadataRecord(assertion.provenance);
  const subject = oneLine(input.subjectName, 300) || 'unknown subject';
  const object = oneLine(input.objectName || assertion.literal_value, 500) || 'unknown object';
  const relation = oneLine(assertion.original_predicate || assertion.predicate, 160) || assertion.predicate;
  const source = oneLine(assertion.source_span, 1_500);
  const speaker = oneLine(provenance.speaker || provenance.role, 160);
  const conversation = oneLine(
    provenance.conversation_id || provenance.session_id || provenance.document_id || provenance.source,
    240,
  );
  const eventTime = assertion.event_time || assertion.observed_at || '';
  const status = temporalStatus(assertion);
  const fact = source
    ? `${subject}: "${source}"`
    : `${subject} ${relation.replaceAll('_', ' ')} ${object}.`;
  return [
    fact,
    `Subject: ${subject}`,
    `Relation: ${relation}`,
    `Object: ${object}`,
    `Source: ${source || 'not provided'}`,
    `Speaker: ${speaker || subject}`,
    `Conversation: ${conversation || 'not provided'}`,
    `Event time: ${eventTime || 'not provided'}`,
    `Valid from: ${assertion.valid_from}`,
    `Valid until: ${assertion.valid_until || 'open'}`,
    `Status: ${status}`,
  ].join('\n');
}
