import fs from 'fs';
import os from 'os';
import path from 'path';

export interface AiCallMetadata {
  purpose: string;
  kind: 'llm' | 'embedding' | 'ocr';
}

interface AiAuditRecord {
  timestamp: string;
  purpose: string;
  kind: AiCallMetadata['kind'];
  provider: string;
  remote: boolean;
  model?: string;
  request_chars: number;
  message_count: number;
  success: boolean;
  status?: number;
  duration_ms: number;
  error?: string;
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized.startsWith('127.');
}

export function isRemoteAiEnabled(): boolean {
  return !['0', 'false', 'off', 'no'].includes(
    (process.env.OMNI_REMOTE_AI_ENABLED || 'true').trim().toLowerCase(),
  );
}

function auditPath(): string {
  if (process.env.OMNI_AI_AUDIT_PATH) return process.env.OMNI_AI_AUDIT_PATH;
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return path.join(os.tmpdir(), `omni-context-ai-audit-${process.pid}.jsonl`);
  }
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'omni-context')
    : path.join(os.homedir(), '.omni-context');
  return path.join(base, 'logs', 'ai-calls.jsonl');
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.name.slice(0, 120);
  return 'UnknownError';
}

function appendAudit(record: AiAuditRecord): void {
  try {
    const target = auditPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.error('[AI Audit] unable to persist audit record:', safeError(error));
  }
}

function inspectBody(body: BodyInit | null | undefined): {
  requestChars: number;
  messageCount: number;
  model?: string;
} {
  if (typeof body !== 'string') return { requestChars: 0, messageCount: 0 };
  try {
    const parsed = JSON.parse(body) as { model?: unknown; messages?: unknown };
    return {
      requestChars: body.length,
      messageCount: Array.isArray(parsed.messages) ? parsed.messages.length : 0,
      model: typeof parsed.model === 'string' ? parsed.model.slice(0, 200) : undefined,
    };
  } catch {
    return { requestChars: body.length, messageCount: 0 };
  }
}

export async function auditedAiFetch(
  input: string | URL,
  init: RequestInit,
  metadata: AiCallMetadata,
): Promise<Response> {
  const url = new URL(input.toString());
  const remote = !isLoopback(url.hostname);
  const startedAt = Date.now();
  const body = inspectBody(init.body);
  const baseRecord = {
    timestamp: new Date().toISOString(),
    purpose: metadata.purpose,
    kind: metadata.kind,
    provider: `${url.protocol}//${url.host}`,
    remote,
    model: body.model,
    request_chars: body.requestChars,
    message_count: body.messageCount,
  };

  if (remote && !isRemoteAiEnabled()) {
    appendAudit({
      ...baseRecord,
      success: false,
      duration_ms: Date.now() - startedAt,
      error: 'RemoteAiDisabled',
    });
    throw new Error('REMOTE_AI_DISABLED');
  }

  try {
    const response = await fetch(url, init);
    appendAudit({
      ...baseRecord,
      success: response.ok,
      status: response.status,
      duration_ms: Date.now() - startedAt,
      ...(response.ok ? {} : { error: 'HttpError' }),
    });
    return response;
  } catch (error) {
    appendAudit({
      ...baseRecord,
      success: false,
      duration_ms: Date.now() - startedAt,
      error: safeError(error),
    });
    throw error;
  }
}

export function createAuditedAiFetch(metadata: AiCallMetadata) {
  return (input: string | URL, init: RequestInit = {}) => auditedAiFetch(input, init, metadata);
}
