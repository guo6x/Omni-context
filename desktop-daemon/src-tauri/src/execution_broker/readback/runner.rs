//! Goal24 Checkpoint 8 (Lane B) - restricted read-back verification runner.
//!
//! `performReadback({ receipt_id })` is the only request shape. The runner
//! never accepts a caller-constructed `BrokerExecutionResult`, a
//! verification capability override, verification inputs override,
//! executable, argv, cwd, env or expected result: everything comes from the
//! trusted native receipt record and the trusted compiled `ReadbackBinding`.
//!
//! The runner performs exactly one attempt per call (no `while(true)`); the
//! hard native bound is `MAX_VERIFICATION_ATTEMPTS` and each attempt id is
//! single-use. It returns an observation envelope and never sets
//! `verified=true`: semantic comparison belongs to the Brain evaluator.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{Map, Value};

use crate::execution_broker::policy::ExecutionBinding;
use crate::execution_broker::runner::{self, ExecutionRegistry};
use crate::execution_broker::types::{
    BrokerError, ErrorCode, EvidenceCoverageSnapshotWire, ExecutionPlanStateWire,
    ExecutionPlanWire, RiskSnapshotWire,
};

use super::binding::{validate_readback_risk, ReadbackBinding, ReadbackExecutionAdapter};
use super::parser::{final_parser_status, payload_digest};
use super::receipt::{new_attempt_id, verify_receipt_digest};
use super::store::ReceiptStore;
use super::types::{
    ExecutionReceipt, ExecutionReceiptState, ReadbackObservationEnvelope, ReadbackRawOutput,
    READBACK_TIMEOUT_MS,
};

/// Trusted compiled read-back registry. IPC callers, skills and LLMs can
/// never register a binding.
pub struct ReadbackRunner {
    bindings: Mutex<HashMap<String, Arc<dyn ReadbackBinding>>>,
    registry: ExecutionRegistry,
}

impl Default for ReadbackRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl ReadbackRunner {
    pub fn new() -> Self {
        Self {
            bindings: Mutex::new(HashMap::new()),
            registry: ExecutionRegistry::default(),
        }
    }

    /// Register a trusted compiled read-back binding. Enforces the
    /// read-only / low / L0 verifier rule and the capability id pattern.
    pub fn register(&self, binding: Box<dyn ReadbackBinding>) -> Result<(), BrokerError> {
        let policy = binding.risk_policy();
        validate_readback_risk(&policy)?;
        if !ExecutionPlanWire::valid_capability_id(binding.capability_id()) {
            return Err(BrokerError::new(
                ErrorCode::ReadbackBindingNotReadOnly,
                format!(
                    "verification capability_id '{}' does not match the contract pattern",
                    binding.capability_id()
                ),
            ));
        }
        self.bindings
            .lock()
            .unwrap()
            .insert(binding.capability_id().to_string(), binding.into());
        Ok(())
    }

    /// Test/crate inspection: whether a capability id is registered.
    #[allow(dead_code)]
    pub fn has_binding(&self, capability_id: &str) -> bool {
        self.bindings.lock().unwrap().contains_key(capability_id)
    }

    /// Perform one read-back for a receipt with a native-generated attempt
    /// id.
    pub fn perform_readback(
        &self,
        store: &ReceiptStore,
        receipt_id: &str,
    ) -> Result<ReadbackObservationEnvelope, BrokerError> {
        let attempt_id = new_attempt_id()?;
        self.perform_readback_attempt(store, receipt_id, Some(&attempt_id))
    }

    /// Perform one read-back with an explicit server-owned opaque attempt id
    /// (used by tests and future Integration). Attempt ids are single-use
    /// and durably reserved before the read-back process spawns.
    pub fn perform_readback_attempt(
        &self,
        store: &ReceiptStore,
        receipt_id: &str,
        attempt_id: Option<&str>,
    ) -> Result<ReadbackObservationEnvelope, BrokerError> {
        // 1. Store health (a corrupt store fails closed, never reset empty).
        if let Some(err) = store.degradation() {
            return Err(err);
        }

        // 2. Trusted receipt lookup. A caller-constructed result JSON is
        // never accepted: the store record is the only execution authority.
        let receipt = store.get(receipt_id)?.ok_or_else(|| {
            BrokerError::new(
                ErrorCode::ReceiptNotFound,
                format!("receipt_id not found: {receipt_id}"),
            )
        })?;

        // 3. Eligibility comes from the trusted lifecycle, never from the
        // caller. `accepted` (no observed spawn) and `spawn_failed` (provably
        // no process) have nothing to read back.
        if matches!(
            receipt.execution_state,
            ExecutionReceiptState::Accepted | ExecutionReceiptState::SpawnFailed
        ) {
            return Err(BrokerError::new(
                ErrorCode::ReadbackNotEligible,
                format!(
                    "receipt {} state {:?} is not read-back eligible",
                    receipt.receipt_id, receipt.execution_state
                ),
            ));
        }

        // 4. Verification linkage must exist in the trusted receipt.
        let verification_capability_id = receipt
            .verification_capability_id
            .as_ref()
            .ok_or_else(|| {
                BrokerError::new(
                    ErrorCode::ReadbackNotEligible,
                    format!(
                        "receipt {} carries no verification plan",
                        receipt.receipt_id
                    ),
                )
            })?
            .clone();
        let verification_inputs = receipt.verification_inputs.clone().ok_or_else(|| {
            BrokerError::new(
                ErrorCode::ReadbackNotEligible,
                format!(
                    "receipt {} carries no verification inputs",
                    receipt.receipt_id
                ),
            )
        })?;

        // 5. Digest integrity: identity tampering fails closed.
        verify_receipt_digest(&receipt)?;

        // 6. The verification capability must be registered under exactly
        // the originating plan's verification capability id.
        let binding = {
            let guard = self.bindings.lock().unwrap();
            guard
                .get(&verification_capability_id)
                .cloned()
                .ok_or_else(|| {
                    BrokerError::new(
                        ErrorCode::ReadbackCapabilityMismatch,
                        format!(
                            "no trusted read-back binding for verification capability '{verification_capability_id}'"
                        ),
                    )
                })?
        };

        // 7. Write-ahead attempt reservation (single-use, bounded). Nothing
        // spawns before this durable reservation.
        let attempt_id = match attempt_id {
            Some(id) => id.to_string(),
            None => new_attempt_id()?,
        };
        let started_at = runner::now_rfc3339();
        store.reserve_attempt(receipt_id, &attempt_id, &started_at)?;

        // 8. Run the verification through the hardened CP3 runner. The plan
        // is built natively from the receipt's trusted verification linkage;
        // the caller can override nothing.
        let run_result = self.run_verification(&receipt, &verification_inputs, binding.as_ref());

        let result = match run_result {
            Ok(result) => result,
            Err(err) => {
                let _ = store.fail_attempt(receipt_id, &attempt_id, err.code);
                return Err(err);
            }
        };

        // 9. Structured parse (never natural-language regex). Truncated
        // output is never reported as a complete parse.
        let raw = ReadbackRawOutput {
            stdout: result.stdout.clone(),
            stderr: result.stderr.clone(),
            stdout_truncated: result.stdout_truncated,
            stderr_truncated: result.stderr_truncated,
            output_redacted: result.output_redacted,
        };
        let parsed = binding.parse(&raw);
        let truncated = raw.truncated();
        let parser_status = final_parser_status(parsed.status, truncated);
        let payload_digest = payload_digest(&parsed.payload)?;
        let observed_at = runner::now_rfc3339();
        let subject_key = binding.subject_key(&verification_inputs).map_err(|err| {
            BrokerError::new(
                ErrorCode::InternalError,
                format!("read-back subject key derivation failed: {err}"),
            )
        })?;

        let observation_id = format!(
            "obs_{}",
            crate::execution_broker::approval::digest::random_hex32()?
        );

        // 10. Persist the acquired observation metadata before returning it.
        store.complete_attempt(
            receipt_id,
            &attempt_id,
            &observed_at,
            &payload_digest,
            parser_status,
        )?;

        Ok(ReadbackObservationEnvelope {
            observation_id,
            verification_attempt_id: attempt_id,
            origin_plan_id: receipt.plan_id.clone(),
            origin_execution_receipt_id: receipt.receipt_id.clone(),
            verification_capability_id: binding.capability_id().to_string(),
            subject_key,
            observed_at,
            payload: parsed.payload,
            payload_digest,
            parser_status,
            truncated,
            source_adapter: binding.adapter_id().to_string(),
            source_binding: binding.binding_id().to_string(),
            process_exit_code: result.exit_code,
            process_timed_out: result.timed_out,
            process_cancelled: result.cancelled,
            resolved_executable_fingerprint: result.executable_fingerprint.clone(),
            process_duration_ms: result.duration_ms,
        })
    }

    /// Execute the verification capability through the hardened runner.
    fn run_verification(
        &self,
        receipt: &ExecutionReceipt,
        verification_inputs: &Map<String, Value>,
        binding: &dyn ReadbackBinding,
    ) -> Result<crate::execution_broker::types::BrokerExecutionResult, BrokerError> {
        let adapter = ReadbackExecutionAdapter::new(binding);
        let policy = adapter.risk_policy();
        let plan = ExecutionPlanWire {
            plan_id: format!(
                "rb-plan-{}",
                crate::execution_broker::approval::digest::random_hex32()?
            ),
            decision_id: format!("rb-decision-{}", receipt.receipt_id),
            capability_id: binding.capability_id().to_string(),
            capability_version: binding.capability_version().to_string(),
            adapter_id: binding.adapter_id().to_string(),
            normalized_inputs: verification_inputs.clone(),
            required_approval: false,
            approval: None,
            risk_snapshot: RiskSnapshotWire {
                risk_level: policy.risk_level,
                reversible: policy.reversible,
                side_effect_class: policy.side_effect_class,
                required_authority: policy.required_authority,
                capability_version: binding.capability_version().to_string(),
            },
            evidence_coverage_snapshot: EvidenceCoverageSnapshotWire { entries: vec![] },
            timeout_ms: READBACK_TIMEOUT_MS,
            verification_plan: None,
            rollback_plan: None,
            state: ExecutionPlanStateWire::Ready,
            created_at: runner::now_rfc3339(),
            expires_at: None,
            correlation_id: None,
            requested_by: Some("native-readback".to_string()),
        };
        runner::run(&plan, &adapter, &self.registry)
    }
}
