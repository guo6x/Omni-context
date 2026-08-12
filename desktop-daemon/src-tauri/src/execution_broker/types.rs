//! Goal24 Checkpoint 3 — Broker wire-contract mirror and result types.
//!
//! The broker must never trust that a plan has already been validated by the
//! TypeScript contract layer. Every inbound ExecutionPlan is re-parsed into
//! these strict Rust types (`#[serde(deny_unknown_fields)]`) and re-checked by
//! the broker gate before any process is spawned.
//!
//! Field names, enums and semantics mirror `brain-server/src/execution/contracts.ts`
//! and `brain-server/src/capabilities/contracts.ts` exactly. No semantic
//! re-definition happens here.

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Contract constants (mirrored from the TypeScript contracts)
// ---------------------------------------------------------------------------

/// `ExecutionPlan.timeout_ms` lower bound (TypeScript `TIMEOUT_MIN_MS`).
pub const TIMEOUT_MIN_MS: u64 = 100;
/// `ExecutionPlan.timeout_ms` upper bound (TypeScript `TIMEOUT_MAX_MS`, 24h).
pub const TIMEOUT_MAX_MS: u64 = 86_400_000;

/// Reserved top-level `normalized_inputs` keys (TypeScript `FORBIDDEN_INPUT_KEYS`).
pub const FORBIDDEN_INPUT_KEYS: &[&str] = &[
    "shell",
    "command",
    "exec",
    "bash",
    "powershell",
    "cmd",
    "cmdline",
    "script",
];

/// First capability-id segments reserved for transports (TypeScript contract).
pub const RESERVED_CAPABILITY_PREFIXES: &[&str] = &[
    "cli",
    "mcp",
    "api",
    "http",
    "transport",
    "shell",
    "exec",
    "cmd",
];

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/// `ExecutionPlan.state` (TypeScript `EXECUTION_PLAN_STATES`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionPlanStateWire {
    Draft,
    AwaitingApproval,
    Ready,
    Executing,
    Succeeded,
    Failed,
    Blocked,
    Cancelled,
}

/// `RiskSnapshot.side_effect_class` (TypeScript `SIDE_EFFECT_CLASSES`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SideEffectClassWire {
    ReadOnly,
    ReversibleWrite,
    DestructiveWrite,
    ExternalEffect,
}

/// `RiskSnapshot.required_authority` (TypeScript `AUTHORITY_LEVELS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthorityLevelWire {
    L0,
    L1,
    L2,
    L3,
}

/// `RiskSnapshot.risk_level` (TypeScript `RISK_LEVELS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevelWire {
    Low,
    Medium,
    High,
}

/// `EvidenceCoverageEntry.status` (TypeScript `EVIDENCE_STATUSES`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceStatusWire {
    Present,
    Missing,
    Stale,
    Conflicted,
    Unverified,
}

/// `EvidenceCoverageEntry.verification_level` (TypeScript `VERIFICATION_REQUIREMENTS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationLevelWire {
    None,
    Asserted,
    Verified,
}

// ---------------------------------------------------------------------------
// Nested contract mirrors
// ---------------------------------------------------------------------------

/// Mirror of `ApprovalReferenceSchema` (schema only; CP3 never treats the
/// structural presence of an approval as validated approval).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovalReferenceWire {
    pub approval_id: String,
    pub plan_id: String,
    pub granted_by: String,
    pub granted_at: String,
    pub policy_version: String,
    /// Opaque reference to the stored approval record (no raw token).
    pub token_reference: String,
    /// Opaque digest placeholder (real computation is Checkpoint 7).
    pub token_digest: String,
}

/// Mirror of `RiskSnapshotSchema`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RiskSnapshotWire {
    pub risk_level: RiskLevelWire,
    pub reversible: bool,
    pub side_effect_class: SideEffectClassWire,
    pub required_authority: AuthorityLevelWire,
    pub capability_version: String,
}

/// Mirror of `EvidenceCoverageEntrySchema`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceCoverageEntryWire {
    pub evidence_class: String,
    pub status: EvidenceStatusWire,
    pub verification_level: VerificationLevelWire,
    pub evidence_ids: Vec<String>,
    pub checked_at: String,
    #[serde(default)]
    pub stale_since: Option<String>,
    #[serde(default)]
    pub conflict_evidence_ids: Option<Vec<String>>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Mirror of `EvidenceCoverageSnapshotSchema`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceCoverageSnapshotWire {
    pub entries: Vec<EvidenceCoverageEntryWire>,
}

/// Mirror of `VerificationPlanSchema`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VerificationPlanWire {
    pub verification_capability_id: String,
    pub verification_inputs: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub description: Option<String>,
}

/// Mirror of `RollbackPlanSchema`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RollbackPlanWire {
    pub rollback_capability_id: String,
    pub rollback_inputs: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub description: Option<String>,
}

// ---------------------------------------------------------------------------
// ExecutionPlan mirror
// ---------------------------------------------------------------------------

/// Strict Rust mirror of `ExecutionPlanSchema` (`brain-server/src/execution/contracts.ts`).
///
/// Only `state=ready` plans are accepted by the CP3 broker's first-spawn entry;
/// `state=executing` is rejected as a replay guard even though the TypeScript
/// contract lists both `ready` and `executing` as executable states.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionPlanWire {
    pub plan_id: String,
    pub decision_id: String,
    pub capability_id: String,
    pub capability_version: String,
    pub adapter_id: String,
    pub normalized_inputs: serde_json::Map<String, serde_json::Value>,
    pub required_approval: bool,
    pub approval: Option<ApprovalReferenceWire>,
    pub risk_snapshot: RiskSnapshotWire,
    pub evidence_coverage_snapshot: EvidenceCoverageSnapshotWire,
    pub timeout_ms: u64,
    pub verification_plan: Option<VerificationPlanWire>,
    pub rollback_plan: Option<RollbackPlanWire>,
    pub state: ExecutionPlanStateWire,
    pub created_at: String,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub correlation_id: Option<String>,
    #[serde(default)]
    pub requested_by: Option<String>,
}

/// Identifier validation helpers (mirror the TypeScript regexes without
/// pulling in a regex dependency).
impl ExecutionPlanWire {
    /// `PLAN_ID_PATTERN`: `^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$`.
    pub fn valid_plan_id(id: &str) -> bool {
        let bytes = id.as_bytes();
        if bytes.len() < 8 || bytes.len() > 200 {
            return false;
        }
        if !bytes[0].is_ascii_alphanumeric() {
            return false;
        }
        bytes[1..]
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-')
    }

    /// `ADAPTER_ID_PATTERN`: `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`.
    pub fn valid_adapter_id(id: &str) -> bool {
        if id.is_empty() || !id.as_bytes()[0].is_ascii_lowercase() {
            return false;
        }
        let mut after_dash = false;
        for b in id.as_bytes() {
            if after_dash {
                if !b.is_ascii_lowercase() && !b.is_ascii_digit() {
                    return false;
                }
                after_dash = false;
            } else if *b == b'-' {
                after_dash = true;
            } else if !b.is_ascii_lowercase() && !b.is_ascii_digit() {
                return false;
            }
        }
        !after_dash
    }

    /// `CAPABILITY_ID_PATTERN`: `^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,4}$`
    /// and the reserved first-segment rule from the capability contract.
    pub fn valid_capability_id(id: &str) -> bool {
        let segments: Vec<&str> = id.split('.').collect();
        if segments.len() < 3 || segments.len() > 5 {
            return false;
        }
        if !segments.iter().all(|s| {
            !s.is_empty()
                && s.as_bytes()[0].is_ascii_lowercase()
                && s.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        }) {
            return false;
        }
        !RESERVED_CAPABILITY_PREFIXES.contains(&segments[0])
    }

    /// `SEMVER_PATTERN`: `^\d+\.\d+\.\d+$`.
    pub fn valid_semver(v: &str) -> bool {
        let parts: Vec<&str> = v.split('.').collect();
        parts.len() == 3
            && parts
                .iter()
                .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
    }
}

// ---------------------------------------------------------------------------
// Broker error codes
// ---------------------------------------------------------------------------

/// Machine-readable broker error codes (CP3 required set plus one extension:
/// `UNKNOWN_EXECUTION` for cancellation of an unknown execution id).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidPlan,
    PlanNotReady,
    PlanExpired,
    ApprovalEnforcementNotAvailable,
    UnknownBinding,
    CapabilityBindingMismatch,
    AdapterBindingMismatch,
    ExecutableNotAllowed,
    ExecutableNotFound,
    ExecutableChanged,
    CwdNotAllowed,
    InvalidArguments,
    SpawnFailed,
    Timeout,
    Cancelled,
    OutputLimit,
    ProcessTreeFailure,
    UnknownExecution,
    InternalError,
}

/// Structured broker error. `message` is a short, non-sensitive description.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerError {
    pub code: ErrorCode,
    pub message: String,
}

impl BrokerError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for BrokerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for BrokerError {}

// ---------------------------------------------------------------------------
// Execution result
// ---------------------------------------------------------------------------

/// Structured result of one broker execution. Returned for every completed
/// spawn (including timeout and cancellation); gate failures return
/// `Err(BrokerError)` instead.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerExecutionResult {
    pub execution_id: String,
    pub plan_id: String,
    pub capability_id: String,
    pub adapter_id: String,
    /// RFC3339 timestamps (UTC).
    pub started_at: String,
    pub finished_at: String,
    pub duration_ms: u64,
    /// Resolved absolute executable path used for the spawn.
    pub resolved_executable: String,
    /// Recorded executable identity (path, size, mtime).
    pub executable_fingerprint: String,
    /// `None` when the process was terminated by timeout/cancel before exit.
    pub exit_code: Option<i32>,
    /// True when the process exited 0 and was not timed out or cancelled.
    pub success: bool,
    pub timed_out: bool,
    pub cancelled: bool,
    /// Bounded captured stdout (UTF-8 lossy, truncated at the output limit).
    pub stdout: String,
    /// Bounded captured stderr (UTF-8 lossy, truncated at the output limit).
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub stdout_bytes_seen: u64,
    pub stderr_bytes_seen: u64,
    /// Present when the execution failed with a machine-readable code.
    pub error_code: Option<ErrorCode>,
    pub error_message: Option<String>,
}
