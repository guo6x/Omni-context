import { describe, expect, it } from 'vitest';
import { Assertion, Entity } from '../src/shared-types.js';
import {
  ASSERTION_SERIALIZATION_VERSION,
  ENTITY_SERIALIZATION_VERSION,
  serializeAssertionPassage,
  serializeEntityPassage,
} from '../src/embedding/serialization.js';

const entity: Entity = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Caroline',
  type: 'person',
  description: 'A conversation participant interested in counseling.',
  aliases: undefined,
  created_at: '2023-05-08T13:56:00.000Z',
  updated_at: '2023-05-08T13:56:00.000Z',
  last_accessed: '2023-05-08T13:56:00.000Z',
  access_count: 0,
  metadata: {
    aliases: ['Carol'],
    extraction_chunks: [{ source_span: 'I am keen on counseling.' }],
    internal_audit_blob: { must_not: 'leak' },
  },
};

const assertion: Assertion = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  subject_id: entity.id,
  predicate: 'relates_to',
  original_predicate: 'has_goal',
  literal_value: 'counseling certification',
  confidence: 0.95,
  source_span: "I'm keen on counseling or working in mental health",
  provenance: {
    speaker: 'Caroline', conversation_id: 'conv1-session1', internal_id: 'hidden',
    state: 'current', state_key: 'career goal', exact_value: 'counseling certification',
    source_event_ids: ['event-8'], source_agent: 'Caroline',
    transition: {
      kind: 'updated', from_value: 'general healthcare', to_value: 'counseling certification',
      effective_at: '2023-05-08T13:56:00.000Z',
    },
  },
  recorded_at: '2023-05-08T13:56:00.000Z',
  valid_from: '2023-05-08T13:56:00.000Z',
  version: 1,
  created_at: '2023-05-08T13:56:00.000Z',
  updated_at: '2023-05-08T13:56:00.000Z',
};

describe('embedding passage serialization golden contract', () => {
  it('versions entity and assertion formats independently', () => {
    expect(ENTITY_SERIALIZATION_VERSION).toBe('entity-passage-v2');
    expect(ASSERTION_SERIALIZATION_VERSION).toBe('assertion-passage-v3');
  });

  it('serializes raw event evidence compactly with only verified speaker metadata', () => {
    const passage = serializeAssertionPassage({
      assertion: {
        id: 'raw-1', subject_id: 'person-1', predicate: 'relates_to', original_predicate: 'reported',
        literal_value: 'A verbatim observation.', confidence: 1, version: 1,
        source_span: 'A verbatim observation.', provenance: {
          evidence_kind: 'raw_event', source_agent: 'Agent Gamma', source_event_ids: ['evt-raw'],
          exact_value: 'A verbatim observation.', state: 'observed',
        }, valid_from: '2026-05-05T09:00:00.000Z', event_time: '2026-05-05T09:00:00.000Z',
        created_at: '2026-05-05T09:00:00.000Z', updated_at: '2026-05-05T09:00:00.000Z',
      } as any,
      subjectName: 'Internal subject that must not replace provenance',
    });

    expect(passage).toContain('Evidence kind: raw event');
    expect(passage).toContain('Speaker: Agent Gamma');
    expect(passage).toContain('Source event IDs: evt-raw');
    expect(passage).not.toContain('Internal subject that must not replace provenance');
  });

  it('serializes an entity as bounded human-readable text without internal JSON', () => {
    const passage = serializeEntityPassage(entity);
    expect(passage).toContain('Name: Caroline');
    expect(passage).toContain('Aliases: Carol');
    expect(passage).toContain('Relevant source text: I am keen on counseling.');
    expect(passage).not.toContain(entity.id);
    expect(passage).not.toContain('internal_audit_blob');
    expect(passage).not.toContain('{');
  });

  it('serializes an assertion with names, source, original relation, and time', () => {
    const passage = serializeAssertionPassage({ assertion, subjectName: 'Caroline' });
    expect(passage).toMatchInlineSnapshot(`
      "Caroline: \"I'm keen on counseling or working in mental health\"
      Subject: Caroline
      Relation: has_goal
      Object: counseling certification
      Source: I'm keen on counseling or working in mental health
      Speaker: Caroline
      Source event IDs: event-8
      Conversation: conv1-session1
      Exact value: counseling certification
      Memory state: current
      State key: career goal
      Transition: [HISTORICAL] general healthcare -> [CURRENT] counseling certification (updated at 2023-05-08T13:56:00.000Z)
      Event time: not provided
      Valid from: 2023-05-08T13:56:00.000Z
      Valid until: open
      Status: current"
    `);
    expect(passage).not.toContain(assertion.subject_id);
    expect(passage).not.toContain('internal_id');
  });

  it('labels invalidated evidence explicitly', () => {
    const passage = serializeAssertionPassage({
      assertion: { ...assertion, invalidated_at: '2023-06-01T00:00:00.000Z' },
      subjectName: 'Caroline',
    });
    expect(passage).toContain('Status: invalidated');
  });
});
