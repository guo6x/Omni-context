//! Goal24 Checkpoint 7 (Integration) - durable accepted-plan replay ledger
//! with write-ahead acceptance.
//!
//! The ledger is the write-ahead journal of the may-spawn path. A plan id is
//! first durably marked `accepted` (the broker accepted it into the may-spawn
//! path) and then durably `reserved` before any spawn. A crash at ANY
//! checkpoint after the acceptance leaves a durable record, so a restart can
//! never accept the same plan id again (`PlanRejectedSingleUse`). Read-only
//! plans are included: every accepted plan id is single-use.
//!
//! The backing file is protected by an exclusive OS lock (see `lock.rs`):
//! a second broker instance pointing at the same ledger opens degraded and
//! every execute fails closed.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::execution_broker::types::{BrokerError, ErrorCode, ExecutionPlanWire};

use super::lock::StoreFileLock;

const LEDGER_FILE_VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerPhase {
    /// Write-ahead: the broker accepted the plan into the may-spawn path.
    Accepted,
    /// Durable reservation taken right before the spawn (step 1 of the
    /// crash-safe sequence).
    Reserved,
}

#[derive(Debug, Serialize, Deserialize)]
struct LedgerEntry {
    plan_id: String,
    phase: LedgerPhase,
}

#[derive(Debug, Serialize, Deserialize)]
struct LedgerFile {
    version: u32,
    entries: Vec<LedgerEntry>,
}

fn corrupt(reason: &str) -> BrokerError {
    BrokerError::new(
        ErrorCode::BrokerPlanLedgerCorrupt,
        format!("plan ledger corrupt: {reason}"),
    )
}

/// Atomic durable write: serialize, write temp file, flush, fsync, rename.
fn atomic_write(path: &PathBuf, bytes: &[u8]) -> Result<(), BrokerError> {
    let parent = path.parent().ok_or_else(|| {
        BrokerError::new(
            ErrorCode::BrokerPlanLedgerCorrupt,
            "plan ledger path has no parent directory",
        )
    })?;
    std::fs::create_dir_all(parent).map_err(|err| {
        BrokerError::new(
            ErrorCode::BrokerPlanLedgerCorrupt,
            format!("cannot create plan ledger directory: {err}"),
        )
    })?;
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, bytes).map_err(|err| {
        BrokerError::new(
            ErrorCode::BrokerPlanLedgerCorrupt,
            format!("cannot write plan ledger temp file: {err}"),
        )
    })?;
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(&temp)
        .map_err(|err| {
            BrokerError::new(
                ErrorCode::BrokerPlanLedgerCorrupt,
                format!("cannot open plan ledger temp file: {err}"),
            )
        })?;
    file.sync_all().map_err(|err| {
        BrokerError::new(
            ErrorCode::BrokerPlanLedgerCorrupt,
            format!("cannot fsync plan ledger temp file: {err}"),
        )
    })?;
    drop(file);
    std::fs::rename(&temp, path).map_err(|err| {
        let _ = std::fs::remove_file(&temp);
        BrokerError::new(
            ErrorCode::BrokerPlanLedgerCorrupt,
            format!("cannot atomically rename plan ledger: {err}"),
        )
    })?;
    Ok(())
}

/// Durable single-use ledger for accepted plan ids.
pub struct PlanLedger {
    path: Option<PathBuf>,
    entries: Mutex<HashMap<String, LedgerPhase>>,
    degraded: Option<BrokerError>,
    _lock: Option<StoreFileLock>,
}

impl PlanLedger {
    /// Volatile in-memory ledger (used by `Broker::new`; unit tests only).
    pub fn in_memory() -> Self {
        Self {
            path: None,
            entries: Mutex::new(HashMap::new()),
            degraded: None,
            _lock: None,
        }
    }

    /// Open (or create) a persistent ledger at a trusted injected path. A
    /// missing file is a healthy empty ledger; corruption or a failed
    /// single-instance lock acquisition degrades the ledger and fails closed.
    pub fn persistent(path: PathBuf) -> Self {
        match Self::open(&path) {
            Ok(ledger) => ledger,
            Err(err) => Self {
                path: Some(path),
                entries: Mutex::new(HashMap::new()),
                degraded: Some(err),
                _lock: None,
            },
        }
    }

    fn open(path: &PathBuf) -> Result<Self, BrokerError> {
        let lock_path = path.with_extension("lock");
        let lock = StoreFileLock::acquire(&lock_path)
            .map_err(|reason| corrupt(&format!("cannot acquire ledger lock: {reason}")))?;
        let entries = match std::fs::read(path) {
            Ok(bytes) => {
                let parsed: LedgerFile = serde_json::from_slice(&bytes)
                    .map_err(|err| corrupt(&format!("cannot parse ledger json: {err}")))?;
                if parsed.version != LEDGER_FILE_VERSION {
                    return Err(corrupt(&format!(
                        "unsupported ledger version {}",
                        parsed.version
                    )));
                }
                let mut map = HashMap::new();
                for entry in parsed.entries {
                    if !ExecutionPlanWire::valid_plan_id(&entry.plan_id) {
                        return Err(corrupt(&format!(
                            "invalid ledger plan_id {}",
                            entry.plan_id
                        )));
                    }
                    if map.contains_key(&entry.plan_id) {
                        return Err(corrupt(&format!(
                            "duplicate ledger plan_id {}",
                            entry.plan_id
                        )));
                    }
                    map.insert(entry.plan_id, entry.phase);
                }
                map
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(err) => {
                return Err(corrupt(&format!("cannot read ledger file: {err}")));
            }
        };
        Ok(Self {
            path: Some(path.clone()),
            entries: Mutex::new(entries),
            degraded: None,
            _lock: Some(lock),
        })
    }

    /// True while the ledger is initialized and healthy.
    pub fn is_healthy(&self) -> bool {
        self.degraded.is_none()
    }

    /// Degraded reason, when unhealthy.
    pub fn degradation(&self) -> Option<BrokerError> {
        self.degraded.clone()
    }

    /// Current phase of a plan id (used by tests to prove crash checkpoints).
    pub fn phase(&self, plan_id: &str) -> Option<LedgerPhase> {
        self.entries.lock().unwrap().get(plan_id).copied()
    }

    /// Write-ahead acceptance: durably mark the plan id as accepted into the
    /// may-spawn path. Returns `false` when the plan id was already accepted
    /// (single-use). This is the first durable step of the execute path.
    pub fn accept(&self, plan_id: &str) -> Result<bool, BrokerError> {
        if let Some(err) = self.degraded.clone() {
            return Err(err);
        }
        {
            let mut guard = self.entries.lock().unwrap();
            if guard.contains_key(plan_id) {
                return Ok(false);
            }
            guard.insert(plan_id.to_string(), LedgerPhase::Accepted);
        }
        self.persist()?;
        Ok(true)
    }

    /// Durable reservation: transition an accepted plan id to `reserved`
    /// (crash-safe step 1 of reserve -> consume -> spawn). A missing
    /// acceptance is an internal invariant violation and fails closed.
    pub fn reserve(&self, plan_id: &str) -> Result<(), BrokerError> {
        if let Some(err) = self.degraded.clone() {
            return Err(err);
        }
        {
            let mut guard = self.entries.lock().unwrap();
            let Some(phase) = guard.get_mut(plan_id) else {
                return Err(corrupt(&format!(
                    "plan {plan_id} was reserved without a write-ahead acceptance"
                )));
            };
            *phase = LedgerPhase::Reserved;
        }
        self.persist()
    }

    fn persist(&self) -> Result<(), BrokerError> {
        let path = match &self.path {
            Some(path) => path,
            None => return Ok(()),
        };
        let guard = self.entries.lock().unwrap();
        let mut entries: Vec<LedgerEntry> = guard
            .iter()
            .map(|(plan_id, phase)| LedgerEntry {
                plan_id: plan_id.clone(),
                phase: *phase,
            })
            .collect();
        entries.sort_by(|a, b| a.plan_id.cmp(&b.plan_id));
        let bytes = serde_json::to_vec_pretty(&LedgerFile {
            version: LEDGER_FILE_VERSION,
            entries,
        })
        .map_err(|err| corrupt(&format!("cannot serialize ledger: {err}")))?;
        atomic_write(path, &bytes)
    }
}
