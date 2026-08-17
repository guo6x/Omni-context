/**
 * Central secret redaction utility. Nothing in the CLI may print:
 * - the local API token
 * - GitHub tokens
 * - Authorization headers
 * - pair codes
 * - approval tokens or token digests
 * - secret environment variables
 *
 * The CLI never stores the token in a variable that could be stringified
 * into logs, but defense-in-depth scrubbing runs on every user-facing
 * string in --json, human output and errors.
 */

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\/=-]+/gi,
  /gh[pousr]_[A-Za-z0-9]{16,}/gi,
  /github_pat_[A-Za-z0-9_]{22,}/gi,
  /OMNI_LOCAL_API_TOKEN\s*=\s*\S+/gi,
  /GH_TOKEN\s*=\s*\S+/gi,
  /GITHUB_TOKEN\s*=\s*\S+/gi,
  /"authorization"\s*:\s*"[^"]+"/gi,
  /"token"\s*:\s*"[^"]+"/gi,
  /"token_digest"\s*:\s*"[^"]+"/gi,
  /"pair_code"\s*:\s*"[^"]+"/gi,
  /"pairCode"\s*:\s*"[^"]+"/gi,
  /"local_api_token"\s*:\s*"[^"]+"/gi,
];

/**
 * Scrub a string so no secret material survives. Applied to stdout, stderr,
 * error messages and --json payloads. Never throws: redaction failure must
 * never turn into a leak path (fall back to a generic message).
 */
export function redactSecrets(value) {
  try {
    let text = typeof value === 'string' ? value : safeStringify(value);
    for (const pattern of SECRET_PATTERNS) {
      text = text.replace(pattern, '[REDACTED]');
    }
    return text;
  } catch {
    return '[REDACTED]';
  }
}

/**
 * Stringify without throwing and without ever emitting undefined or
 * circular structures. Used for error-safe output only.
 */
export function safeStringify(value) {
  try {
    return JSON.stringify(value, (_key, item) => {
      if (item === undefined) return null;
      return item;
    }) ?? String(value);
  } catch {
    return String(value);
  }
}
