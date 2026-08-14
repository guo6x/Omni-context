//! Goal24 Checkpoint 7 (Integration) - durable replay crash matrix.
//!
//! Proves the crash-safe ordered reservation (write-ahead accept ->
//! reserve -> consume -> spawn): a crash at ANY fault checkpoint after the
//! acceptance leaves durable state, so a restarted broker can never accept
//! the same plan id again. The approval is never unconsumed and the plan
//! reservation is never rolled back when the spawn itself fails.
//!
//! Also covers concurrent double execution (8/16/32 attempts -> exactly one
//! acceptance), the multi-broker same-store race (the second instance opens
//! degraded behind the exclusive OS lock) and additional store-corruption
//! fail-closed cases.

use std::sync::Arc;

use super::authority::GrantRequest;
use super::ledger::LedgerPhase;
use super::types::ActorKind;
use crate::execution_broker::policy::ExecutionRiskPolicy;
use crate::execution_broker::tests::{child_test_lock, plan_with, TempDir, TestSelfBinding};
use crate::execution_broker::types::{
    ApprovalReferenceWire, AuthorityLevelWire, ErrorCode, ExecutionPlanStateWire, ExecutionPlanWire,
};
use crate::execution_broker::{clear_fault, set_fault, Broker, FaultPoint};

static PLAN_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn fresh_plan_id() -> String {
    let n = PLAN_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("plan-cp7x-{n:08}")
}

fn read_plan_requiring_approval() -> ExecutionPlanWire {
    let mut plan = plan_with(ExecutionPlanStateWire::Ready, |p| {
        p.plan_id = fresh_plan_id();
    });
    plan.required_approval = true;
    plan
}

fn grant_for(broker: &Broker, plan: &ExecutionPlanWire) -> ApprovalReferenceWire {
    let expires_at = (chrono::Utc::now() + chrono::Duration::minutes(5)).to_rfc3339();
    broker
        .grant_approval(&GrantRequest {
            plan,
            approval_request_id: None,
            actor_id: "owner-test".to_string(),
            actor_kind: ActorKind::Owner,
            actor_authority: AuthorityLevelWire::L0,
            expires_at,
            binding_policy: &ExecutionRiskPolicy::read_only_low_l0(),
        })
        .expect("native grant")
}

fn approved_plan(broker: &Broker) -> ExecutionPlanWire {
    let mut plan = read_plan_requiring_approval();
    let approval = grant_for(broker, &plan);
    plan.approval = Some(approval);
    plan
}

// ---------------------------------------------------------------------------
// Crash fault-point matrix
// ---------------------------------------------------------------------------

#[test]
fn crash_at_every_fault_checkpoint_blocks_replay_after_restart() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");

    let points: [(FaultPoint, LedgerPhase, &str); 5] = [
        (
            FaultPoint::BeforePlanReserve,
            LedgerPhase::Accepted,
            "BeforePlanReserve",
        ),
        (
            FaultPoint::AfterPlanReserve,
            LedgerPhase::Reserved,
            "AfterPlanReserve",
        ),
        (
            FaultPoint::BeforeApprovalConsume,
            LedgerPhase::Reserved,
            "BeforeApprovalConsume",
        ),
        (
            FaultPoint::AfterApprovalConsume,
            LedgerPhase::Reserved,
            "AfterApprovalConsume",
        ),
        (
            FaultPoint::BeforeSpawn,
            LedgerPhase::Reserved,
            "BeforeSpawn",
        ),
    ];

    for (point, expected_phase, label) in points {
        let tmp = TempDir::new(&format!("cp7-crash-{label}"));
        let store = tmp.path().join("approval-store.json");
        let ledger = tmp.path().join("plan-ledger.json");

        let broker1 = Broker::with_persistence(&store, &ledger);
        broker1.register_binding(Box::new(TestSelfBinding::new(tmp.path().to_path_buf())));
        let plan = approved_plan(&broker1);

        set_fault(point);
        let fault_err = broker1
            .execute(&plan, "test.self.run")
            .expect_err("the injected fault must abort the execute");
        assert_eq!(fault_err.code, ErrorCode::InternalError, "{label}");
        clear_fault();
        assert_eq!(
            broker1.plan_ledger().phase(&plan.plan_id),
            Some(expected_phase),
            "{label}: durable phase must match the crash checkpoint"
        );
        drop(broker1);

        // Restart over the same durable state: the same plan (same approval)
        // must never be accepted again.
        let broker2 = Broker::with_persistence(&store, &ledger);
        broker2.register_binding(Box::new(TestSelfBinding::new(tmp.path().to_path_buf())));
        let replay_err = broker2
            .execute(&plan, "test.self.run")
            .expect_err("same plan must be rejected after the restart");
        assert!(
            matches!(
                replay_err.code,
                ErrorCode::PlanRejectedSingleUse | ErrorCode::ApprovalConsumed
            ),
            "{label}: replay after restart must be single-use rejected, got {:?}",
            replay_err.code
        );
    }
}

// ---------------------------------------------------------------------------
// Spawn failure never un-consumes / un-reserves
// ---------------------------------------------------------------------------

#[test]
fn spawn_failure_keeps_approval_consumed_and_plan_reserved() {
    let _guard = child_test_lock();
    let tmp = TempDir::new("cp7-spawn-failure");
    let store = tmp.path().join("approval-store.json");
    let ledger = tmp.path().join("plan-ledger.json");

    let broker = Broker::with_persistence(&store, &ledger);
    let missing_exe = tmp.path().join("missing-executable.exe");
    broker.register_binding(Box::new(
        TestSelfBinding::new(tmp.path().to_path_buf()).with_candidate(missing_exe),
    ));
    let plan = approved_plan(&broker);
    let approval_id = plan.approval.as_ref().unwrap().approval_id.clone();

    let spawn_err = broker
        .execute(&plan, "test.self.run")
        .expect_err("a missing executable must fail the spawn");
    assert_ne!(spawn_err.code, ErrorCode::InternalError);

    // The approval stays consumed: verifying it again reports the consumed
    // status (single-use).
    let verify_err = broker
        .approval_authority()
        .verify(
            plan.approval.as_ref().unwrap(),
            &plan,
            &ExecutionRiskPolicy::read_only_low_l0(),
            chrono::Utc::now(),
        )
        .expect_err("the approval must stay consumed after a spawn failure");
    assert_eq!(verify_err.code, ErrorCode::ApprovalConsumed);

    // The plan id stays reserved: a retry (even with a fresh grant) fails.
    let mut retry = read_plan_requiring_approval();
    retry.plan_id = plan.plan_id.clone();
    let fresh_approval = grant_for(&broker, &retry);
    retry.approval = Some(fresh_approval);
    let retry_err = broker
        .execute(&retry, "test.self.run")
        .expect_err("a fresh grant must never replay a reserved plan id");
    assert_eq!(retry_err.code, ErrorCode::PlanRejectedSingleUse);
    assert_eq!(approval_id, plan.approval.as_ref().unwrap().approval_id);
}

// ---------------------------------------------------------------------------
// Concurrent double execution
// ---------------------------------------------------------------------------

#[test]
fn concurrent_attempts_accept_exactly_one() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");

    for attempts in [8usize, 16, 32] {
        let tmp = TempDir::new(&format!("cp7-concurrency-{attempts}"));
        let store = tmp.path().join("approval-store.json");
        let ledger = tmp.path().join("plan-ledger.json");
        let broker = Arc::new(Broker::with_persistence(&store, &ledger));
        broker.register_binding(Box::new(TestSelfBinding::new(tmp.path().to_path_buf())));

        let plan = Arc::new(approved_plan(&broker));
        let mut handles = Vec::with_capacity(attempts);
        for _ in 0..attempts {
            let broker = broker.clone();
            let plan = plan.clone();
            handles.push(std::thread::spawn(move || {
                broker.execute(&plan, "test.self.run")
            }));
        }
        let results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().expect("thread"))
            .collect();
        let successes = results.iter().filter(|r| r.is_ok()).count();
        assert_eq!(
            successes, 1,
            "exactly one of {attempts} attempts must be accepted"
        );
        for result in results.iter().filter(|r| r.is_err()) {
            let code = result.as_ref().err().unwrap().code;
            assert!(
                matches!(
                    code,
                    ErrorCode::PlanRejectedSingleUse | ErrorCode::ApprovalConsumed
                ),
                "losers must be single-use/consumed rejections, got {code:?}"
            );
        }
        assert!(results
            .iter()
            .any(|r| r.as_ref().is_ok_and(|ok| ok.success)));
    }
}

// ---------------------------------------------------------------------------
// Multi-broker same store
// ---------------------------------------------------------------------------

#[test]
fn second_broker_instance_on_same_store_opens_degraded() {
    let _guard = child_test_lock();
    std::env::set_var("OMNI_BROKER_TEST_MODE", "echo");

    let tmp = TempDir::new("cp7-multi-broker");
    let store = tmp.path().join("approval-store.json");
    let ledger = tmp.path().join("plan-ledger.json");

    let broker_a = Broker::with_persistence(&store, &ledger);
    broker_a.register_binding(Box::new(TestSelfBinding::new(tmp.path().to_path_buf())));
    let broker_b = Broker::with_persistence(&store, &ledger);
    broker_b.register_binding(Box::new(TestSelfBinding::new(tmp.path().to_path_buf())));

    assert!(
        broker_a.status().approvals_enforced,
        "the first broker must hold the durable-state authority"
    );
    assert!(
        !broker_b.status().approvals_enforced,
        "the second broker instance must open degraded behind the OS lock"
    );

    let plan = approved_plan(&broker_a);
    let first = broker_a
        .execute(&plan, "test.self.run")
        .expect("broker A executes once");
    assert!(first.success);

    let b_err = broker_b
        .execute(&plan, "test.self.run")
        .expect_err("broker B must fail closed while degraded");
    assert_eq!(b_err.code, ErrorCode::BrokerApprovalStoreCorrupt);

    let replay_err = broker_a
        .execute(&plan, "test.self.run")
        .expect_err("the plan is single-use on broker A");
    assert!(
        matches!(
            replay_err.code,
            ErrorCode::PlanRejectedSingleUse | ErrorCode::ApprovalConsumed
        ),
        "single-use replay rejection expected, got {:?}",
        replay_err.code
    );
}

// ---------------------------------------------------------------------------
// Store / ledger corruption fail-closed matrix
// ---------------------------------------------------------------------------

fn grant_record_json() -> serde_json::Value {
    serde_json::json!({
        "approval_id": "appr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "plan_id": "plan-00000001",
        "approval_binding_digest": "a".repeat(64),
        "capability_id": "test.self.run",
        "capability_version": "1.0.0",
        "risk_policy_snapshot": {
            "risk_level": "low",
            "side_effect_class": "read_only",
            "reversible": false,
            "required_authority": "L0"
        },
        "actor_id": "owner-test",
        "actor_kind": "owner",
        "actor_authority": "L0",
        "policy_version": "goal24-approval-policy-v1",
        "granted_at": "2026-08-14T00:00:00Z",
        "expires_at": "2026-08-14T00:05:00Z",
        "token_reference": "grant_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "token_digest": "b".repeat(64),
        "status": "granted"
    })
}

fn store_bytes(records: &[serde_json::Value]) -> Vec<u8> {
    serde_json::to_vec_pretty(&serde_json::json!({
        "version": 1,
        "records": records
    }))
    .unwrap()
}

#[test]
fn store_corruption_variants_fail_closed() {
    let cases: Vec<(&str, Vec<u8>)> = vec![
        (
            "truncated-json",
            store_bytes(&[grant_record_json()])[..80].to_vec(),
        ),
        (
            "unknown-schema-version",
            serde_json::to_vec(&serde_json::json!({ "version": 99, "records": [] })).unwrap(),
        ),
        (
            "duplicate-approval-ids",
            store_bytes(&[grant_record_json(), grant_record_json()]),
        ),
        (
            "consumed-without-consumed-at",
            store_bytes(&[{
                let mut record = grant_record_json();
                record["status"] = serde_json::json!("consumed");
                record
            }]),
        ),
        (
            "unconsumed-with-consumed-at",
            store_bytes(&[{
                let mut record = grant_record_json();
                record["consumed_at"] = serde_json::json!("2026-08-14T00:01:00Z");
                record
            }]),
        ),
        (
            "non-hex-token-digest",
            store_bytes(&[{
                let mut record = grant_record_json();
                record["token_digest"] = serde_json::json!("z".repeat(64));
                record
            }]),
        ),
        (
            "invalid-timestamp",
            store_bytes(&[{
                let mut record = grant_record_json();
                record["granted_at"] = serde_json::json!("not-a-timestamp");
                record
            }]),
        ),
        (
            "grant-lifetime-over-15m",
            store_bytes(&[{
                let mut record = grant_record_json();
                record["expires_at"] = serde_json::json!("2026-08-14T01:00:00Z");
                record
            }]),
        ),
    ];

    for (label, bytes) in cases {
        let tmp = TempDir::new(&format!("cp7-corrupt-{label}"));
        let store = tmp.path().join("approval-store.json");
        let ledger = tmp.path().join("plan-ledger.json");
        std::fs::write(&store, &bytes).expect("write corrupt store");

        let broker = Broker::with_persistence(&store, &ledger);
        broker.register_binding(Box::new(TestSelfBinding::new(tmp.path().to_path_buf())));
        assert!(
            !broker.status().approvals_enforced,
            "{label}: a corrupt store must degrade the broker"
        );
        let err = broker
            .execute(
                &plan_with(ExecutionPlanStateWire::Ready, |p| {
                    p.plan_id = fresh_plan_id();
                }),
                "test.self.run",
            )
            .expect_err("{label}: every execute must fail closed");
        assert_eq!(err.code, ErrorCode::BrokerApprovalStoreCorrupt, "{label}");
    }
}
