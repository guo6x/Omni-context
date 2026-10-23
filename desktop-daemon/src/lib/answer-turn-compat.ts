export interface AnswerSourceRecord {
  id: string;
  name: string;
  type: string;
  description?: string;
}

export interface PersistedAnswerTurn {
  id?: string;
  decisionRequestKey?: string;
  decisionRequestFingerprint?: string;
  question: string;
  conclusion: string;
  reasons: Array<{ text: string; entityIds: string[] }>;
  questions: string[];
  isDecision: boolean;
  sources: AnswerSourceRecord[];
  citedEntityIds: string[];
  grounding?: {
    status: 'grounded' | 'insufficient_evidence';
    answerClassification: 'inference' | 'unknown';
    evidenceCoverage: 'partial' | 'none';
    confidence: number;
  };
  needsLlmSetup?: boolean;
  savedAsDecision?: boolean;
  savedDecisionId?: string;
  decisionConclusion?: string;
  decisionSaveUncertain?: boolean;
  favorited?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Normalize persisted Ask turns written by older releases. Optional display
 * fields become harmless empty values; required user text stays fail-closed.
 */
export function normalizePersistedAnswerTurns(value: unknown): PersistedAnswerTurn[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const turns: PersistedAnswerTurn[] = [];

  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.question !== 'string' || typeof raw.conclusion !== 'string') return null;

    const sources: AnswerSourceRecord[] = Array.isArray(raw.sources)
      ? raw.sources.flatMap((source) => {
        if (!isRecord(source) || typeof source.id !== 'string' || typeof source.name !== 'string') return [];
        return [{
          id: source.id,
          name: source.name,
          type: typeof source.type === 'string' ? source.type : 'unknown',
          ...(typeof source.description === 'string' ? { description: source.description } : {}),
        }];
      })
      : [];
    const reasons = Array.isArray(raw.reasons)
      ? raw.reasons.flatMap((reason) => {
        if (!isRecord(reason) || typeof reason.text !== 'string') return [];
        return [{ text: reason.text, entityIds: stringArray(reason.entityIds) }];
      })
      : [];
    const rawGrounding = isRecord(raw.grounding) ? raw.grounding : null;
    const grounding: PersistedAnswerTurn['grounding'] = rawGrounding
      && (rawGrounding.status === 'grounded' || rawGrounding.status === 'insufficient_evidence')
      && (rawGrounding.answerClassification === 'inference' || rawGrounding.answerClassification === 'unknown')
      && (rawGrounding.evidenceCoverage === 'partial' || rawGrounding.evidenceCoverage === 'none')
      && typeof rawGrounding.confidence === 'number'
      && Number.isFinite(rawGrounding.confidence)
      ? {
        status: rawGrounding.status as 'grounded' | 'insufficient_evidence',
        answerClassification: rawGrounding.answerClassification as 'inference' | 'unknown',
        evidenceCoverage: rawGrounding.evidenceCoverage as 'partial' | 'none',
        confidence: Math.max(0, Math.min(1, rawGrounding.confidence)),
      }
      : undefined;
    const citedEntityIds = stringArray(raw.citedEntityIds);

    turns.push({
      ...(typeof raw.id === 'string' ? { id: raw.id } : {}),
      ...(typeof raw.decisionRequestKey === 'string' ? { decisionRequestKey: raw.decisionRequestKey } : {}),
      ...(typeof raw.decisionRequestFingerprint === 'string' ? { decisionRequestFingerprint: raw.decisionRequestFingerprint } : {}),
      question: raw.question,
      conclusion: raw.conclusion,
      reasons,
      questions: stringArray(raw.questions),
      isDecision: raw.isDecision === true,
      sources,
      citedEntityIds: citedEntityIds.length > 0 ? citedEntityIds : sources.map((source) => source.id),
      ...(grounding ? { grounding } : {}),
      ...(raw.needsLlmSetup === true ? { needsLlmSetup: true } : {}),
      ...(raw.savedAsDecision === true ? { savedAsDecision: true } : {}),
      ...(typeof raw.savedDecisionId === 'string' ? { savedDecisionId: raw.savedDecisionId } : {}),
      ...(typeof raw.decisionConclusion === 'string' ? { decisionConclusion: raw.decisionConclusion } : {}),
      ...(raw.decisionSaveUncertain === true ? { decisionSaveUncertain: true } : {}),
      ...(raw.favorited === true ? { favorited: true } : {}),
    });
  }

  return turns;
}

export interface AskAnswerBookmarkLabels {
  title: string;
  summaryPrefix: string;
  note: string;
}

/**
 * Keep a saved Ask answer distinct from a user-confirmed fact or decision.
 * Cited IDs point to retrieved memory records, not independently verified
 * original materials.
 */
export function createAskAnswerBookmark(
  turn: PersistedAnswerTurn,
  labels: AskAnswerBookmarkLabels,
): { content: string; summary: string; tags: string[] } {
  const sourceById = new Map(turn.sources.map((source) => [source.id, source]));
  const citedEntityIds = [...new Set([
    ...turn.citedEntityIds,
    ...turn.reasons.flatMap((reason) => reason.entityIds),
  ])];
  const record = {
    record_type: 'omni_ask_answer',
    origin: 'omni-ask',
    user_confirmed: false,
    answer_classification: turn.grounding?.answerClassification ?? 'unavailable',
    grounding_status: turn.grounding?.status ?? 'unavailable',
    evidence_coverage: turn.grounding?.evidenceCoverage ?? 'unavailable',
    question: turn.question,
    conclusion: turn.conclusion,
    reasons: turn.reasons.map((reason) => ({ text: reason.text, cited_entity_ids: reason.entityIds })),
    cited_sources: citedEntityIds.map((id) => ({ id, name: sourceById.get(id)?.name ?? null })),
    linked_user_decision_id: turn.savedDecisionId ?? null,
    note: labels.note,
  };
  const normalizedQuestion = turn.question.trim() || turn.conclusion.trim().slice(0, 80);
  return {
    content: `${labels.title}\n${JSON.stringify(record, null, 2)}`,
    summary: `${labels.summaryPrefix}: ${normalizedQuestion}`.slice(0, 240),
    tags: ['收藏', 'source:omni-ask', 'authority:ai_derived', 'confirmation:unconfirmed'],
  };
}
