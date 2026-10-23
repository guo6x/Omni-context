use std::future::Future;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    OnceLock, RwLock,
};

const MAX_BLOCKLIST_ENTRIES: usize = 100;
const MAX_BLOCKLIST_ENTRY_CHARS: usize = 256;

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
    invalidated: AtomicBool,
    generation: AtomicU64,
}

impl Default for PolicyRuntime {
    fn default() -> Self {
        Self {
            store: PolicyStore::default(),
            gate: tokio::sync::Mutex::new(()),
            invalidated: AtomicBool::new(true),
            generation: AtomicU64::new(0),
        }
    }
}

static POLICY: OnceLock<PolicyRuntime> = OnceLock::new();

fn policy_runtime() -> &'static PolicyRuntime {
    POLICY.get_or_init(PolicyRuntime::default)
}

/// Publish the WebView's persisted privacy preferences as a native runtime
/// snapshot. It is refreshed on startup and every persisted settings change;
/// keeping it in memory avoids timer throttling changing normal tray behavior.
pub async fn set_policy(
    capture_paused: bool,
    capture_blocklist: Vec<String>,
) -> Result<(), String> {
    policy_runtime()
        .set(capture_paused, capture_blocklist)
        .await
}

impl PolicyRuntime {
    fn begin_invalidation(&self) -> u64 {
        self.invalidated.store(true, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    async fn set(
        &self,
        capture_paused: bool,
        capture_blocklist: Vec<String>,
    ) -> Result<(), String> {
        let generation = self.begin_invalidation();
        let _gate = self.gate.lock().await;
        let result = self.store.set(capture_paused, capture_blocklist);
        if result.is_ok() && self.generation.load(Ordering::SeqCst) == generation {
            self.invalidated.store(false, Ordering::SeqCst);
        }
        result
    }

    fn mark_invalidated(&self) {
        self.begin_invalidation();
    }

    async fn invalidate(&self) {
        self.begin_invalidation();
        let _gate = self.gate.lock().await;
        self.store.invalidate();
    }

    fn current(&self) -> Result<CapturePolicy, String> {
        if self.invalidated.load(Ordering::SeqCst) {
            return Err("capture policy is not confirmed; capture denied".to_string());
        }
        self.store.current()
    }

    fn authorize_foreground(
        &self,
        foreground: Result<ForegroundWindow, String>,
    ) -> Result<CaptureAuthorization, String> {
        let policy = self.current()?;
        let foreground = foreground.map_err(|_| {
            "foreground application could not be verified; capture denied".to_string()
        })?;
        authorize(Ok(policy), Ok(foreground.clone()))?;
        Ok(CaptureAuthorization {
            generation: self.generation.load(Ordering::SeqCst),
            foreground,
        })
    }

    fn authorization_is_current(&self, authorization: &CaptureAuthorization) -> bool {
        !self.invalidated.load(Ordering::SeqCst)
            && self.generation.load(Ordering::SeqCst) == authorization.generation
    }

    async fn run_with_foreground<Fg, F, Fut, T>(
        &self,
        foreground: Fg,
        action: F,
    ) -> Result<(T, CaptureAuthorization), String>
    where
        Fg: FnOnce() -> Result<ForegroundWindow, String>,
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, String>>,
    {
        let _gate = self.gate.lock().await;
        let authorization = self.authorize_foreground(foreground())?;
        let result = action().await?;
        if !self.authorization_is_current(&authorization) {
            return Err(
                "capture policy changed during capture; captured data discarded".to_string(),
            );
        }
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
        Fg: FnOnce() -> Result<ForegroundWindow, String>,
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
        action().await
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
    capture_paused: bool,
    capture_blocklist: Vec<String>,
) -> Result<(), String> {
    set_policy(capture_paused, capture_blocklist).await
}

#[tauri::command]
pub async fn invalidate_capture_policy() {
    invalidate().await;
}

/// Clear the native snapshot. Until the renderer confirms a valid current
/// policy, hardware capture is denied.
pub fn mark_invalidated() {
    policy_runtime().mark_invalidated();
}

pub async fn invalidate() {
    policy_runtime().invalidate().await;
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
        authorize, run_if_allowed, CapturePolicy, ForegroundWindow, PolicyRuntime, PolicyStore,
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
    async fn policy_change_invalidates_in_flight_capture_and_denies_later_actions() {
        let runtime = Arc::new(PolicyRuntime::default());
        runtime.set(false, vec![]).await.unwrap();

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
        let update = tokio::spawn(async move { update_runtime.set(true, vec![]).await });
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while runtime.current().is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("policy update must fail closed as soon as it is requested");
        assert!(
            !update.is_finished(),
            "policy acknowledgement waits for an in-flight capture"
        );

        finish_capture.send(()).unwrap();
        assert!(
            capture.await.unwrap().is_err(),
            "captured bytes must be discarded after invalidation"
        );
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
        runtime.set(false, vec![]).await.unwrap();
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

        runtime.set(false, vec!["bank".to_string()]).await.unwrap();
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
}
