//! Goal24 Checkpoint 7 (Integration) - Rust half of the cross-language
//! conformance test.
//!
//! Reads the SAME golden fixture files as the TypeScript test
//! (`brain-server/tests/goal24-cp7-cross-language.test.ts`):
//! `docs/goal24/fixtures/cp7-approval/binding-golden-vectors.json` and
//! `risk-policy-vectors.json`. A digest / policy / authority-order mismatch
//! here or in the TS half is a CP7 integration failure; neither language
//! maintains its own expected values.

use std::path::PathBuf;

use super::authority::APPROVAL_POLICY_VERSION;
use super::digest::{approval_binding_digest, approval_binding_payload};
use crate::execution_broker::policy::{authority_rank, ExecutionRiskPolicy};
use crate::execution_broker::types::{
    AuthorityLevelWire, ExecutionPlanWire, RiskLevelWire, SideEffectClassWire,
};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/goal24/fixtures/cp7-approval")
}

fn read_fixture(name: &str) -> serde_json::Value {
    let text = std::fs::read_to_string(fixtures_dir().join(name))
        .unwrap_or_else(|err| panic!("{name}: {err}"));
    serde_json::from_str(&text).unwrap_or_else(|err| panic!("{name}: {err}"))
}

fn digest_for(plan: &serde_json::Value, policy_version: &str) -> String {
    let wire: ExecutionPlanWire =
        serde_json::from_value(plan.clone()).expect("golden plan parses as ExecutionPlanWire");
    approval_binding_digest(&wire, policy_version).expect("binding digest")
}

#[test]
fn golden_binding_vectors_match_ts_exactly() {
    let fixture = read_fixture("binding-golden-vectors.json");
    let total = fixture["total_vectors"].as_u64().expect("total_vectors");
    let baseline_id = fixture["baseline_vector_id"].as_str().expect("baseline id");
    let policy_literal = fixture["policy_version_literal"]
        .as_str()
        .expect("policy literal");
    assert_eq!(APPROVAL_POLICY_VERSION, policy_literal);

    let vectors = fixture["vectors"].as_array().expect("vectors");
    assert_eq!(vectors.len() as u64, total);
    assert!(vectors.len() >= 30, "at least 30 golden vectors required");

    let mut baseline_digest: Option<String> = None;
    let mut negzero_digest: Option<String> = None;
    let mut zero_digest: Option<String> = None;
    let mut combining_digest: Option<String> = None;
    let mut precomposed_digest: Option<String> = None;
    let mut mutation_count = 0usize;

    for vector in vectors {
        let id = vector["id"].as_str().expect("vector id");
        let kind = vector["kind"].as_str().expect("vector kind");
        let policy_version = vector["policy_version"].as_str().expect("policy version");
        let expected_digest = vector["expected_digest"].as_str().expect("expected digest");

        let plan_value = &vector["plan"];
        let digest = digest_for(plan_value, policy_version);
        assert_eq!(digest, expected_digest, "digest mismatch for vector {id}");

        let wire: ExecutionPlanWire =
            serde_json::from_value(plan_value.clone()).expect("plan parses");
        let payload = approval_binding_payload(&wire, policy_version).expect("payload");
        assert_eq!(
            payload, vector["expected_payload"],
            "payload mismatch for vector {id}"
        );

        match id {
            value if value == baseline_id => baseline_digest = Some(digest.clone()),
            "golden-num-negzero" => negzero_digest = Some(digest.clone()),
            "golden-num-000" => zero_digest = Some(digest.clone()),
            "golden-uni-combining" => combining_digest = Some(digest.clone()),
            "golden-uni-precomposed" => precomposed_digest = Some(digest.clone()),
            _ => {}
        }
        if kind == "mutation" {
            mutation_count += 1;
            assert_eq!(
                vector["differs_from"].as_str().unwrap_or(""),
                baseline_id,
                "mutation {id} must differ from the baseline vector"
            );
            assert_ne!(
                digest,
                baseline_digest.as_deref().unwrap_or(""),
                "mutation {id} must change the digest"
            );
        }
    }

    let baseline = baseline_digest.expect("baseline digest present");
    let excluded = digest_for(
        &fixture["vectors"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["id"] == "golden-excluded-fields")
            .expect("excluded-fields vector")["plan"],
        "goal24-approval-policy-v1",
    );
    assert_eq!(
        excluded, baseline,
        "lifecycle fields (state/approval/required_approval) must never change the binding digest"
    );
    assert_eq!(
        negzero_digest.expect("negzero vector"),
        zero_digest.expect("zero vector"),
        "-0 must canonicalize to 0 with the same digest"
    );
    assert_ne!(
        combining_digest.expect("combining vector"),
        precomposed_digest.expect("precomposed vector"),
        "Unicode must never be normalized"
    );
    assert!(
        mutation_count >= 14,
        "mutation vectors must cover all bound fields"
    );
}

#[test]
fn risk_policy_native_minimum_matrix_matches_ts() {
    let fixture = read_fixture("risk-policy-vectors.json");
    assert_eq!(
        fixture["policy_version_literal"].as_str().expect("literal"),
        APPROVAL_POLICY_VERSION
    );
    let rows = fixture["native_minimum_matrix"].as_array().expect("matrix");
    assert_eq!(rows.len(), 4 * 3 * 4, "48 matrix rows expected");
    for row in rows {
        let side_effect_class: SideEffectClassWire =
            serde_json::from_value(row["side_effect_class"].clone()).expect("side effect");
        let risk_level: RiskLevelWire =
            serde_json::from_value(row["risk_level"].clone()).expect("risk level");
        let required_authority: AuthorityLevelWire =
            serde_json::from_value(row["required_authority"].clone()).expect("authority");
        let policy = ExecutionRiskPolicy {
            risk_level,
            side_effect_class,
            reversible: row["reversible"].as_bool().expect("reversible"),
            required_authority,
        };
        assert_eq!(
            policy.native_minimum_approval_required(),
            row["approval_required"]
                .as_bool()
                .expect("approval_required"),
            "matrix row mismatch: {row}"
        );
    }
}

#[test]
fn authority_order_and_satisfies_match_ts() {
    let fixture = read_fixture("risk-policy-vectors.json");
    for row in fixture["authority_order"].as_array().expect("order rows") {
        let lower: AuthorityLevelWire =
            serde_json::from_value(row["lower"].clone()).expect("lower");
        let higher: AuthorityLevelWire =
            serde_json::from_value(row["higher"].clone()).expect("higher");
        let ordered = row["ordered"].as_bool().expect("ordered");
        assert_eq!(
            authority_rank(lower) < authority_rank(higher),
            ordered,
            "authority order mismatch: {row}"
        );
    }
    for row in fixture["authority_satisfies"]
        .as_array()
        .expect("satisfies rows")
    {
        let actor: AuthorityLevelWire =
            serde_json::from_value(row["actor"].clone()).expect("actor");
        let required: AuthorityLevelWire =
            serde_json::from_value(row["required"].clone()).expect("required");
        let satisfies = row["satisfies"].as_bool().expect("satisfies");
        assert_eq!(
            authority_rank(actor) >= authority_rank(required),
            satisfies,
            "authority satisfies mismatch: {row}"
        );
    }
}

#[test]
fn policy_version_literal_is_shared() {
    let fixture = read_fixture("risk-policy-vectors.json");
    assert_eq!(
        APPROVAL_POLICY_VERSION,
        fixture["policy_version_literal"].as_str().expect("literal")
    );
    assert_eq!(APPROVAL_POLICY_VERSION, "goal24-approval-policy-v1");
}

#[test]
fn wire_plan_number_domain_fails_closed() {
    let fixture = read_fixture("binding-golden-vectors.json");
    let baseline = fixture["vectors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == "golden-001")
        .expect("baseline")["plan"]
        .clone();
    for (bad, label) in [
        ("9007199254740992", "above MAX_SAFE_INTEGER"),
        ("1e21", "exponent notation"),
        ("0.1234567", "7 fractional digits"),
        ("1e-7", "tiny exponent form"),
    ] {
        let mut plan = baseline.clone();
        plan["normalized_inputs"] = serde_json::json!({ "repo": "repo-a", "number": serde_json::from_str::<serde_json::Value>(bad).unwrap() });
        let wire: ExecutionPlanWire =
            serde_json::from_value(plan).expect("plan parses at the wire level");
        assert!(
            approval_binding_digest(&wire, "goal24-approval-policy-v1").is_err(),
            "out-of-domain number must fail closed: {label}"
        );
    }
}

#[test]
fn wire_unknown_enum_and_type_domain_fails_closed() {
    let fixture = read_fixture("binding-golden-vectors.json");
    let baseline = fixture["vectors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == "golden-001")
        .expect("baseline")["plan"]
        .clone();

    let mut cases: Vec<(serde_json::Value, &str)> = Vec::new();
    let mut bad = baseline.clone();
    bad["risk_snapshot"]["risk_level"] = serde_json::json!("risky");
    cases.push((bad, "unknown risk_level enum"));
    let mut bad = baseline.clone();
    bad["risk_snapshot"]["required_authority"] = serde_json::json!("L9");
    cases.push((bad, "unknown required_authority enum"));
    let mut bad = baseline.clone();
    bad["risk_snapshot"]["side_effect_class"] = serde_json::json!("write");
    cases.push((bad, "unknown side_effect_class enum"));
    let mut bad = baseline.clone();
    bad["state"] = serde_json::json!("flying");
    cases.push((bad, "unknown plan state enum"));
    let mut bad = baseline.clone();
    bad["required_approval"] = serde_json::json!("false");
    cases.push((bad, "non-boolean required_approval"));
    let mut bad = baseline.clone();
    bad["timeout_ms"] = serde_json::json!("5000");
    cases.push((bad, "string timeout_ms"));
    let mut bad = baseline.clone();
    bad["normalized_inputs"] = serde_json::json!(["not-an-object"]);
    cases.push((bad, "array where object declared"));

    for (plan, label) in cases {
        assert!(
            serde_json::from_value::<ExecutionPlanWire>(plan).is_err(),
            "wire must fail closed for {label}"
        );
    }
}
