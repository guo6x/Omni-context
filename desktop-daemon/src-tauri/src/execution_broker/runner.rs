//! Goal24 Checkpoint 3 — broker execution engine.
//!
//! Executes a validated `ready` plan through a trusted binding: resolve ->
//! argv -> cwd -> env -> contained spawn -> bounded output -> timeout/cancel
//! enforcement -> structured result. Maintains the broker's active-execution
//! registry for cancellation by `execution_id` only.

use std::collections::HashMap;
use std::ffi::OsString;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::execution_broker::output::OutputReaders;
use crate::execution_broker::policy::{
    build_child_env, validate_cwd, ExecutionBinding, OutputLimits, BASE_ENV_VARS,
};
use crate::execution_broker::process_tree::ProcessTree;
use crate::execution_broker::resolver::resolve_executable;
use crate::execution_broker::types::{
    BrokerError, BrokerExecutionResult, ErrorCode, ExecutionPlanWire,
};

/// Random hex execution id generator (getrandom is already a direct dependency).
pub fn new_execution_id() -> String {
    let mut bytes = [0u8; 16];
    let _ = getrandom::getrandom(&mut bytes);
    let mut hex = String::with_capacity(4 + 32);
    hex.push_str("exec_");
    for b in bytes {
        hex.push_str(&format!("{b:02x}"));
    }
    hex
}

/// RFC3339 UTC timestamp with millisecond precision.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Fail-closed expiry check for an RFC3339 `expires_at` string: unparseable
/// timestamps are treated as expired.
pub fn plan_is_expired(expires_at: &str) -> bool {
    match chrono::DateTime::parse_from_rfc3339(expires_at) {
        Ok(dt) => chrono::Utc::now() >= dt.with_timezone(&chrono::Utc),
        Err(_) => true,
    }
}

/// Cancellation token shared with the wait loop and output readers.
pub type CancelToken = Arc<AtomicBool>;

/// Active-execution registry: execution_id -> cancellation token.
#[derive(Default)]
pub struct ExecutionRegistry {
    inner: Mutex<HashMap<String, CancelToken>>,
}

impl ExecutionRegistry {
    pub fn insert(&self, execution_id: String, token: CancelToken) {
        self.inner.lock().unwrap().insert(execution_id, token);
    }

    /// Request cancellation. Only executions this broker created can be
    /// cancelled; callers cannot target arbitrary PIDs.
    pub fn request_cancel(&self, execution_id: &str) -> Result<(), BrokerError> {
        let token = self
            .inner
            .lock()
            .unwrap()
            .get(execution_id)
            .cloned()
            .ok_or_else(|| {
                BrokerError::new(
                    ErrorCode::UnknownExecution,
                    format!("unknown execution_id: {execution_id}"),
                )
            })?;
        token.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub fn remove(&self, execution_id: &str) {
        self.inner.lock().unwrap().remove(execution_id);
    }

    pub fn active_count(&self) -> usize {
        self.inner.lock().unwrap().len()
    }

    pub fn active_ids(&self) -> Vec<String> {
        self.inner.lock().unwrap().keys().cloned().collect()
    }
}

/// Outcome of the spawned process lifecycle.
enum RunOutcome {
    Exited(std::process::ExitStatus),
    TimedOut,
    Cancelled,
}

/// Execute one validated plan through `binding`.
///
/// # Gate preconditions (checked by `Broker::execute` before calling)
/// - `plan.state == Ready`
/// - `plan.required_approval == false`
/// - `plan.expires_at` is `None` or in the future
/// - `plan.timeout_ms` within contract bounds
/// - `binding` matches `plan.adapter_id` and `plan.capability_id`
pub fn run(
    plan: &ExecutionPlanWire,
    binding: &dyn ExecutionBinding,
    registry: &ExecutionRegistry,
) -> Result<BrokerExecutionResult, BrokerError> {
    let execution_id = new_execution_id();
    let started_at = now_rfc3339();
    let started = Instant::now();

    // --- argv (trusted binding only) -------------------------------------
    let argv = binding.build_argv(&plan.normalized_inputs).map_err(|e| {
        BrokerError::new(
            ErrorCode::InvalidArguments,
            format!("binding rejected inputs: {e}"),
        )
    })?;
    reject_nul_args(&argv)?;

    // --- executable resolution + identity --------------------------------
    let (_candidate, fingerprint) = resolve_executable(binding.executable_candidates())?;
    if !fingerprint.verify() {
        return Err(BrokerError::new(
            ErrorCode::ExecutableChanged,
            format!(
                "executable identity changed between resolution and spawn: {}",
                fingerprint.canonical_path.display()
            ),
        ));
    }
    let resolved_exe = fingerprint.canonical_path.clone();

    // --- cwd policy -------------------------------------------------------
    let derived_cwd = binding.derive_cwd(&plan.normalized_inputs).map_err(|e| {
        BrokerError::new(
            ErrorCode::CwdNotAllowed,
            format!("cwd derivation failed: {e}"),
        )
    })?;
    let cwd = validate_cwd(&derived_cwd, binding.allowed_cwd_roots())?;

    // --- environment policy ----------------------------------------------
    let parent_env: HashMap<String, String> = std::env::vars().collect();
    let env = build_child_env(BASE_ENV_VARS, binding.env_allowlist(), &parent_env);

    // --- output limits ----------------------------------------------------
    let limits = OutputLimits::clamp(
        binding.output_limits().stdout_max_bytes,
        binding.output_limits().stderr_max_bytes,
    );

    // --- spawn with containment ------------------------------------------
    let mut command = std::process::Command::new(&resolved_exe);
    command
        .args(&argv)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear();
    for (name, value) in &env {
        command.env(name, value);
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let mut tree = ProcessTree::spawn(&mut command)?;

    registry.insert(execution_id.clone(), cancel.clone());

    let stdout = tree
        .child_mut()
        .stdout
        .take()
        .ok_or_else(|| BrokerError::new(ErrorCode::SpawnFailed, "stdout pipe missing"))?;
    let stderr = tree
        .child_mut()
        .stderr
        .take()
        .ok_or_else(|| BrokerError::new(ErrorCode::SpawnFailed, "stderr pipe missing"))?;
    let readers = OutputReaders::start(stdout, stderr, limits, cancel.clone());

    // --- wait loop with timeout + cancellation ---------------------------
    let deadline = started + Duration::from_millis(plan.timeout_ms);
    let outcome = loop {
        if cancel.load(Ordering::SeqCst) {
            let _ = tree.terminate();
            let _ = tree.wait();
            break RunOutcome::Cancelled;
        }
        match tree.try_wait() {
            Ok(Some(status)) => break RunOutcome::Exited(status),
            Ok(None) => {}
            Err(e) => {
                let _ = tree.terminate();
                let _ = tree.wait();
                return Err(BrokerError::new(
                    ErrorCode::SpawnFailed,
                    format!("wait failed: {e}"),
                ));
            }
        }
        if Instant::now() >= deadline {
            let _ = tree.terminate();
            let _ = tree.wait();
            break RunOutcome::TimedOut;
        }
        std::thread::sleep(Duration::from_millis(10));
    };

    // --- reap + collect output --------------------------------------------
    let (stdout_out, stderr_out) = readers.finish();
    let exit_code = match outcome {
        RunOutcome::Exited(status) => status.code(),
        RunOutcome::TimedOut | RunOutcome::Cancelled => None,
    };

    registry.remove(&execution_id);

    let finished_at = now_rfc3339();
    let duration_ms = started.elapsed().as_millis() as u64;

    let (timed_out, cancelled) = match outcome {
        RunOutcome::TimedOut => (true, false),
        RunOutcome::Cancelled => (false, true),
        RunOutcome::Exited(_) => (false, false),
    };

    let success = !timed_out && !cancelled && exit_code == Some(0);

    Ok(BrokerExecutionResult {
        execution_id,
        plan_id: plan.plan_id.clone(),
        capability_id: plan.capability_id.clone(),
        adapter_id: plan.adapter_id.clone(),
        started_at,
        finished_at,
        duration_ms,
        resolved_executable: resolved_exe.display().to_string(),
        executable_fingerprint: fingerprint.to_string(),
        exit_code,
        success,
        timed_out,
        cancelled,
        stdout: stdout_out.as_lossy_string(),
        stderr: stderr_out.as_lossy_string(),
        stdout_truncated: stdout_out.truncated,
        stderr_truncated: stderr_out.truncated,
        stdout_bytes_seen: stdout_out.bytes_seen,
        stderr_bytes_seen: stderr_out.bytes_seen,
        error_code: None,
        error_message: None,
    })
}

/// Reject argv elements containing a NUL character (would otherwise be
/// truncated/ambiguous at the OS boundary).
pub fn reject_nul_args(args: &[OsString]) -> Result<(), BrokerError> {
    for arg in args {
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            if arg.encode_wide().any(|u| u == 0) {
                return Err(BrokerError::new(
                    ErrorCode::InvalidArguments,
                    "argv contains a NUL character",
                ));
            }
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::ffi::OsStrExt;
            if arg.as_bytes().contains(&0) {
                return Err(BrokerError::new(
                    ErrorCode::InvalidArguments,
                    "argv contains a NUL character",
                ));
            }
        }
    }
    Ok(())
}
