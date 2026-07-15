import { createHash } from 'crypto';

export const MEMORY_FIDELITY_VERSION = 'memory-fidelity-v1';

export type MemoryFactState = 'current' | 'historical' | 'invalidated' | 'uncertain';
export type StateTransitionKind = 'updated' | 'corrected' | 'withdrawn' | 'superseded';

export interface StructuredStateTransition {
  kind: StateTransitionKind;
  from_value: string;
  to_value: string;
  effective_at?: string;
}

export interface FidelityFact {
  subject: string;
  predicate: string;
  original_predicate?: string;
  object: string;
  exact_value?: string;
  normalized_value?: string;
  confidence: number;
  source_span: string;
  state?: MemoryFactState;
  state_key?: string;
  source_event_id?: string;
  transition?: StructuredStateTransition;
}

export interface RawEventReference {
  event_id: string;
  timestamp: string;
  agent?: string;
  text: string;
  raw_text_reference: string;
  document_id?: string;
  source?: string;
}

interface RawEventDefaults {
  timestamp: string;
  documentId?: string;
  source?: string;
}

function oneLine(value: string, max = 2_000): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function stableEventId(line: string, index: number): string {
  return `event-${createHash('sha256').update(`${index}:${line}`).digest('hex').slice(0, 20)}`;
}

/**
 * Parse source records without interpreting their meaning. Event ids and agents
 * are provenance, so they are taken only from the raw transcript envelope and
 * never from model output.
 */
export function parseRawEventReferences(text: string, defaults: RawEventDefaults): RawEventReference[] {
  const events: RawEventReference[] = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const enveloped = line.match(/^\[([^\]]{1,300})\]\s+(\S{1,100})\s+([^:]{1,160}):\s*(.+)$/);
    const dialogue = enveloped ? null : line.match(/^([^:\[\]]{1,160})(?:\s+\[([^\]]{1,100})\])?:\s*(.+)$/);
    const eventId = enveloped?.[1] || stableEventId(line, index);
    const timestamp = enveloped?.[2] || dialogue?.[2] || defaults.timestamp;
    const agent = oneLine(enveloped?.[3] || dialogue?.[1] || '', 160) || undefined;
    const eventText = oneLine(enveloped?.[4] || dialogue?.[3] || line);
    events.push({
      event_id: eventId,
      timestamp,
      ...(agent ? { agent } : {}),
      text: eventText,
      raw_text_reference: oneLine(line),
      ...(defaults.documentId ? { document_id: defaults.documentId } : {}),
      ...(defaults.source ? { source: defaults.source } : {}),
    });
  }
  return events.slice(0, 500);
}

function matchingEvents(sourceSpan: string, events: RawEventReference[]): RawEventReference[] {
  const needle = oneLine(sourceSpan).toLocaleLowerCase();
  if (!needle) return [];
  const exact = events.filter((event) => {
    const text = event.text.toLocaleLowerCase();
    const raw = event.raw_text_reference.toLocaleLowerCase();
    return text.includes(needle) || raw.includes(needle) || needle.includes(text);
  });
  if (exact.length > 0) return exact.slice(0, 3);

  // A verbatim span can cover only part of a long event. Require a substantial
  // deterministic overlap; do not use semantic guessing for provenance.
  const tokens = new Set(needle.split(/[^\p{L}\p{N}_-]+/u).filter((token) => token.length >= 3));
  if (tokens.size < 2) return [];
  return events.filter((event) => {
    const haystack = event.text.toLocaleLowerCase();
    let matches = 0;
    for (const token of tokens) if (haystack.includes(token)) matches++;
    return matches / tokens.size >= 0.7;
  }).slice(0, 3);
}

export function buildAssertionProvenance(input: {
  fact: FidelityFact;
  rawEvents: RawEventReference[];
  source?: string;
  documentId?: string;
  model?: string;
}): Record<string, unknown> {
  const matched = matchingEvents(input.fact.source_span, input.rawEvents);
  const state = input.fact.state || 'uncertain';
  const exactValue = oneLine(input.fact.exact_value || input.fact.object);
  const stateKey = oneLine(
    input.fact.state_key
      || `${input.fact.subject}:${input.fact.original_predicate || input.fact.predicate}`,
    500,
  );
  return {
    extractor: 'llm',
    ...(input.model ? { model: input.model } : {}),
    fidelity_version: MEMORY_FIDELITY_VERSION,
    exact_value: exactValue,
    ...(input.fact.normalized_value ? { normalized_value: oneLine(input.fact.normalized_value) } : {}),
    state,
    state_key: stateKey,
    source_event_ids: matched.map((event) => event.event_id),
    ...(matched.length === 1 && matched[0].agent ? { source_agent: matched[0].agent } : {}),
    raw_event_references: matched.map((event) => ({
      event_id: event.event_id,
      timestamp: event.timestamp,
      ...(event.agent ? { agent: event.agent } : {}),
      text: event.text,
      raw_text_reference: event.raw_text_reference,
    })),
    ...(input.documentId ? { document_id: input.documentId } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.fact.transition ? { transition: { ...input.fact.transition } } : {}),
  };
}

/**
 * Preserve a bounded transcript event as evidence without interpreting it as a
 * normalized memory fact. This closes extraction gaps while keeping the raw
 * observation distinguishable from current/historical assertions.
 */
export function buildRawEventEvidenceProvenance(
  event: RawEventReference,
  input: { source?: string; documentId?: string } = {},
): Record<string, unknown> {
  return {
    extractor: 'raw_event',
    fidelity_version: MEMORY_FIDELITY_VERSION,
    evidence_kind: 'raw_event',
    exact_value: event.text,
    state: 'observed',
    state_key: `raw_event:${event.event_id}`,
    source_event_ids: [event.event_id],
    ...(event.agent ? { source_agent: event.agent } : {}),
    raw_event_references: [{
      event_id: event.event_id,
      timestamp: event.timestamp,
      ...(event.agent ? { agent: event.agent } : {}),
      text: event.text,
      raw_text_reference: event.raw_text_reference,
    }],
    ...(input.documentId || event.document_id ? { document_id: input.documentId || event.document_id } : {}),
    ...(input.source || event.source ? { source: input.source || event.source } : {}),
  };
}
