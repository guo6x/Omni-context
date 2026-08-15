/**
 * Goal24 Checkpoint 8 (Integration) - cross-language execution state mapping.
 *
 * The native receipt lifecycle states (accepted / spawn_started / completed /
 * spawn_failed / unknown_after_crash) are process lifecycle facts. The Brain
 * ExecutionEffectState vocabulary describes what the local runtime knows
 * about the process for OUTCOME purposes. The trusted bridge materializes the
 * narrow TrustedExecutionReceipt from the native receipt through exactly this
 * mapping; the shared golden vectors live in
 * docs/goal24/fixtures/cp8-outcome/execution-state-mapping.json and BOTH the
 * Brain test suite and the Rust test suite validate them (0 mismatches).
 *
 * CRITICAL RULE: a recovered `accepted` receipt defaults to
 * `unknown_after_crash` - the OS process may have spawned and produced an
 * external effect before the spawn marker reached durable storage. Only a
 * provable `spawn_failed` (strict proof the child was never created) maps to
 * `not_started`.
 */

import type { ExecutionEffectState } from './contracts.js';

/** Native receipt lifecycle states (mirror of the Rust ExecutionReceiptState). */
export const NATIVE_EXECUTION_RECEIPT_STATES = [
  'accepted',
  'spawn_started',
  'completed',
  'spawn_failed',
  'unknown_after_crash',
] as const;
export type NativeExecutionReceiptState = (typeof NATIVE_EXECUTION_RECEIPT_STATES)[number];

/** Stable machine-readable mapping failure codes (shared with Rust). */
export const EXECUTION_STATE_MAPPING_ERRORS = [
  'invalid_flags',
  'missing_exit_code',
  'inconsistent_spawn_failed',
  'inconsistent_accepted',
  'inconsistent_live_spawn',
  'inconsistent_crash',
  'in_flight',
] as const;
export type ExecutionStateMappingError = (typeof EXECUTION_STATE_MAPPING_ERRORS)[number];

export interface NativeStateMappingInput {
  /** The persisted native receipt lifecycle state. */
  state: NativeExecutionReceiptState;
  /** True when the receipt was recovered across a process restart. */
  recovered: boolean;
  exit_code: number | undefined;
  timed_out: boolean;
  cancelled: boolean;
  /** True when the receipt carries a spawn marker (spawn_started_at). */
  spawn_started_at_present: boolean;
}

export type ExecutionStateMappingResult =
  | { ok: true; effect_state: ExecutionEffectState }
  | { ok: false; error: ExecutionStateMappingError };

/**
 * Pure mapping shared with the native layer. Semantics:
 * - completed + timeout -> timed_out (precedence over exit code)
 * - completed + cancel -> cancelled (precedence over exit code)
 * - completed + exit 0 -> process_succeeded, nonzero -> process_failed
 * - spawn_failed -> not_started (strict proof the child never existed)
 * - recovered accepted / recovered spawn_started -> unknown_after_crash
 * - live spawn_started -> spawn_started (in-flight, read-back eligible)
 * - live accepted -> not materializable yet (in-flight; never "no effect")
 * - unknown_after_crash -> unknown_after_crash (no flags / exit may ride on it)
 */
export function mapNativeStateToEffectState(input: NativeStateMappingInput): ExecutionStateMappingResult {
  const { state, recovered, exit_code, timed_out, cancelled, spawn_started_at_present } = input;
  if (timed_out && cancelled) {
    return { ok: false, error: 'invalid_flags' };
  }
  switch (state) {
    case 'completed': {
      if (timed_out) return { ok: true, effect_state: 'timed_out' };
      if (cancelled) return { ok: true, effect_state: 'cancelled' };
      if (exit_code === undefined) return { ok: false, error: 'missing_exit_code' };
      return exit_code === 0
        ? { ok: true, effect_state: 'process_succeeded' }
        : { ok: true, effect_state: 'process_failed' };
    }
    case 'spawn_failed':
      if (spawn_started_at_present || exit_code !== undefined || timed_out || cancelled) {
        return { ok: false, error: 'inconsistent_spawn_failed' };
      }
      return { ok: true, effect_state: 'not_started' };
    case 'unknown_after_crash':
      if (exit_code !== undefined || timed_out || cancelled) {
        return { ok: false, error: 'inconsistent_crash' };
      }
      return { ok: true, effect_state: 'unknown_after_crash' };
    case 'spawn_started':
      if (recovered) {
        if (exit_code !== undefined || timed_out || cancelled) {
          return { ok: false, error: 'inconsistent_crash' };
        }
        return { ok: true, effect_state: 'unknown_after_crash' };
      }
      if (exit_code !== undefined || timed_out || cancelled) {
        return { ok: false, error: 'inconsistent_live_spawn' };
      }
      return { ok: true, effect_state: 'spawn_started' };
    case 'accepted':
      if (recovered) {
        if (exit_code !== undefined || timed_out || cancelled || spawn_started_at_present) {
          return { ok: false, error: 'inconsistent_crash' };
        }
        // A recovered accepted receipt must never be read as "no effect":
        // spawn + effect + crash-before-fsync is possible.
        return { ok: true, effect_state: 'unknown_after_crash' };
      }
      if (spawn_started_at_present) {
        return { ok: false, error: 'inconsistent_accepted' };
      }
      // Live, in-flight, pre-spawn: the outcome pipeline must not materialize
      // an outcome yet (the execution lifecycle has not finished).
      return { ok: false, error: 'in_flight' };
  }
}

/**
 * Read-back eligibility on the native side: only states after an observed
 * spawn (or a crash that may have spawned) carry an observable post-state.
 */
export function isNativeReadbackEligible(state: NativeExecutionReceiptState, recovered: boolean): boolean {
  void recovered;
  switch (state) {
    case 'accepted':
    case 'spawn_failed':
      return false;
    case 'spawn_started':
    case 'completed':
    case 'unknown_after_crash':
      return true;
  }
}
