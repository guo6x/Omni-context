/**
 * Goal24 Checkpoint 6 (Lane A) - Evidence Provider V1 contract.
 *
 * A provider returns raw candidates and a structured outcome. It never
 * returns EvidenceCoverageEntry and never decides coverage status: the core
 * alone decides present/verified/not-conflicted. Outcomes are structured
 * business semantics, never exception text:
 *
 * - collected:              candidates returned
 * - not_found:              the subject/source does not exist
 * - temporary_unavailable:  transient failure (retry allowed)
 * - permanent_unavailable:  the provider cannot ever serve this class
 * - user_context_required:  the provider needs user-supplied context
 *
 * Provider exceptions are normalized to EVIDENCE_PROVIDER_ERROR; the
 * original message is withheld so secrets can never leak through
 * diagnostics. Collection supports AbortSignal for Guard-level
 * cancel/timeout; aborting maps to EVIDENCE_COLLECTION_ABORTED.
 */

import { z } from 'zod';
import {
  EVIDENCE_CLASS_PATTERN,
  VERIFICATION_REQUIREMENTS,
} from '../capabilities/contracts.js';
import { SEMVER_PATTERN } from '../capabilities/contracts.js';
import { EvidenceCandidateSchema } from './model.js';
import { EvidenceError } from './errors.js';

export const EVIDENCE_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const EVIDENCE_PROVIDER_OUTCOMES = [
  'collected',
  'not_found',
  'temporary_unavailable',
  'permanent_unavailable',
  'user_context_required',
] as const;
export type EvidenceProviderOutcome = (typeof EVIDENCE_PROVIDER_OUTCOMES)[number];

/** Structured provider diagnostic; never exception text, never secrets. */
export const EvidenceProviderDiagnosticSchema = z.strictObject({
  code: z.string().trim().min(1).max(100),
  message: z.string().min(1).max(2000),
});
export type EvidenceProviderDiagnostic = z.infer<typeof EvidenceProviderDiagnosticSchema>;

/** Provider metadata: the descriptor that gates what the provider may claim. */
export const EvidenceProviderV1MetadataSchema = z
  .strictObject({
    provider_id: z.string().regex(EVIDENCE_PROVIDER_ID_PATTERN, 'provider_id must be a lowercase identifier'),
    version: z.string().regex(SEMVER_PATTERN, 'provider version must be semantic (major.minor.patch)'),
    supported_classes: z.array(z.string().regex(EVIDENCE_CLASS_PATTERN, 'supported class must be a dotted identifier')).min(1).max(100),
    /** Higher wins; ties are broken by provider_id ascending (deterministic). */
    priority: z.number().int().min(0).max(10_000),
    /** Hard cap on what this provider may claim (none < asserted < verified). */
    max_verification_level: z.enum(VERIFICATION_REQUIREMENTS),
    description: z.string().max(1000).optional(),
  })
  .superRefine((metadata, ctx) => {
    if (new Set(metadata.supported_classes).size !== metadata.supported_classes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'supported_classes must not contain duplicates',
        path: ['supported_classes'],
      });
    }
  });
export type EvidenceProviderV1Metadata = z.infer<typeof EvidenceProviderV1MetadataSchema>;

/** Collection request. `signal` lets the Guard cancel / timeout collection. */
export interface EvidenceCollectRequest {
  evidence_class: string;
  subject_key: string;
  signal?: AbortSignal;
}

/** Provider result: raw candidates plus structured outcome and diagnostics. */
export const EvidenceProviderResultSchema = z.strictObject({
  outcome: z.enum(EVIDENCE_PROVIDER_OUTCOMES),
  candidates: z.array(EvidenceCandidateSchema).max(10_000),
  diagnostics: z.array(EvidenceProviderDiagnosticSchema).max(1000),
});
export type EvidenceProviderResult = z.infer<typeof EvidenceProviderResultSchema>;

/**
 * Evidence Provider V1 contract. Providers are trusted application code
 * registered internally; they are never registered from MCP / REST / Tauri
 * IPC / LLM tools.
 */
export interface EvidenceProviderV1 {
  readonly metadata: EvidenceProviderV1Metadata;
  collect(request: EvidenceCollectRequest): Promise<EvidenceProviderResult>;
}

// ---------------------------------------------------------------------------
// Normalized collection helpers
// ---------------------------------------------------------------------------

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Collect from a provider with fail-closed normalization:
 * - an already-aborted signal throws EVIDENCE_COLLECTION_ABORTED;
 * - an AbortError (or a result returned after the signal aborted) throws
 *   EVIDENCE_COLLECTION_ABORTED;
 * - any other provider exception is normalized to an outcome of
 *   `temporary_unavailable` with a single EVIDENCE_PROVIDER_ERROR
 *   diagnostic whose message never echoes the original exception text;
 * - a structurally invalid provider result is treated the same as a thrown
 *   provider exception (providers may never emit arbitrary result shapes).
 */
export async function collectFromProvider(
  provider: EvidenceProviderV1,
  request: EvidenceCollectRequest,
): Promise<EvidenceProviderResult> {
  if (request.signal?.aborted) {
    throw new EvidenceError('EVIDENCE_COLLECTION_ABORTED', 'evidence collection was aborted before start');
  }

  let rawResult: unknown;
  try {
    rawResult = await provider.collect(request);
  } catch (error) {
    if (isAbortError(error)) {
      throw new EvidenceError('EVIDENCE_COLLECTION_ABORTED', 'evidence collection was aborted');
    }
    return normalizedProviderErrorResult();
  }

  if (request.signal?.aborted) {
    throw new EvidenceError(
      'EVIDENCE_COLLECTION_ABORTED',
      `evidence collection aborted after provider '${provider.metadata.provider_id}' returned`,
    );
  }

  const parsed = EvidenceProviderResultSchema.safeParse(rawResult);
  if (!parsed.success) {
    return normalizedProviderErrorResult();
  }
  return parsed.data;
}

function normalizedProviderErrorResult(): EvidenceProviderResult {
  return {
    outcome: 'temporary_unavailable',
    candidates: [],
    diagnostics: [
      {
        code: 'EVIDENCE_PROVIDER_ERROR',
        message: 'provider collection failed; details withheld',
      },
    ],
  };
}