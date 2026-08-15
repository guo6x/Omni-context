//! Goal24 Checkpoint 8 (Lane B) - receipt identity, digest and transitions.
//!
//! Identity fields are immutable after creation. Lifecycle updates only move
//! through the legal transition table below; a completed receipt can never
//! rewind to `spawn_started` and a `spawn_failed` receipt can never claim it
//! spawned.

use serde_json::{Map, Value};

use crate::execution_broker::approval::digest::{canonical_json, sha256_hex};
use crate::execution_broker::types::{BrokerError, ErrorCode, ExecutionPlanWire};

use super::types::{ExecutionReceipt, ExecutionReceiptState, ATTEMPT_ID_PREFIX, RECEIPT_ID_PREFIX};

/// Legal lifecycle transitions. History rewind is forbidden; the only way out
/// of `spawn_started`/`accepted` after a crash is `unknown_after_crash`.
pub fn transition_allowed(from: ExecutionReceiptState, to: ExecutionReceiptState) -> bool {
    matches!(
        (from, to),
        (
            ExecutionReceiptState::Accepted,
            ExecutionReceiptState::SpawnStarted
        ) | (
            ExecutionReceiptState::Accepted,
            ExecutionReceiptState::SpawnFailed
        ) | (
            ExecutionReceiptState::Accepted,
            ExecutionReceiptState::UnknownAfterCrash
        ) | (
            ExecutionReceiptState::SpawnStarted,
            ExecutionReceiptState::Completed
        ) | (
            ExecutionReceiptState::SpawnStarted,
            ExecutionReceiptState::UnknownAfterCrash
        )
    )
}

/// Native-generated receipt id: prefix + 32 random hex chars. Callers can
/// never submit one.
pub fn new_receipt_id() -> Result<String, BrokerError> {
    Ok(format!(
        "{}{}",
        RECEIPT_ID_PREFIX,
        crate::execution_broker::approval::digest::random_hex32()?
    ))
}

/// Native-generated verification attempt id (Brain-issued server-owned ids
/// are accepted through the explicit-attempt variant with strict bounds).
pub fn new_attempt_id() -> Result<String, BrokerError> {
    Ok(format!(
        "{}{}",
        ATTEMPT_ID_PREFIX,
        crate::execution_broker::approval::digest::random_hex32()?
    ))
}

/// Validate a caller-supplied opaque attempt id (bounded, printable, no
/// leading dash). Native ids always pass.
pub fn valid_attempt_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if !(8..=128).contains(&bytes.len()) {
        return false;
    }
    if !bytes[0].is_ascii_alphanumeric() {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-')
}

fn valid_receipt_id(id: &str) -> bool {
    let Some(hex) = id.strip_prefix(RECEIPT_ID_PREFIX) else {
        return false;
    };
    hex.len() == 32 && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

/// SHA-256 over the canonical JSON of `normalized_inputs` (CP7 canonical
/// rules: sorted keys, strict number domain).
pub fn normalized_inputs_digest(inputs: &Map<String, Value>) -> Result<String, BrokerError> {
    let canonical = canonical_json(&Value::Object(inputs.clone()))?;
    Ok(sha256_hex(canonical.as_bytes()))
}

/// SHA-256 over the canonical JSON of the full `verification_plan` object
/// (identical definition to the CP7 approval binding's
/// `verification_plan_digest`).
pub fn verification_plan_digest(plan: &ExecutionPlanWire) -> Result<Option<String>, BrokerError> {
    let Some(verification_plan) = &plan.verification_plan else {
        return Ok(None);
    };
    let value = serde_json::to_value(verification_plan).map_err(|err| {
        BrokerError::new(
            ErrorCode::PlanRejectedInvalid,
            format!("verification plan cannot be serialized: {err}"),
        )
    })?;
    let canonical = canonical_json(&value)?;
    Ok(Some(sha256_hex(canonical.as_bytes())))
}

/// Build the immutable identity object a receipt digest covers.
fn identity_object(receipt: &ExecutionReceipt) -> Value {
    serde_json::json!({
        "receipt_id": receipt.receipt_id,
        "plan_id": receipt.plan_id,
        "decision_id": receipt.decision_id,
        "capability_id": receipt.capability_id,
        "capability_version": receipt.capability_version,
        "adapter_id": receipt.adapter_id,
        "binding_id": receipt.binding_id,
        "normalized_inputs_digest": receipt.normalized_inputs_digest,
        "verification_plan_digest": receipt.verification_plan_digest,
        "verification_capability_id": receipt.verification_capability_id,
        "verification_inputs": receipt.verification_inputs,
        "accepted_at": receipt.accepted_at,
        "source": receipt.source,
    })
}

/// Recompute the receipt digest from the immutable identity fields.
pub fn compute_receipt_digest(receipt: &ExecutionReceipt) -> Result<String, BrokerError> {
    let canonical = canonical_json(&identity_object(receipt))?;
    Ok(sha256_hex(canonical.as_bytes()))
}

/// Constant-time digest equality (imported from the approval authority).
fn digest_eq(a: &str, b: &str) -> bool {
    crate::execution_broker::approval::digest::constant_time_eq(a, b)
}

/// Verify the stored `receipt_digest` matches the identity fields. Used on
/// store load and before every read-back; a mismatch fails closed.
pub fn verify_receipt_digest(receipt: &ExecutionReceipt) -> Result<(), BrokerError> {
    if !valid_receipt_id(&receipt.receipt_id) {
        return Err(BrokerError::new(
            ErrorCode::BrokerReceiptStoreCorrupt,
            "receipt_id does not match the native receipt id pattern",
        ));
    }
    let recomputed = compute_receipt_digest(receipt)?;
    if !digest_eq(&recomputed, &receipt.receipt_digest) {
        return Err(BrokerError::new(
            ErrorCode::ReceiptDigestMismatch,
            format!("receipt {} identity digest mismatch", receipt.receipt_id),
        ));
    }
    Ok(())
}

/// Construct a native-owned `accepted` receipt from a plan that already
/// passed the broker gate. The verification linkage is copied natively here;
/// a caller can never supply it later.
pub fn build_accepted_receipt(
    plan: &ExecutionPlanWire,
    binding_id: &str,
    accepted_at: &str,
) -> Result<ExecutionReceipt, BrokerError> {
    let receipt_id = new_receipt_id()?;
    let normalized_inputs_digest = normalized_inputs_digest(&plan.normalized_inputs)?;
    let verification_plan_digest = verification_plan_digest(plan)?;
    let (verification_capability_id, verification_inputs) = match &plan.verification_plan {
        Some(verification_plan) => (
            Some(verification_plan.verification_capability_id.clone()),
            Some(verification_plan.verification_inputs.clone()),
        ),
        None => (None, None),
    };
    let mut receipt = ExecutionReceipt {
        receipt_id,
        plan_id: plan.plan_id.clone(),
        decision_id: plan.decision_id.clone(),
        source: "native_broker".to_string(),
        capability_id: plan.capability_id.clone(),
        capability_version: plan.capability_version.clone(),
        adapter_id: plan.adapter_id.clone(),
        binding_id: binding_id.to_string(),
        execution_id: None,
        normalized_inputs_digest,
        verification_plan_digest,
        verification_capability_id,
        verification_inputs,
        execution_state: ExecutionReceiptState::Accepted,
        accepted_at: accepted_at.to_string(),
        spawn_started_at: None,
        finished_at: None,
        exit_code: None,
        timed_out: false,
        cancelled: false,
        stdout_digest: None,
        stderr_digest: None,
        output_truncated: false,
        output_redacted: false,
        resolved_executable_fingerprint: None,
        receipt_digest: String::new(),
        verification_attempts: Vec::new(),
    };
    receipt.receipt_digest = compute_receipt_digest(&receipt)?;
    Ok(receipt)
}

/// Structural sanity for a loaded receipt. Violations mark the whole store
/// corrupt; the store is never reset to empty.
pub fn validate_receipt_structure(receipt: &ExecutionReceipt) -> Result<(), BrokerError> {
    if !valid_receipt_id(&receipt.receipt_id) {
        return Err(structural_error("invalid receipt_id"));
    }
    if receipt.source != "native_broker" {
        return Err(structural_error("receipt source must be native_broker"));
    }
    if !ExecutionPlanWire::valid_plan_id(&receipt.plan_id) {
        return Err(structural_error("invalid plan_id"));
    }
    if receipt.normalized_inputs_digest.len() != 64
        || !receipt
            .normalized_inputs_digest
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
    {
        return Err(structural_error("malformed normalized_inputs_digest"));
    }
    if receipt.receipt_digest.len() != 64 {
        return Err(structural_error("malformed receipt_digest"));
    }
    verify_receipt_digest(receipt).map_err(|_| {
        structural_error("receipt digest does not match the stored identity fields")
    })?;
    match receipt.execution_state {
        ExecutionReceiptState::Accepted => {
            if receipt.spawn_started_at.is_some() || receipt.finished_at.is_some() {
                return Err(structural_error(
                    "accepted receipt must not carry lifecycle markers",
                ));
            }
        }
        ExecutionReceiptState::SpawnStarted => {
            if receipt.spawn_started_at.is_none() || receipt.finished_at.is_some() {
                return Err(structural_error(
                    "spawn_started receipt must carry spawn_started_at and no finished_at",
                ));
            }
        }
        ExecutionReceiptState::Completed => {
            if receipt.spawn_started_at.is_none() || receipt.finished_at.is_none() {
                return Err(structural_error(
                    "completed receipt must carry spawn_started_at and finished_at",
                ));
            }
        }
        ExecutionReceiptState::SpawnFailed => {
            if receipt.spawn_started_at.is_some() {
                return Err(structural_error(
                    "spawn_failed receipt must not carry spawn_started_at",
                ));
            }
        }
        ExecutionReceiptState::UnknownAfterCrash => {}
    }
    let mut seen = std::collections::HashSet::new();
    for attempt in &receipt.verification_attempts {
        if !valid_attempt_id(&attempt.attempt_id) || !seen.insert(&attempt.attempt_id) {
            return Err(structural_error("invalid or duplicate attempt id"));
        }
    }
    if receipt.verification_attempts.len() > super::types::MAX_VERIFICATION_ATTEMPTS {
        return Err(structural_error(
            "attempt count exceeds the native hard bound",
        ));
    }
    Ok(())
}

fn structural_error(reason: &str) -> BrokerError {
    BrokerError::new(
        ErrorCode::BrokerReceiptStoreCorrupt,
        format!("receipt structure invalid: {reason}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution_broker::tests::plan;
    use crate::execution_broker::ExecutionPlanStateWire;

    #[test]
    fn transition_table_forbids_history_rewind() {
        assert!(transition_allowed(
            ExecutionReceiptState::Accepted,
            ExecutionReceiptState::SpawnStarted
        ));
        assert!(transition_allowed(
            ExecutionReceiptState::Accepted,
            ExecutionReceiptState::SpawnFailed
        ));
        assert!(transition_allowed(
            ExecutionReceiptState::SpawnStarted,
            ExecutionReceiptState::Completed
        ));
        assert!(transition_allowed(
            ExecutionReceiptState::SpawnStarted,
            ExecutionReceiptState::UnknownAfterCrash
        ));
        assert!(!transition_allowed(
            ExecutionReceiptState::Completed,
            ExecutionReceiptState::SpawnStarted
        ));
        assert!(!transition_allowed(
            ExecutionReceiptState::SpawnFailed,
            ExecutionReceiptState::SpawnStarted
        ));
        assert!(!transition_allowed(
            ExecutionReceiptState::Completed,
            ExecutionReceiptState::UnknownAfterCrash
        ));
    }

    #[test]
    fn receipt_ids_are_unpredictable_and_patterned() {
        let a = new_receipt_id().expect("receipt id");
        let b = new_receipt_id().expect("receipt id");
        assert_ne!(a, b);
        assert!(valid_receipt_id(&a));
        assert!(valid_receipt_id(&b));
        assert!(!valid_receipt_id("caller-forged-id"));
    }

    #[test]
    fn receipt_digest_binds_verification_inputs() {
        let mut p = plan(ExecutionPlanStateWire::Ready);
        p.verification_plan = Some(crate::execution_broker::types::VerificationPlanWire {
            verification_capability_id: "test.fixture.readback".to_string(),
            verification_inputs: serde_json::json!({ "path": "a" })
                .as_object()
                .unwrap()
                .clone(),
            description: None,
        });
        let receipt =
            build_accepted_receipt(&p, "test.self.run", "2026-08-14T00:00:00Z").expect("receipt");
        assert!(verify_receipt_digest(&receipt).is_ok());
        let mut tampered = receipt.clone();
        tampered.verification_inputs.as_mut().unwrap().insert(
            "path".to_string(),
            serde_json::Value::String("b".to_string()),
        );
        assert!(matches!(
            verify_receipt_digest(&tampered),
            Err(BrokerError {
                code: ErrorCode::ReceiptDigestMismatch,
                ..
            })
        ));
    }
}
