export const LONGMEMEVAL_REPOSITORY = 'xiaowu0162/LongMemEval';
export const LONGMEMEVAL_COMMIT = '9e0b455f4ef0e2ab8f2e582289761153549043fc';
export const LONGMEMEVAL_VARIANT = 'longmemeval_s_cleaned';

export function normalizeLongMemEvalGeneration(record) {
  if (!record.question_id || !record.question || !Array.isArray(record.haystack_sessions)) throw new Error('LONGMEMEVAL_FIXTURE_SCHEMA_INVALID');
  const sessions = [...record.haystack_sessions].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  return {
    id: record.question_id,
    question: record.question,
    question_date: record.question_date || null,
    sessions: sessions.map((session) => ({
      session_id: session.session_id,
      timestamp: session.timestamp,
      messages: session.messages.map(({ role, content }) => ({ role, content })),
    })),
  };
}

export function toLongMemEvalOfficialOutput(record, answer, diagnostics = {}) {
  return { question_id: record.id, hypothesis: answer, abstained: answer === null, diagnostics };
}
