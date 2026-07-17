export const LOCOMO_REPOSITORY = 'snap-research/locomo';
export const LOCOMO_COMMIT = '3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376';
export const LOCOMO_HELDOUT_SUBSET = 'Conversations 2-10';

export function normalizeLocomoGeneration(record) {
  const conversation = record.conversation;
  if (!record.sample_id || !conversation?.speaker_a || !conversation?.speaker_b || !Array.isArray(record.questions)) throw new Error('LOCOMO_FIXTURE_SCHEMA_INVALID');
  const sessionKeys = Object.keys(conversation).filter((key) => /^session_\d+$/.test(key)).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
  const sessions = sessionKeys.map((key) => ({
    session_id: key,
    timestamp: conversation[`${key}_date_time`],
    turns: conversation[key].map(({ speaker, dia_id, text }) => ({ speaker, dia_id, text })),
  }));
  return record.questions.map((question) => ({ id: `${record.sample_id}:${question.question_id}`, sample_id: record.sample_id, question: question.question, category: question.category, sessions }));
}

export function toLocomoOfficialOutput(record, answer, diagnostics = {}) {
  return { sample_id: record.sample_id, question_id: record.id.split(':').at(-1), response: answer, diagnostics };
}
