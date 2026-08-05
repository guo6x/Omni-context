/**
 * Protocol-neutral error model for the unified MCP business dispatch layer.
 *
 * The business layer (`mcp/dispatch.ts`) throws `BusinessError` only. Protocol
 * adapters (stdio MCP in `mcp-server.ts`, HTTP JSON-RPC/REST in
 * `api/handlers/mcp.ts`) translate these codes into their own error formats.
 *
 * Same input -> same business result: because the business layer is shared,
 * both adapters observe identical success/error semantics.
 */

export type BusinessErrorCode =
  | 'INVALID_PARAMS'
  | 'NOT_FOUND'
  | 'METHOD_NOT_FOUND'
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_ANALYSIS_FAILED'
  | 'LLM_OUTPUT_INVALID_JSON'
  | 'LLM_OUTPUT_INVALID'
  | 'EVALUATION_EMBEDDING_UNAVAILABLE'
  | 'INTERNAL';

export class BusinessError extends Error {
  readonly code: BusinessErrorCode;

  constructor(code: BusinessErrorCode, message: string) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
  }
}

/**
 * Shared MCP tool-call success payload. Both adapters use this so that the
 * serialized `content[0].text` is byte-identical for identical business data.
 */
export function formatToolResult(data: any): {
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Shared MCP resource-read success payload.
 */
export function formatResourceResult(uri: string, data: any): {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
} {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Map a `BusinessErrorCode` to an HTTP status code (used by the HTTP adapter).
 */
export function businessErrorToHttpStatus(code: BusinessErrorCode): number {
  switch (code) {
    case 'INVALID_PARAMS':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'METHOD_NOT_FOUND':
      return 404;
    case 'LLM_NOT_CONFIGURED':
      return 400;
    case 'EVALUATION_EMBEDDING_UNAVAILABLE':
      return 503;
    case 'LLM_ANALYSIS_FAILED':
    case 'LLM_OUTPUT_INVALID_JSON':
    case 'LLM_OUTPUT_INVALID':
    case 'INTERNAL':
    default:
      return 500;
  }
}
