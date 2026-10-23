type ErrorPayload = Record<string, unknown>;

/** Accept the camelCase aliases and the snake_case shape returned by Brain HTTP. */
export function getImportErrorCode(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const payload = body as ErrorPayload;
  for (const candidate of [payload.code, payload.errorCode, payload.error_code]) {
    if (typeof candidate === 'string') return candidate;
  }
  return null;
}

/** Read an error code without consuming the response body used by the caller. */
export async function responseImportErrorCode(response: Response): Promise<string | null> {
  try {
    return getImportErrorCode(await response.clone().json());
  } catch {
    return null;
  }
}
