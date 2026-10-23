import type { DecisionLineage } from "@/hooks/useDecisionContext";

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Hide only records explicitly marked as unconfirmed AI-derived decisions. */
export function isUserDecision(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return !(value.authority === "ai_derived" && value.user_confirmed === false);
}

function requiredString(record: RecordValue, camelName: string, wireName: string): string {
  const value = record[camelName] ?? record[wireName];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid decision lineage field: ${wireName}`);
  }
  return value;
}

/** Normalize the Brain HTTP/MCP wire shape without hiding malformed citations. */
export function normalizeDecisionLineage<T extends DecisionLineage = DecisionLineage>(value: unknown): T {
  if (!isRecord(value)
    || !isRecord(value.current)
    || !Array.isArray(value.sources)
    || !Array.isArray(value.chain)) {
    throw new Error("Invalid decision lineage response");
  }

  const sources = value.sources.map((source) => {
    if (!isRecord(source)) throw new Error("Invalid decision lineage source");
    return {
      entity_id: requiredString(source, "entityId", "entity_id"),
      entity_name: requiredString(source, "entityName", "entity_name"),
      entity_type: requiredString(source, "entityType", "entity_type"),
      relationship: requiredString(source, "relationship", "relationship"),
    };
  });

  return { ...value, sources } as T;
}

export type DecisionLineageReadResult =
  | { kind: "loaded"; data: DecisionLineage }
  | { kind: "error" };

/** Distinguish an empty lineage from an unavailable or malformed response. */
export async function readDecisionLineage(read: () => Promise<Response>): Promise<DecisionLineageReadResult> {
  try {
    const response = await read();
    if (!response.ok) return { kind: "error" };
    return { kind: "loaded", data: normalizeDecisionLineage(await response.json()) };
  } catch {
    return { kind: "error" };
  }
}

export interface PendingOutcomeArgs<T> {
  status: "saving" | "uncertain";
  args: T;
}

/** A 4xx is only safe to edit/resubmit when the server definitely rejected it. */
export function isDeterministicOutcomeRejection(status: number, errorCode: string | null): boolean {
  return status >= 400
    && status < 500
    && status !== 408
    && status !== 425
    && status !== 429
    && errorCode !== "IDEMPOTENCY_KEY_REUSED";
}

/** Only an unresolved request in the still-open renderer is eligible to replay. */
export function getSafeOutcomeRetryArgs<T>(pending: PendingOutcomeArgs<T> | undefined): T | undefined {
  return pending?.status === "uncertain" ? pending.args : undefined;
}
