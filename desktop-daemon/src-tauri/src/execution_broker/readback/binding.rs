//! Goal24 Checkpoint 8 (Lane B) - read-back binding contract.
//!
//! A `ReadbackBinding` is a *separate semantic role* from an execution
//! binding: it can only observe state. Registration is compiled/trusted only
//! (no IPC, no skill, no LLM registration) and every binding must declare
//! `read_only` / `low` / `L0`; anything else is rejected with
//! `READBACK_BINDING_NOT_READ_ONLY`.
//!
//! Read-back execution reuses the CP3 hardened runner through a thin
//! `ExecutionBinding` adapter: trusted executable candidates only, argv
//! built exclusively from the plan's trusted `verification_inputs`, no
//! shell, cwd allowlist, env allowlist, output bounds, process-tree kill and
//! secret redaction all stay enforced.

use std::ffi::OsString;
use std::path::PathBuf;

use serde_json::{Map, Value};

use crate::execution_broker::policy::{ExecutionBinding, ExecutionRiskPolicy, OutputLimits};
use crate::execution_broker::types::{
    AuthorityLevelWire, BrokerError, ErrorCode, RiskLevelWire, SideEffectClassWire,
};

use super::parser::parse_json_payload;
use super::types::{ReadbackParseResult, ReadbackRawOutput};

/// Trusted compiled read-back binding. Never registered from IPC.
pub trait ReadbackBinding: Send + Sync {
    /// Stable identifier used by the runner to select this binding.
    fn binding_id(&self) -> &str;
    /// Compiled adapter id for the verification capability.
    fn adapter_id(&self) -> &str;
    /// Must equal the originating plan's
    /// `verification_plan.verification_capability_id` (enforced by the
    /// runner; a mismatch is `READBACK_CAPABILITY_MISMATCH`).
    fn capability_id(&self) -> &str;
    /// Compiled capability version.
    fn capability_version(&self) -> &str;
    /// Native compiled risk policy for this verification binding. Must be
    /// `read_only` / `low` / `L0`; enforced at registration time.
    fn risk_policy(&self) -> ExecutionRiskPolicy;
    /// Trusted executable candidates, tried in order (CP3 resolver).
    fn executable_candidates(&self) -> &[PathBuf];
    /// Build argv exclusively from the trusted `verification_inputs`. No
    /// shell string, no caller-supplied argv.
    fn build_argv(&self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, String>;
    /// Allowlisted cwd roots (canonicalized at use time).
    fn allowed_cwd_roots(&self) -> &[PathBuf];
    /// Derive the working directory from the trusted verification inputs.
    fn derive_cwd(&self, inputs: &Map<String, Value>) -> Result<PathBuf, String>;
    /// Environment variable allowlist (secret names stripped by the runner).
    fn env_allowlist(&self) -> &[String];
    /// Output limits (broker clamps them; never raised).
    fn output_limits(&self) -> OutputLimits;
    /// Derive the canonical subject key from the trusted verification
    /// inputs. Callers can never supply a subject to bypass scope.
    fn subject_key(&self, inputs: &Map<String, Value>) -> Result<String, String>;
    /// Trusted parser: bounded raw output -> structured JSON-safe payload.
    /// Defaults to strict JSON parsing; bindings may implement structured
    /// extraction for their own machine-readable CLI flags, but must never
    /// regex natural-language success messages.
    fn parse(&self, raw: &ReadbackRawOutput) -> ReadbackParseResult {
        parse_json_payload(raw)
    }
}

/// Enforce the read-only verifier rule at registration time.
pub fn validate_readback_risk(policy: &ExecutionRiskPolicy) -> Result<(), BrokerError> {
    if policy.risk_level != RiskLevelWire::Low
        || policy.side_effect_class != SideEffectClassWire::ReadOnly
        || policy.required_authority != AuthorityLevelWire::L0
    {
        return Err(BrokerError::new(
            ErrorCode::ReadbackBindingNotReadOnly,
            "a verification binding must be read_only / low / L0; a write or elevated binding can never observe state for verification",
        ));
    }
    Ok(())
}

/// Thin adapter that lets the hardened CP3 execution runner execute a
/// read-back binding. This is an internal role adapter, never a public
/// execution surface.
pub(crate) struct ReadbackExecutionAdapter<'a> {
    inner: &'a dyn ReadbackBinding,
}

impl<'a> ReadbackExecutionAdapter<'a> {
    pub fn new(inner: &'a dyn ReadbackBinding) -> Self {
        Self { inner }
    }
}

impl ExecutionBinding for ReadbackExecutionAdapter<'_> {
    fn binding_id(&self) -> &str {
        self.inner.binding_id()
    }

    fn adapter_id(&self) -> &str {
        self.inner.adapter_id()
    }

    fn capability_id(&self) -> &str {
        self.inner.capability_id()
    }

    fn executable_candidates(&self) -> &[PathBuf] {
        self.inner.executable_candidates()
    }

    fn build_argv(&self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, String> {
        self.inner.build_argv(inputs)
    }

    fn allowed_cwd_roots(&self) -> &[PathBuf] {
        self.inner.allowed_cwd_roots()
    }

    fn derive_cwd(&self, inputs: &Map<String, Value>) -> Result<PathBuf, String> {
        self.inner.derive_cwd(inputs)
    }

    fn env_allowlist(&self) -> &[String] {
        self.inner.env_allowlist()
    }

    fn output_limits(&self) -> OutputLimits {
        self.inner.output_limits()
    }

    fn capability_version(&self) -> &str {
        self.inner.capability_version()
    }

    fn risk_policy(&self) -> ExecutionRiskPolicy {
        // Every registered read-back binding was validated as
        // read_only / low / L0 at registration time.
        ExecutionRiskPolicy::read_only_low_l0()
    }
}
