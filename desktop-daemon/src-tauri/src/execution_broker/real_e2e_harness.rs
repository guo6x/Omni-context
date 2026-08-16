//! Goal24 Post-CP8 Real E2E (DRG-2 candidate) - native operator harness
//! (dev-only, #[ignore] test).
//!
//! Run ONLY via:
//!   cargo test --bin omni-context-desktop \
//!     goal24_real_e2e_native_phase -- --ignored --nocapture
//! with the following environment:
//!   OMNI_REAL_E2E_RUN=1
//!   OMNI_REAL_E2E_BRIDGE=<abs bridge dir>       (default: <crate>/../../.tmp/real-e2e)
//!   OMNI_REAL_E2E_APPROVAL_FILE=<abs file>      (human approval artifact)
//!   OMNI_GITHUB_CLI_EXE=<abs validated gh.exe>  (trusted operator config, same as prod)
//!
//! The harness NEVER auto-approves, NEVER accepts arbitrary capability ids,
//! argv, receipt JSON, observation JSON or outcome verdicts. It rebuilds the
//! plan from the compiled capability + canonical inputs, proves the CP7
//! binding digest matches the Brain-approved plan, requires the one-time
//! human approval artifact, executes the write exactly once through the
//! restricted broker, persists the receipt and performs exactly one trusted
//! read-back. Outcome authority stays with the Brain evaluator.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::execution_broker::approval::digest::approval_binding_digest;
use crate::execution_broker::approval::{ActorKind, GrantRequest};
use crate::execution_broker::{
    ApprovalReferenceWire, AuthorityLevelWire, Broker, EvidenceCoverageSnapshotWire,
    ExecutionPlanStateWire, ExecutionPlanWire, RiskSnapshotWire, VerificationPlanWire,
};
use crate::github_cli::adapter::GitHubCliAdapter;
use crate::github_cli::close_binding::github_issue_close_risk_policy;

pub(crate) const REAL_E2E_POLICY_VERSION: &str = "goal24-approval-policy-v1";

fn env_or(key: &str, default: String) -> String {
    std::env::var(key).unwrap_or(default)
}

fn bridge_dir() -> PathBuf {
    PathBuf::from(env_or(
        "OMNI_REAL_E2E_BRIDGE",
        format!("{}\\..\\..\\.tmp\\real-e2e", env!("CARGO_MANIFEST_DIR")),
    ))
}

fn read_json(path: &Path) -> Value {
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|err| panic!("bridge file {} unreadable: {err}", path.display()));
    serde_json::from_str(&text).expect("bridge JSON")
}

fn write_json(path: &Path, value: &Value) {
    std::fs::write(
        path,
        format!("{}\n", serde_json::to_string_pretty(value).unwrap()),
    )
    .expect("write bridge");
}

/// The exact one-time human approval artifact.
fn approval_line(owner: &str, repo: &str, number: u64) -> String {
    format!("APPROVE {owner}/{repo}#{number}")
}

fn risk_snapshot_wire() -> RiskSnapshotWire {
    let policy = github_issue_close_risk_policy();
    RiskSnapshotWire {
        risk_level: policy.risk_level,
        reversible: policy.reversible,
        side_effect_class: policy.side_effect_class,
        required_authority: policy.required_authority,
        capability_version: "1.0.0".to_string(),
    }
}

fn parse_verification_plan(value: Option<&Value>) -> Option<VerificationPlanWire> {
    match value {
        Some(v) => serde_json::from_value(v.clone()).expect("verification_plan shape"),
        None => None,
    }
}

fn parse_coverage(value: &Value) -> EvidenceCoverageSnapshotWire {
    serde_json::from_value(value.clone()).expect("evidence coverage shape")
}

/// Rebuild the plan from the compiled capability + the Brain-approved bridge
/// values. Every authority field (risk, capability identity, inputs schema)
/// comes from compiled trusted code; the bridge supplies only the
/// server-owned identities/timestamps/coverage the Brain decision bound.
fn rebuild_plan(brain: &Value) -> ExecutionPlanWire {
    let inputs = brain["normalized_inputs"]
        .as_object()
        .expect("normalized_inputs");
    let owner = inputs["owner"].as_str().expect("owner");
    let repo = inputs["repo"].as_str().expect("repo");
    let number = inputs["number"].as_u64().expect("number");
    if owner.is_empty() || repo.is_empty() || number == 0 {
        panic!("canonical inputs must carry owner/repo/positive number");
    }
    let capability_id = brain["capability_id"].as_str().expect("capability_id");
    assert_eq!(
        capability_id, "github.issue.close",
        "harness supports exactly one write"
    );
    let adapter_id = brain["adapter_id"].as_str().expect("adapter_id");
    assert_eq!(
        adapter_id, "github-cli",
        "harness supports exactly one adapter"
    );
    let version = brain["capability_version"]
        .as_str()
        .expect("capability_version");
    assert_eq!(
        version, "1.0.0",
        "harness supports exactly one capability version"
    );

    ExecutionPlanWire {
        plan_id: brain["plan_id"].as_str().expect("plan_id").to_string(),
        decision_id: brain["decision_id"]
            .as_str()
            .expect("decision_id")
            .to_string(),
        capability_id: capability_id.to_string(),
        capability_version: version.to_string(),
        adapter_id: adapter_id.to_string(),
        normalized_inputs: inputs.clone(),
        required_approval: true,
        approval: None,
        risk_snapshot: risk_snapshot_wire(),
        evidence_coverage_snapshot: parse_coverage(&brain["evidence_coverage_snapshot"]),
        timeout_ms: brain["timeout_ms"].as_u64().expect("timeout_ms"),
        verification_plan: parse_verification_plan(brain.get("verification_plan")),
        rollback_plan: None,
        state: ExecutionPlanStateWire::Ready,
        created_at: brain["created_at"]
            .as_str()
            .expect("created_at")
            .to_string(),
        expires_at: brain
            .get("expires_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        correlation_id: brain
            .get("correlation_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        requested_by: brain
            .get("requested_by")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    }
}

/// The native phase of the real E2E. Returns the machine-readable run record
/// (also written to the bridge for the Brain verify phase).
#[test]
#[ignore]
fn goal24_real_e2e_native_phase() {
    if std::env::var("OMNI_REAL_E2E_RUN").as_deref() != Ok("1") {
        eprintln!("[real-e2e] skipping: set OMNI_REAL_E2E_RUN=1 to run the native phase");
        return;
    }
    let bridge = bridge_dir();
    std::fs::create_dir_all(&bridge).expect("bridge dir");

    // 1. Load the Brain-approved decision output (server-owned identities only).
    let brain = read_json(&bridge.join("brain-before.json"));
    let plan = rebuild_plan(&brain);
    let inputs = plan.normalized_inputs.clone();
    let owner = inputs["owner"].as_str().unwrap().to_string();
    let repo = inputs["repo"].as_str().unwrap().to_string();
    let number = inputs["number"].as_u64().unwrap();
    println!(
        "[real-e2e] STEP 1-4: Brain decision/plan loaded: plan={} decision={}",
        plan.plan_id, plan.decision_id
    );

    // 2. Cross-side binding proof: the native recomputed CP7 binding digest
    // must equal the digest the Brain decision bound.
    let native_binding = approval_binding_digest(&plan, REAL_E2E_POLICY_VERSION).expect("binding");
    let brain_binding = brain["approval_binding_digest"]
        .as_str()
        .expect("approval_binding_digest");
    assert_eq!(
        &native_binding, brain_binding,
        "plan content must be byte-identical to the Brain-approved decision"
    );
    println!(
        "[real-e2e] STEP 2-3: evidence-bound plan identity matches (binding digest {})",
        &native_binding[..16]
    );

    // 3. Trusted gh discovery via the SAME production adapter bootstrap.
    let gh_path = PathBuf::from(
        std::env::var("OMNI_GITHUB_CLI_EXE")
            .expect("OMNI_GITHUB_CLI_EXE must name an absolute validated gh.exe"),
    );
    let adapter =
        GitHubCliAdapter::new(gh_path, bridge.join("gh-work")).expect("trusted gh adapter");
    let broker = Broker::with_receipt_persistence(
        &bridge.join("approvals.json"),
        &bridge.join("ledger.json"),
        &bridge.join("receipts.json"),
    );
    adapter.register_all(&broker);
    adapter.register_issue_close(&broker);
    adapter.register_issue_readback(&broker);
    println!(
        "[real-e2e] native broker ready: {} execution bindings + read-back registered",
        broker.status().registered_bindings.len()
    );

    // 4. Human approval artifact (single-use; never auto-approved).
    let approval_file = PathBuf::from(
        std::env::var("OMNI_REAL_E2E_APPROVAL_FILE").expect("OMNI_REAL_E2E_APPROVAL_FILE"),
    );
    let expected_line = approval_line(&owner, &repo, number);
    let granted_line = std::fs::read_to_string(&approval_file)
        .map(|text| text.trim().to_string())
        .unwrap_or_default();
    assert_eq!(granted_line, expected_line, "human approval artifact missing or mismatched - the write is BLOCKED (REAL_E2E_EXTERNAL_RUN=BLOCKED_HUMAN_APPROVAL without exact approval)");
    std::fs::remove_file(&approval_file).expect("single-use approval artifact consumed");
    println!("[real-e2e] STEP 4-5: APPROVAL REQUIRED -> human operator granted: {expected_line}");

    // 5. Native CP7 grant (consume-before-spawn, single-use, bound to the plan).
    let expires_at = plan
        .expires_at
        .clone()
        .unwrap_or_else(|| (chrono::Utc::now() + chrono::Duration::minutes(15)).to_rfc3339());
    let grant_reference: ApprovalReferenceWire = broker
        .grant_approval(&GrantRequest {
            plan: &plan,
            approval_request_id: brain
                .get("approval_request_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            actor_id: "guo6x".to_string(),
            actor_kind: ActorKind::Owner,
            actor_authority: AuthorityLevelWire::L3,
            expires_at: expires_at.clone(),
            binding_policy: &github_issue_close_risk_policy(),
        })
        .expect("native grant");
    println!("[real-e2e] STEP 5: native grant issued and stored (single-use, plan-bound)");

    // 6. Restricted broker execution.
    let mut ready_plan = plan.clone();
    ready_plan.approval = Some(grant_reference.clone());
    let result = broker
        .execute(&ready_plan, "github-cli.issue.close")
        .expect("restricted broker execution");
    println!("[real-e2e] STEP 6: RESTRICTED BROKER spawned gh issue close {number} --repo={owner}/{repo}");
    println!(
        "[real-e2e] STEP 7: PROCESS EXIT = {} (success={}) - this is process_succeeded ONLY",
        result
            .exit_code
            .map(|c| c.to_string())
            .unwrap_or_else(|| "none".to_string()),
        result.success
    );
    println!("[real-e2e] STEP 7: OUTCOME = PENDING (exit 0 can NEVER verify an external effect)");

    // 7. Persistent native receipt.
    let receipt = broker
        .receipts_for_plan(&plan.plan_id)
        .expect("receipts")
        .into_iter()
        .next()
        .expect("exactly one receipt per plan");
    println!(
        "[real-e2e] STEP 7: native receipt {} persisted (state {:?})",
        receipt.receipt_id, receipt.execution_state
    );

    // 8. Independent read-back through the trusted read-back runner.
    let envelope = broker
        .perform_readback(&receipt.receipt_id)
        .expect("trusted read-back");
    let readback_state = envelope
        .payload
        .get("state")
        .and_then(|s| s.as_str())
        .unwrap_or("?");
    let readback_number = envelope
        .payload
        .get("number")
        .and_then(|n| n.as_u64())
        .unwrap_or(0);
    println!("[real-e2e] STEP 8: INDEPENDENT READ-BACK github.issue.read -> state={readback_state} number={readback_number}");
    println!(
        "[real-e2e] STEP 8: native observation id {} (no verified field - Brain decides)",
        envelope.observation_id
    );

    // 9. Export the trusted bridge payload for the Brain verify phase.
    let export = json!({
        "grant": {
            "approval_id": grant_reference.approval_id,
            "plan_id": grant_reference.plan_id,
            "granted_by": grant_reference.granted_by,
            "granted_at": grant_reference.granted_at,
            "expires_at": expires_at,
            "policy_version": grant_reference.policy_version,
            "token_reference": grant_reference.token_reference,
            "token_digest": grant_reference.token_digest,
            "actor_id": "guo6x",
            "actor_kind": "owner",
            "actor_authority": "L3"
        },
        "receipt": serde_json::to_value(&receipt).expect("receipt serialize"),
        "receipt_id": receipt.receipt_id,
        "observation": serde_json::to_value(&envelope).expect("envelope serialize"),
        "observation_id": envelope.observation_id,
        "attempt_id": envelope.verification_attempt_id,
        "process": {
            "exit_code": result.exit_code,
            "success": result.success,
            "timed_out": result.timed_out,
            "cancelled": result.cancelled
        }
    });
    write_json(&bridge.join("native-after.json"), &export);
    println!("[real-e2e] native phase complete; bridge written to native-after.json");
    println!(
        "[real-e2e] OUTCOME AUTHORITY: NONE on this side - awaiting the Brain trusted evaluator"
    );
}
