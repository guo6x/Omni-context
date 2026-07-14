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
  provenance: { speaker: 'Caroline', conversation_id: 'conv1-session1', internal_id: 'hidden' },
  recorded_at: '2023-05-08T13:56:00.000Z',
  valid_from: '2023-05-08T13:56:00.000Z',
  version: 1,
  created_at: '2023-05-08T13:56:00.000Z',
  updated_at: '2023-05-08T13:56:00.000Z',
};

describe('embedding passage serialization golden contract', () => {
  it('versions entity and assertion formats independently', () => {
    expect(ENTITY_SERIALIZATION_VERSION).toBe('entity-passage-v2');
    expect(ASSERTION_SERIALIZATION_VERSION).toBe('assertion-passage-v1');
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
      Conversation: conv1-session1
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
