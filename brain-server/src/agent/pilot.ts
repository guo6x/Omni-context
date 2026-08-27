/**
 * Goal26 Agent Pilot adapter.
 *
 * This module is intentionally a thin, server-owned adapter around the CP6
 * evidence runtime and CP7 authorization service.  It never exposes stores,
 * approval references, native bridge material or an execution primitive.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthorizationService } from '../approval/authorization-service.js';
import type { PlanAuthorizationRecord } from '../approval/contracts.js';
import type { EvidenceSurfaceRuntime } from '../evidence/runtime.js';
import type { ServerVerificationRuntime } from '../control/verification-runtime.js';
import { JsonObjectSchema } from '../contracts/json-safe.js';
import { CAPABILITY_ID_PATTERN, SEMVER_PATTERN } from '../capabilities/contracts.js';
import { ADAPTER_ID_PATTERN, RollbackPlanSchema, VerificationPlanSchema, TIMEOUT_MAX_MS, TIMEOUT_MIN_MS } from '../execution/contracts.js';

export const AgentAskSchema = z.strictObject({
  question: z.string().trim().min(1).max(4000),
  capability_id: z.string().regex(CAPABILITY_ID_PATTERN),
  capability_version: z.string().regex(SEMVER_PATTERN),
  normalized_inputs: JsonObjectSchema,
  create_plan: z.boolean().optional().default(false),
  decision_id: z.string().trim().min(1).max(200).optional(),
  adapter_id: z.string().regex(ADAPTER_ID_PATTERN).optional(),
  timeout_ms: z.number().int().min(TIMEOUT_MIN_MS).max(TIMEOUT_MAX_MS).optional(),
  verification_plan: VerificationPlanSchema.nullable().optional(),
  rollback_plan: RollbackPlanSchema.nullable().optional(),
  correlation_id: z.string().trim().min(1).max(200).optional(),
});

export const AgentPlanIdSchema = z.strictObject({ plan_id: z.string().trim().min(8).max(200) });
export type AgentAskRequest = z.infer<typeof AgentAskSchema>;

export type AgentDisposition = 'DECIDE' | 'CLARIFY' | 'DEFER' | 'BLOCK';

export interface AgentPilotAdapterOptions {
  evidenceRuntime: EvidenceSurfaceRuntime;
  authorizationService: AuthorizationService;
  verificationRuntime?: ServerVerificationRuntime;
}

function disposition(action: string): AgentDisposition {
  switch (action) {
    case 'proceed': return 'DECIDE';
    case 'clarify': return 'CLARIFY';
    case 'defer': return 'DEFER';
    default: return 'BLOCK';
  }
}

function sanitizePlanRecord(record: PlanAuthorizationRecord) {
  const safePlan = { ...record.plan, approval: null };
  return {
    plan: {
      ...safePlan,
      approval_granted: Boolean(record.grant),
    },
    approval_request: record.approval_request ? {
      approval_request_id: record.approval_request.approval_request_id,
      plan_id: record.approval_request.plan_id,
      decision_id: record.approval_request.decision_id,
      capability_id: record.approval_request.capability_id,
      capability_version: record.approval_request.capability_version,
      risk_snapshot: record.approval_request.risk_snapshot,
      side_effect_summary: record.approval_request.side_effect_summary,
      reversible: record.approval_request.reversible,
      evidence_summary: record.approval_request.evidence_summary,
      required_authority: record.approval_request.required_authority,
      policy_version: record.approval_request.policy_version,
      created_at: record.approval_request.created_at,
      expires_at: record.approval_request.expires_at,
      status: record.approval_request.status,
    } : null,
    guard_run_id: record.guard_run_id,
    blocked_reason: record.blocked_reason,
  };
}

export class AgentPilotAdapter {
  constructor(private readonly options: AgentPilotAdapterOptions) {}

  async ask(rawRequest: unknown) {
    const parsed = AgentAskSchema.parse(rawRequest);
    const evidence = await this.options.evidenceRuntime.evaluateForCapability({
      capability_id: parsed.capability_id,
      capability_version: parsed.capability_version,
      normalized_inputs: parsed.normalized_inputs,
      ...(parsed.correlation_id ? { correlation_id: parsed.correlation_id } : {}),
    });
    const result: Record<string, unknown> = {
      decision_id: parsed.decision_id ?? `decision-${randomUUID()}`,
      disposition: disposition(evidence.action),
      reason: evidence.reason_codes[0] ?? (evidence.final_assessment.mandatory_satisfied ? 'EVIDENCE_SATISFIED' : 'EVIDENCE_MISSING'),
      evidence_status: evidence.final_assessment.mandatory_satisfied ? 'qualified' : 'insufficient',
      missing_evidence: evidence.final_assessment.missing_mandatory,
      conflicts: evidence.final_coverage.entries.filter((entry) => entry.status === 'conflicted').map((entry) => entry.evidence_class),
      stale_evidence: evidence.final_coverage.entries.filter((entry) => entry.status === 'stale').map((entry) => entry.evidence_class),
      evidence: {
        guard_run_id: evidence.guard_run_id,
        coverage: evidence.final_coverage,
        reason_codes: evidence.reason_codes,
        qualified_evidence_ids: evidence.qualified_evidence_ids,
      },
      plan: null,
      next_allowed_action: evidence.action === 'proceed' ? 'human_approval_or_observation' : 'provide_missing_evidence',
    };

    // Asking is not plan creation. A plan is materialized only when the agent
    // explicitly requests it and the trusted guard says proceed.
    if (parsed.create_plan && evidence.action === 'proceed') {
      if (!parsed.adapter_id || !parsed.timeout_ms || parsed.verification_plan === undefined || parsed.rollback_plan === undefined) {
        result.disposition = 'CLARIFY';
        result.reason = 'PLAN_FIELDS_REQUIRED';
        result.next_allowed_action = 'provide_plan_fields';
      } else {
        const authorization = this.options.authorizationService.authorize({
          decision_id: parsed.decision_id ?? String(result.decision_id),
          capability_id: parsed.capability_id,
          capability_version: parsed.capability_version,
          adapter_id: parsed.adapter_id,
          normalized_inputs: parsed.normalized_inputs,
          guard_run_id: evidence.guard_run_id,
          timeout_ms: parsed.timeout_ms,
          verification_plan: parsed.verification_plan,
          rollback_plan: parsed.rollback_plan,
          requested_by: 'agent-pilot',
          ...(parsed.correlation_id ? { correlation_id: parsed.correlation_id } : {}),
        });
        const record = this.options.authorizationService.getAuthorizationRecord(authorization.plan.plan_id);
        result.plan = record ? sanitizePlanRecord(record) : {
          plan_id: authorization.plan.plan_id,
          state: authorization.plan.state,
          approval_required: authorization.required_approval,
        };
        result.next_allowed_action = authorization.required_approval ? 'human_approval' : 'observe';
      }
    }
    return result;
  }

  inspect(planId: string) {
    const record = this.options.authorizationService.getAuthorizationRecord(planId);
    if (!record) return null;
    return sanitizePlanRecord(record);
  }

  history() {
    return this.options.authorizationService.listAuthorizationRecords().map((record) => ({
      ...sanitizePlanRecord(record),
      outcome: this.options.verificationRuntime?.observePlan(record.plan.plan_id) ?? null,
    }));
  }

  outcome(planId: string) {
    if (!this.options.verificationRuntime) return null;
    return this.options.verificationRuntime.observePlan(planId);
  }
}
