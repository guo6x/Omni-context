use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    OnceLock, RwLock,
};

const MAX_BLOCKLIST_ENTRIES: usize = 100;
const MAX_BLOCKLIST_ENTRY_CHARS: usize = 256;
const STATE_INVALIDATED: u64 = 1;
const STATE_ACTION_ACTIVE: u64 = 1 << 1;
const STATE_GENERATION_SHIFT: u32 = 2;
const MAX_POLICY_GENERATION: u64 = u64::MAX >> STATE_GENERATION_SHIFT;
const REVOCATION_LATCH_CONTENT: &[u8] =
    b"Omni-context capture requires explicit privacy confirmation.\n";

fn revocation_latch_present(path: &Path) -> Result<bool, String> {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(true),
        Ok(_) => Err("capture revocation latch path is not a file".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("cannot inspect capture revocation latch: {error}")),
    }
}

fn write_revocation_latch(path: &Path) -> Result<(), String> {
    if revocation_latch_present(path)? {
        return Ok(());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "capture revocation latch has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("cannot create capture policy data directory: {error}"))?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = path.with_file_name(format!(
        ".capture-policy-revoked-{}-{nonce}.tmp",
        std::process::id()
    ));
    let write_result = (|| {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("cannot create capture revocation latch: {error}"))?;
        file.write_all(REVOCATION_LATCH_CONTENT)
            .map_err(|error| format!("cannot write capture revocation latch: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("cannot flush capture revocation latch: {error}"))?;
        match std::fs::rename(&temporary, path) {
            Ok(()) => Ok(()),
            Err(_error) if revocation_latch_present(path).unwrap_or(false) => Ok(()),
            Err(error) => Err(format!("cannot commit capture revocation latch: {error}")),
        }
    })();
    if temporary.exists() {
        let _ = std::fs::remove_file(&temporary);
    }
    write_result
}

fn clear_revocation_latch(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("cannot clear capture revocation latch: {error}")),
    }
}

#[derive(Clone, Debug)]
pub struct CapturePolicy {
    pub capture_paused: bool,
    pub capture_blocklist: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ForegroundWindow {
    pub title: String,
    pub process_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CaptureAuthorization {
    generation: u64,
    foreground: ForegroundWindow,
}

#[derive(Default)]
struct PolicyStore {
    policy: RwLock<Option<CapturePolicy>>,
}

struct PolicyRuntime {
    store: PolicyStore,
    gate: tokio::sync::Mutex<()>,
    revocation_latch: Option<PathBuf>,
    // One atomic word orders policy generations, revocation, action admission,
    // and result commitment. Bit 0 is invalidated, bit 1 is an admitted native
    // capture/upload operation, and the remaining bits are the generation.
    state: AtomicU64,
}

impl Default for PolicyRuntime {
    fn default() -> Self {
        Self {
            store: PolicyStore::default(),
            gate: tokio::sync::Mutex::new(()),
            // Start invalidated at generation zero.
            state: AtomicU64::new(STATE_INVALIDATED),
            revocation_latch: None,
        }
    }
}

/// A native action lease is acquired by a single CAS before invoking a
/// screenshot, clipboard read, or upload. Its commit CAS is the linearization
/// point for returning captured data / a successful upload result. Revocation
/// wins either CAS race atomically; dropping an unfinished lease clears the
/// active bit without ever re-confirming an invalidated generation.
struct CaptureActionLease<'a> {
    runtime: &'a PolicyRuntime,
    generation: u64,
    active: bool,
}

impl CaptureActionLease<'_> {
    fn commit(mut self) -> Result<(), String> {
        let active_state = (self.generation << STATE_GENERATION_SHIFT) | STATE_ACTION_ACTIVE;
        let confirmed_state = self.generation << STATE_GENERATION_SHIFT;
        match self.runtime.state.compare_exchange(
            active_state,
            confirmed_state,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => {
                self.active = false;
                Ok(())
            }
            Err(_) => {
                self.release_active_bit();
                Err("capture policy was revoked before the action could be committed".to_string())
            }
        }
    }

    fn release_active_bit(&mut self) {
        while self.active {
            let state = self.runtime.state.load(Ordering::SeqCst);
            if state & STATE_ACTION_ACTIVE == 0 {
                self.active = false;
                break;
            }
            if self
                .runtime
                .state
                .compare_exchange(
                    state,
                    state & !STATE_ACTION_ACTIVE,
                    Ordering::SeqCst,
                    Ordering::SeqCst,
                )
                .is_ok()
            {
                self.active = false;
            }
        }
    }
}

impl Drop for CaptureActionLease<'_> {
    fn drop(&mut self) {
        self.release_active_bit();
    }
}

static POLICY: OnceLock<PolicyRuntime> = OnceLock::new();

fn policy_runtime() -> &'static PolicyRuntime {
    POLICY.get_or_init(|| {
        PolicyRuntime::with_revocation_latch(
            crate::brain_server::user_data_dir().join("capture-policy-revoked"),
        )
    })
}

/// Publish the WebView's persisted privacy preferences as a native runtime
/// snapshot. It is refreshed on startup and every persisted settings change;
/// keeping it in memory avoids timer throttling changing normal tray behavior.
pub async fn set_policy(
    expected_generation: u64,
    capture_paused: bool,
    capture_blocklist: Vec<String>,
    explicit_confirmation: bool,
) -> Result<(), String> {
    policy_runtime()
        .set(
            expected_generation,
            capture_paused,
            capture_blocklist,
            explicit_confirmation,
        )
        .await
}

impl PolicyRuntime {
    fn with_revocation_latch(revocation_latch: PathBuf) -> Self {
        Self {
            revocation_latch: Some(revocation_latch),
            ..Self::default()
        }
    }

    fn revocation_latch_present(&self) -> Result<bool, String> {
        self.revocation_latch
            .as_deref()
            .map(revocation_latch_present)
            .unwrap_or(Ok(false))
    }

    fn begin_invalidation(&self) -> u64 {
        let previous = self
            .state
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |state| {
                let generation = state >> STATE_GENERATION_SHIFT;
                generation.checked_add(1).map(|next| {
                    (next << STATE_GENERATION_SHIFT)
                        | STATE_INVALIDATED
                        | (state & STATE_ACTION_ACTIVE)
                })
            });
        match previous {
            Ok(state) => (state >> STATE_GENERATION_SHIFT) + 1,
            Err(_) => {
                // Exhausting 62 bits is not realistically reachable. Still
                // fail closed instead of allowing the counter to wrap and
                // make a stale generation valid again.
                self.state.fetch_or(STATE_INVALIDATED, Ordering::SeqCst);
                MAX_POLICY_GENERATION
            }
        }
    }

    async fn set(
        &self,
        expected_generation: u64,
        capture_paused: bool,
        capture_blocklist: Vec<String>,
        explicit_confirmation: bool,
    ) -> Result<(), String> {
        let _gate = self.gate.lock().await;
        if expected_generation >= MAX_POLICY_GENERATION {
            return Err("capture policy generation is exhausted; capture denied".to_string());
        }
        let revoked_state = (expected_generation << STATE_GENERATION_SHIFT) | STATE_INVALIDATED;
        if self.state.load(Ordering::SeqCst) != revoked_state {
            return Err("stale capture policy confirmation denied".to_string());
        }
        self.store.invalidate();
        if self.revocation_latch_present()? && !explicit_confirmation {
            return Err(
                "capture policy remains revoked; explicit privacy settings confirmation required"
                    .to_string(),
            );
        }
        self.store.set(capture_paused, capture_blocklist)?;
        if explicit_confirmation {
            if let Some(path) = self.revocation_latch.as_deref() {
                clear_revocation_latch(path)?;
            }
        }
        let confirmed_state = expected_generation << STATE_GENERATION_SHIFT;
        if self
            .state
            .compare_exchange(
                revoked_state,
                confirmed_state,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_err()
        {
            self.store.invalidate();
            return Err(
                "capture policy changed during confirmation; retry synchronization".to_string(),
            );
        }
        Ok(())
    }

    async fn invalidate(&self, require_reconfirmation: bool) -> Result<u64, String> {
        // Revoke atomically before waiting for an admitted native action to
        // leave the gate. Explicit privacy changes also write a durable latch
        // so a failed WebView save cannot restore an older permissive setting
        // after restart.
        let generation = self.begin_invalidation();
        let _gate = self.gate.lock().await;
        self.store.invalidate();
        if require_reconfirmation {
            if let Some(path) = self.revocation_latch.as_deref() {
                write_revocation_latch(path)?;
            }
        }
        Ok(generation)
    }

    fn current(&self) -> Result<CapturePolicy, String> {
        let state = self.state.load(Ordering::SeqCst);
        if state & STATE_INVALIDATED != 0 {
            return Err("capture policy is not confirmed; capture denied".to_string());
        }
        let policy = self.store.current()?;
        if self.state.load(Ordering::SeqCst) & !STATE_ACTION_ACTIVE != state & !STATE_ACTION_ACTIVE
        {
            return Err("capture policy changed; capture denied".to_string());
        }
        Ok(policy)
    }

    fn authorize_foreground(
        &self,
        foreground: Result<ForegroundWindow, String>,
    ) -> Result<CaptureAuthorization, String> {
        let state = self.state.load(Ordering::SeqCst);
        let policy = self.current()?;
        let foreground = foreground.map_err(|_| {
            "foreground application could not be verified; capture denied".to_string()
        })?;
        authorize(Ok(policy), Ok(foreground.clone()))?;
        let current_state = self.state.load(Ordering::SeqCst);
        if current_state & !STATE_ACTION_ACTIVE != state & !STATE_ACTION_ACTIVE {
            return Err("capture policy changed during authorization; capture denied".to_string());
        }
        Ok(CaptureAuthorization {
            generation: state >> STATE_GENERATION_SHIFT,
            foreground,
        })
    }

    fn authorization_is_current(&self, authorization: &CaptureAuthorization) -> bool {
        let state = self.state.load(Ordering::SeqCst);
        state & !STATE_ACTION_ACTIVE == authorization.generation << STATE_GENERATION_SHIFT
    }

    fn begin_action(
        &self,
        authorization: &CaptureAuthorization,
    ) -> Result<CaptureActionLease<'_>, String> {
        let confirmed_state = authorization.generation << STATE_GENERATION_SHIFT;
        self.state
            .compare_exchange(
                confirmed_state,
                confirmed_state | STATE_ACTION_ACTIVE,
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .map_err(|_| "capture authorization expired; action denied".to_string())?;
        Ok(CaptureActionLease {
            runtime: self,
            generation: authorization.generation,
            active: true,
        })
    }

    async fn run_with_foreground<Fg, F, Fut, T>(
        &self,
        foreground: Fg,
        action: F,
    ) -> Result<(T, CaptureAuthorization), String>
    where
        Fg: Fn() -> Result<ForegroundWindow, String>,
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        self.run_with_foreground_and_hooks(foreground, || async {}, || async {}, action)
            .await
    }

    async fn run_with_foreground_and_hooks<
        Fg,
        BeforeAdmission,
        BeforeAdmissionFut,
        BeforeCommit,
        BeforeCommitFut,
        F,
        Fut,
        T,
    >(
        &self,
        foreground: Fg,
        before_admission: BeforeAdmission,
        before_commit: BeforeCommit,
        action: F,
    ) -> Result<(T, CaptureAuthorization), String>
    where
        Fg: Fn() -> Result<ForegroundWindow, String>,
        BeforeAdmission: FnOnce() -> BeforeAdmissionFut,
        BeforeAdmissionFut: Future<Output = ()>,
        BeforeCommit: FnOnce() -> BeforeCommitFut,
        BeforeCommitFut: Future<Output = ()>,
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        let _gate = self.gate.lock().await;
        let authorization = self.authorize_foreground(foreground())?;
        // Re-read the foreground immediately before invoking the capture
        // action.  A window can change between the initial authorization and
        // the native screenshot/clipboard call; in that case the action must
        // not run at all.  The post-action checks below remain as a final
        // defence for races that occur while the action itself is running.
        let current_foreground = self.authorize_foreground(foreground())?;
        if current_foreground != authorization {
            return Err(
                "foreground application changed before capture; capture denied".to_string(),
            );
        }
        before_admission().await;
        // This CAS is the action-admission linearization point shared with
        // synchronous tray revocation. A revoke that wins first makes the
        // screenshot/clipboard future unreachable; a prior lease is allowed
        // to run, but cannot deliver its result if revoke wins before commit.
        let action_lease = self.begin_action(&authorization)?;
        // Admission hooks may yield while the user changes focus. Recheck
        // after the lease is acquired, immediately before invoking native
        // screenshot/clipboard work, so a newly sensitive window is not read
        // and merely discarded afterwards.
        let latest_foreground = self.authorize_foreground(foreground())?;
        if latest_foreground != authorization {
            return Err(
                "foreground application changed immediately before capture; capture denied"
                    .to_string(),
            );
        }
        let result = action().await?;
        if !self.authorization_is_current(&authorization) {
            return Err(
                "capture policy changed during capture; captured data discarded".to_string(),
            );
        }
        let current_foreground = self.authorize_foreground(foreground())?;
        if current_foreground.foreground != authorization.foreground {
            return Err(
                "foreground application changed during capture; captured data discarded"
                    .to_string(),
            );
        }
        if current_foreground != authorization || !self.authorization_is_current(&authorization) {
            return Err(
                "capture policy changed during capture; captured data discarded".to_string(),
            );
        }
        before_commit().await;
        action_lease.commit()?;
        Ok((result, authorization))
    }

    async fn run_with_authorization<F, Fut, T>(
        &self,
        authorization: &CaptureAuthorization,
        action: F,
    ) -> Result<T, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        self.run_with_authorization_and_foreground(authorization, foreground_window, action)
            .await
    }

    async fn run_with_authorization_and_foreground<Fg, F, Fut, T>(
        &self,
        authorization: &CaptureAuthorization,
        foreground: Fg,
        action: F,
    ) -> Result<T, String>
    where
        Fg: Fn() -> Result<ForegroundWindow, String>,
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        self.run_with_authorization_and_foreground_and_hooks(
            authorization,
            foreground,
            || async {},
            || async {},
            action,
        )
        .await
    }

    async fn run_with_authorization_and_foreground_and_hooks<
        Fg,
        BeforeAdmission,
        BeforeAdmissionFut,
        BeforeCommit,
        BeforeCommitFut,
        F,
        Fut,
        T,
    >(
        &self,
        authorization: &CaptureAuthorization,
        foreground: Fg,
        before_admission: BeforeAdmission,
        before_commit: BeforeCommit,
        action: F,
    ) -> Result<T, String>
    where
        Fg: Fn() -> Result<ForegroundWindow, String>,
        BeforeAdmission: FnOnce() -> BeforeAdmissionFut,
        BeforeAdmissionFut: Future<Output = ()>,
        BeforeCommit: FnOnce() -> BeforeCommitFut,
        BeforeCommitFut: Future<Output = ()>,
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        let _gate = self.gate.lock().await;
        if !self.authorization_is_current(authorization) {
            return Err("capture authorization expired; upload denied".to_string());
        }
        let current = self.authorize_foreground(foreground())?;
        if current != *authorization {
            return Err(
                "capture authorization no longer matches the foreground application".to_string(),
            );
        }
        before_admission().await;
        // Uploads use the same admission lease as native reads. In particular,
        // a pause that wins before this CAS prevents the network request from
        // starting, even if captured bytes are already in memory.
        let action_lease = self.begin_action(authorization)?;
        // Re-read after the lease is acquired and directly before starting
        // the loopback request. A focus change must not send the captured
        // payload merely to discard its receipt after the request completes.
        let latest_foreground = self.authorize_foreground(foreground())?;
        if latest_foreground != *authorization {
            return Err(
                "foreground application changed immediately before upload; upload denied"
                    .to_string(),
            );
        }
        let result = action().await?;
        if !self.authorization_is_current(authorization) {
            return Err(
                "capture policy changed during upload; captured data discarded".to_string(),
            );
        }
        let current = self.authorize_foreground(foreground())?;
        if current.foreground != authorization.foreground {
            return Err(
                "foreground application changed during upload; captured data discarded".to_string(),
            );
        }
        if current != *authorization || !self.authorization_is_current(authorization) {
            return Err(
                "capture policy changed during upload; captured data discarded".to_string(),
            );
        }
        before_commit().await;
        action_lease.commit()?;
        Ok(result)
    }
}

impl PolicyStore {
    fn set(&self, capture_paused: bool, capture_blocklist: Vec<String>) -> Result<(), String> {
        // Invalidate first so malformed input cannot leave a prior permissive
        // policy active after a failed settings sync.
        self.invalidate();

        if capture_blocklist.len() > MAX_BLOCKLIST_ENTRIES {
            return Err("capture policy contains too many blocklist entries".to_string());
        }
        let mut normalized = Vec::with_capacity(capture_blocklist.len());
        for entry in capture_blocklist {
            let value = entry.trim();
            if value.is_empty() {
                continue;
            }
            if value.chars().count() > MAX_BLOCKLIST_ENTRY_CHARS
                || value.chars().any(char::is_control)
            {
                return Err("capture policy contains an invalid blocklist entry".to_string());
            }
            normalized.push(value.to_string());
        }

        let mut store = self
            .policy
            .write()
            .map_err(|_| "capture policy state is unavailable".to_string())?;
        *store = Some(CapturePolicy {
            capture_paused,
            capture_blocklist: normalized,
        });
        Ok(())
    }

    fn invalidate(&self) {
        if let Ok(mut store) = self.policy.write() {
            *store = None;
        }
    }

    fn current(&self) -> Result<CapturePolicy, String> {
        let store = self
            .policy
            .read()
            .map_err(|_| "capture policy state is unavailable; capture denied".to_string())?;
        store
            .as_ref()
            .cloned()
            .ok_or_else(|| "capture policy is not confirmed; capture denied".to_string())
    }
}

#[tauri::command]
pub async fn sync_capture_policy(
    expected_generation: u64,
    capture_paused: bool,
    capture_blocklist: Vec<String>,
    explicit_confirmation: bool,
) -> Result<(), String> {
    set_policy(
        expected_generation,
        capture_paused,
        capture_blocklist,
        explicit_confirmation,
    )
    .await
}

#[tauri::command]
pub async fn invalidate_capture_policy(require_reconfirmation: bool) -> Result<u64, String> {
    invalidate(require_reconfirmation).await
}

/// Serialize tray-triggered revocation with native capture actions before the
/// renderer is told to persist the new pause state.
pub async fn mark_invalidated() -> Result<u64, String> {
    policy_runtime().invalidate(true).await
}

pub async fn invalidate(require_reconfirmation: bool) -> Result<u64, String> {
    policy_runtime().invalidate(require_reconfirmation).await
}

fn is_identifiable(foreground: &ForegroundWindow) -> bool {
    let process = foreground.process_name.trim();
    !process.is_empty()
        && !process.eq_ignore_ascii_case("unknown")
        && !process.to_ascii_lowercase().starts_with("pid:")
}

pub fn authorize(
    policy: Result<CapturePolicy, String>,
    foreground: Result<ForegroundWindow, String>,
) -> Result<(), String> {
    let policy = policy?;
    if policy.capture_paused {
        return Err("capture is paused; hardware capture denied".to_string());
    }

    let foreground = foreground
        .map_err(|_| "foreground application could not be verified; capture denied".to_string())?;
    if !is_identifiable(&foreground) {
        return Err("foreground application could not be verified; capture denied".to_string());
    }

    let foreground_text =
        format!("{}\n{}", foreground.process_name, foreground.title).to_lowercase();
    if policy
        .capture_blocklist
        .iter()
        .any(|rule| foreground_text.contains(&rule.to_lowercase()))
    {
        return Err("capture is blocked for the foreground application".to_string());
    }
    Ok(())
}

/// Gate the complete native capture action, not just the renderer's button.
/// Keeping the action injectable also lets policy tests prove that denied
/// paths never invoke screenshot, clipboard, or upload work.
pub async fn run_if_allowed<F, Fut, T>(
    policy: Result<CapturePolicy, String>,
    foreground: Result<ForegroundWindow, String>,
    action: F,
) -> Result<T, String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    authorize(policy, foreground)?;
    action().await
}

pub async fn run_current_if_allowed<F, Fut, T>(action: F) -> Result<T, String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    policy_runtime()
        .run_with_foreground(foreground_window, action)
        .await
        .map(|(result, _)| result)
}

pub async fn run_current_if_allowed_with_authorization<F, Fut, T>(
    action: F,
) -> Result<(T, CaptureAuthorization), String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    policy_runtime()
        .run_with_foreground(foreground_window, action)
        .await
}

pub async fn run_with_capture_authorization<F, Fut, T>(
    authorization: &CaptureAuthorization,
    action: F,
) -> Result<T, String>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    policy_runtime()
        .run_with_authorization(authorization, action)
        .await
}

pub fn foreground_window() -> Result<ForegroundWindow, String> {
    let info = crate::commands::get_foreground_window_info()?;
    Ok(ForegroundWindow {
        title: info.title,
        process_name: info.process_name,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        authorize, revocation_latch_present, run_if_allowed, CapturePolicy, ForegroundWindow,
        PolicyRuntime, PolicyStore,
    };
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    fn policy(paused: bool, blocklist: &[&str]) -> Result<CapturePolicy, String> {
        Ok(CapturePolicy {
            capture_paused: paused,
            capture_blocklist: blocklist.iter().map(|value| value.to_string()).collect(),
        })
    }

    fn foreground(process_name: &str, title: &str) -> Result<ForegroundWindow, String> {
        Ok(ForegroundWindow {
            process_name: process_name.to_string(),
            title: title.to_string(),
        })
    }

    async fn confirm_policy(runtime: &PolicyRuntime, paused: bool, blocklist: Vec<String>) {
        let generation = runtime.invalidate(false).await.unwrap();
        runtime
            .set(generation, paused, blocklist, false)
            .await
            .unwrap();
    }

    async fn wait_for_revocation(runtime: &PolicyRuntime) {
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while runtime.current().is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect(
            "native invalidate path should revoke admission before waiting for the action gate",
        );
    }

    #[tokio::test]
    async fn paused_policy_does_not_run_capture_or_import_action() {
        let calls = Arc::new(AtomicUsize::new(0));
        let action_calls = calls.clone();
        let result = run_if_allowed(
            policy(true, &[]),
            foreground("browser.exe", "Article"),
            || async move {
                action_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .await;
        assert!(result.unwrap_err().contains("paused"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn sensitive_foreground_does_not_run_capture_or_import_action() {
        let calls = Arc::new(AtomicUsize::new(0));
        let action_calls = calls.clone();
        let result = run_if_allowed(
            policy(false, &["password manager", "bank"]),
            foreground("KeePass.exe", "Password Manager"),
            || async move {
                action_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .await;
        assert!(result.unwrap_err().contains("blocked"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn unknown_policy_or_unverifiable_foreground_does_not_run_action() {
        for (policy, foreground) in [
            (
                Err("not confirmed".to_string()),
                foreground("browser.exe", "Article"),
            ),
            (
                policy(false, &[]),
                Err("foreground lookup failed".to_string()),
            ),
            (policy(false, &[]), foreground("Unknown", "Article")),
        ] {
            let calls = Arc::new(AtomicUsize::new(0));
            let action_calls = calls.clone();
            let result = run_if_allowed(policy, foreground, || async move {
                action_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .await;
            assert!(result.is_err());
            assert_eq!(calls.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test]
    async fn valid_unblocked_policy_runs_capture_action() {
        let calls = Arc::new(AtomicUsize::new(0));
        let action_calls = calls.clone();
        run_if_allowed(
            policy(false, &["password manager", "bank"]),
            foreground("browser.exe", "Research article"),
            || async move {
                action_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .await
        .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn empty_blocklist_is_a_valid_explicit_policy_and_matching_is_case_insensitive() {
        assert!(authorize(policy(false, &[]), foreground("browser.exe", "Normal page")).is_ok());
        assert!(authorize(policy(false, &["WECHAT"]), foreground("WeChat.exe", "Chat")).is_err());
    }

    #[test]
    fn new_policy_store_denies_capture_until_first_confirmation() {
        let store = PolicyStore::default();
        assert!(store.current().unwrap_err().contains("not confirmed"));
    }

    #[tokio::test]
    async fn failed_privacy_save_latch_survives_restart_until_user_confirms_a_policy() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let test_dir = std::env::temp_dir().join(format!(
            "omni-capture-policy-restart-{}-{nonce}",
            std::process::id()
        ));
        let latch = test_dir.join("capture-policy-revoked");
        let first_runtime = PolicyRuntime::with_revocation_latch(latch.clone());

        // Existing persisted settings permitted capture; a privacy update
        // revokes native access before the WebView attempts its local write.
        let generation = first_runtime.invalidate(false).await.unwrap();
        first_runtime
            .set(generation, false, vec![], false)
            .await
            .unwrap();
        let failed_save_generation = first_runtime.invalidate(true).await.unwrap();
        assert!(revocation_latch_present(&latch).unwrap());
        assert!(first_runtime.current().is_err());
        drop(first_runtime);

        // A new process must not re-publish the old active preference merely
        // because the settings write had failed before it could be persisted.
        let restarted = PolicyRuntime::with_revocation_latch(latch.clone());
        let startup_generation = restarted.invalidate(false).await.unwrap();
        let stale_generation = restarted
            .set(failed_save_generation, false, vec![], false)
            .await
            .unwrap_err();
        assert!(stale_generation.contains("stale"));
        let unconfirmed = restarted
            .set(startup_generation, false, vec![], false)
            .await
            .unwrap_err();
        assert!(unconfirmed.contains("explicit privacy settings confirmation required"));
        assert!(restarted.current().is_err());
        assert!(revocation_latch_present(&latch).unwrap());

        // The recovery choice explicitly saves "paused" before removing the
        // durable latch; a later user-initiated resume can be a separate act.
        restarted
            .set(startup_generation, true, vec![], true)
            .await
            .unwrap();
        assert!(restarted.current().unwrap().capture_paused);
        assert!(!revocation_latch_present(&latch).unwrap());
        let _ = std::fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn malformed_update_invalidates_previous_permissive_policy() {
        let store = PolicyStore::default();
        store.set(false, vec![]).unwrap();
        assert!(!store.current().unwrap().capture_paused);

        let malformed_entry = format!("invalid{}entry", '\0');
        assert!(store.set(false, vec![malformed_entry]).is_err());
        assert!(store.current().unwrap_err().contains("not confirmed"));
    }

    #[tokio::test]
    async fn policy_change_waits_for_in_flight_capture_then_denies_later_actions() {
        let runtime = Arc::new(PolicyRuntime::default());
        confirm_policy(&runtime, false, vec![]).await;

        let (capture_started, started) = tokio::sync::oneshot::channel();
        let (finish_capture, finish) = tokio::sync::oneshot::channel();
        let capture_runtime = runtime.clone();
        let capture = tokio::spawn(async move {
            capture_runtime
                .run_with_foreground(
                    || foreground("browser.exe", "Article"),
                    || async move {
                        let _ = capture_started.send(());
                        finish.await.map_err(|error| error.to_string())?;
                        Ok("captured bytes")
                    },
                )
                .await
        });
        started.await.unwrap();

        let update_runtime = runtime.clone();
        let update = tokio::spawn(async move {
            let generation = update_runtime.invalidate(false).await.unwrap();
            update_runtime.set(generation, true, vec![], false).await
        });
        tokio::task::yield_now().await;
        assert!(
            !update.is_finished(),
            "policy acknowledgement waits for an in-flight capture"
        );
        assert!(
            runtime.current().is_err(),
            "revocation denies new actions immediately while the action gate drains"
        );

        finish_capture.send(()).unwrap();
        assert!(capture
            .await
            .unwrap()
            .unwrap_err()
            .contains("captured data discarded"));
        update.await.unwrap().unwrap();
        assert!(runtime.current().unwrap().capture_paused);

        let calls = Arc::new(AtomicUsize::new(0));
        let action_calls = calls.clone();
        let denied = runtime
            .run_with_foreground(
                || foreground("browser.exe", "Article"),
                || async move {
                    action_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            )
            .await;
        assert!(denied.unwrap_err().contains("paused"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn capture_authorization_expires_on_policy_or_foreground_change() {
        let runtime = PolicyRuntime::default();
        confirm_policy(&runtime, false, vec![]).await;
        let (_, authorization) = runtime
            .run_with_foreground(
                || foreground("browser.exe", "Project notes"),
                || async { Ok(()) },
            )
            .await
            .unwrap();

        let calls = Arc::new(AtomicUsize::new(0));
        let action_calls = calls.clone();
        let foreground_changed = runtime
            .run_with_authorization_and_foreground(
                &authorization,
                || foreground("other.exe", "Different app"),
                || async move {
                    action_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            )
            .await;
        assert!(foreground_changed
            .unwrap_err()
            .contains("foreground application"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        confirm_policy(&runtime, false, vec!["bank".to_string()]).await;
        let action_calls = calls.clone();
        let policy_changed = runtime
            .run_with_authorization_and_foreground(
                &authorization,
                || foreground("browser.exe", "Project notes"),
                || async move {
                    action_calls.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                },
            )
            .await;
        assert!(policy_changed.unwrap_err().contains("expired"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn capture_rechecks_foreground_after_action_before_returning_data() {
        let runtime = PolicyRuntime::default();
        confirm_policy(&runtime, false, vec!["password".to_string()]).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let foreground_calls = Arc::new(AtomicUsize::new(0));
        let foreground_calls_for_lookup = foreground_calls.clone();
        let action_calls = calls.clone();
        let result = runtime
            .run_with_foreground(
                move || {
                    if foreground_calls_for_lookup.fetch_add(1, Ordering::SeqCst) < 3 {
                        foreground("browser.exe", "Research")
                    } else {
                        foreground("password-manager.exe", "Vault")
                    }
                },
                || async move {
                    action_calls.fetch_add(1, Ordering::SeqCst);
                    Ok("captured bytes")
                },
            )
            .await;
        assert!(result.unwrap_err().contains("foreground application"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn capture_does_not_run_when_foreground_changes_before_action() {
        let runtime = PolicyRuntime::default();
        confirm_policy(&runtime, false, vec![]).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let foreground_calls = Arc::new(AtomicUsize::new(0));
        let foreground_calls_for_lookup = foreground_calls.clone();
        let action_calls = calls.clone();
        let result = runtime
            .run_with_foreground(
                move || {
                    if foreground_calls_for_lookup.fetch_add(1, Ordering::SeqCst) < 2 {
                        foreground("browser.exe", "Research")
                    } else {
                        foreground("other.exe", "Different app")
                    }
                },
                || async move {
                    action_calls.fetch_add(1, Ordering::SeqCst);
                    Ok("captured bytes")
                },
            )
            .await;
        assert!(result.unwrap_err().contains("before capture"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn capture_does_not_run_when_foreground_changes_during_admission() {
        let runtime = PolicyRuntime::default();
        confirm_policy(&runtime, false, vec![]).await;
        let foreground_changed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let foreground_changed_for_lookup = foreground_changed.clone();
        let foreground_changed_for_hook = foreground_changed.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let action_calls = calls.clone();

        let result = runtime
            .run_with_foreground_and_hooks(
                move || {
                    if foreground_changed_for_lookup.load(Ordering::SeqCst) {
                        foreground("password-manager.exe", "Vault")
                    } else {
                        foreground("browser.exe", "Research")
                    }
                },
                move || async move {
                    foreground_changed_for_hook.store(true, Ordering::SeqCst);
                },
                || async {},
                || async move {
                    action_calls.fetch_add(1, Ordering::SeqCst);
                    Ok("captured bytes")
                },
            )
            .await;

        assert!(result.unwrap_err().contains("immediately before capture"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn tray_revoke_before_capture_admission_keeps_native_action_unstarted() {
        let runtime = Arc::new(PolicyRuntime::default());
        confirm_policy(&runtime, false, vec![]).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let action_calls = calls.clone();
        let (at_admission, admission_reached) = tokio::sync::oneshot::channel();
        let (resume_admission, resume) = tokio::sync::oneshot::channel();
        let capture_runtime = runtime.clone();
        let capture = tokio::spawn(async move {
            capture_runtime
                .run_with_foreground_and_hooks(
                    || foreground("browser.exe", "Research"),
                    || async move {
                        let _ = at_admission.send(());
                        let _ = resume.await;
                    },
                    || async {},
                    || async move {
                        action_calls.fetch_add(1, Ordering::SeqCst);
                        Ok("captured bytes")
                    },
                )
                .await
        });

        admission_reached.await.unwrap();
        let revoke_runtime = runtime.clone();
        let revoke = tokio::spawn(async move { revoke_runtime.invalidate(false).await });
        wait_for_revocation(&runtime).await;
        assert!(
            !revoke.is_finished(),
            "invalidation waits for the admitted gate holder"
        );
        resume_admission.send(()).unwrap();

        let result = capture.await.unwrap();
        assert!(result.unwrap_err().contains("authorization expired"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        revoke.await.unwrap().unwrap();
        assert!(runtime.current().is_err());
    }

    #[tokio::test]
    async fn tray_revoke_before_capture_commit_discards_captured_result() {
        let runtime = Arc::new(PolicyRuntime::default());
        confirm_policy(&runtime, false, vec![]).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let action_calls = calls.clone();
        let (at_commit, commit_reached) = tokio::sync::oneshot::channel();
        let (resume_commit, resume) = tokio::sync::oneshot::channel();
        let capture_runtime = runtime.clone();
        let capture = tokio::spawn(async move {
            capture_runtime
                .run_with_foreground_and_hooks(
                    || foreground("browser.exe", "Research"),
                    || async {},
                    || async move {
                        let _ = at_commit.send(());
                        let _ = resume.await;
                    },
                    || async move {
                        action_calls.fetch_add(1, Ordering::SeqCst);
                        Ok("captured bytes")
                    },
                )
                .await
        });

        commit_reached.await.unwrap();
        let revoke_runtime = runtime.clone();
        let revoke = tokio::spawn(async move { revoke_runtime.invalidate(false).await });
        wait_for_revocation(&runtime).await;
        assert!(
            !revoke.is_finished(),
            "invalidation waits for the admitted gate holder"
        );
        resume_commit.send(()).unwrap();

        let result = capture.await.unwrap();
        assert!(result.unwrap_err().contains("revoked"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        revoke.await.unwrap().unwrap();
        assert!(runtime.current().is_err());
    }

    #[tokio::test]
    async fn tray_revoke_before_upload_admission_keeps_network_action_unstarted() {
        let runtime = Arc::new(PolicyRuntime::default());
        confirm_policy(&runtime, false, vec![]).await;
        let (_, authorization) = runtime
            .run_with_foreground(
                || foreground("browser.exe", "Research"),
                || async { Ok(()) },
            )
            .await
            .unwrap();

        let calls = Arc::new(AtomicUsize::new(0));
        let action_calls = calls.clone();
        let (at_admission, admission_reached) = tokio::sync::oneshot::channel();
        let (resume_admission, resume) = tokio::sync::oneshot::channel();
        let upload_runtime = runtime.clone();
        let upload = tokio::spawn(async move {
            upload_runtime
                .run_with_authorization_and_foreground_and_hooks(
                    &authorization,
                    || foreground("browser.exe", "Research"),
                    || async move {
                        let _ = at_admission.send(());
                        let _ = resume.await;
                    },
                    || async {},
                    || async move {
                        action_calls.fetch_add(1, Ordering::SeqCst);
                        Ok("uploaded")
                    },
                )
                .await
        });

        admission_reached.await.unwrap();
        let revoke_runtime = runtime.clone();
        let revoke = tokio::spawn(async move { revoke_runtime.invalidate(false).await });
        wait_for_revocation(&runtime).await;
        assert!(
            !revoke.is_finished(),
            "invalidation waits for the admitted gate holder"
        );
        resume_admission.send(()).unwrap();

        let result = upload.await.unwrap();
        assert!(result.unwrap_err().contains("authorization expired"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        revoke.await.unwrap().unwrap();
        assert!(runtime.current().is_err());
    }

    #[tokio::test]
    async fn tray_revoke_before_upload_commit_does_not_report_success() {
        let runtime = Arc::new(PolicyRuntime::default());
        confirm_policy(&runtime, false, vec![]).await;
        let (_, authorization) = runtime
            .run_with_foreground(
                || foreground("browser.exe", "Research"),
                || async { Ok(()) },
            )
            .await
            .unwrap();

        let calls = Arc::new(AtomicUsize::new(0));
        let action_calls = calls.clone();
        let (at_commit, commit_reached) = tokio::sync::oneshot::channel();
        let (resume_commit, resume) = tokio::sync::oneshot::channel();
        let upload_runtime = runtime.clone();
        let upload = tokio::spawn(async move {
            upload_runtime
                .run_with_authorization_and_foreground_and_hooks(
                    &authorization,
                    || foreground("browser.exe", "Research"),
                    || async {},
                    || async move {
                        let _ = at_commit.send(());
                        let _ = resume.await;
                    },
                    || async move {
                        action_calls.fetch_add(1, Ordering::SeqCst);
                        Ok("uploaded")
                    },
                )
                .await
        });

        commit_reached.await.unwrap();
        let revoke_runtime = runtime.clone();
        let revoke = tokio::spawn(async move { revoke_runtime.invalidate(false).await });
        wait_for_revocation(&runtime).await;
        assert!(
            !revoke.is_finished(),
            "invalidation waits for the admitted gate holder"
        );
        resume_commit.send(()).unwrap();

        let result = upload.await.unwrap();
        assert!(result.unwrap_err().contains("revoked"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        revoke.await.unwrap().unwrap();
        assert!(runtime.current().is_err());
    }

    #[tokio::test]
    async fn upload_rechecks_foreground_after_action_before_accepting_result() {
        let runtime = PolicyRuntime::default();
        confirm_policy(&runtime, false, vec![]).await;
        let (_, authorization) = runtime
            .run_with_foreground(
                || foreground("browser.exe", "Research"),
                || async { Ok(()) },
            )
            .await
            .unwrap();
        let foreground_calls = Arc::new(AtomicUsize::new(0));
        let foreground_calls_for_lookup = foreground_calls.clone();
        let action_calls = Arc::new(AtomicUsize::new(0));
        let action_calls_for_upload = action_calls.clone();
        let result = runtime
            .run_with_authorization_and_foreground(
                &authorization,
                move || {
                    if foreground_calls_for_lookup.fetch_add(1, Ordering::SeqCst) < 2 {
                        foreground("browser.exe", "Research")
                    } else {
                        foreground("other.exe", "Different app")
                    }
                },
                || async move {
                    action_calls_for_upload.fetch_add(1, Ordering::SeqCst);
                    Ok("uploaded")
                },
            )
            .await;
        assert!(result.unwrap_err().contains("foreground application"));
        assert_eq!(foreground_calls.load(Ordering::SeqCst), 3);
        assert_eq!(action_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn upload_does_not_start_when_foreground_changes_during_admission() {
        let runtime = PolicyRuntime::default();
        confirm_policy(&runtime, false, vec![]).await;
        let (_, authorization) = runtime
            .run_with_foreground(
                || foreground("browser.exe", "Research"),
                || async { Ok(()) },
            )
            .await
            .unwrap();
        let foreground_changed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let foreground_changed_for_lookup = foreground_changed.clone();
        let foreground_changed_for_hook = foreground_changed.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let action_calls = calls.clone();

        let result = runtime
            .run_with_authorization_and_foreground_and_hooks(
                &authorization,
                move || {
                    if foreground_changed_for_lookup.load(Ordering::SeqCst) {
                        foreground("password-manager.exe", "Vault")
                    } else {
                        foreground("browser.exe", "Research")
                    }
                },
                move || async move {
                    foreground_changed_for_hook.store(true, Ordering::SeqCst);
                },
                || async {},
                || async move {
                    action_calls.fetch_add(1, Ordering::SeqCst);
                    Ok("uploaded")
                },
            )
            .await;

        assert!(result.unwrap_err().contains("immediately before upload"));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn late_policy_confirmation_cannot_override_a_newer_revocation_generation() {
        let runtime = PolicyRuntime::default();
        let stale_generation = runtime.invalidate(false).await.unwrap();
        let current_generation = runtime.invalidate(false).await.unwrap();

        runtime
            .set(current_generation, true, vec![], false)
            .await
            .unwrap();
        let stale = runtime.set(stale_generation, false, vec![], false).await;

        assert!(stale.unwrap_err().contains("stale"));
        assert!(runtime.current().unwrap().capture_paused);
    }
}
