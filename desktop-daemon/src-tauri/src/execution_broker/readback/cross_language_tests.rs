//! Goal24 Checkpoint 8 (Integration) - cross-language golden vector tests.
//!
//! Reads the SHARED machine-readable fixtures under
//! `docs/goal24/fixtures/cp8-outcome/` and asserts the native side produces
//! exactly the verdicts the fixtures declare. The Brain test suite validates
//! the same files from the TypeScript side; cross-language mismatch must be
//! 0 on both sides.

use serde_json::Value;

use super::parser::payload_digest;
use super::state_map::map_state_to_effect_state;
use super::types::ExecutionReceiptState;

const STATE_MAPPING_FIXTURE: &str =
    include_str!("../../../../../docs/goal24/fixtures/cp8-outcome/execution-state-mapping.json");
const OBSERVATION_VECTORS_FIXTURE: &str = include_str!(
    "../../../../../docs/goal24/fixtures/cp8-outcome/readback-observation-vectors.json"
);

fn parse_receipt_state(state: &str) -> ExecutionReceiptState {
    match state {
        "accepted" => ExecutionReceiptState::Accepted,
        "spawn_started" => ExecutionReceiptState::SpawnStarted,
        "completed" => ExecutionReceiptState::Completed,
        "spawn_failed" => ExecutionReceiptState::SpawnFailed,
        "unknown_after_crash" => ExecutionReceiptState::UnknownAfterCrash,
        other => panic!("unknown native state {other}"),
    }
}

fn valid_capability_id(id: &str) -> bool {
    let segments: Vec<&str> = id.split('.').collect();
    if !(3..=5).contains(&segments.len()) {
        return false;
    }
    segments.iter().all(|segment| {
        let bytes = segment.as_bytes();
        !segment.is_empty()
            && bytes[0].is_ascii_lowercase()
            && bytes[1..]
                .iter()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    })
}

fn timestamp_ok(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

/// Test-only native envelope validator: the structural + digest + shape
/// rules the native layer guarantees when it EMITS an observation. It never
/// performs semantic verdicts (those belong to the Brain evaluator).
fn validate_native_envelope(envelope: &Value) -> Result<(), String> {
    let obj = envelope
        .as_object()
        .ok_or_else(|| "envelope must be an object".to_string())?;
    let get_str = |key: &str| -> Result<&str, String> {
        obj.get(key)
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("field {key} must be a string"))
    };
    let observation_id = get_str("observation_id")?;
    if observation_id.is_empty() {
        return Err("observation_id must not be empty".to_string());
    }
    let attempt_id = get_str("verification_attempt_id")?;
    if attempt_id.is_empty() {
        return Err("verification_attempt_id must not be empty".to_string());
    }
    let origin_plan_id = get_str("origin_plan_id")?;
    if origin_plan_id.is_empty() {
        return Err("origin_plan_id must not be empty".to_string());
    }
    let origin_receipt_id = get_str("origin_execution_receipt_id")?;
    if origin_receipt_id.is_empty() {
        return Err("origin_execution_receipt_id must not be empty".to_string());
    }
    let capability = get_str("verification_capability_id")?;
    if !valid_capability_id(capability) {
        return Err(format!("invalid verification_capability_id {capability}"));
    }
    let subject_key = get_str("subject_key")?;
    if subject_key.is_empty() || subject_key.len() > 200 {
        return Err("subject_key must be 1..=200 chars".to_string());
    }
    let attempt_started_at = get_str("attempt_started_at")?;
    let observed_at = get_str("observed_at")?;
    if !timestamp_ok(attempt_started_at) || !timestamp_ok(observed_at) {
        return Err("timestamps must be RFC3339".to_string());
    }
    let attempt_ts = chrono::DateTime::parse_from_rfc3339(attempt_started_at).unwrap();
    let observed_ts = chrono::DateTime::parse_from_rfc3339(observed_at).unwrap();
    if observed_ts < attempt_ts {
        return Err("observed_at must not precede attempt_started_at".to_string());
    }
    let payload = obj
        .get("payload")
        .ok_or_else(|| "payload missing".to_string())?;
    if !payload.is_object() {
        return Err("payload must be a JSON object".to_string());
    }
    let payload_digest_value = get_str("payload_digest")?;
    let recomputed = payload_digest(payload).map_err(|err| err.to_string())?;
    if recomputed != payload_digest_value {
        return Err("payload_digest does not match the payload".to_string());
    }
    let truncated = obj
        .get("truncated")
        .and_then(|v| v.as_bool())
        .ok_or_else(|| "truncated must be a boolean".to_string())?;
    let parser_status = get_str("parser_status")?;
    if !matches!(parser_status, "parsed" | "malformed" | "truncated") {
        return Err(format!(
            "native parser status {parser_status} is not emittable"
        ));
    }
    if truncated && parser_status != "truncated" {
        return Err("truncated output must be reported with parser_status=truncated".to_string());
    }
    if !truncated && parser_status == "truncated" {
        return Err("parser_status=truncated requires the truncated flag".to_string());
    }
    let source_adapter = get_str("source_adapter")?;
    if source_adapter.is_empty() {
        return Err("source_adapter must not be empty".to_string());
    }
    let source_binding = get_str("source_binding")?;
    if source_binding.is_empty() {
        return Err("source_binding must not be empty".to_string());
    }
    let process_timed_out = obj
        .get("process_timed_out")
        .and_then(|v| v.as_bool())
        .ok_or_else(|| "process_timed_out must be a boolean".to_string())?;
    let process_cancelled = obj
        .get("process_cancelled")
        .and_then(|v| v.as_bool())
        .ok_or_else(|| "process_cancelled must be a boolean".to_string())?;
    if process_timed_out && process_cancelled {
        return Err("process_timed_out and process_cancelled cannot both be true".to_string());
    }
    match obj.get("process_duration_ms").and_then(|v| v.as_i64()) {
        Some(value) if value >= 0 => {}
        _ => return Err("process_duration_ms must be a non-negative integer".to_string()),
    }
    if let Some(exit_code) = obj.get("process_exit_code") {
        match exit_code.as_i64() {
            Some(value) if value >= 0 => {}
            _ => return Err("process_exit_code must be a non-negative integer".to_string()),
        }
    }
    Ok(())
}

#[test]
fn execution_state_mapping_vectors_cross_language() {
    let fixture: Value = serde_json::from_str(STATE_MAPPING_FIXTURE).expect("fixture JSON");
    let vectors = fixture["vectors"].as_array().expect("vectors array");
    assert!(
        vectors.len() >= 20,
        "state mapping fixture must carry >= 20 vectors"
    );
    let mut mismatches = 0usize;
    for vector in vectors {
        let id = vector["id"].as_str().unwrap_or("?");
        let state = parse_receipt_state(vector["state"].as_str().expect("state"));
        let recovered = vector["recovered"].as_bool().expect("recovered");
        let exit_code = vector["exit_code"].as_i64().map(|v| v as i32);
        let timed_out = vector["timed_out"].as_bool().expect("timed_out");
        let cancelled = vector["cancelled"].as_bool().expect("cancelled");
        let spawn_present = vector["spawn_started_at_present"]
            .as_bool()
            .expect("spawn_started_at_present");
        let result = map_state_to_effect_state(
            state,
            recovered,
            exit_code,
            timed_out,
            cancelled,
            spawn_present,
        );
        let expected_state = vector["expected_effect_state"].as_str();
        let expected_error = vector["expected_error"].as_str();
        let actual = match result {
            Ok(effect) => (Some(effect.as_str()), None),
            Err(err) => (None, Some(err.as_str())),
        };
        if actual != (expected_state, expected_error) {
            mismatches += 1;
            eprintln!(
                "MISMATCH {id}: expected ({expected_state:?},{expected_error:?}) got {actual:?}"
            );
        }
    }
    assert_eq!(
        mismatches, 0,
        "cross-language state mapping mismatch must be 0"
    );
}

#[test]
fn readback_eligibility_matches_shared_rule() {
    // Mirrors isNativeReadbackEligible (Brain) and the runner eligibility
    // gate: only states after an observed spawn (or a crash that may have
    // spawned) carry an observable post-state.
    use super::state_map::is_readback_eligible;
    assert!(!is_readback_eligible(
        ExecutionReceiptState::Accepted,
        false
    ));
    assert!(!is_readback_eligible(ExecutionReceiptState::Accepted, true));
    assert!(!is_readback_eligible(
        ExecutionReceiptState::SpawnFailed,
        false
    ));
    assert!(is_readback_eligible(
        ExecutionReceiptState::SpawnStarted,
        false
    ));
    assert!(is_readback_eligible(
        ExecutionReceiptState::Completed,
        false
    ));
    assert!(is_readback_eligible(
        ExecutionReceiptState::UnknownAfterCrash,
        true
    ));
}

#[test]
fn readback_observation_vectors_cross_language() {
    let fixture: Value = serde_json::from_str(OBSERVATION_VECTORS_FIXTURE).expect("fixture JSON");
    let vectors = fixture["vectors"].as_array().expect("vectors array");
    assert!(
        vectors.len() >= 30,
        "observation fixture must carry >= 30 vectors"
    );
    let mut mismatches = 0usize;
    for vector in vectors {
        let id = vector["id"].as_str().unwrap_or("?");
        let envelope = &vector["envelope"];
        let actual_valid = validate_native_envelope(envelope).is_ok();
        let expected_valid = vector["expected_native_valid"]
            .as_bool()
            .expect("expected_native_valid");
        if actual_valid != expected_valid {
            mismatches += 1;
            eprintln!("MISMATCH {id}: expected_native_valid={expected_valid} got {actual_valid}");
        }
    }
    assert_eq!(
        mismatches, 0,
        "cross-language observation mismatch must be 0"
    );
}
