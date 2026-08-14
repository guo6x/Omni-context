//! Goal24 Checkpoint 7 (Lane B) - canonical digests and token material.
//!
//! Lane A defines the canonical `ApprovalBindingPayload` in TypeScript; this
//! module is the Rust mirror with the same canonical rules so the integration
//! step can run a 1:1 cross-language conformance check. JSON objects are
//! canonicalized by sorting keys byte-wise - the digest never depends on
//! `serde_json` map iteration order.

use sha2::{Digest, Sha256};

use crate::execution_broker::types::{BrokerError, ErrorCode, ExecutionPlanWire};

/// Digest format version prefix. Changes here change every approval binding
/// digest and therefore invalidate outstanding grants (fail-closed by design).
pub const APPROVAL_BINDING_DIGEST_PREFIX: &str = "cp7-approval-binding-v1";

/// Canonical JSON: objects sorted by key, arrays in order, strings escaped by
/// `serde_json`, numbers via their shortest JSON representation. Deterministic
/// across runs and across map insertion orders.
pub fn canonical_json(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(v) => v.to_string(),
        serde_json::Value::Number(v) => v.to_string(),
        serde_json::Value::String(v) => serde_json::to_string(v).expect("string serializes"),
        serde_json::Value::Array(items) => {
            let parts: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", parts.join(","))
        }
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let parts: Vec<String> = keys
                .iter()
                .map(|key| {
                    let k = serde_json::to_string(key).expect("key serializes");
                    format!("{}:{}", k, canonical_json(&map[*key]))
                })
                .collect();
            format!("{{{}}}", parts.join(","))
        }
    }
}

/// Lowercase hex SHA-256 of `data`.
pub fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Secure random hex (16 bytes -> 32 hex chars) via `getrandom`. The OS CSPRNG
/// is the only entropy source; there is no hand-rolled PRNG anywhere.
pub fn random_hex32() -> Result<String, BrokerError> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|err| {
        BrokerError::new(
            ErrorCode::InternalError,
            format!("secure random source unavailable: {err}"),
        )
    })?;
    let mut out = String::with_capacity(32);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    Ok(out)
}

/// High-entropy, unpredictable native token reference (prefix + 32 random hex).
pub fn new_token_reference() -> Result<String, BrokerError> {
    Ok(format!("grant_{}", random_hex32()?))
}

/// Token digest: SHA-256 over secure random grant material plus the approval
/// binding digest and the token reference. The authority computes this; a
/// caller-supplied `token_digest` is never accepted into the store.
pub fn token_digest(
    grant_material: &[u8],
    approval_binding_digest: &str,
    token_reference: &str,
) -> String {
    let mut payload = Vec::with_capacity(
        grant_material.len() + approval_binding_digest.len() + token_reference.len() + 2,
    );
    payload.extend_from_slice(grant_material);
    payload.push(b'\n');
    payload.extend_from_slice(approval_binding_digest.as_bytes());
    payload.push(b'\n');
    payload.extend_from_slice(token_reference.as_bytes());
    sha256_hex(&payload)
}

/// Constant-time equality for digests and token references.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut acc = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        acc |= x ^ y;
    }
    acc == 0
}

/// Canonical approval binding digest for a plan under a policy version.
///
/// Bound fields: plan identity, decision, capability/version, adapter,
/// normalized inputs, risk snapshot, coverage snapshot, timeout, verification
/// and rollback plans, created/expires timestamps and the policy version.
/// Mutating any of them changes the digest and invalidates the grant.
pub fn approval_binding_digest(plan: &ExecutionPlanWire, policy_version: &str) -> String {
    let risk = serde_json::to_value(&plan.risk_snapshot).expect("risk snapshot serializes");
    let evidence =
        serde_json::to_value(&plan.evidence_coverage_snapshot).expect("coverage serializes");
    let verification = match &plan.verification_plan {
        Some(value) => serde_json::to_value(value).expect("verification plan serializes"),
        None => serde_json::Value::Null,
    };
    let rollback = match &plan.rollback_plan {
        Some(value) => serde_json::to_value(value).expect("rollback plan serializes"),
        None => serde_json::Value::Null,
    };

    let mut payload = String::new();
    payload.push_str(APPROVAL_BINDING_DIGEST_PREFIX);
    payload.push('\n');
    payload.push_str(&format!("plan_id={}\n", plan.plan_id));
    payload.push_str(&format!("decision_id={}\n", plan.decision_id));
    payload.push_str(&format!("capability_id={}\n", plan.capability_id));
    payload.push_str(&format!("capability_version={}\n", plan.capability_version));
    payload.push_str(&format!("adapter_id={}\n", plan.adapter_id));
    payload.push_str(&format!(
        "normalized_inputs={}\n",
        canonical_json(&serde_json::Value::Object(plan.normalized_inputs.clone()))
    ));
    payload.push_str(&format!("risk_snapshot={}\n", canonical_json(&risk)));
    payload.push_str(&format!(
        "evidence_coverage_snapshot={}\n",
        canonical_json(&evidence)
    ));
    payload.push_str(&format!("timeout_ms={}\n", plan.timeout_ms));
    payload.push_str(&format!(
        "verification_plan={}\n",
        canonical_json(&verification)
    ));
    payload.push_str(&format!("rollback_plan={}\n", canonical_json(&rollback)));
    payload.push_str(&format!("created_at={}\n", plan.created_at));
    payload.push_str(&format!(
        "expires_at={}\n",
        plan.expires_at.as_deref().unwrap_or("null")
    ));
    payload.push_str(&format!("policy_version={}\n", policy_version));
    sha256_hex(payload.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_json_is_key_order_independent() {
        let a = serde_json::json!({"b": 1, "a": [true, null, "x"]});
        let b = serde_json::json!({"a": [true, null, "x"], "b": 1});
        assert_eq!(canonical_json(&a), canonical_json(&b));
        assert_eq!(canonical_json(&a), r#"{"a":[true,null,"x"],"b":1}"#);
    }

    #[test]
    fn token_reference_is_unpredictable() {
        let first = new_token_reference().expect("rng");
        let second = new_token_reference().expect("rng");
        assert_ne!(first, second);
        assert!(first.starts_with("grant_"));
        assert_eq!(first.len(), "grant_".len() + 32);
    }
}
