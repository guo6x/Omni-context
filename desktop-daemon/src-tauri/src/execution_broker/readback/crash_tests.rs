//! Goal24 Checkpoint 8 (Lane B) - receipt crash / restart recovery tests.
//!
//! A crash between OS process creation and the durable completion write must
//! never be misclassified as "no effect". Reopening a persistent receipt
//! store migrates any mid-flight receipt ('accepted' or 'spawn_started') to
//! 'unknown_after_crash', and the read-back runner must still be allowed to
//! observe the external post-state. A corrupt store fails closed and is
//! never reset to an empty database.

use std::path::Path;

use crate::execution_broker::tests::{child_test_lock, TempDir};
use crate::execution_broker::types::ErrorCode;

use super::receipt::build_accepted_receipt;
use super::runner::ReadbackRunner;
use super::store::ReceiptStore;
use super::tests::{grant_write, write_plan, TestReadbackBinding, TestWriteBinding};
use super::types::{ExecutionReceipt, ExecutionReceiptState};
use crate::execution_broker::Broker;

// ---------------------------------------------------------------------------
// Mid-flight migration + read-back after unknown crash
// ---------------------------------------------------------------------------

#[test]
fn restart_migrates_accepted_to_unknown_after_crash_and_allows_readback() {
    let tmp = TempDir::new("cp8-crash-accepted");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "new").expect("fixture");
    let store_path = tmp.path().join("receipts.json");
    let plan = write_plan(state_file.to_str().unwrap());
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");

    {
        let store = ReceiptStore::persistent(store_path.clone());
        store.insert_accepted(receipt.clone()).expect("insert");
        assert_eq!(
            store
                .get(&receipt.receipt_id)
                .expect("get")
                .unwrap()
                .execution_state,
            ExecutionReceiptState::Accepted
        );
    } // crash before any spawn marker

    let store = ReceiptStore::persistent(store_path.clone());
    let recovered = store
        .get(&receipt.receipt_id)
        .expect("lookup")
        .expect("receipt survived restart");
    assert_eq!(
        recovered.execution_state,
        ExecutionReceiptState::UnknownAfterCrash,
        "a mid-flight accepted receipt can never be claimed as no-effect"
    );

    // The unknown-after-crash receipt must remain read-back eligible.
    let runner = ReadbackRunner::new();
    runner
        .register(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
        .expect("binding");
    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    let envelope = runner
        .perform_readback(&store, &receipt.receipt_id)
        .expect("read-back after unknown crash must be allowed");
    assert_eq!(envelope.payload, serde_json::json!({ "value": "new" }));
}

#[test]
fn restart_migrates_spawn_started_to_unknown_after_crash_and_allows_readback() {
    let tmp = TempDir::new("cp8-crash-spawn-started");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "new").expect("fixture");
    let store_path = tmp.path().join("receipts.json");
    let plan = write_plan(state_file.to_str().unwrap());
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");

    {
        let store = ReceiptStore::persistent(store_path.clone());
        store.insert_accepted(receipt.clone()).expect("insert");
        store
            .mark_spawn_started(&receipt.receipt_id, "2026-08-14T00:00:01Z")
            .expect("spawn marker");
    } // crash after spawn, before completion

    let store = ReceiptStore::persistent(store_path.clone());
    let recovered = store
        .get(&receipt.receipt_id)
        .expect("lookup")
        .expect("receipt survived restart");
    assert_eq!(
        recovered.execution_state,
        ExecutionReceiptState::UnknownAfterCrash,
        "spawn_started without completion must classify as unknown_after_crash"
    );

    let runner = ReadbackRunner::new();
    runner
        .register(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
        .expect("binding");
    let _guard = child_test_lock();
    std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
    std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
    let envelope = runner
        .perform_readback(&store, &receipt.receipt_id)
        .expect("read-back after unknown crash must be allowed");
    assert_eq!(envelope.payload, serde_json::json!({ "value": "new" }));
}

// ---------------------------------------------------------------------------
// Full broker restart: single-use survives, read-back still works
// ---------------------------------------------------------------------------

#[test]
fn full_broker_restart_blocks_plan_replay_and_preserves_readback() {
    let tmp = TempDir::new("cp8-crash-full-broker");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let approval_store_path = tmp.path().join("approvals.json");
    let ledger_path = tmp.path().join("ledger.json");
    let receipt_store_path = tmp.path().join("receipts.json");

    let mut plan = write_plan(state_file.to_str().unwrap());
    let plan_id = plan.plan_id.clone();

    let receipt_id;
    {
        let broker = Broker::with_receipt_persistence(
            &approval_store_path,
            &ledger_path,
            &receipt_store_path,
        );
        broker.register_binding(Box::new(TestWriteBinding::new(tmp.path().to_path_buf())));
        broker
            .register_readback_binding(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
            .expect("read-back binding");
        {
            let _guard = child_test_lock();
            std::env::set_var("OMNI_READBACK_TEST_MODE", "write-new");
            std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
            plan.approval = Some(grant_write(&broker, &plan));
            let result = broker
                .execute(&plan, "test.cp8.write")
                .expect("first write execution");
            assert!(result.success);
        }
        let receipt = broker
            .receipts_for_plan(&plan_id)
            .expect("receipts")
            .into_iter()
            .next()
            .expect("one receipt");
        assert_eq!(receipt.execution_state, ExecutionReceiptState::Completed);
        receipt_id = receipt.receipt_id.clone();
    } // destroy the broker instance (restart simulation)

    {
        let broker = Broker::with_receipt_persistence(
            &approval_store_path,
            &ledger_path,
            &receipt_store_path,
        );
        broker.register_binding(Box::new(TestWriteBinding::new(tmp.path().to_path_buf())));
        broker
            .register_readback_binding(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
            .expect("read-back binding");
        // The same plan id can never execute again after restart, even with a
        // freshly granted approval: the durable plan ledger rejects it before
        // any spawn.
        plan.approval = Some(grant_write(&broker, &plan));
        let err = broker
            .execute(&plan, "test.cp8.write")
            .expect_err("plan replay must be blocked across restart");
        assert_eq!(err.code, ErrorCode::PlanRejectedSingleUse);

        // The completed receipt survives restart and remains read-backable.
        let recovered = broker
            .lookup_receipt(&receipt_id)
            .expect("lookup")
            .expect("receipt survived restart");
        assert_eq!(recovered.execution_state, ExecutionReceiptState::Completed);
        let _guard = child_test_lock();
        std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
        std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
        let envelope = broker
            .perform_readback(&receipt_id)
            .expect("read-back after restart must still be allowed");
        assert_eq!(envelope.payload, serde_json::json!({ "value": "new" }));
        assert_eq!(envelope.origin_execution_receipt_id, receipt_id);
    }
}

// ---------------------------------------------------------------------------
// Attempt replay across restart
// ---------------------------------------------------------------------------

#[test]
fn attempt_single_use_survives_restart() {
    let tmp = TempDir::new("cp8-crash-attempt-replay");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "new").expect("fixture");
    let store_path = tmp.path().join("receipts.json");
    let plan = write_plan(state_file.to_str().unwrap());
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");

    {
        let store = ReceiptStore::persistent(store_path.clone());
        store.insert_accepted(receipt.clone()).expect("insert");
        store
            .mark_spawn_started(&receipt.receipt_id, "2026-08-14T00:00:01Z")
            .expect("spawn marker");
    }

    {
        let store = ReceiptStore::persistent(store_path.clone());
        let runner = ReadbackRunner::new();
        runner
            .register(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
            .expect("binding");
        let _guard = child_test_lock();
        std::env::set_var("OMNI_READBACK_TEST_MODE", "read-state");
        std::env::set_var("OMNI_READBACK_STATE_FILE", state_file.to_str().unwrap());
        runner
            .perform_readback_attempt(&store, &receipt.receipt_id, Some("attempt-00000001"))
            .expect("first attempt after restart");
    }

    {
        let store = ReceiptStore::persistent(store_path.clone());
        let runner = ReadbackRunner::new();
        runner
            .register(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
            .expect("binding");
        let err = runner
            .perform_readback_attempt(&store, &receipt.receipt_id, Some("attempt-00000001"))
            .expect_err("attempt ids are single-use across restart");
        assert_eq!(err.code, ErrorCode::ReadbackAttemptReplay);
    }
}

// ---------------------------------------------------------------------------
// Corrupt store: fail closed, never reset to empty
// ---------------------------------------------------------------------------

fn write_receipt_store_file(store_path: &Path, receipt: &ExecutionReceipt) {
    let file = serde_json::json!({
        "version": 1,
        "receipts": [serde_json::to_value(receipt).expect("serialize")],
    });
    std::fs::write(store_path, serde_json::to_vec_pretty(&file).expect("json"))
        .expect("write store file");
}

#[test]
fn truncated_store_file_fails_closed_and_is_never_reset() {
    let tmp = TempDir::new("cp8-crash-truncated-store");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let store_path = tmp.path().join("receipts.json");
    let plan = write_plan(state_file.to_str().unwrap());
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");
    write_receipt_store_file(&store_path, &receipt);

    // Simulate a torn write: truncated JSON on disk.
    std::fs::write(&store_path, br#"{"version":1,"receipts":["#).expect("torn write");
    let store = ReceiptStore::persistent(store_path.clone());
    assert!(store.degradation().is_some(), "store must degrade");
    let err = store
        .get(&receipt.receipt_id)
        .expect_err("corrupt store must fail closed");
    assert_eq!(err.code, ErrorCode::BrokerReceiptStoreCorrupt);

    let runner = ReadbackRunner::new();
    runner
        .register(Box::new(TestReadbackBinding::new(tmp.path().to_path_buf())))
        .expect("binding");
    let err = runner
        .perform_readback(&store, &receipt.receipt_id)
        .expect_err("read-back against a corrupt store must fail closed");
    assert_eq!(err.code, ErrorCode::BrokerReceiptStoreCorrupt);

    // The corrupt bytes must still be on disk: never reset to an empty db.
    let on_disk = std::fs::read(&store_path).expect("read");
    assert_eq!(
        on_disk,
        br#"{"version":1,"receipts":["#.to_vec(),
        "a corrupt store must never be deleted or replaced with an empty database"
    );
}

#[test]
fn unknown_schema_version_fails_closed() {
    let tmp = TempDir::new("cp8-crash-version-store");
    let store_path = tmp.path().join("receipts.json");
    std::fs::write(&store_path, br#"{"version":99,"receipts":[]}"#).expect("write");
    let store = ReceiptStore::persistent(store_path);
    assert!(
        store.degradation().is_some(),
        "unknown version must degrade"
    );
    let err = store
        .get("rcpt_00000000000000000000000000000000")
        .expect_err("fail closed");
    assert_eq!(err.code, ErrorCode::BrokerReceiptStoreCorrupt);
}

#[test]
fn duplicate_receipt_ids_fail_closed() {
    let tmp = TempDir::new("cp8-crash-duplicate-store");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let store_path = tmp.path().join("receipts.json");
    let plan = write_plan(state_file.to_str().unwrap());
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");
    let file = serde_json::json!({
        "version": 1,
        "receipts": [
            serde_json::to_value(&receipt).expect("serialize"),
            serde_json::to_value(&receipt).expect("serialize"),
        ],
    });
    std::fs::write(&store_path, serde_json::to_vec_pretty(&file).expect("json"))
        .expect("write store file");

    let store = ReceiptStore::persistent(store_path);
    assert!(store.degradation().is_some(), "duplicate ids must degrade");
    let err = store.get(&receipt.receipt_id).expect_err("fail closed");
    assert_eq!(err.code, ErrorCode::BrokerReceiptStoreCorrupt);
}

#[test]
fn tampered_receipt_digest_fails_closed() {
    let tmp = TempDir::new("cp8-crash-digest-store");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let store_path = tmp.path().join("receipts.json");
    let plan = write_plan(state_file.to_str().unwrap());
    let receipt =
        build_accepted_receipt(&plan, "test.cp8.write", "2026-08-14T00:00:00Z").expect("receipt");
    write_receipt_store_file(&store_path, &receipt);

    let mut file: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&store_path).expect("read"))
            .expect("parse store file");
    file["receipts"][0]["receipt_digest"] = serde_json::Value::String("0".repeat(64));
    std::fs::write(&store_path, serde_json::to_vec_pretty(&file).expect("json"))
        .expect("write tampered store");

    let store = ReceiptStore::persistent(store_path);
    assert!(
        store.degradation().is_some(),
        "digest mismatch must degrade"
    );
    let err = store.get(&receipt.receipt_id).expect_err("fail closed");
    assert_eq!(err.code, ErrorCode::BrokerReceiptStoreCorrupt);
}

// ---------------------------------------------------------------------------
// Corrupt store blocks broker execution (fail closed before any spawn)
// ---------------------------------------------------------------------------

#[test]
fn corrupt_store_blocks_broker_execution_before_spawn() {
    let tmp = TempDir::new("cp8-crash-broker-corrupt-store");
    let state_file = tmp.path().join("state.txt");
    std::fs::write(&state_file, "old").expect("fixture");
    let approval_store_path = tmp.path().join("approvals.json");
    let ledger_path = tmp.path().join("ledger.json");
    let receipt_store_path = tmp.path().join("receipts.json");
    std::fs::write(&receipt_store_path, br#"{"version":1,"receipts":["#).expect("torn store");

    let broker =
        Broker::with_receipt_persistence(&approval_store_path, &ledger_path, &receipt_store_path);
    broker.register_binding(Box::new(TestWriteBinding::new(tmp.path().to_path_buf())));
    let mut plan = write_plan(state_file.to_str().unwrap());
    plan.approval = Some(grant_write(&broker, &plan));

    let err = broker
        .execute(&plan, "test.cp8.write")
        .expect_err("a corrupt receipt store must block execution");
    assert_eq!(err.code, ErrorCode::BrokerReceiptStoreCorrupt);
    assert_eq!(
        std::fs::read_to_string(&state_file).expect("fixture"),
        "old",
        "no process may spawn against a corrupt receipt store"
    );
}
