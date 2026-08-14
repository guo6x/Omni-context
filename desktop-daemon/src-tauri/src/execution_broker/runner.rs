//! Goal24 Checkpoint 3 — broker execution engine.
//!
//! Executes a validated `ready` plan through a trusted binding: resolve ->
//! argv -> cwd -> env -> contained spawn -> bounded output -> timeout/cancel
//! enforcement -> structured result. Maintains the broker's active-execution
//! registry for cancellation by `execution_id` only.

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::execution_broker::output::{redact, OutputReaders};
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

/// CP3 broker-side default plan TTL: a plan without `expires_at` is valid
/// for at most 24h from `created_at` (frozen threat model T16: the policy is
/// broker-side, not yet a contract field; specified here for the CP3 spec).
pub const DEFAULT_PLAN_TTL_MS: i64 = 86_400_000;

/// Fail-closed expiry check for an RFC3339 `expires_at` string: unparseable
/// timestamps are treated as expired.
pub fn plan_is_expired(expires_at: &str) -> bool {
    match chrono::DateTime::parse_from_rfc3339(expires_at) {
        Ok(dt) => chrono::Utc::now() >= dt.with_timezone(&chrono::Utc),
        Err(_) => true,
    }
}

/// Fail-closed staleness check for a plan without `expires_at`: the CP3
/// default TTL is measured from `created_at`; unparseable timestamps are
/// treated as stale.
pub fn plan_is_stale(created_at: &str) -> bool {
    match chrono::DateTime::parse_from_rfc3339(created_at) {
        Ok(dt) => {
            let age_ms = (chrono::Utc::now() - dt.with_timezone(&chrono::Utc)).num_milliseconds();
            age_ms >= DEFAULT_PLAN_TTL_MS
        }
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

/// Executed-process lifecycle observer hooks. The broker uses these to keep
/// the durable execution receipt in sync with the real process lifecycle:
/// `spawn_started` is persisted immediately after the OS process is created
/// (before the broker waits for exit), so a crash during the wait can never
/// be misread as "never spawned".
pub trait RunLifecycle {
    /// The OS process was successfully created. A failing hook aborts
    /// fail-closed: the runner terminates the contained process tree and
    /// returns the error without a result.
    fn on_spawn_started(&mut self) -> Result<(), BrokerError>;
    /// The spawn (or an earlier pre-spawn gate) failed before any OS process
    /// was created.
    fn on_spawn_failed(&mut self) -> Result<(), BrokerError>;
    /// The process lifecycle finished (exit, timeout or cancel). Called after
    /// the result object is fully built, before the caller receives it.
    fn on_completed(&mut self, result: &BrokerExecutionResult) -> Result<(), BrokerError>;
    /// True once `on_spawn_started` was recorded (used by the broker to pick
    /// the fail-closed receipt classification when a later step errors).
    fn spawn_started_recorded(&self) -> bool;
}

/// Everything the pre-spawn stage produces. Kept together so the
/// `on_spawn_failed` hook can be applied to every pre-spawn error path.
struct PreparedRun {
    execution_id: String,
    started_at: String,
    started: Instant,
    cancel: CancelToken,
    command: std::process::Command,
    resolved_exe: PathBuf,
    fingerprint: String,
    limits: OutputLimits,
}

/// Trusted pre-spawn assembly: argv -> executable resolution -> cwd -> env ->
/// output limits. Any failure here proves no OS process was created, so the
/// caller can classify it as `spawn_failed`.
fn prepare_run(
    plan: &ExecutionPlanWire,
    binding: &dyn ExecutionBinding,
) -> Result<PreparedRun, BrokerError> {
    let execution_id = new_execution_id();
    let started_at = now_rfc3339();
    let started = Instant::now();

    // --- argv (trusted binding only) -------------------------------------
    let argv = binding.build_argv(&plan.normalized_inputs).map_err(|e| {
        BrokerError::new(
            ErrorCode::BrokerBlockedArgv,
            format!("binding rejected inputs: {e}"),
        )
    })?;
    reject_nul_args(&argv)?;

    // --- executable resolution + identity --------------------------------
    let (_candidate, fingerprint) = resolve_executable(binding.executable_candidates())?;
    if !fingerprint.verify() {
        return Err(BrokerError::new(
            ErrorCode::BrokerBlockedExecutable,
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
            ErrorCode::BrokerBlockedCwd,
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

    // --- spawn command with containment ----------------------------------
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

    Ok(PreparedRun {
        execution_id,
        started_at,
        started,
        cancel,
        command,
        resolved_exe,
        fingerprint: fingerprint.to_string(),
        limits,
    })
}

/// Execute one validated plan through `binding` (CP3 entry point; unchanged
/// semantics, no lifecycle observer).
pub fn run(
    plan: &ExecutionPlanWire,
    binding: &dyn ExecutionBinding,
    registry: &ExecutionRegistry,
) -> Result<BrokerExecutionResult, BrokerError> {
    run_with_observer(plan, binding, registry, None)
}

/// Execute one validated plan through `binding` with lifecycle hooks.
///
/// Hook ordering (CP8 receipt lifecycle):
/// - any pre-spawn failure -> `on_spawn_failed` (provably no process existed)
/// - process created -> `on_spawn_started`, persisted before the wait loop
/// - lifecycle finished -> `on_completed` after the result is built
///
/// A failing `on_spawn_started` hook aborts fail-closed: the contained
/// process tree is terminated and the error is returned without a result.
pub fn run_with_observer(
    plan: &ExecutionPlanWire,
    binding: &dyn ExecutionBinding,
    registry: &ExecutionRegistry,
    mut observer: Option<&mut dyn RunLifecycle>,
) -> Result<BrokerExecutionResult, BrokerError> {
    let prepared = match prepare_run(plan, binding) {
        Ok(prepared) => prepared,
        Err(err) => {
            if let Some(observer) = observer.as_mut() {
                let _ = observer.on_spawn_failed();
            }
            return Err(err);
        }
    };
    let PreparedRun {
        execution_id,
        started_at,
        started,
        cancel,
        mut command,
        resolved_exe,
        fingerprint,
        limits,
    } = prepared;

    let mut tree = match ProcessTree::spawn(&mut command) {
        Ok(tree) => tree,
        Err(err) => {
            if let Some(observer) = observer.as_mut() {
                let _ = observer.on_spawn_failed();
            }
            return Err(err);
        }
    };

    // Persist the spawn marker before anything waits for the child, so a
    // crash during the wait is never misclassified as "never spawned".
    if let Some(observer) = observer.as_mut() {
        if let Err(err) = observer.on_spawn_started() {
            let _ = tree.terminate();
            let _ = tree.wait();
            return Err(err);
        }
    }

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
            Ok(Some(status)) => {
                // The direct child exited; the tree is complete only when
                // no descendant remains inside the containment boundary.
                if tree.is_empty() {
                    break RunOutcome::Exited(status);
                }
                if Instant::now() >= deadline {
                    let _ = tree.terminate();
                    let _ = tree.wait();
                    break RunOutcome::TimedOut;
                }
            }
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
    let (stdout_text, stdout_redacted) = redact(&stdout_out.as_lossy_string());
    let (stderr_text, stderr_redacted) = redact(&stderr_out.as_lossy_string());
    let output_redacted = stdout_redacted || stderr_redacted;
    let exit_code = match outcome {
        RunOutcome::Exited(status) => status.code(),
        RunOutcome::TimedOut | RunOutcome::Cancelled => None,
    };

    registry.remove(&execution_id);

    let finished_at = now_rfc3339();
    let duration_ms = started.elapsed().as_millis() as u64;

    let (timed_out, cancelled, error_code, error_message) = match outcome {
        RunOutcome::TimedOut => (
            true,
            false,
            Some(ErrorCode::BrokerTimeout),
            Some("execution timed out".to_string()),
        ),
        RunOutcome::Cancelled => (
            false,
            true,
            Some(ErrorCode::BrokerCancelled),
            Some("execution cancelled".to_string()),
        ),
        RunOutcome::Exited(_) => {
            if stdout_out.truncated || stderr_out.truncated {
                (
                    false,
                    false,
                    Some(ErrorCode::BrokerOutputLimit),
                    Some("output truncated at broker limit".to_string()),
                )
            } else {
                (false, false, None, None)
            }
        }
    };

    let success = !timed_out && !cancelled && exit_code == Some(0);

    let result = BrokerExecutionResult {
        execution_id,
        plan_id: plan.plan_id.clone(),
        capability_id: plan.capability_id.clone(),
        adapter_id: plan.adapter_id.clone(),
        started_at,
        finished_at,
        duration_ms,
        resolved_executable: resolved_exe.display().to_string(),
        executable_fingerprint: fingerprint,
        exit_code,
        success,
        timed_out,
        cancelled,
        stdout: stdout_text,
        stderr: stderr_text,
        stdout_truncated: stdout_out.truncated,
        stderr_truncated: stderr_out.truncated,
        stdout_bytes_seen: stdout_out.bytes_seen,
        stderr_bytes_seen: stderr_out.bytes_seen,
        output_redacted,
        error_code,
        error_message,
    };

    if let Some(observer) = observer.as_mut() {
        observer.on_completed(&result)?;
    }
    Ok(result)
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
                    ErrorCode::BrokerBlockedArgv,
                    "argv contains a NUL character",
                ));
            }
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::ffi::OsStrExt;
            if arg.as_bytes().contains(&0) {
                return Err(BrokerError::new(
                    ErrorCode::BrokerBlockedArgv,
                    "argv contains a NUL character",
                ));
            }
        }
    }
    Ok(())
}
