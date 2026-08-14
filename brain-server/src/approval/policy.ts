/**
 * Goal24 Checkpoint 7 (Lane A) - fail-closed approval policy.
 *
 * CP7 V1 policy: approval is NOT required only for the minimum case
 *
 *   side_effect_class == read_only
 *   && risk_level == low
 *   && required_authority == L0
 *
 * Everything else - any write, external effect, elevated risk or elevated
 * authority - requires explicit owner/admin approval. There is no write
 * auto-approval path and no system/LLM grant in CP7 V1.
 *
 * The policy version is fixed and every approval request / grant must bind
 * it; a runtime policy-version change invalidates old pending approvals and
 * grants (fail closed). Authority ordering is canonical: L0 < L1 < L2 < L3.
 */

import {
  AUTHORITY_LEVELS,
  type AuthorityLevel,
  type CapabilityDefinition,
} from '../capabilities/contracts.js';
import { RiskSnapshotSchema, type RiskSnapshot } from '../execution/contracts.js';
import { ApprovalError } from './errors.js';

/** Fixed CP7 V1 approval policy identity (bound into requests and grants). */
export const APPROVAL_POLICY_VERSION = 'goal24-approval-policy-v1';

/** V1 trusted policy: approval lifetime (pending + granted) is capped at 15 minutes. */
export const DEFAULT_MAX_APPROVAL_TTL_MS = 15 * 60 * 1000;

export const AUTHORITY_RANK: Record<AuthorityLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};

/** Canonical ordering check: L0 < L1 < L2 < L3; grant requires actor >= required. */
export function authoritySatisfies(actorAuthority: AuthorityLevel, requiredAuthority: AuthorityLevel): boolean {
  if (!AUTHORITY_LEVELS.includes(actorAuthority) || !AUTHORITY_LEVELS.includes(requiredAuthority)) {
    throw new ApprovalError('APPROVAL_INPUT_INVALID', 'authority levels must be L0..L3');
  }
  return AUTHORITY_RANK[actorAuthority] >= AUTHORITY_RANK[requiredAuthority];
}

/**
 * CP7 V1 fail-closed default: only read_only + low + L0 is approval-free.
 * Any other combination requires explicit approval. No write auto-approval
 * exists in V1.
 */
export function approvalRequired(
  capability: Pick<CapabilityDefinition, 'side_effect_class' | 'risk_level' | 'required_authority'>,
): boolean {
  return !(
    capability.side_effect_class === 'read_only' &&
    capability.risk_level === 'low' &&
    capability.required_authority === 'L0'
  );
}

/**
 * Risk snapshot derived exclusively from the trusted CapabilityDefinition.
 * The caller can never supply a risk snapshot; the capability declaration is
 * the single authority.
 */
export function deriveRiskSnapshot(capability: CapabilityDefinition): RiskSnapshot {
  return RiskSnapshotSchema.parse({
    risk_level: capability.risk_level,
    reversible: capability.reversible,
    side_effect_class: capability.side_effect_class,
    required_authority: capability.required_authority,
    capability_version: capability.version,
  });
}

/**
 * Plan expiry: always bounded by `created_at + maxApprovalTtlMs`. A caller
 * `expires_at` may only shorten the bound (it is never authority to extend
 * past the policy cap). `expires_at` must be strictly after `created_at`.
 */
export function computePlanExpiry(
  createdAt: Date,
  requestedExpiresAt: string | undefined,
  maxApprovalTtlMs: number,
): string {
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
    throw new ApprovalError('APPROVAL_INPUT_INVALID', 'createdAt must be a valid date');
  }
  if (!Number.isInteger(maxApprovalTtlMs) || maxApprovalTtlMs <= 0) {
    throw new ApprovalError('APPROVAL_INPUT_INVALID', 'maxApprovalTtlMs must be a positive integer');
  }
  const policyBoundMs = createdAt.getTime() + maxApprovalTtlMs;
  let expiresMs = policyBoundMs;
  if (requestedExpiresAt !== undefined) {
    const requestedMs = Date.parse(requestedExpiresAt);
    if (!Number.isFinite(requestedMs)) {
      throw new ApprovalError('APPROVAL_INPUT_INVALID', 'expires_at is not a parseable timestamp');
    }
    expiresMs = Math.min(requestedMs, policyBoundMs);
  }
  if (expiresMs <= createdAt.getTime()) {
    throw new ApprovalError(
      'APPROVAL_INPUT_INVALID',
      `expires_at must be strictly after created_at (${createdAt.toISOString()})`,
    );
  }
  return new Date(expiresMs).toISOString();
}

/**
 * Deterministic expiry check: `now >= expires_at` is expired (boundary
 * inclusive), matching isExecutionPlanExpired semantics.
 */
export function isExpiredAt(expiresAt: string, now: Date): boolean {
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) {
    throw new ApprovalError('APPROVAL_INPUT_INVALID', `expires_at '${expiresAt}' is not parseable`);
  }
  return now.getTime() >= expiresMs;
}