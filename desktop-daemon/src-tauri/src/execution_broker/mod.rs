//! Goal24 Checkpoint 7 - Tauri Local Execution Broker core with native
//! approval enforcement (Lane B).
//!
//! The broker is a *restricted execution primitive*: it executes a semantic
//! `ExecutionPlan` (`state=ready`) through a trusted compiled
//! `ExecutionBinding`. It never accepts an executable, argv, cwd or env from
//! a plan or from an IPC caller.
//!
//! CP7 replaces the CP3 unconditional
//! `required_approval=true -> PlanRejectedApproval` fail-closed with a real
//! native approval authority: verify a store-backed grant, atomically consume
//! it, durably reserve the plan id, then spawn. The broker also enforces the
//! compiled binding risk policy independently: a plan can never downgrade the
//! native risk metadata or bypass the native minimum approval rule.

mod output;
mod policy;
mod process_tree;
mod resolver;
mod runner;
mod types;

pub(crate) mod approval;

#[cfg(test)]
mod adversarial;
#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::execution_broker::approval::{ApprovalAuthority, GrantRequest, PlanLedger};
use crate::execution_broker::runner::ExecutionRegistry;

#[cfg(test)]
pub use policy::{build_child_env, validate_cwd, BASE_ENV_VARS};
pub use policy::{ExecutionBinding, ExecutionRiskPolicy, OutputLimits, DEFAULT_OUTPUT_MAX_BYTES};
pub use types::{
    BrokerError, BrokerExecutionResult, ErrorCode, ExecutionPlanStateWire, ExecutionPlanWire,
    FORBIDDEN_INPUT_KEYS, TIMEOUT_MAX_MS, TIMEOUT_MIN_MS,
};

/// Broker version reported by the status IPC surface.
pub const BROKER_VERSION: &str = "0.1.0-cp7";

/// Read-only broker status view (the only Tauri IPC surface).
#[derive(Debug, Clone, serde::Serialize)]
pub struct BrokerStatus {
    pub broker_version: String,
    /// Always false: no generic execute IPC is exposed.
    pub execute_ipc_enabled: bool,
    pub registered_bindings: Vec<String>,
    pub active_executions: usize,
    pub output_limits: OutputLimitsView,
    /// True only while both the ApprovalStore and the durable plan ledger are
    /// initialized and healthy. A corrupt store/ledger reports false and every
    /// execute fails closed.
    pub approvals_enforced: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OutputLimitsView {
    pub stdout_max_bytes: usize,
    pub stderr_max_bytes: usize,
}

/// The broker core. `execute` is `pub(crate)`: only trusted compiled code in
/// this crate can run plans; no generic execute IPC exists.
pub struct Broker {
    bindings: Mutex<HashMap<String, Arc<dyn ExecutionBinding>>>,
    registry: ExecutionRegistry,
    approval: Arc<ApprovalAuthority>,
    plan_ledger: PlanLedger,
}

impl Default for Broker {
    fn default() -> Self {
        Self::new()
    }
}

impl Broker {
    /// Create a broker with volatile in-memory approval state (unit tests and
    /// the CP7 default). Production persistence is wired with
    /// `Broker::with_persistence` using trusted app-data paths.
    pub fn new() -> Self {
        Self::with_internal(ApprovalAuthority::in_memory(), PlanLedger::in_memory())
    }

    /// Create a broker with a persistent approval store and durable plan
    /// replay ledger. The paths are trusted/injected by this constructor;
    /// callers can never submit a store path over IPC. A corrupt store or
    /// ledger is retained as a degraded state: status reports
    /// `approvals_enforced=false` and every execute fails closed.
    pub fn with_persistence(store_path: &Path, ledger_path: &Path) -> Self {
        Self::with_internal(
            ApprovalAuthority::persistent(store_path.to_path_buf()),
            PlanLedger::persistent(ledger_path.to_path_buf()),
        )
    }

    fn with_internal(approval: ApprovalAuthority, plan_ledger: PlanLedger) -> Self {
        Self {
            bindings: Mutex::new(HashMap::new()),
            registry: ExecutionRegistry::default(),
            approval: Arc::new(approval),
            plan_ledger,
        }
    }

    /// Register a trusted compiled binding. Never callable from IPC.
    pub fn register_binding(&self, binding: Box<dyn ExecutionBinding>) {
        self.bindings
            .lock()
            .unwrap()
            .insert(binding.binding_id().to_string(), binding.into());
    }

    /// Crate-internal native grant entry point. Not a Tauri command; the CP9
    /// Approval UI will wire it to an owner/admin-facing surface later.
    pub(crate) fn grant_approval(
        &self,
        request: &GrantRequest<'_>,
    ) -> Result<types::ApprovalReferenceWire, BrokerError> {
        self.approval.grant(request)
    }

    /// Crate-internal revoke entry point (audit-only after consume).
    pub(crate) fn revoke_approval(&self, approval_id: &str) -> Result<(), BrokerError> {
        self.approval.revoke(approval_id)
    }

    /// Crate-internal deny entry point.
    pub(crate) fn deny_approval(&self, approval_id: &str) -> Result<(), BrokerError> {
        self.approval.deny(approval_id)
    }

    /// Crate-internal: the native authority (used by tests and future owners).
    pub(crate) fn approval_authority(&self) -> &ApprovalAuthority {
        &self.approval
    }

    /// Execute an approved plan through a trusted binding.
    ///
    /// Gate (all enforced here, never delegated to the TypeScript layer):
    /// - `state=ready` only (`executing` is rejected as a replay guard)
    /// - `expires_at` must be absent (default TTL: 24h from `created_at`) or in the future
    /// - `timeout_ms` within contract bounds `[100, 86_400_000]`
    /// - plan identity fields must match the contract patterns
    /// - `normalized_inputs` must not carry reserved command keys
    /// - `binding_id` must exist and match `adapter_id` + `capability_id`
    /// - the plan risk snapshot must exactly match the compiled binding policy
    ///   (`capability_version` + risk level + side effect + reversible + authority)
    /// - the native minimum approval rule cannot be bypassed
    /// - `required_approval=true` requires a real store-backed grant which is
    ///   atomically consumed (single-use) before the plan id is durably
    ///   reserved and the process is spawned (consume-before-spawn)
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
                "only state=ready plans are accepted by the broker"
            };
            return Err(BrokerError::new(ErrorCode::PlanRejectedState, detail));
        }

        // Approval reference consistency (schema-level). The real authority
        // is the native store lookup below, never these strings.
        if let Some(approval) = &plan.approval {
            if approval.plan_id != plan.plan_id {
                return Err(BrokerError::new(
                    ErrorCode::PlanRejectedInvalid,
                    "approval.plan_id does not match plan.plan_id",
                ));
            }
            if !plan.required_approval {
                return Err(BrokerError::new(
                    ErrorCode::PlanRejectedInvalid,
                    "approval reference present on a plan that does not require approval",
                ));
            }
        }

        // Fail closed on a degraded approval store or plan ledger. A corrupt
        // store is never deleted and never treated as an empty database.
        if let Some(err) = self.approval.degradation() {
            return Err(err.clone());
        }
        if let Some(err) = self.plan_ledger.degradation() {
            return Err(err.clone());
        }

        if let Some(expires_at) = &plan.expires_at {
            if runner::plan_is_expired(expires_at) {
                return Err(BrokerError::new(
                    ErrorCode::PlanRejectedExpired,
                    "plan has expired",
                ));
            }
        } else if runner::plan_is_stale(&plan.created_at) {
            return Err(BrokerError::new(
                ErrorCode::PlanRejectedExpired,
                "plan has no expires_at and exceeded the broker default TTL from created_at",
            ));
        }

        if !(TIMEOUT_MIN_MS..=TIMEOUT_MAX_MS).contains(&plan.timeout_ms) {
            return Err(BrokerError::new(
                ErrorCode::PlanRejectedInvalid,
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
                ErrorCode::PlanRejectedInvalid,
                format!("normalized_inputs must not contain reserved top-level key '{forbidden}'"),
            ));
        }

        // Fail-closed environment rule: a write-scoped GitHub token in the
        // broker's own environment would implicitly authenticate the pinned
        // `gh` binary, so execution is refused rather than silently
        // proceeding.
        if std::env::var_os("GITHUB_TOKEN").is_some() {
            return Err(BrokerError::new(
                ErrorCode::BrokerBlockedEnv,
                "GITHUB_TOKEN is present in the broker environment; execution is blocked",
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
                ErrorCode::PlanRejectedAdapter,
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
                ErrorCode::PlanRejectedCapability,
                format!(
                    "binding {} capability_id '{}' does not match plan capability_id '{}'",
                    binding_id,
                    binding.capability_id(),
                    plan.capability_id
                ),
            ));
        }

        // -------------------------------------------------------------------
        // Native risk enforcement (independent of any Brain-side validation).
        // -------------------------------------------------------------------
        let compiled_policy = binding.risk_policy();
        if binding.capability_version() != plan.capability_version
            || plan.risk_snapshot.capability_version != binding.capability_version()
        {
            return Err(BrokerError::new(
                ErrorCode::PlanRejectedRiskPolicy,
                format!(
                    "capability_version mismatch: plan '{}', risk snapshot '{}', compiled binding '{}'",
                    plan.capability_version,
                    plan.risk_snapshot.capability_version,
                    binding.capability_version()
                ),
            ));
        }
        let snapshot = &plan.risk_snapshot;
        if snapshot.risk_level != compiled_policy.risk_level
            || snapshot.side_effect_class != compiled_policy.side_effect_class
            || snapshot.reversible != compiled_policy.reversible
            || snapshot.required_authority != compiled_policy.required_authority
        {
            return Err(BrokerError::new(
                ErrorCode::PlanRejectedRiskPolicy,
                "plan risk snapshot does not match the compiled binding risk policy",
            ));
        }

        // -------------------------------------------------------------------
        // Native minimum approval rule + real grant verification.
        // -------------------------------------------------------------------
        let approved = if plan.required_approval {
            let approval = plan.approval.as_ref().ok_or_else(|| {
                BrokerError::new(
                    ErrorCode::PlanRejectedApproval,
                    "required_approval=true but no approval reference is present",
                )
            })?;
            // The native store is the only source of approval authority. The
            // reference strings alone prove nothing.
            self.approval
                .verify(approval, plan, &compiled_policy, chrono::Utc::now())?;
            Some(approval)
        } else if compiled_policy.native_minimum_approval_required() {
            return Err(BrokerError::new(
                ErrorCode::PlanRejectedApprovalPolicy,
                "the compiled binding risk policy requires approval; a plan cannot opt out",
            ));
        } else {
            None
        };

        // Consume before spawn: even when the spawn itself later fails, the
        // approval stays consumed (fail-closed against duplicate effects).
        if let Some(approval) = approved {
            self.approval
                .consume(&approval.approval_id, chrono::Utc::now())?;
        }

        // Durable single-use plan reservation. Persisted before any spawn.
        if !self.plan_ledger.reserve(&plan.plan_id)? {
            return Err(BrokerError::new(
                ErrorCode::PlanRejectedSingleUse,
                "plan_id was already accepted for execution",
            ));
        }

        let result = runner::run(plan, binding.as_ref(), &self.registry)?;
        if let Some(approval) = approved {
            // Audit bookkeeping; a persistence failure here can never roll
            // back an already-executed effect.
            let _ = self
                .approval
                .record_execution_id(&approval.approval_id, &result.execution_id);
        }
        Ok(result)
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
            approvals_enforced: self.approval.is_healthy() && self.plan_ledger.is_healthy(),
        }
    }
}

/// Plan identity / structural validation mirroring the TypeScript contract
/// patterns. All failures are `INVALID_PLAN`.
fn validate_plan_identity(plan: &ExecutionPlanWire) -> Result<(), BrokerError> {
    let invalid =
        |reason: &str| BrokerError::new(ErrorCode::PlanRejectedInvalid, reason.to_string());

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
