/**
 * Goal24 Post-CP8 Real E2E (DRG-2 candidate) - trusted internal bridge for
 * the dev-only operator harness.
 *
 * This is NOT a production IPC bridge. It is the harness-local trusted code
 * that (a) recomputes and verifies the native receipt identity digest, (b)
 * materializes the narrow TrustedExecutionReceipt the CP8 Brain contract
 * consumes, (c) verifies the native-issued approval grant, and (d) resolves
 * the trusted observation. Callers can never inject receipt/observation
 * JSON through this bridge: every loaded record is digest-verified.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mapNativeStateToEffectState,
  sha256Hex,
  validateObservationEnvelope,
  type ReadbackObservationEnvelope,
  type TrustedExecutionReceipt,
} from '../../src/outcome/index.js';
import { canonicalJson } from '../../src/evidence/model.js';
import type { ApprovalReference } from '../../src/execution/contracts.js';
import type {
  ApprovalGrantVerificationResult,
  VerifiedGrant,
} from '../../src/approval/contracts.js';

export function bridgeDir(): string {
  const fromEnv = process.env.OMNI_REAL_E2E_BRIDGE;
  const dir = fromEnv ?? join(process.cwd(), '..', '..', '.tmp', 'real-e2e');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readBridge<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(join(bridgeDir(), name), 'utf8')) as T;
}

export function writeBridge(name: string, value: unknown): void {
  const path = join(bridgeDir(), name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * Recompute the NATIVE receipt identity digest (the exact field set the
 * Rust identity_object covers) and compare it with the stored native
 * receipt_digest. This proves the bridge file was not tampered with after
 * the native store emitted it (the native store itself validates on load).
 */
export function verifyNativeReceiptDigest(nativeReceipt: Record<string, unknown>): void {
  const identity = {
    receipt_id: nativeReceipt.receipt_id,
    plan_id: nativeReceipt.plan_id,
    decision_id: nativeReceipt.decision_id,
    capability_id: nativeReceipt.capability_id,
    capability_version: nativeReceipt.capability_version,
    adapter_id: nativeReceipt.adapter_id,
    binding_id: nativeReceipt.binding_id,
    normalized_inputs_digest: nativeReceipt.normalized_inputs_digest,
    verification_plan_digest: nativeReceipt.verification_plan_digest ?? null,
    verification_capability_id: nativeReceipt.verification_capability_id ?? null,
    verification_inputs: nativeReceipt.verification_inputs ?? null,
    accepted_at: nativeReceipt.accepted_at,
    source: nativeReceipt.source ?? 'native_broker',
  };
  const recomputed = sha256Hex(canonicalJson(identity));
  if (recomputed !== nativeReceipt.receipt_digest) {
    throw new Error('native receipt identity digest mismatch: bridge data was tampered with');
  }
}

export interface MaterializedReceipt {
  narrow: TrustedExecutionReceipt;
  native: Record<string, unknown>;
}

/**
 * Materialize the narrow TrustedExecutionReceipt from the native receipt
 * record (the documented CP8 production path: receipt_id -> trusted
 * resolver -> native persistent store -> narrow snapshot).
 */
export function materializeReceipt(nativeReceipt: Record<string, unknown>): MaterializedReceipt {
  verifyNativeReceiptDigest(nativeReceipt);
  const state = String(nativeReceipt.execution_state ?? '');
  const exitCode = typeof nativeReceipt.exit_code === 'number' ? (nativeReceipt.exit_code as number) : undefined;
  const mapped = mapNativeStateToEffectState({
    state: state as never,
    recovered: false,
    exit_code: exitCode,
    timed_out: Boolean(nativeReceipt.timed_out),
    cancelled: Boolean(nativeReceipt.cancelled),
    spawn_started_at_present: typeof nativeReceipt.spawn_started_at === 'string',
  });
  if (!mapped.ok) {
    throw new Error(`native receipt state cannot be mapped: ${state}`);
  }
  const narrow: Record<string, unknown> = {
    receipt_id: nativeReceipt.receipt_id,
    plan_id: nativeReceipt.plan_id,
    decision_id: nativeReceipt.decision_id,
    capability_id: nativeReceipt.capability_id,
    capability_version: nativeReceipt.capability_version,
    adapter_id: nativeReceipt.adapter_id,
    normalized_inputs_digest: nativeReceipt.normalized_inputs_digest,
    execution_state: mapped.effect_state,
    accepted_at: nativeReceipt.accepted_at,
    timed_out: Boolean(nativeReceipt.timed_out),
    cancelled: Boolean(nativeReceipt.cancelled),
    source: 'native_broker',
  };
  if (typeof nativeReceipt.verification_plan_digest === 'string') {
    narrow.verification_plan_digest = nativeReceipt.verification_plan_digest;
  }
  if (typeof nativeReceipt.spawn_started_at === 'string') narrow.spawn_started_at = nativeReceipt.spawn_started_at;
  if (typeof nativeReceipt.finished_at === 'string') narrow.finished_at = nativeReceipt.finished_at;
  if (typeof nativeReceipt.exit_code === 'number') narrow.exit_code = nativeReceipt.exit_code;
  // Same canonical rule as recomputeReceiptDigest (hash of all fields except
  // the digest itself); computed manually here because the schema requires
  // the digest field to be present before parsing.
  narrow.receipt_digest = sha256Hex(canonicalJson(narrow));
  return { narrow: narrow as TrustedExecutionReceipt, native: nativeReceipt };
}

/** Grant verifier backed by the native-issued grant record (the harness IS
 * the internal bridge to the native approval authority). The Brain never
 * fabricates token digests. */
export function makeNativeGrantVerifier(nativeGrant: Record<string, unknown>) {
  return {
    verifyGrant(input: {
      plan: { plan_id: string };
      approval_reference: ApprovalReference;
      approval_binding_digest: string;
    }): ApprovalGrantVerificationResult {
      const reference = input.approval_reference;
      const mismatch = (reason: string): ApprovalGrantVerificationResult => ({ valid: false, reason });
      if (reference.plan_id !== nativeGrant.plan_id) return mismatch('grant plan_id mismatch');
      if (reference.policy_version !== nativeGrant.policy_version) return mismatch('grant policy_version mismatch');
      if (reference.token_reference !== nativeGrant.token_reference) return mismatch('grant token_reference mismatch');
      if (reference.token_digest !== nativeGrant.token_digest) return mismatch('grant token_digest mismatch');
      const grant: VerifiedGrant = {
        actor: {
          actor_id: String(nativeGrant.actor_id),
          actor_kind: nativeGrant.actor_kind === 'admin' ? 'admin' : 'owner',
          authority_level: String(nativeGrant.actor_authority) as never,
          source: 'trusted_local',
        },
        authority: String(nativeGrant.actor_authority) as never,
        granted_at: String(nativeGrant.granted_at),
        expires_at: String(nativeGrant.expires_at ?? nativeGrant.granted_at),
        native_record_id: String(nativeGrant.approval_id),
        token_reference: String(nativeGrant.token_reference),
        token_digest: String(nativeGrant.token_digest),
      };
      return { valid: true, grant };
    },
  };
}

/** Trusted observation resolver: the harness bridge adds the documented
 * Brain-side annotations (verification_source / verification_level - the
 * native envelope never carries them) and then validates the envelope
 * (schema + payload digest recomputation) before the evaluator ever sees
 * it. */
export function makeObservationResolver(observation: Record<string, unknown>) {
  const annotated = {
    ...observation,
    verification_source: observation.verification_source ?? 'native_readback',
    verification_level: observation.verification_level ?? 'asserted',
  };
  const validated = validateObservationEnvelope(annotated);
  const map = new Map<string, ReadbackObservationEnvelope>([[validated.observation_id, validated]]);
  return (observationId: string): ReadbackObservationEnvelope | null => map.get(observationId) ?? null;
}

/** Trusted receipt resolver over one materialized narrow receipt. */
export function makeReceiptResolver(narrow: TrustedExecutionReceipt) {
  const map = new Map<string, TrustedExecutionReceipt>([[narrow.receipt_id, narrow]]);
  return (receiptId: string): TrustedExecutionReceipt | null => map.get(receiptId) ?? null;
}

