import { describe, expect, it } from 'vitest';
import { normalizePersistedAnswerTurns } from '../../desktop-daemon/src/lib/answer-turn-compat.js';

describe('persisted Ask turn compatibility', () => {
  it('restores older turns with missing optional arrays without inventing decision IDs', () => {
    const turns = normalizePersistedAnswerTurns([{
      question: 'What did I decide earlier?',
      conclusion: 'Keep the first answer available.',
      questions: [],
      sources: [{ id: 'source-1', name: 'Imported note' }],
      savedAsDecision: true,
    }]);

    expect(turns).toEqual([{
      question: 'What did I decide earlier?',
      conclusion: 'Keep the first answer available.',
      reasons: [],
      questions: [],
      isDecision: false,
      sources: [{ id: 'source-1', name: 'Imported note', type: 'unknown' }],
      citedEntityIds: ['source-1'],
      savedAsDecision: true,
    }]);
    expect(turns?.[0]).not.toHaveProperty('savedDecisionId');
  });

  it('preserves bounded grounding and populated source/decision references from current turns', () => {
    const turns = normalizePersistedAnswerTurns([{
      id: 'turn-1',
      question: 'Why?',
      conclusion: 'Because of these sources.',
      reasons: [{ text: 'A cited note', entityIds: ['source-1', 12] }],
      questions: ['Should I check another note?', 12],
      isDecision: true,
      sources: [{ id: 'source-1', name: 'Imported note', type: 'memory' }],
      citedEntityIds: ['source-1'],
      grounding: { status: 'grounded', answerClassification: 'inference', evidenceCoverage: 'partial', confidence: 1.4 },
      savedAsDecision: true,
      savedDecisionId: 'decision-1',
    }]);

    expect(turns?.[0]).toMatchObject({
      id: 'turn-1',
      reasons: [{ text: 'A cited note', entityIds: ['source-1'] }],
      questions: ['Should I check another note?'],
      citedEntityIds: ['source-1'],
      grounding: { confidence: 1 },
      savedDecisionId: 'decision-1',
    });
  });

  it('rejects a turn without its user question or answer text', () => {
    expect(normalizePersistedAnswerTurns([{ question: 'Only a question' }])).toBeNull();
    expect(normalizePersistedAnswerTurns({ turns: [] })).toBeNull();
  });
});
