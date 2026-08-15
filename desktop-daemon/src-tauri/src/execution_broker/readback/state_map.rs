//! Goal24 Checkpoint 8 (Integration) - cross-language execution state mapping.
//!
//! Mirrors `brain-server/src/outcome/execution-state-map.ts` exactly. The
//! shared golden vectors live in
//! `docs/goal24/fixtures/cp8-outcome/execution-state-mapping.json` and both
//! the Rust and Brain test suites validate them (0 mismatches).
//!
//! CRITICAL RULE: a recovered `accepted` receipt defaults to
//! `unknown_after_crash` - the OS process may have spawned and produced an
//! external effect before the spawn marker reached durable storage. Only a
//! provable `spawn_failed` (strict proof the child was never created) maps
//! to `not_started`.

use serde::{Deserialize, Serialize};

use super::types::ExecutionReceiptState;

/// Brain ExecutionEffectState vocabulary (snake_case wire form).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionEffectState {
    NotStarted,
    SpawnStarted,
    ProcessSucceeded,
    ProcessFailed,
    TimedOut,
    Cancelled,
    UnknownAfterCrash,
}

impl ExecutionEffectState {
    pub fn as_str(&self) -> &'static str {
        match self {
            ExecutionEffectState::NotStarted => "not_started",
            ExecutionEffectState::SpawnStarted => "spawn_started",
            ExecutionEffectState::ProcessSucceeded => "process_succeeded",
            ExecutionEffectState::ProcessFailed => "process_failed",
            ExecutionEffectState::TimedOut => "timed_out",
            ExecutionEffectState::Cancelled => "cancelled",
            ExecutionEffectState::UnknownAfterCrash => "unknown_after_crash",
        }
    }
}

/// Stable machine-readable mapping failure codes (shared with the Brain).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStateMappingError {
    InvalidFlags,
    MissingExitCode,
    InconsistentSpawnFailed,
    InconsistentAccepted,
    InconsistentLiveSpawn,
    InconsistentCrash,
    InFlight,
}

impl ExecutionStateMappingError {
    pub fn as_str(&self) -> &'static str {
        match self {
            ExecutionStateMappingError::InvalidFlags => "invalid_flags",
            ExecutionStateMappingError::MissingExitCode => "missing_exit_code",
            ExecutionStateMappingError::InconsistentSpawnFailed => "inconsistent_spawn_failed",
            ExecutionStateMappingError::InconsistentAccepted => "inconsistent_accepted",
            ExecutionStateMappingError::InconsistentLiveSpawn => "inconsistent_live_spawn",
            ExecutionStateMappingError::InconsistentCrash => "inconsistent_crash",
            ExecutionStateMappingError::InFlight => "in_flight",
        }
    }
}

pub type MappingResult = Result<ExecutionEffectState, ExecutionStateMappingError>;

/// Pure mapping shared with the Brain (see the TS twin for the full
/// semantic contract). Precedence: timeout > cancel > exit code; a
/// recovered accepted / spawn_started receipt is unknown_after_crash; a
/// live accepted receipt is not materializable yet.
pub fn map_state_to_effect_state(
    state: ExecutionReceiptState,
    recovered: bool,
    exit_code: Option<i32>,
    timed_out: bool,
    cancelled: bool,
    spawn_started_at_present: bool,
) -> MappingResult {
    if timed_out && cancelled {
        return Err(ExecutionStateMappingError::InvalidFlags);
    }
    match state {
        ExecutionReceiptState::Completed => {
            if timed_out {
                return Ok(ExecutionEffectState::TimedOut);
            }
            if cancelled {
                return Ok(ExecutionEffectState::Cancelled);
            }
            match exit_code {
                Some(0) => Ok(ExecutionEffectState::ProcessSucceeded),
                Some(_) => Ok(ExecutionEffectState::ProcessFailed),
                None => Err(ExecutionStateMappingError::MissingExitCode),
            }
        }
        ExecutionReceiptState::SpawnFailed => {
            if spawn_started_at_present || exit_code.is_some() || timed_out || cancelled {
                return Err(ExecutionStateMappingError::InconsistentSpawnFailed);
            }
            Ok(ExecutionEffectState::NotStarted)
        }
        ExecutionReceiptState::UnknownAfterCrash => {
            if exit_code.is_some() || timed_out || cancelled {
                return Err(ExecutionStateMappingError::InconsistentCrash);
            }
            Ok(ExecutionEffectState::UnknownAfterCrash)
        }
        ExecutionReceiptState::SpawnStarted => {
            if recovered {
                if exit_code.is_some() || timed_out || cancelled {
                    return Err(ExecutionStateMappingError::InconsistentCrash);
                }
                return Ok(ExecutionEffectState::UnknownAfterCrash);
            }
            if exit_code.is_some() || timed_out || cancelled {
                return Err(ExecutionStateMappingError::InconsistentLiveSpawn);
            }
            Ok(ExecutionEffectState::SpawnStarted)
        }
        ExecutionReceiptState::Accepted => {
            if recovered {
                if exit_code.is_some() || timed_out || cancelled || spawn_started_at_present {
                    return Err(ExecutionStateMappingError::InconsistentCrash);
                }
                // A recovered accepted receipt must never be read as "no
                // effect": spawn + effect + crash-before-fsync is possible.
                return Ok(ExecutionEffectState::UnknownAfterCrash);
            }
            if spawn_started_at_present {
                return Err(ExecutionStateMappingError::InconsistentAccepted);
            }
            // Live, in-flight, pre-spawn: not materializable yet.
            Err(ExecutionStateMappingError::InFlight)
        }
    }
}

/// Native read-back eligibility: only states after an observed spawn (or a
/// crash that may have spawned) carry an observable post-state.
pub fn is_readback_eligible(state: ExecutionReceiptState, _recovered: bool) -> bool {
    matches!(
        state,
        ExecutionReceiptState::SpawnStarted
            | ExecutionReceiptState::Completed
            | ExecutionReceiptState::UnknownAfterCrash
    )
}
