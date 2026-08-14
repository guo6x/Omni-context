//! Goal24 Checkpoint 8 (Lane B) - persistent native execution receipt store.
//!
//! The store path is trusted/injected (production wires Tauri app-data
//! later; CP8 tests use temp directories); callers can never submit a path.
//! Writes are serialized and atomic (temp file -> flush -> fsync -> rename)
//! and the backing file is protected by the same exclusive OS lock used by
//! the CP7 approval store. A corrupt store fails closed with
//! `BROKER_RECEIPT_STORE_CORRUPT`, is never deleted and is never treated as
//! an empty database.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::execution_broker::approval::digest::sha256_hex;
use crate::execution_broker::approval::lock::StoreFileLock;
use crate::execution_broker::types::{BrokerError, BrokerExecutionResult, ErrorCode};

use super::receipt::{transition_allowed, validate_receipt_structure};
use super::types::{
    AttemptStatus, ExecutionReceipt, ExecutionReceiptState, ReadbackParserStatus,
    VerificationAttemptRecord, MAX_VERIFICATION_ATTEMPTS, RECEIPT_STORE_FILE_VERSION,
};

#[derive(Debug, Serialize, Deserialize)]
struct ReceiptStoreFile {
    version: u32,
    receipts: Vec<ExecutionReceipt>,
}

fn corrupt(reason: &str) -> BrokerError {
    BrokerError::new(
        ErrorCode::BrokerReceiptStoreCorrupt,
        format!("receipt store corrupt: {reason}"),
    )
}

/// Atomic durable write: serialize, write temp file, flush, fsync, rename.
fn atomic_write(path: &PathBuf, bytes: &[u8]) -> Result<(), BrokerError> {
    let parent = path.parent().ok_or_else(|| {
        BrokerError::new(
            ErrorCode::BrokerReceiptStoreCorrupt,
            "receipt store path has no parent directory",
        )
    })?;
    std::fs::create_dir_all(parent).map_err(|err| {
        BrokerError::new(
            ErrorCode::BrokerReceiptStoreCorrupt,
            format!("cannot create receipt store directory: {err}"),
        )
    })?;
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, bytes).map_err(|err| {
        BrokerError::new(
            ErrorCode::BrokerReceiptStoreCorrupt,
            format!("cannot write receipt store temp file: {err}"),
        )
    })?;
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(&temp)
        .map_err(|err| {
            BrokerError::new(
                ErrorCode::BrokerReceiptStoreCorrupt,
                format!("cannot open receipt store temp file: {err}"),
            )
        })?;
    file.sync_all().map_err(|err| {
        BrokerError::new(
            ErrorCode::BrokerReceiptStoreCorrupt,
            format!("cannot fsync receipt store temp file: {err}"),
        )
    })?;
    drop(file);
    std::fs::rename(&temp, path).map_err(|err| {
        let _ = std::fs::remove_file(&temp);
        BrokerError::new(
            ErrorCode::BrokerReceiptStoreCorrupt,
            format!("cannot atomically rename receipt store: {err}"),
        )
    })?;
    Ok(())
}

/// The native receipt store. All records are native-owned; lookups are the
/// only execution authority a read-back accepts.
pub struct ReceiptStore {
    path: Option<PathBuf>,
    state: Mutex<BTreeMap<String, ExecutionReceipt>>,
    degraded: Mutex<Option<BrokerError>>,
    _lock: Option<StoreFileLock>,
}

impl ReceiptStore {
    /// Volatile in-memory store (used by `Broker::new`; unit tests only).
    pub fn in_memory() -> Self {
        Self {
            path: None,
            state: Mutex::new(BTreeMap::new()),
            degraded: Mutex::new(None),
            _lock: None,
        }
    }

    /// Open (or create) a persistent store at a trusted injected path. A
    /// missing file is a healthy empty store. Corruption or a failed
    /// single-instance lock acquisition degrades the store and every execute
    /// / read-back fails closed.
    pub fn persistent(path: PathBuf) -> Self {
        match Self::open(&path) {
            Ok(store) => store,
            Err(err) => Self {
                path: Some(path),
                state: Mutex::new(BTreeMap::new()),
                degraded: Mutex::new(Some(err)),
                _lock: None,
            },
        }
    }

    fn open(path: &PathBuf) -> Result<Self, BrokerError> {
        let lock_path = path.with_extension("lock");
        let lock = StoreFileLock::acquire(&lock_path)
            .map_err(|reason| corrupt(&format!("cannot acquire store lock: {reason}")))?;
        let mut receipts = match std::fs::read(path) {
            Ok(bytes) => {
                let parsed: ReceiptStoreFile = serde_json::from_slice(&bytes)
                    .map_err(|err| corrupt(&format!("cannot parse store json: {err}")))?;
                if parsed.version != RECEIPT_STORE_FILE_VERSION {
                    return Err(corrupt(&format!(
                        "unsupported store version {}",
                        parsed.version
                    )));
                }
                let mut map = BTreeMap::new();
                for receipt in parsed.receipts {
                    if map.contains_key(&receipt.receipt_id) {
                        return Err(corrupt(&format!(
                            "duplicate receipt_id {}",
                            receipt.receipt_id
                        )));
                    }
                    if map
                        .values()
                        .any(|existing: &ExecutionReceipt| existing.plan_id == receipt.plan_id)
                    {
                        return Err(corrupt(&format!("duplicate plan_id {}", receipt.plan_id)));
                    }
                    validate_receipt_structure(&receipt)?;
                    map.insert(receipt.receipt_id.clone(), receipt);
                }
                map
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(err) => return Err(corrupt(&format!("cannot read store file: {err}"))),
        };

        // -------------------------------------------------------------------
        // Restart recovery: receipts left mid-flight by a previous run can
        // never be claimed as "no effect" or as "completed". A crash between
        // OS process creation and the durable spawn marker means even an
        // `accepted` receipt cannot strictly prove "never spawned", so both
        // `accepted` and `spawn_started` migrate to `unknown_after_crash`.
        // -------------------------------------------------------------------
        let mut migrated = false;
        for receipt in receipts.values_mut() {
            if matches!(
                receipt.execution_state,
                ExecutionReceiptState::Accepted | ExecutionReceiptState::SpawnStarted
            ) {
                receipt.execution_state = ExecutionReceiptState::UnknownAfterCrash;
                migrated = true;
            }
        }
        let store = Self {
            path: Some(path.clone()),
            state: Mutex::new(receipts),
            degraded: Mutex::new(None),
            _lock: Some(lock),
        };
        if migrated {
            store.persist()?;
        }
        Ok(store)
    }

    /// True while the store is initialized and healthy.
    #[allow(dead_code)]
    pub fn is_healthy(&self) -> bool {
        self.degraded.lock().unwrap().is_none()
    }

    /// Degraded reason, when unhealthy.
    pub fn degradation(&self) -> Option<BrokerError> {
        self.degraded.lock().unwrap().clone()
    }

    /// Mark the store degraded (fail-closed; the store is never reset).
    pub(crate) fn degrade_for_test(&self, err: BrokerError) {
        let mut degraded = self.degraded.lock().unwrap();
        if degraded.is_none() {
            *degraded = Some(err);
        }
    }

    /// Serialize and atomically write the full snapshot. Never called while
    /// the state mutex is held (see the mutation helpers).
    fn persist(&self) -> Result<(), BrokerError> {
        let path = match &self.path {
            Some(path) => path.clone(),
            None => return Ok(()),
        };
        let mut receipts: Vec<ExecutionReceipt> = {
            let guard = self.state.lock().unwrap();
            guard.values().cloned().collect()
        };
        receipts.sort_by(|a, b| a.receipt_id.cmp(&b.receipt_id));
        let bytes = serde_json::to_vec_pretty(&ReceiptStoreFile {
            version: RECEIPT_STORE_FILE_VERSION,
            receipts,
        })
        .map_err(|err| corrupt(&format!("cannot serialize store: {err}")))?;
        atomic_write(&path, &bytes)
    }

    /// Persist after an in-memory mutation; on failure the store degrades so
    /// no caller can keep executing against unpersisted state.
    fn persist_or_degrade(&self) -> Result<(), BrokerError> {
        match self.persist() {
            Ok(()) => Ok(()),
            Err(err) => {
                self.degrade_for_test(err.clone());
                Err(err)
            }
        }
    }

    /// Durably insert a freshly built `accepted` receipt. The digest is
    /// re-verified and duplicates are rejected before any write.
    pub fn insert_accepted(&self, receipt: ExecutionReceipt) -> Result<(), BrokerError> {
        if let Some(err) = self.degradation() {
            return Err(err);
        }
        if receipt.execution_state != ExecutionReceiptState::Accepted {
            return Err(BrokerError::new(
                ErrorCode::ReceiptTransitionInvalid,
                "a new receipt must start in the accepted state",
            ));
        }
        validate_receipt_structure(&receipt)?;
        {
            let mut guard = self.state.lock().unwrap();
            if guard.contains_key(&receipt.receipt_id) {
                return Err(BrokerError::new(
                    ErrorCode::BrokerReceiptStoreCorrupt,
                    "duplicate receipt_id",
                ));
            }
            if guard
                .values()
                .any(|existing| existing.plan_id == receipt.plan_id)
            {
                return Err(BrokerError::new(
                    ErrorCode::BrokerReceiptStoreCorrupt,
                    "duplicate plan_id",
                ));
            }
            guard.insert(receipt.receipt_id.clone(), receipt);
        }
        self.persist_or_degrade()
    }

    /// Look up one receipt.
    pub fn get(&self, receipt_id: &str) -> Result<Option<ExecutionReceipt>, BrokerError> {
        if let Some(err) = self.degradation() {
            return Err(err);
        }
        Ok(self.state.lock().unwrap().get(receipt_id).cloned())
    }

    /// All receipts for a plan id (single-use plans have at most one).
    pub fn by_plan(&self, plan_id: &str) -> Result<Vec<ExecutionReceipt>, BrokerError> {
        if let Some(err) = self.degradation() {
            return Err(err);
        }
        Ok(self
            .state
            .lock()
            .unwrap()
            .values()
            .filter(|receipt| receipt.plan_id == plan_id)
            .cloned()
            .collect())
    }

    /// Apply a lifecycle update through the strict transition table. Identity
    /// fields are re-validated (digest included) afterwards; any mutation of
    /// them fails closed.
    pub fn transition(
        &self,
        receipt_id: &str,
        to: ExecutionReceiptState,
        apply: impl FnOnce(&mut ExecutionReceipt),
    ) -> Result<ExecutionReceipt, BrokerError> {
        if let Some(err) = self.degradation() {
            return Err(err);
        }
        let updated = {
            let mut guard = self.state.lock().unwrap();
            let receipt = guard.get_mut(receipt_id).ok_or_else(|| {
                BrokerError::new(
                    ErrorCode::ReceiptNotFound,
                    format!("receipt_id not found: {receipt_id}"),
                )
            })?;
            let from = receipt.execution_state;
            if !transition_allowed(from, to) {
                return Err(BrokerError::new(
                    ErrorCode::ReceiptTransitionInvalid,
                    format!("illegal receipt transition {from:?} -> {to:?}"),
                ));
            }
            receipt.execution_state = to;
            apply(receipt);
            validate_receipt_structure(receipt)?;
            receipt.clone()
        };
        self.persist_or_degrade()?;
        Ok(updated)
    }

    /// `accepted -> spawn_started` with the trusted clock timestamp.
    pub fn mark_spawn_started(
        &self,
        receipt_id: &str,
        spawn_started_at: &str,
    ) -> Result<ExecutionReceipt, BrokerError> {
        let spawn_started_at = spawn_started_at.to_string();
        self.transition(receipt_id, ExecutionReceiptState::SpawnStarted, |receipt| {
            receipt.spawn_started_at = Some(spawn_started_at.clone());
        })
    }

    /// `accepted -> spawn_failed` (provably no process was created).
    pub fn mark_spawn_failed(&self, receipt_id: &str) -> Result<ExecutionReceipt, BrokerError> {
        self.transition(receipt_id, ExecutionReceiptState::SpawnFailed, |_| {})
    }

    /// `spawn_started -> completed` with the full process metadata. Stream
    /// digests are computed natively here so callers can never submit
    /// digests that do not match the captured, redacted output.
    pub fn mark_completed(
        &self,
        receipt_id: &str,
        result: &BrokerExecutionResult,
    ) -> Result<ExecutionReceipt, BrokerError> {
        let execution_id = result.execution_id.clone();
        let finished_at = result.finished_at.clone();
        let stdout_digest = Some(sha256_hex(result.stdout.as_bytes()));
        let stderr_digest = Some(sha256_hex(result.stderr.as_bytes()));
        let output_truncated = result.stdout_truncated || result.stderr_truncated;
        let output_redacted = result.output_redacted;
        let resolved_executable_fingerprint = result.executable_fingerprint.clone();
        self.transition(receipt_id, ExecutionReceiptState::Completed, |receipt| {
            receipt.execution_id = Some(execution_id);
            receipt.finished_at = Some(finished_at);
            receipt.exit_code = result.exit_code;
            receipt.timed_out = result.timed_out;
            receipt.cancelled = result.cancelled;
            receipt.stdout_digest = stdout_digest;
            receipt.stderr_digest = stderr_digest;
            receipt.output_truncated = output_truncated;
            receipt.output_redacted = output_redacted;
            receipt.resolved_executable_fingerprint = Some(resolved_executable_fingerprint);
        })
    }

    /// `accepted | spawn_started -> unknown_after_crash` (restart recovery
    /// and fail-closed error classification).
    pub fn mark_unknown_after_crash(
        &self,
        receipt_id: &str,
    ) -> Result<ExecutionReceipt, BrokerError> {
        self.transition(receipt_id, ExecutionReceiptState::UnknownAfterCrash, |_| {})
    }

    /// Reserve a verification attempt (write-ahead). Duplicate attempt ids
    /// and attempts beyond the hard bound are rejected before any spawn.
    pub fn reserve_attempt(
        &self,
        receipt_id: &str,
        attempt_id: &str,
        started_at: &str,
    ) -> Result<(), BrokerError> {
        if let Some(err) = self.degradation() {
            return Err(err);
        }
        if !super::receipt::valid_attempt_id(attempt_id) {
            return Err(BrokerError::new(
                ErrorCode::ReadbackAttemptReplay,
                "invalid verification attempt id",
            ));
        }
        let attempt_id = attempt_id.to_string();
        let started_at = started_at.to_string();
        {
            let mut guard = self.state.lock().unwrap();
            let receipt = guard.get_mut(receipt_id).ok_or_else(|| {
                BrokerError::new(
                    ErrorCode::ReceiptNotFound,
                    format!("receipt_id not found: {receipt_id}"),
                )
            })?;
            if receipt
                .verification_attempts
                .iter()
                .any(|attempt| attempt.attempt_id == attempt_id)
            {
                return Err(BrokerError::new(
                    ErrorCode::ReadbackAttemptReplay,
                    format!("verification attempt {attempt_id} already executed"),
                ));
            }
            if receipt.verification_attempts.len() >= MAX_VERIFICATION_ATTEMPTS {
                return Err(BrokerError::new(
                    ErrorCode::ReadbackAttemptLimitExceeded,
                    format!(
                        "receipt {receipt_id} exceeded the {MAX_VERIFICATION_ATTEMPTS}-attempt hard bound"
                    ),
                ));
            }
            receipt
                .verification_attempts
                .push(VerificationAttemptRecord {
                    attempt_id: attempt_id.clone(),
                    status: AttemptStatus::Running,
                    started_at,
                    observed_at: None,
                    payload_digest: None,
                    parser_status: None,
                    error_code: None,
                });
        }
        self.persist_or_degrade()
    }

    /// Complete a reserved attempt with the acquired observation metadata.
    pub fn complete_attempt(
        &self,
        receipt_id: &str,
        attempt_id: &str,
        observed_at: &str,
        payload_digest: &str,
        parser_status: ReadbackParserStatus,
    ) -> Result<(), BrokerError> {
        if let Some(err) = self.degradation() {
            return Err(err);
        }
        let observed_at = observed_at.to_string();
        let payload_digest = payload_digest.to_string();
        {
            let mut guard = self.state.lock().unwrap();
            let receipt = guard.get_mut(receipt_id).ok_or_else(|| {
                BrokerError::new(
                    ErrorCode::ReceiptNotFound,
                    format!("receipt_id not found: {receipt_id}"),
                )
            })?;
            let attempt = receipt
                .verification_attempts
                .iter_mut()
                .find(|attempt| attempt.attempt_id == attempt_id)
                .ok_or_else(|| {
                    BrokerError::new(
                        ErrorCode::ReadbackAttemptReplay,
                        format!("unknown verification attempt {attempt_id}"),
                    )
                })?;
            if attempt.status == AttemptStatus::Completed {
                return Err(BrokerError::new(
                    ErrorCode::ReadbackAttemptReplay,
                    format!("verification attempt {attempt_id} already completed"),
                ));
            }
            attempt.status = AttemptStatus::Completed;
            attempt.observed_at = Some(observed_at);
            attempt.payload_digest = Some(payload_digest);
            attempt.parser_status = Some(parser_status);
            attempt.error_code = None;
        }
        self.persist_or_degrade()
    }

    /// Mark a reserved attempt as failed (the read-back process produced no
    /// observation).
    pub fn fail_attempt(
        &self,
        receipt_id: &str,
        attempt_id: &str,
        error_code: ErrorCode,
    ) -> Result<(), BrokerError> {
        if let Some(err) = self.degradation() {
            return Err(err);
        }
        {
            let mut guard = self.state.lock().unwrap();
            let receipt = guard.get_mut(receipt_id).ok_or_else(|| {
                BrokerError::new(
                    ErrorCode::ReceiptNotFound,
                    format!("receipt_id not found: {receipt_id}"),
                )
            })?;
            let attempt = receipt
                .verification_attempts
                .iter_mut()
                .find(|attempt| attempt.attempt_id == attempt_id)
                .ok_or_else(|| {
                    BrokerError::new(
                        ErrorCode::ReadbackAttemptReplay,
                        format!("unknown verification attempt {attempt_id}"),
                    )
                })?;
            if attempt.status != AttemptStatus::Running {
                return Ok(());
            }
            attempt.status = AttemptStatus::Failed;
            attempt.error_code = Some(error_code);
        }
        self.persist_or_degrade()
    }

    /// Number of attempts recorded for a receipt.
    pub fn attempt_count(&self, receipt_id: &str) -> Result<usize, BrokerError> {
        if let Some(err) = self.degradation() {
            return Err(err);
        }
        Ok(self
            .state
            .lock()
            .unwrap()
            .get(receipt_id)
            .map(|receipt| receipt.verification_attempts.len())
            .unwrap_or(0))
    }
}
