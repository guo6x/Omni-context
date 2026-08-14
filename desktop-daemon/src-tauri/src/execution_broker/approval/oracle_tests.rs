//! Goal24 Checkpoint 7 (Integration) ? adversarial execution map oracle.
//!
//! Loads the committed machine-readable map
//! (`docs/goal24/checkpoint7-adversarial-execution-map.json`) and verifies
//! the map is structurally complete and honest. All 280 CP7 vectors are
//! mapped exactly once, no vector is UNMAPPED, no vector has failed, and
//! every referenced test exists in the embedded test_registry whose entries
//! name suites that participate in this checkpoint's conformance runs
//! (brain goal24 suites / this crate).
//! The registry itself is machine-extracted from `vitest --reporter=json`
//! and `cargo test -- --list` output during CP7 integration; this oracle
//! freezes the referential integrity of that extraction on every test run.

use std::collections::HashSet;
use std::path::PathBuf;

fn map_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../docs/goal24/checkpoint7-adversarial-execution-map.json")
}

const STATUSES: &[&str] = &[
    "AUTOMATED",
    "COVERED_BY_EXISTING_TEST",
    "MANUAL",
    "NOT_APPLICABLE",
];

#[test]
fn adversarial_execution_map_is_complete_and_honest() {
    let text = std::fs::read_to_string(map_path()).expect("adversarial execution map");
    let map: serde_json::Value = serde_json::from_str(&text).expect("valid map JSON");

    assert_eq!(map["goal24_checkpoint"].as_str(), Some("7"));
    assert_eq!(
        map["vectors_source"].as_str(),
        Some("docs/goal24/cp7-approval-adversarial-vectors.json")
    );

    let counts = &map["counts"];
    assert_eq!(
        counts["total"].as_u64(),
        Some(280),
        "all 280 vectors must be present"
    );
    assert_eq!(counts["unmapped"].as_u64(), Some(0), "unmapped must be 0");
    assert_eq!(counts["failed"].as_u64(), Some(0), "failed must be 0");
    assert_eq!(
        counts["automated"].as_u64().unwrap_or(0)
            + counts["covered"].as_u64().unwrap_or(0)
            + counts["manual"].as_u64().unwrap_or(0)
            + counts["not_applicable"].as_u64().unwrap_or(0),
        280,
        "status counts must sum to total"
    );

    let vectors = map["vectors"].as_array().expect("vectors array");
    assert_eq!(vectors.len(), 280, "vector array length must be 280");

    let mut ids = HashSet::new();
    let mut categories = HashSet::new();
    let mut automated = 0u64;
    let mut covered = 0u64;
    let mut manual = 0u64;
    let mut not_applicable = 0u64;
    let mut failed = 0u64;

    for vector in vectors {
        let id = vector["id"].as_str().expect("vector id");
        assert!(
            id.starts_with("CP7V-"),
            "vector id must use the CP7V- prefix: {id}"
        );
        assert!(ids.insert(id.to_string()), "duplicate vector id: {id}");
        categories.insert(vector["category"].as_str().expect("category").to_string());

        let status = vector["status"].as_str().expect("status");
        assert!(STATUSES.contains(&status), "unknown status: {status}");
        match status {
            "AUTOMATED" => automated += 1,
            "COVERED_BY_EXISTING_TEST" => covered += 1,
            "MANUAL" => manual += 1,
            "NOT_APPLICABLE" => not_applicable += 1,
            _ => unreachable!(),
        }

        assert_eq!(
            vector["result"].as_str(),
            Some("PASS"),
            "vector {id} must pass"
        );
        if vector["result"] != "PASS" {
            failed += 1;
        }
        let reason = vector["reason"].as_str().expect("reason");
        assert!(!reason.trim().is_empty(), "vector {id} must have a reason");

        if status == "MANUAL" || status == "NOT_APPLICABLE" {
            assert_eq!(vector["suite"].as_str(), Some("none"), "vector {id} suite");
            assert_eq!(
                vector["test_name"].as_str(),
                Some("none"),
                "vector {id} test_name"
            );
        } else {
            let suite = vector["suite"].as_str().expect("suite");
            assert!(
                suite == "brain" || suite == "rust",
                "vector {id} has unknown suite {suite}"
            );
            let test_name = vector["test_name"].as_str().expect("test_name");
            assert!(
                !test_name.trim().is_empty(),
                "vector {id} must name a real test"
            );
        }
    }

    assert_eq!(automated, counts["automated"].as_u64().unwrap_or(0));
    assert_eq!(covered, counts["covered"].as_u64().unwrap_or(0));
    assert_eq!(manual, counts["manual"].as_u64().unwrap_or(0));
    assert_eq!(
        not_applicable,
        counts["not_applicable"].as_u64().unwrap_or(0)
    );
    assert_eq!(failed, 0, "failed vectors must be 0");
    assert_eq!(categories.len(), 36, "all 36 categories must be present");

    // Registry referential integrity: every referenced (suite, test_name) pair
    // must appear in test_registry, and every registry entry must be well-formed.
    let registry = map["test_registry"].as_array().expect("test_registry");
    let registry_keys: HashSet<(String, String)> = registry
        .iter()
        .map(|entry| {
            let suite = entry["suite"].as_str().expect("registry suite");
            let test_name = entry["test_name"].as_str().expect("registry test name");
            assert!(
                suite == "brain" || suite == "rust",
                "registry entry has unknown suite {suite}"
            );
            assert!(
                !test_name.trim().is_empty(),
                "registry entry has empty test name"
            );
            (suite.to_string(), test_name.to_string())
        })
        .collect();

    for vector in vectors {
        let status = vector["status"].as_str().expect("status");
        if status == "MANUAL" || status == "NOT_APPLICABLE" {
            continue;
        }
        let suite = vector["suite"].as_str().expect("suite");
        let test_name = vector["test_name"].as_str().expect("test_name");
        assert!(
            registry_keys.contains(&(suite.to_string(), test_name.to_string())),
            "vector {} references test ({suite}, {test_name}) that is missing from test_registry",
            vector["id"].as_str().unwrap_or("?")
        );
    }

    // Every fail_oracle item must be covered by at least one category or an
    // explicit static-audit note.
    let fail_oracle = map["fail_oracle_coverage"]
        .as_array()
        .expect("fail_oracle_coverage");
    assert_eq!(
        fail_oracle.len(),
        14,
        "all 14 fail-oracle items must be mapped"
    );
    for item in fail_oracle {
        let covered = item["covered_categories"]
            .as_array()
            .expect("covered_categories");
        let has_note = item["note"].as_str().is_some_and(|n| !n.trim().is_empty());
        assert!(
            !covered.is_empty() || has_note,
            "fail-oracle item must have covered categories or a static-audit note: {:?}",
            item["oracle"]
        );
    }
}
