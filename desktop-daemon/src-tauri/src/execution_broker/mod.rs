//! Goal24 Checkpoint 3 — Tauri Local Execution Broker core (Lane A).
//!
//! The broker is a *restricted execution primitive*: it executes an approved
//! semantic `ExecutionPlan` (`state=ready`, `required_approval=false` in CP3)
//! through a trusted compiled `ExecutionBinding`. It never accepts an
//! executable, argv, cwd or env from a plan or from an IPC caller.
//!
//! CP3 exposes only a read-only status surface over Tauri IPC; the `execute`
//! entry point is `pub(crate)` and will be opened to production IPC in CP4
//! together with the GitHub CLI adapter.

mod output;
mod policy;
mod process_tree;
mod resolver;
mod runner;
mod types;


use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub use policy::{ExecutionBinding, DEFAULT_OUTPUT_MAX_BYTES};
pub use types::{
    BrokerError, BrokerExecutionResult, ErrorCode, ExecutionPlanStateWire, ExecutionPlanWire,
    FORBIDDEN_INPUT_KEYS, TIMEOUT_MAX_MS, TIMEOUT_MIN_MS,
};

use crate::execution_broker::runner::ExecutionRegistry;

/// Broker version reported by the status IPC surface.
pub const BROKER_VERSION: &str = "0.1.0-cp3";

/// Read-only broker status view (the only CP3 Tauri IPC surface).
#[derive(Debug, Clone, serde::Serialize)]
pub struct BrokerStatus {
    pub broker_version: String,
    /// Always false in CP3: no generic execute IPC is exposed.
    pub execute_ipc_enabled: bool,
    pub registered_bindings: Vec<String>,
    pub active_executions: usize,
    pub output_limits: OutputLimitsView,
    pub approvals_enforced: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OutputLimitsView {
    pub stdout_max_bytes: usize,
    pub stderr_max_bytes: usize,
}

/// The broker core. `execute` is `pub(crate)`: only trusted compiled code in
/// this crate can run plans until a production adapter (CP4) is registered.
pub struct Broker {
    bindings: Mutex<HashMap<String, Arc<dyn ExecutionBinding>>>,
    registry: ExecutionRegistry,
}

impl Default for Broker {
    fn default() -> Self {
        Self::new()
    }
}

impl Broker {
    /// Create an empty broker. CP3 registers no production bindings.
    pub fn new() -> Self {
        Self {
            bindings: Mutex::new(HashMap::new()),
            registry: ExecutionRegistry::default(),
        }
    }

    /// Register a trusted compiled binding. Never callable from IPC.
    pub fn register_binding(&self, binding: Box<dyn ExecutionBinding>) {
        self.bindings
            .lock()
            .unwrap()
            .insert(binding.binding_id().to_string(), binding.into());
    }

    /// Execute an approved plan through a trusted binding.
    ///
    /// Gate (all enforced here, never delegated to the TypeScript layer):
    /// - `state=ready` only (`executing` is rejected as a replay guard)
    /// - `required_approval=false` only in CP3
    ///   (`APPROVAL_ENFORCEMENT_NOT_AVAILABLE` until Checkpoint 7)
    /// - `expires_at` must be absent or in the future
    /// - `timeout_ms` within contract bounds `[100, 86_400_000]`
    /// - plan identity fields must match the contract patterns
    /// - `normalized_inputs` must not carry reserved command keys
    /// - `binding_id` must exist and match `adapter_id` + `capability_id`
    pub fn execute(
        &self,
        plan: &ExecutionPlanWire,
        binding_id: &str,
    ) -> Result<BrokerExecutionResult, BrokerError> {
        validate_plan_identity(plan)?;

        if plan.state != ExecutionPlanStateWire::Ready {
            let detail = if plan.state == ExecutionPlanStateWire::Executing {
                "replay guard: state=executing cannot trigger a new spawn; only state=ready is accepted once"
            } else {
                "only state=ready plans are accepted by the CP3 broker"
            };
            return Err(BrokerError::new(ErrorCode::PlanNotReady, detail));
        }

        if plan.required_approval {
            return Err(BrokerError::new(
                ErrorCode::ApprovalEnforcementNotAvailable,
                "required_approval=true is blocked in CP3 until Checkpoint 7 provides real approval enforcement",
            ));
        }

        if let Some(expires_at) = &plan.expires_at {
            if runner::plan_is_expired(expires_at) {
                return Err(BrokerError::new(ErrorCode::PlanExpired, "plan has expired"));
            }
        }

        if !(TIMEOUT_MIN_MS..=TIMEOUT_MAX_MS).contains(&plan.timeout_ms) {
            return Err(BrokerError::new(
                ErrorCode::InvalidPlan,
                format!(
                    "timeout_ms {} outside contract bounds [{TIMEOUT_MIN_MS}, {TIMEOUT_MAX_MS}]",
                    plan.timeout_ms
                ),
            ));
        }

        if let Some(forbidden) = plan
            .normalized_inputs
            .keys()
            .find(|k| FORBIDDEN_INPUT_KEYS.contains(&k.as_str()))
        {
            return Err(BrokerError::new(
                ErrorCode::InvalidPlan,
                format!("normalized_inputs must not contain reserved top-level key '{forbidden}'"),
            ));
        }

        let binding = {
            let guard = self.bindings.lock().unwrap();
            guard.get(binding_id).cloned().ok_or_else(|| {
                BrokerError::new(
                    ErrorCode::UnknownBinding,
                    format!("unknown binding_id: {binding_id}"),
                )
            })?
        };

        if binding.adapter_id() != plan.adapter_id {
            return Err(BrokerError::new(
                ErrorCode::AdapterBindingMismatch,
                format!(
                    "binding {} adapter_id '{}' does not match plan adapter_id '{}'",
                    binding_id,
                    binding.adapter_id(),
                    plan.adapter_id
                ),
            ));
        }
        if binding.capability_id() != plan.capability_id {
            return Err(BrokerError::new(
                ErrorCode::CapabilityBindingMismatch,
                format!(
                    "binding {} capability_id '{}' does not match plan capability_id '{}'",
                    binding_id,
                    binding.capability_id(),
                    plan.capability_id
                ),
            ));
        }

        runner::run(plan, binding.as_ref(), &self.registry)
    }

    /// Cancel a broker-created execution by `execution_id`. Callers cannot
    /// target arbitrary PIDs; only executions this broker spawned are reachable.
    pub fn cancel_execution(&self, execution_id: &str) -> Result<(), BrokerError> {
        self.registry.request_cancel(execution_id)
    }

    /// Crate-internal: active execution ids (used by tests to cancel by id).
    pub(crate) fn active_executions(&self) -> Vec<String> {
        self.registry.active_ids()
    }

    /// Read-only status for IPC.
    pub fn status(&self) -> BrokerStatus {
        let binding_ids: Vec<String> = self.bindings.lock().unwrap().keys().cloned().collect();
        BrokerStatus {
            broker_version: BROKER_VERSION.to_string(),
            execute_ipc_enabled: false,
            registered_bindings: binding_ids,
            active_executions: self.registry.active_count(),
            output_limits: OutputLimitsView {
                stdout_max_bytes: DEFAULT_OUTPUT_MAX_BYTES,
                stderr_max_bytes: DEFAULT_OUTPUT_MAX_BYTES,
            },
            approvals_enforced: false,
        }
    }
}

/// Plan identity / structural validation mirroring the TypeScript contract
/// patterns. All failures are `INVALID_PLAN`.
fn validate_plan_identity(plan: &ExecutionPlanWire) -> Result<(), BrokerError> {
    let invalid = |reason: &str| BrokerError::new(ErrorCode::InvalidPlan, reason.to_string());

    if !ExecutionPlanWire::valid_plan_id(&plan.plan_id) {
        return Err(invalid("plan_id does not match the contract pattern"));
    }
    if plan.decision_id.trim().is_empty() {
        return Err(invalid("decision_id must be non-empty"));
    }
    if !ExecutionPlanWire::valid_capability_id(&plan.capability_id) {
        return Err(invalid("capability_id does not match provider.resource.action (3-5 segments, no reserved prefix)"));
    }
    if !ExecutionPlanWire::valid_semver(&plan.capability_version) {
        return Err(invalid("capability_version must be major.minor.patch"));
    }
    if !ExecutionPlanWire::valid_adapter_id(&plan.adapter_id) {
        return Err(invalid("adapter_id does not match the contract pattern"));
    }
    if plan
        .requested_by
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .len()
        > 200
    {
        return Err(invalid("requested_by exceeds 200 characters"));
    }
    if plan
        .correlation_id
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .len()
        > 200
    {
        return Err(invalid("correlation_id exceeds 200 characters"));
    }
    Ok(())
}

/// Process-wide broker instance used by the read-only status IPC command.
static GLOBAL_BROKER: std::sync::OnceLock<Broker> = std::sync::OnceLock::new();

pub fn global_broker() -> &'static Broker {
    GLOBAL_BROKER.get_or_init(Broker::new)
}
