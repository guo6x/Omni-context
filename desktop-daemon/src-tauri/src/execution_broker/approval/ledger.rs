//! Goal24 Checkpoint 7 (Lane B) - durable accepted-plan replay ledger.
//!
//! Every plan id accepted into the spawn phase is durably reserved here
//! (read-only plans included). After a restart the same plan id is still
//! rejected with `PlanRejectedSingleUse`. The CP3 in-memory `HashSet` is
//! replaced by this ledger.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::execution_broker::types::{BrokerError, ErrorCode, ExecutionPlanWire};

const LEDGER_FILE_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct LedgerFile {
    version: u32,
    reserved_plan_ids: Vec<String>,
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

/// Durable single-use reservation ledger for accepted plan ids.
pub struct PlanLedger {
    path: Option<PathBuf>,
    reserved: Mutex<HashSet<String>>,
    degraded: Option<BrokerError>,
}

impl PlanLedger {
    /// Volatile in-memory ledger (used by `Broker::new`; unit tests only).
    pub fn in_memory() -> Self {
        Self {
            path: None,
            reserved: Mutex::new(HashSet::new()),
            degraded: None,
        }
    }

    /// Open (or create) a persistent ledger at a trusted injected path. A
    /// missing file is a healthy empty ledger; corruption fails closed.
    pub fn persistent(path: PathBuf) -> Self {
        match Self::open(&path) {
            Ok(ledger) => ledger,
            Err(err) => Self {
                path: Some(path),
                reserved: Mutex::new(HashSet::new()),
                degraded: Some(err),
            },
        }
    }

    fn open(path: &PathBuf) -> Result<Self, BrokerError> {
        let reserved = match std::fs::read(path) {
            Ok(bytes) => {
                let parsed: LedgerFile = serde_json::from_slice(&bytes)
                    .map_err(|err| corrupt(&format!("cannot parse ledger json: {err}")))?;
                if parsed.version != LEDGER_FILE_VERSION {
                    return Err(corrupt(&format!(
                        "unsupported ledger version {}",
                        parsed.version
                    )));
                }
                let mut set = HashSet::new();
                for plan_id in parsed.reserved_plan_ids {
                    if !ExecutionPlanWire::valid_plan_id(&plan_id) {
                        return Err(corrupt(&format!("invalid reserved plan_id {plan_id}")));
                    }
                    if !set.insert(plan_id.clone()) {
                        return Err(corrupt(&format!("duplicate reserved plan_id {plan_id}")));
                    }
                }
                set
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => HashSet::new(),
            Err(err) => {
                return Err(corrupt(&format!("cannot read ledger file: {err}")));
            }
        };
        Ok(Self {
            path: Some(path.clone()),
            reserved: Mutex::new(reserved),
            degraded: None,
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

    /// Reserve a plan id exactly once; returns `false` when already reserved.
    /// The reservation is persisted before the broker spawns anything.
    pub fn reserve(&self, plan_id: &str) -> Result<bool, BrokerError> {
        if let Some(err) = self.degraded.clone() {
            return Err(err);
        }
        {
            let mut guard = self.reserved.lock().unwrap();
            if guard.contains(plan_id) {
                return Ok(false);
            }
            guard.insert(plan_id.to_string());
        }
        self.persist()?;
        Ok(true)
    }

    fn persist(&self) -> Result<(), BrokerError> {
        let path = match &self.path {
            Some(path) => path,
            None => return Ok(()),
        };
        let mut ids: Vec<String> = self.reserved.lock().unwrap().iter().cloned().collect();
        ids.sort();
        let bytes = serde_json::to_vec_pretty(&LedgerFile {
            version: LEDGER_FILE_VERSION,
            reserved_plan_ids: ids,
        })
        .map_err(|err| corrupt(&format!("cannot serialize ledger: {err}")))?;
        atomic_write(path, &bytes)
    }
}
