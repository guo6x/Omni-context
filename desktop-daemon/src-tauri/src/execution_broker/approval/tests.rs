//! Goal24 Checkpoint 7 (Lane B) - native approval and risk enforcement tests.
//!
//! Covers the compiled risk mirror, the native minimum approval rule, grant
//! verification / atomic consume, mutation resistance, restart replay and
//! store corruption behavior. A `#[cfg(test)]` synthetic write binding
//! exercises the real broker gates; it can never become a production binding.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use super::authority::GrantRequest;
use super::types::ActorKind;
use crate::execution_broker::policy::{ExecutionRiskPolicy, OutputLimits};
use crate::execution_broker::tests::{
    broker_with_root, child_test_lock, plan_with, TempDir, TestSelfBinding,
};
use crate::execution_broker::types::{
    ApprovalReferenceWire, AuthorityLevelWire, ErrorCode, ExecutionPlanStateWire,
    ExecutionPlanWire, RiskLevelWire, RiskSnapshotWire, SideEffectClassWire,
};
use crate::execution_broker::{Broker, ExecutionBinding};

// ---------------------------------------------------------------------------
// Test-only synthetic write binding (never a production binding)
// ---------------------------------------------------------------------------

pub fn write_risk_policy() -> ExecutionRiskPolicy {
    ExecutionRiskPolicy {
        risk_level: RiskLevelWire::Medium,
        side_effect_class: SideEffectClassWire::ReversibleWrite,
        reversible: true,
        required_authority: AuthorityLevelWire::L2,
    }
}

/// `#[cfg(test)]` synthetic write binding: medium, L2, reversible_write.
pub struct TestWriteBinding {
    inner: TestSelfBinding,
}

impl TestWriteBinding {
    pub fn new(cwd_root: PathBuf) -> Self {
        Self {
            inner: TestSelfBinding::new(cwd_root),
        }
    }
}

impl ExecutionBinding for TestWriteBinding {
    fn binding_id(&self) -> &str {
        "test.self.write"
    }

    fn adapter_id(&self) -> &str {
        "test-adapter"
    }

    fn capability_id(&self) -> &str {
        "test.self.write"
    }

    fn capability_version(&self) -> &str {
        "1.0.0"
    }

    fn risk_policy(&self) -> ExecutionRiskPolicy {
        write_risk_policy()
    }

    fn executable_candidates(&self) -> &[PathBuf] {
        self.inner.executable_candidates()
    }

    fn build_argv(
        &self,
        inputs: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<Vec<OsString>, String> {
        self.inner.build_argv(inputs)
    }

    fn allowed_cwd_roots(&self) -> &[PathBuf] {
        self.inner.allowed_cwd_roots()
    }

    fn derive_cwd(
        &self,
        inputs: &serde_json::Map<String, serde_json::Value>,
    ) -> Result<PathBuf, String> {
        self.inner.derive_cwd(inputs)
    }

    fn env_allowlist(&self) -> &[String] {
        self.inner.env_allowlist()
    }

    fn output_limits(&self) -> OutputLimits {
        self.inner.output_limits()
    }
}

// ---------------------------------------------------------------------------
// Plan helpers
// ---------------------------------------------------------------------------

static PLAN_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn fresh_plan_id() -> String {
    let n = PLAN_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("plan-cp7-{n:08}")
}

/// Read-only low/L0 plan for the test self binding.
fn read_plan() -> ExecutionPlanWire {
    plan_with(ExecutionPlanStateWire::Ready, |p| {
        p.plan_id = fresh_plan_id();
    })
}

/// Correct-risk write plan (medium / L2 / reversible_write).
fn write_plan() -> ExecutionPlanWire {
    plan_with(ExecutionPlanStateWire::Ready, |p| {
        p.plan_id = fresh_plan_id();
        p.capability_id = "test.self.write".to_string();
        p.risk_snapshot = RiskSnapshotWire {
            risk_level: RiskLevelWire::Medium,
            reversible: true,
            side_effect_class: SideEffectClassWire::ReversibleWrite,
            required_authority: AuthorityLevelWire::L2,
            capability_version: "1.0.0".to_string(),
        };
    })
}

fn grant_for(
    broker: &Broker,
    plan: &ExecutionPlanWire,
    binding_policy: ExecutionRiskPolicy,
    actor_authority: AuthorityLevelWire,
) -> ApprovalReferenceWire {
    let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();
    broker
        .grant_approval(&GrantRequest {
            plan,
            approval_request_id: None,
            actor_id: "owner-test".to_string(),
            actor_kind: ActorKind::Owner,
            actor_authority,
            expires_at,
            binding_policy: &binding_policy,
        })
        .expect("native grant")
}

fn register_write_binding(broker: &Broker, root: &std::path::Path) {
    broker.register_binding(Box::new(TestWriteBinding::new(root.to_path_buf())));
}

// ---------------------------------------------------------------------------
// Risk enforcement
// ---------------------------------------------------------------------------

#[test]
fn read_only_low_l0_without_approval_executes() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    let tmp = TempDir::new("cp7-risk-read");
    let broker = broker_with_root(tmp.path());
    let result = broker
        .execute(&read_plan(), "test.self.run")
        .expect("read-only low L0 plan must run without approval");
    assert!(result.success);
}

#[test]
fn write_binding_without_approval_rejected() {
    let tmp = TempDir::new("cp7-risk-write-noapproval");
    let broker = broker_with_root(tmp.path());
    register_write_binding(&broker, tmp.path());
    let err = broker
        .execute(&write_plan(), "test.self.write")
        .expect_err("a write plan can never bypass the native minimum approval rule");
    assert_eq!(err.code, ErrorCode::PlanRejectedApprovalPolicy);
}

#[test]
fn plan_cannot_downgrade_risk_level() {
    let tmp = TempDir::new("cp7-risk-downgrade-level");
    let broker = broker_with_root(tmp.path());
    register_write_binding(&broker, tmp.path());
    let mut plan = write_plan();
    plan.risk_snapshot.risk_level = RiskLevelWire::Low;
    let err = broker
        .execute(&plan, "test.self.write")
        .expect_err("risk level downgrade must be rejected");
    assert_eq!(err.code, ErrorCode::PlanRejectedRiskPolicy);
}

#[test]
fn plan_cannot_downgrade_authority() {
    let tmp = TempDir::new("cp7-risk-downgrade-authority");
    let broker = broker_with_root(tmp.path());
    register_write_binding(&broker, tmp.path());
    let mut plan = write_plan();
    plan.risk_snapshot.required_authority = AuthorityLevelWire::L0;
    let err = broker
        .execute(&plan, "test.self.write")
        .expect_err("authority downgrade must be rejected");
    assert_eq!(err.code, ErrorCode::PlanRejectedRiskPolicy);
}

#[test]
fn plan_cannot_downgrade_side_effect_class() {
    let tmp = TempDir::new("cp7-risk-downgrade-side");
    let broker = broker_with_root(tmp.path());
    register_write_binding(&broker, tmp.path());
    let mut plan = write_plan();
    plan.risk_snapshot.side_effect_class = SideEffectClassWire::ReadOnly;
    let err = broker
        .execute(&plan, "test.self.write")
        .expect_err("side-effect downgrade must be rejected");
    assert_eq!(err.code, ErrorCode::PlanRejectedRiskPolicy);
}

#[test]
fn plan_cannot_flip_reversibility() {
    let tmp = TempDir::new("cp7-risk-reversible");
    let broker = broker_with_root(tmp.path());
    register_write_binding(&broker, tmp.path());
    let mut plan = write_plan();
    plan.risk_snapshot.reversible = false;
    let err = broker
        .execute(&plan, "test.self.write")
        .expect_err("reversibility mismatch must be rejected");
    assert_eq!(err.code, ErrorCode::PlanRejectedRiskPolicy);
}

#[test]
fn plan_cannot_mismatch_capability_version() {
    let tmp = TempDir::new("cp7-risk-version");
    let broker = broker_with_root(tmp.path());
    register_write_binding(&broker, tmp.path());
    let mut plan = write_plan();
    plan.risk_snapshot.capability_version = "0.9.9".to_string();
    let err = broker
        .execute(&plan, "test.self.write")
        .expect_err("version mismatch must be rejected");
    assert_eq!(err.code, ErrorCode::PlanRejectedRiskPolicy);

    let mut plan2 = write_plan();
    plan2.capability_version = "0.9.9".to_string();
    let err2 = broker
        .execute(&plan2, "test.self.write")
        .expect_err("plan capability_version mismatch must be rejected");
    assert_eq!(err2.code, ErrorCode::PlanRejectedRiskPolicy);
}

// ---------------------------------------------------------------------------
// Approval verification
// ---------------------------------------------------------------------------

#[test]
fn valid_approval_executes() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    let tmp = TempDir::new("cp7-approval-valid");
    let broker = broker_with_root(tmp.path());
    let policy = ExecutionRiskPolicy::read_only_low_l0();
    let mut plan = read_plan();
    plan.required_approval = true;
    let approval = grant_for(&broker, &plan, policy, AuthorityLevelWire::L0);
    plan.approval = Some(approval);
    let result = broker
        .execute(&plan, "test.self.run")
        .expect("a valid native grant must execute");
    assert!(result.success);
}

#[test]
fn fake_reference_rejected() {
    let tmp = TempDir::new("cp7-approval-fake");
    let broker = broker_with_root(tmp.path());
    let mut plan = read_plan();
    plan.required_approval = true;
    plan.approval = Some(ApprovalReferenceWire {
        approval_id: "appr_fake".to_string(),
        plan_id: plan.plan_id.clone(),
        granted_by: "attacker".to_string(),
        granted_at: chrono::Utc::now().to_rfc3339(),
        policy_version: "goal24-approval-policy-v1".to_string(),
        token_reference: "grant_fake".to_string(),
        token_digest: "0".repeat(64),
    });
    let err = broker
        .execute(&plan, "test.self.run")
        .expect_err("a fabricated reference without a store record must be rejected");
    assert_eq!(err.code, ErrorCode::ApprovalRecordNotFound);
}

#[test]
fn missing_store_record_rejected() {
    let tmp = TempDir::new("cp7-approval-missing");
    let broker = broker_with_root(tmp.path());
    let mut plan = read_plan();
    plan.required_approval = true;
    plan.approval = Some(ApprovalReferenceWire {
        approval_id: "appr_missing".to_string(),
        plan_id: plan.plan_id.clone(),
        granted_by: "owner-test".to_string(),
        granted_at: chrono::Utc::now().to_rfc3339(),
        policy_version: "goal24-approval-policy-v1".to_string(),
        token_reference: "grant_missing".to_string(),
        token_digest: "0".repeat(64),
    });
    let err = broker
        .execute(&plan, "test.self.run")
        .expect_err("missing store record must be rejected");
    assert_eq!(err.code, ErrorCode::ApprovalRecordNotFound);
}

#[test]
fn fake_token_digest_rejected() {
    let tmp = TempDir::new("cp7-approval-fakedigest");
    let broker = broker_with_root(tmp.path());
    let policy = ExecutionRiskPolicy::read_only_low_l0();
    let mut plan = read_plan();
    plan.required_approval = true;
    let mut approval = grant_for(&broker, &plan, policy, AuthorityLevelWire::L0);
    approval.token_digest = format!("{}x", "0".repeat(63));
    plan.approval = Some(approval);
    let err = broker
        .execute(&plan, "test.self.run")
        .expect_err("a copied reference with a wrong digest must be rejected");
    assert_eq!(err.code, ErrorCode::ApprovalInvalidToken);
}

#[test]
fn wrong_plan_id_rejected() {
    let tmp = TempDir::new("cp7-approval-wrongplan");
    let broker = broker_with_root(tmp.path());
    let policy = ExecutionRiskPolicy::read_only_low_l0();
    let mut granted_plan = read_plan();
    granted_plan.required_approval = true;
    let approval = grant_for(&broker, &granted_plan, policy, AuthorityLevelWire::L0);

    // Replay the same approval against a different plan id.
    let mut other_plan = read_plan();
    other_plan.required_approval = true;
    let mut replay = approval.clone();
    replay.plan_id = other_plan.plan_id.clone();
    other_plan.approval = Some(replay);
    let err = broker
        .execute(&other_plan, "test.self.run")
        .expect_err("an approval granted for plan A must never authorize plan B");
    assert_eq!(err.code, ErrorCode::ApprovalWrongPlan);
}

#[test]
fn mutation_after_grant_rejected() {
    let tmp = TempDir::new("cp7-approval-mutation");
    let broker = broker_with_root(tmp.path());
    let policy = ExecutionRiskPolicy::read_only_low_l0();
    let mut plan = read_plan();
    plan.required_approval = true;
    let approval = grant_for(&broker, &plan, policy, AuthorityLevelWire::L0);
    plan.approval = Some(approval);
    plan.normalized_inputs
        .insert("extra".to_string(), serde_json::json!("mutated"));
    let err = broker
        .execute(&plan, "test.self.run")
        .expect_err("any post-grant plan mutation must break the approval binding");
    assert_eq!(err.code, ErrorCode::ApprovalBindingMismatch);
}

#[test]
fn insufficient_actor_authority_rejected_at_grant() {
    let tmp = TempDir::new("cp7-approval-actor");
    let broker = broker_with_root(tmp.path());
    register_write_binding(&broker, tmp.path());
    let plan = write_plan();
    let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();
    let err = broker
        .grant_approval(&GrantRequest {
            plan: &plan,
            approval_request_id: None,
            actor_id: "owner-test".to_string(),
            actor_kind: ActorKind::Owner,
            actor_authority: AuthorityLevelWire::L0,
            expires_at,
            binding_policy: &write_risk_policy(),
        })
        .expect_err("an L0 actor must never grant an L2 write approval");
    assert_eq!(err.code, ErrorCode::ApprovalActorAuthorityInsufficient);
}

#[test]
fn expired_approval_rejected() {
    let tmp = TempDir::new("cp7-approval-expired");
    let broker = broker_with_root(tmp.path());
    let policy = ExecutionRiskPolicy::read_only_low_l0();
    let mut plan = read_plan();
    plan.required_approval = true;
    let approval = grant_for(&broker, &plan, policy, AuthorityLevelWire::L0);
    broker
        .approval_authority()
        .force_expire_for_test(&approval.approval_id, chrono::Utc::now())
        .expect("force expire");
    plan.approval = Some(approval);
    let err = broker
        .execute(&plan, "test.self.run")
        .expect_err("an expired grant must never verify");
    assert_eq!(err.code, ErrorCode::ApprovalExpired);
}

#[test]
fn future_grant_rejected() {
    let tmp = TempDir::new("cp7-approval-future");
    let broker = broker_with_root(tmp.path());
    let policy = ExecutionRiskPolicy::read_only_low_l0();
    let plan = read_plan();
    let future = chrono::Utc::now() + chrono::Duration::hours(1);
    let expires_at = (future + chrono::Duration::minutes(5)).to_rfc3339();
    let err = broker
        .approval_authority()
        .grant_at(
            &GrantRequest {
                plan: &plan,
                approval_request_id: None,
                actor_id: "owner-test".to_string(),
                actor_kind: ActorKind::Owner,
                actor_authority: AuthorityLevelWire::L0,
                expires_at,
                binding_policy: &policy,
            },
            future,
        )
        .expect_err("a grant with a future granted_at must fail closed");
    assert_eq!(err.code, ErrorCode::PlanRejectedInvalid);
}

#[test]
fn denied_approval_rejected() {
    let tmp = TempDir::new("cp7-approval-denied");
    let broker = broker_with_root(tmp.path());
    let policy = ExecutionRiskPolicy::read_only_low_l0();
    let mut plan = read_plan();
    plan.required_approval = true;
    let approval = grant_for(&broker, &plan, policy, AuthorityLevelWire::L0);
    broker.deny_approval(&approval.approval_id).expect("deny");
    plan.approval = Some(approval);
    let err = broker
        .execute(&plan, "test.self.run")
        .expect_err("a denied grant must never execute");
    assert_eq!(err.code, ErrorCode::ApprovalDenied);
}

#[test]
fn revoked_approval_rejected() {
    let tmp = TempDir::new("cp7-approval-revoked");
    let broker = broker_with_root(tmp.path());
    let policy = ExecutionRiskPolicy::read_only_low_l0();
    let mut plan = read_plan();
    plan.required_approval = true;
    let approval = grant_for(&broker, &plan, policy, AuthorityLevelWire::L0);
    broker
        .revoke_approval(&approval.approval_id)
        .expect("revoke");
    plan.approval = Some(approval);
    let err = broker
        .execute(&plan, "test.self.run")
        .expect_err("a revoked grant must never execute");
    assert_eq!(err.code, ErrorCode::ApprovalRevoked);
}

#[test]
fn consumed_approval_rejected() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    let tmp = TempDir::new("cp7-approval-consumed");
    let broker = broker_with_root(tmp.path());
    let policy = ExecutionRiskPolicy::read_only_low_l0();
    let mut plan = read_plan();
    plan.required_approval = true;
    let approval = grant_for(&broker, &plan, policy, AuthorityLevelWire::L0);
    plan.approval = Some(approval.clone());
    let first = broker
        .execute(&plan, "test.self.run")
        .expect("first consumption executes");
    assert!(first.success);

    let err = broker
        .execute(&plan, "test.self.run")
        .expect_err("a consumed approval is single-use");
    assert_eq!(err.code, ErrorCode::ApprovalConsumed);
}

#[test]
fn concurrent_consume_exactly_one_wins() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    let tmp = TempDir::new("cp7-approval-race");
    let broker = Arc::new(broker_with_root(tmp.path()));
    let policy = ExecutionRiskPolicy::read_only_low_l0();
    let mut plan = read_plan();
    plan.required_approval = true;
    let approval = grant_for(&broker, &plan, policy, AuthorityLevelWire::L0);
    plan.approval = Some(approval);
    let plan_a = plan.clone();
    let plan_b = plan;
    let broker_a = broker.clone();
    let broker_b = broker.clone();
    let handle_a = std::thread::spawn(move || broker_a.execute(&plan_a, "test.self.run"));
    let handle_b = std::thread::spawn(move || broker_b.execute(&plan_b, "test.self.run"));
    let result_a = handle_a.join().expect("thread a");
    let result_b = handle_b.join().expect("thread b");

    let (successes, failures): (Vec<_>, Vec<_>) =
        [result_a, result_b].into_iter().partition(Result::is_ok);
    assert_eq!(
        successes.len(),
        1,
        "exactly one concurrent consume must win"
    );
    assert_eq!(
        failures.len(),
        1,
        "exactly one concurrent consume must lose"
    );
    let failure_code = failures[0].as_ref().err().map(|e| e.code);
    assert!(
        matches!(
            failure_code,
            Some(ErrorCode::PlanRejectedSingleUse | ErrorCode::ApprovalConsumed)
        ),
        "the losing concurrent attempt must fail closed, got {failure_code:?}"
    );
    assert!(successes[0].as_ref().expect("ok").success);
}

// ---------------------------------------------------------------------------
// Restart replay + corruption
// ---------------------------------------------------------------------------

#[test]
fn restart_replay_blocked_by_persistent_state() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");
    let tmp = TempDir::new("cp7-restart");
    let store = tmp.path().join("approval-store.json");
    let ledger = tmp.path().join("plan-ledger.json");

    let broker1 = Broker::with_persistence(&store, &ledger);
    broker1.register_binding(Box::new(TestSelfBinding::new(tmp.path().to_path_buf())));
    let policy = ExecutionRiskPolicy::read_only_low_l0();
    let mut plan = read_plan();
    plan.required_approval = true;
    let approval = grant_for(&broker1, &plan, policy, AuthorityLevelWire::L0);
    plan.approval = Some(approval.clone());
    let first = broker1.execute(&plan, "test.self.run").expect("first run");
    assert!(first.success);
    drop(broker1);

    // New broker over the same persistent store + ledger.
    let broker2 = Broker::with_persistence(&store, &ledger);
    broker2.register_binding(Box::new(TestSelfBinding::new(tmp.path().to_path_buf())));
    let err = broker2
        .execute(&plan, "test.self.run")
        .expect_err("same plan + approval must be rejected after restart");
    assert_eq!(err.code, ErrorCode::ApprovalConsumed);

    // The plan id reservation also survived the restart.
    let mut replay = read_plan();
    replay.plan_id = plan.plan_id.clone();
    replay.required_approval = false;
    replay.approval = None;
    let err2 = broker2
        .execute(&replay, "test.self.run")
        .expect_err("the durable plan ledger must block the same plan id after restart");
    assert_eq!(err2.code, ErrorCode::PlanRejectedSingleUse);
}

#[test]
fn corrupt_approval_store_fails_closed() {
    let tmp = TempDir::new("cp7-corrupt-store");
    let store = tmp.path().join("approval-store.json");
    let ledger = tmp.path().join("plan-ledger.json");
    std::fs::write(&store, b"{ definitely not json").expect("corrupt store");

    let broker = Broker::with_persistence(&store, &ledger);
    broker.register_binding(Box::new(TestSelfBinding::new(tmp.path().to_path_buf())));
    assert!(
        !broker.status().approvals_enforced,
        "a corrupt approval store must report degraded"
    );
    let err = broker
        .execute(&read_plan(), "test.self.run")
        .expect_err("a corrupt approval store must block all execution");
    assert_eq!(err.code, ErrorCode::BrokerApprovalStoreCorrupt);
}

#[test]
fn corrupt_plan_ledger_fails_closed() {
    let tmp = TempDir::new("cp7-corrupt-ledger");
    let store = tmp.path().join("approval-store.json");
    let ledger = tmp.path().join("plan-ledger.json");
    std::fs::write(&ledger, b"{ definitely not json").expect("corrupt ledger");

    let broker = Broker::with_persistence(&store, &ledger);
    broker.register_binding(Box::new(TestSelfBinding::new(tmp.path().to_path_buf())));
    assert!(
        !broker.status().approvals_enforced,
        "a corrupt plan ledger must report degraded"
    );
    let err = broker
        .execute(&read_plan(), "test.self.run")
        .expect_err("a corrupt plan ledger must block all execution");
    assert_eq!(err.code, ErrorCode::BrokerPlanLedgerCorrupt);
}
