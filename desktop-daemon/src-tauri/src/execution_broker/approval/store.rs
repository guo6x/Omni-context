//! Goal24 Checkpoint 7 (Lane B) - persistent native approval store.
//!
//! The store path is trusted/injected by the broker constructor (production
//! wires Tauri app-data later; CP7 tests use temp directories). Callers can
//! never submit a store path. Writes are atomic: temp file -> flush ->
//! fsync -> rename. A corrupt store fails closed with
//! `BROKER_APPROVAL_STORE_CORRUPT` and is never deleted or treated as empty.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::execution_broker::types::{BrokerError, ErrorCode};

use super::digest::constant_time_eq;
use super::lock::StoreFileLock;
use super::types::{ApprovalRecord, ApprovalStatus};
use crate::execution_broker::types::ExecutionPlanWire;

const STORE_FILE_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct StoreFile {
    version: u32,
    records: Vec<ApprovalRecord>,
}

fn corrupt(reason: &str) -> BrokerError {
    BrokerError::new(
        ErrorCode::BrokerApprovalStoreCorrupt,
        format!("approval store corrupt: {reason}"),
    )
}

/// Atomic durable write: serialize, write temp file, flush, fsync, rename.
fn atomic_write(path: &PathBuf, bytes: &[u8]) -> Result<(), BrokerError> {
    let parent = path.parent().ok_or_else(|| {
        BrokerError::new(
            ErrorCode::BrokerApprovalStoreCorrupt,
            "approval store path has no parent directory",
        )
    })?;
    std::fs::create_dir_all(parent).map_err(|err| {
        BrokerError::new(
            ErrorCode::BrokerApprovalStoreCorrupt,
            format!("cannot create approval store directory: {err}"),
        )
    })?;
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, bytes).map_err(|err| {
        BrokerError::new(
            ErrorCode::BrokerApprovalStoreCorrupt,
            format!("cannot write approval store temp file: {err}"),
        )
    })?;
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(&temp)
        .map_err(|err| {
            BrokerError::new(
                ErrorCode::BrokerApprovalStoreCorrupt,
                format!("cannot open approval store temp file: {err}"),
            )
        })?;
    file.sync_all().map_err(|err| {
        BrokerError::new(
            ErrorCode::BrokerApprovalStoreCorrupt,
            format!("cannot fsync approval store temp file: {err}"),
        )
    })?;
    drop(file);
    std::fs::rename(&temp, path).map_err(|err| {
        let _ = std::fs::remove_file(&temp);
        BrokerError::new(
            ErrorCode::BrokerApprovalStoreCorrupt,
            format!("cannot atomically rename approval store: {err}"),
        )
    })?;
    Ok(())
}

/// The native approval store. All records are native-owned; lookups are the
/// only source of approval authority.
pub struct ApprovalStore {
    path: Option<PathBuf>,
    records: Mutex<BTreeMap<String, ApprovalRecord>>,
    degraded: Option<BrokerError>,
    _lock: Option<StoreFileLock>,
}

impl ApprovalStore {
    /// Volatile in-memory store (used by `Broker::new`; unit tests only).
    pub fn in_memory() -> Self {
        Self {
            path: None,
            records: Mutex::new(BTreeMap::new()),
            degraded: None,
            _lock: None,
        }
    }

    /// Open (or create) a persistent store at a trusted injected path. A
    /// missing file is a healthy empty store; any parse/structural problem is
    /// retained as a degraded state so every execute fails closed.
    pub fn persistent(path: PathBuf) -> Self {
        match Self::open(&path) {
            Ok(store) => store,
            Err(err) => Self {
                path: Some(path),
                records: Mutex::new(BTreeMap::new()),
                degraded: Some(err),
                _lock: None,
            },
        }
    }

    fn open(path: &PathBuf) -> Result<Self, BrokerError> {
        let lock_path = path.with_extension("lock");
        let lock = StoreFileLock::acquire(&lock_path)
            .map_err(|reason| corrupt(&format!("cannot acquire store lock: {reason}")))?;
        let records = match std::fs::read(path) {
            Ok(bytes) => {
                let parsed: StoreFile = serde_json::from_slice(&bytes)
                    .map_err(|err| corrupt(&format!("cannot parse store json: {err}")))?;
                if parsed.version != STORE_FILE_VERSION {
                    return Err(corrupt(&format!(
                        "unsupported store version {}",
                        parsed.version
                    )));
                }
                let mut map = BTreeMap::new();
                for record in parsed.records {
                    if map.contains_key(&record.approval_id) {
                        return Err(corrupt(&format!(
                            "duplicate approval_id {}",
                            record.approval_id
                        )));
                    }
                    if record.token_reference.is_empty() || record.token_digest.len() != 64 {
                        return Err(corrupt(&format!(
                            "approval {} has malformed token fields",
                            record.approval_id
                        )));
                    }
                    if !record.token_digest.bytes().all(|b| b.is_ascii_hexdigit()) {
                        return Err(corrupt(&format!(
                            "approval {} has a non-hex token digest",
                            record.approval_id
                        )));
                    }
                    if record.approval_binding_digest.len() != 64
                        || !record
                            .approval_binding_digest
                            .bytes()
                            .all(|b| b.is_ascii_hexdigit())
                    {
                        return Err(corrupt(&format!(
                            "approval {} has a malformed approval binding digest",
                            record.approval_id
                        )));
                    }
                    if !ExecutionPlanWire::valid_plan_id(&record.plan_id) {
                        return Err(corrupt(&format!(
                            "approval {} has an invalid plan_id",
                            record.approval_id
                        )));
                    }
                    if !record.token_reference.starts_with("grant_")
                        || record.token_reference.len() != "grant_".len() + 32
                        || !record.token_reference["grant_".len()..]
                            .bytes()
                            .all(|b| b.is_ascii_hexdigit())
                    {
                        return Err(corrupt(&format!(
                            "approval {} has a malformed token reference",
                            record.approval_id
                        )));
                    }
                    let granted = chrono::DateTime::parse_from_rfc3339(&record.granted_at)
                        .map_err(|err| corrupt(&format!("bad granted_at: {err}")))?;
                    let expires = chrono::DateTime::parse_from_rfc3339(&record.expires_at)
                        .map_err(|err| corrupt(&format!("bad expires_at: {err}")))?;
                    if expires <= granted {
                        return Err(corrupt(&format!(
                            "approval {} expires before it is granted",
                            record.approval_id
                        )));
                    }
                    let lifetime_ms = (expires - granted).num_milliseconds();
                    if lifetime_ms > 15 * 60 * 1000 {
                        return Err(corrupt(&format!(
                            "approval {} grant lifetime exceeds the CP7 maximum",
                            record.approval_id
                        )));
                    }
                    match record.status {
                        ApprovalStatus::Consumed => {
                            if record.consumed_at.is_none() {
                                return Err(corrupt(&format!(
                                    "approval {} is consumed without consumed_at",
                                    record.approval_id
                                )));
                            }
                        }
                        _ => {
                            if record.consumed_at.is_some() || record.execution_id.is_some() {
                                return Err(corrupt(&format!(
                                    "approval {} has consumed/execution audit fields in an unconsumed state",
                                    record.approval_id
                                )));
                            }
                        }
                    }
                    map.insert(record.approval_id.clone(), record);
                }
                map
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(err) => {
                return Err(corrupt(&format!("cannot read store file: {err}")));
            }
        };
        Ok(Self {
            path: Some(path.clone()),
            records: Mutex::new(records),
            degraded: None,
            _lock: Some(lock),
        })
    }

    /// True while the store is initialized and healthy.
    pub fn is_healthy(&self) -> bool {
        self.degraded.is_none()
    }

    /// Degraded reason, when unhealthy.
    pub fn degradation(&self) -> Option<BrokerError> {
        self.degraded.clone()
    }

    fn persist(&self) -> Result<(), BrokerError> {
        let path = match &self.path {
            Some(path) => path,
            None => return Ok(()),
        };
        let guard = self.records.lock().unwrap();
        let records: Vec<ApprovalRecord> = guard.values().cloned().collect();
        let bytes = serde_json::to_vec_pretty(&StoreFile {
            version: STORE_FILE_VERSION,
            records,
        })
        .map_err(|err| corrupt(&format!("cannot serialize store: {err}")))?;
        atomic_write(path, &bytes)
    }

    /// Insert a native-built record. Fails closed when degraded.
    pub fn insert(&self, record: ApprovalRecord) -> Result<(), BrokerError> {
        if let Some(err) = self.degraded.clone() {
            return Err(err);
        }
        {
            let mut guard = self.records.lock().unwrap();
            if guard.contains_key(&record.approval_id) {
                return Err(BrokerError::new(
                    ErrorCode::InternalError,
                    format!("duplicate approval_id {}", record.approval_id),
                ));
            }
            // A second live grant for the same plan is rejected. Once a grant
            // is consumed/denied/revoked, a regrant may be recorded for audit,
            // but the durable plan ledger still prevents execution replay.
            if guard.values().any(|existing| {
                existing.plan_id == record.plan_id && existing.status == ApprovalStatus::Granted
            }) {
                return Err(BrokerError::new(
                    ErrorCode::ApprovalConsumed,
                    format!(
                        "plan {} already has a native approval grant",
                        record.plan_id
                    ),
                ));
            }
            guard.insert(record.approval_id.clone(), record);
        }
        self.persist()
    }

    /// Look up one record. Fails closed when degraded.
    pub fn get(&self, approval_id: &str) -> Result<Option<ApprovalRecord>, BrokerError> {
        if let Some(err) = self.degraded.clone() {
            return Err(err);
        }
        Ok(self.records.lock().unwrap().get(approval_id).cloned())
    }

    /// Verify presented token fields against the stored record
    /// (constant-time). The stored record remains the source of truth.
    pub fn token_fields_match(
        record: &ApprovalRecord,
        token_reference: &str,
        token_digest: &str,
    ) -> bool {
        constant_time_eq(&record.token_reference, token_reference)
            && constant_time_eq(&record.token_digest, token_digest)
    }

    /// Atomic compare-and-consume: exactly one caller transitions `Granted`
    /// (and not expired) -> `Consumed`. Every other caller is rejected.
    pub fn consume_if_granted(
        &self,
        approval_id: &str,
        now: &chrono::DateTime<chrono::Utc>,
    ) -> Result<ApprovalRecord, BrokerError> {
        if let Some(err) = self.degraded.clone() {
            return Err(err);
        }
        let mut guard = self.records.lock().unwrap();
        let record = guard.get(approval_id).cloned().ok_or_else(|| {
            BrokerError::new(
                ErrorCode::ApprovalRecordNotFound,
                format!("approval_id not found: {approval_id}"),
            )
        })?;
        if record.status != super::types::ApprovalStatus::Granted {
            return Err(super::authority::status_error(&record));
        }
        if !record.is_verifiable(now) {
            return Err(BrokerError::new(
                ErrorCode::ApprovalExpired,
                format!("approval {approval_id} is expired"),
            ));
        }
        let consumed = ApprovalRecord {
            status: super::types::ApprovalStatus::Consumed,
            consumed_at: Some(now.to_rfc3339()),
            ..record.clone()
        };
        guard.insert(approval_id.to_string(), consumed.clone());
        drop(guard);
        self.persist()?;
        Ok(consumed)
    }

    /// Record the execution id against an already-consumed approval (audit).
    pub fn record_execution_id(
        &self,
        approval_id: &str,
        execution_id: &str,
    ) -> Result<(), BrokerError> {
        if let Some(err) = self.degraded.clone() {
            return Err(err);
        }
        {
            let mut guard = self.records.lock().unwrap();
            let Some(record) = guard.get_mut(approval_id) else {
                return Ok(());
            };
            record.execution_id = Some(execution_id.to_string());
        }
        self.persist()
    }

    /// Transition to `Denied` unless already consumed.
    pub fn deny(&self, approval_id: &str) -> Result<(), BrokerError> {
        self.transition(approval_id, super::types::ApprovalStatus::Denied)
    }

    /// Transition to `Revoked` unless already consumed. Revoking an already
    /// consumed grant is audit-only: an executed effect can never be rolled
    /// back by the store.
    pub fn revoke(&self, approval_id: &str) -> Result<(), BrokerError> {
        self.transition(approval_id, super::types::ApprovalStatus::Revoked)
    }

    /// Test-only: force a granted record to expire now (time-travel for the
    /// expiry gate without waiting 15 minutes).
    pub fn force_expire_for_test(
        &self,
        approval_id: &str,
        now: &chrono::DateTime<chrono::Utc>,
    ) -> Result<(), BrokerError> {
        if let Some(err) = self.degraded.clone() {
            return Err(err);
        }
        {
            let mut guard = self.records.lock().unwrap();
            let Some(record) = guard.get_mut(approval_id) else {
                return Err(BrokerError::new(
                    ErrorCode::ApprovalRecordNotFound,
                    format!("approval_id not found: {approval_id}"),
                ));
            };
            record.expires_at = (*now - chrono::Duration::milliseconds(1)).to_rfc3339();
        }
        self.persist()
    }

    fn transition(
        &self,
        approval_id: &str,
        status: super::types::ApprovalStatus,
    ) -> Result<(), BrokerError> {
        if let Some(err) = self.degraded.clone() {
            return Err(err);
        }
        {
            let mut guard = self.records.lock().unwrap();
            let Some(record) = guard.get_mut(approval_id) else {
                return Err(BrokerError::new(
                    ErrorCode::ApprovalRecordNotFound,
                    format!("approval_id not found: {approval_id}"),
                ));
            };
            if record.status == super::types::ApprovalStatus::Consumed {
                return Ok(());
            }
            record.status = status;
        }
        self.persist()
    }
}
