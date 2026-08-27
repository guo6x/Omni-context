//! Goal24 Checkpoint 8 (Lane B) - native execution receipt and read-back
//! verification types.
//!
//! Receipts and observations are native/server-owned. A caller can only
//! present a `receipt_id`; the trusted store record is the only execution
//! authority. No type in this module carries a shell command or an
//! `outcome_verified` claim.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::execution_broker::types::ErrorCode;

/// Receipt store file schema version (strict parse; anything else is
/// `BROKER_RECEIPT_STORE_CORRUPT`).
pub const RECEIPT_STORE_FILE_VERSION: u32 = 1;

/// Hard native ceiling for verification attempts per receipt. Integration /
/// Brain policy is expected to be stricter (3); the native primitive only
/// enforces the hard bound and never retries by itself.
pub const MAX_VERIFICATION_ATTEMPTS: usize = 5;

/// Compiled read-back timeout. Callers can never set a timeout, executable,
/// argv, cwd, env or expected result for a read-back.
pub const READBACK_TIMEOUT_MS: u64 = 30_000;

/// Receipt id prefix (followed by 32 random hex chars).
pub const RECEIPT_ID_PREFIX: &str = "rcpt_";

/// Attempt id prefix for native-generated attempt ids.
pub const ATTEMPT_ID_PREFIX: &str = "rbattempt_";

/// Lifecycle state of one broker execution receipt.
///
/// `success` on `BrokerExecutionResult` only ever means "process exited 0";
/// the receipt states describe *what was durably observed about the process
/// lifecycle*, never whether the external outcome is verified.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionReceiptState {
    /// Durably created after CP7 reservation/consumption, before spawn.
    Accepted,
    /// The OS process was observed as successfully created.
    SpawnStarted,
    /// The process lifecycle finished (exit / timeout / cancel) and the
    /// bounded output metadata was recorded.
    Completed,
    /// A pre-spawn gate failed; provably no OS process was created.
    SpawnFailed,
    /// Restart recovery: a previous run left the receipt mid-flight. Whether
    /// an external effect occurred is unknown and must be read back.
    UnknownAfterCrash,
}

/// Machine-readable parser status for a read-back observation. The native
/// layer only reports parsing/truncation; semantic comparison belongs to the
/// Brain evaluator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadbackParserStatus {
    /// The trusted binding parser produced a structured JSON-safe payload
    /// from non-truncated output.
    Parsed,
    /// The trusted binding parser could not produce a structured payload.
    Malformed,
    /// Output was truncated at the broker cap; the payload is incomplete and
    /// must not be treated as a complete observation.
    Truncated,
}

/// Durable state of one verification attempt (replay + bounded retries).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttemptStatus {
    /// Reserved before the read-back process is spawned (write-ahead).
    Running,
    /// The observation was acquired and persisted.
    Completed,
    /// The read-back process could not produce an observation.
    Failed,
}

/// One reserved verification attempt. Attempt ids are single-use: the same
/// id can never execute twice, across restarts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationAttemptRecord {
    pub attempt_id: String,
    pub status: AttemptStatus,
    pub started_at: String,
    #[serde(default)]
    pub observed_at: Option<String>,
    #[serde(default)]
    pub payload_digest: Option<String>,
    #[serde(default)]
    pub parser_status: Option<ReadbackParserStatus>,
    #[serde(default)]
    pub error_code: Option<ErrorCode>,
}

fn default_receipt_source() -> String {
    "native_broker".to_string()
}

/// Native-owned persistent execution receipt.
///
/// Identity fields (plan / capability / digests / verification linkage) are
/// immutable after creation; only lifecycle fields change through the legal
/// transitions in `receipt.rs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionReceipt {
    pub receipt_id: String,
    pub plan_id: String,
    pub decision_id: String,
    /// Authority marker: receipts can only ever originate from the native
    /// broker. The Brain contract requires this literal and rejects anything
    /// else.
    #[serde(default = "default_receipt_source")]
    pub source: String,
    pub capability_id: String,
    pub capability_version: String,
    pub adapter_id: String,
    pub binding_id: String,
    #[serde(default)]
    pub execution_id: Option<String>,
    /// SHA-256 over the canonical JSON of the approved `normalized_inputs`.
    pub normalized_inputs_digest: String,
    /// SHA-256 over the canonical JSON of the full `verification_plan`
    /// object (same definition as the CP7 approval binding), or `None`.
    pub verification_plan_digest: Option<String>,
    /// Trusted copy of the plan's verification capability. Never caller
    /// supplied at read-back time.
    #[serde(default)]
    pub verification_capability_id: Option<String>,
    /// Trusted copy of the plan's verification inputs (native-owned).
    #[serde(default)]
    pub verification_inputs: Option<Map<String, Value>>,
    pub execution_state: ExecutionReceiptState,
    pub accepted_at: String,
    #[serde(default)]
    pub spawn_started_at: Option<String>,
    #[serde(default)]
    pub finished_at: Option<String>,
    #[serde(default)]
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub cancelled: bool,
    #[serde(default)]
    pub stdout_digest: Option<String>,
    #[serde(default)]
    pub stderr_digest: Option<String>,
    pub output_truncated: bool,
    pub output_redacted: bool,
    #[serde(default)]
    pub resolved_executable_fingerprint: Option<String>,
    /// SHA-256 over the canonical JSON of the immutable identity fields.
    /// Validated on every load and read-back; a mismatch fails closed.
    pub receipt_digest: String,
    #[serde(default)]
    pub verification_attempts: Vec<VerificationAttemptRecord>,
}

/// Raw bounded, redacted output handed to a `ReadbackBinding::parse`.
/// `stderr`/`output_redacted` are part of the trusted parser input surface;
/// the built-in parsers only consume the JSON stdout segment.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ReadbackRawOutput {
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub output_redacted: bool,
}

impl ReadbackRawOutput {
    /// True when either captured stream hit the broker output cap.
    pub fn truncated(&self) -> bool {
        self.stdout_truncated || self.stderr_truncated
    }
}

/// Structured parse result produced by a trusted read-back binding.
#[derive(Debug, Clone)]
pub struct ReadbackParseResult {
    /// JSON-safe payload. `Value::Null` when parsing failed.
    pub payload: Value,
    /// `Parsed` or `Malformed`; the runner upgrades `Parsed` to `Truncated`
    /// when the source output was truncated.
    pub status: ReadbackParserStatus,
}

/// The native read-back observation envelope. Contains NO `verified` field:
/// the native layer only acquires observations; the Brain evaluator decides
/// semantic outcome.
#[derive(Debug, Clone, Serialize)]
pub struct ReadbackObservationEnvelope {
    pub observation_id: String,
    /// Canonical attempt binding id (the Brain contract's native_attempt_id
    /// alias denotes this exact value).
    pub verification_attempt_id: String,
    pub origin_plan_id: String,
    pub origin_execution_receipt_id: String,
    pub verification_capability_id: String,
    /// Trusted origin marker consumed by the Brain outcome contract. This is
    /// always `native_readback`; the semantic evaluator still decides the
    /// outcome and this field never means VERIFIED by itself.
    pub verification_source: String,
    /// Strength of the acquired provider observation. The compiled read-back
    /// binding is authenticated and therefore emits `verified`, while the
    /// Brain evaluator remains the only outcome authority.
    pub verification_level: String,
    pub subject_key: String,
    /// Trusted native clock: the durable attempt reservation timestamp.
    pub attempt_started_at: String,
    pub observed_at: String,
    pub payload: Value,
    pub payload_digest: String,
    pub parser_status: ReadbackParserStatus,
    pub truncated: bool,
    pub source_adapter: String,
    pub source_binding: String,
    pub process_exit_code: Option<i32>,
    pub process_timed_out: bool,
    pub process_cancelled: bool,
    pub resolved_executable_fingerprint: String,
    pub process_duration_ms: u64,
}
