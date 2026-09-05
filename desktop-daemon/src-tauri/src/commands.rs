use crate::brain_server;
use crate::clipboard;
use crate::screen_capture;
use crate::SystemStatus;
use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::Manager;

#[derive(serde::Serialize, serde::Deserialize)]
struct ControlSessionFile {
    token: String,
    expires_at: String,
    scope: String,
}

#[derive(serde::Serialize)]
pub struct ControlSessionInfo {
    expires_at: String,
    scope: String,
}

/// Explicit human-confirmation action. This is the only Desktop path that
/// mints a CLI approval session; startup never enables it automatically.
#[tauri::command]
pub async fn enable_cli_approvals() -> Result<ControlSessionInfo, String> {
    if !brain_server::is_ready() {
        return Err("Brain Server is not ready".to_string());
    }
    let secret = std::env::var("NATIVE_BRIDGE_SECRET")
        .map_err(|_| "native control bridge is unavailable".to_string())?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("control client unavailable: {e}"))?;
    let response = client
        .post(format!(
            "{}/internal/control/session",
            brain_server::brain_api_url()
        ))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {secret}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body("{}")
        .send()
        .await
        .map_err(|e| format!("cannot reach Brain Server: {e}"))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("invalid Brain response: {e}"))?;
    if !status.is_success() {
        return Err(payload
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("control session mint rejected")
            .to_string());
    }
    let session = payload
        .get("data")
        .and_then(|v| v.get("session"))
        .ok_or_else(|| "Brain response omitted control session".to_string())?;
    let issued_token = payload
        .get("data")
        .and_then(|v| v.get("token"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brain response omitted control token".to_string())?;
    let file = ControlSessionFile {
        token: issued_token.to_string(),
        expires_at: session
            .get("expires_at")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Brain response omitted expiry".to_string())?
            .to_string(),
        scope: session
            .get("scope")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Brain response omitted scope".to_string())?
            .to_string(),
    };
    if file.scope != "control:approve" {
        return Err("Brain returned an unexpected control scope".to_string());
    }
    let path = brain_server::control_session_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create session directory: {e}"))?;
    }
    let bytes = serde_json::to_vec(&file).map_err(|e| format!("cannot encode session: {e}"))?;
    #[cfg(unix)]
    {
        use std::fs::OpenOptions;
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut handle = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| format!("cannot create control session file: {e}"))?;
        handle
            .write_all(&bytes)
            .map_err(|e| format!("cannot write control session file: {e}"))?;
        handle
            .sync_all()
            .map_err(|e| format!("cannot flush control session file: {e}"))?;
    }
    #[cfg(not(unix))]
    std::fs::write(&path, &bytes).map_err(|e| format!("cannot write control session file: {e}"))?;
    Ok(ControlSessionInfo {
        expires_at: file.expires_at,
        scope: file.scope,
    })
}

/// Explicit human-confirmation action for the separate D1B-2 verify scope.
/// It never reuses or broadens the approve session token.
#[tauri::command]
pub async fn enable_cli_verification() -> Result<ControlSessionInfo, String> {
    if !brain_server::is_ready() {
        return Err("Brain Server is not ready".to_string());
    }
    let secret = std::env::var("NATIVE_BRIDGE_SECRET")
        .map_err(|_| "native control bridge is unavailable".to_string())?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("control client unavailable: {e}"))?;
    let response = client
        .post(format!(
            "{}/internal/control/session/verify",
            brain_server::brain_api_url()
        ))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {secret}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body("{}")
        .send()
        .await
        .map_err(|e| format!("cannot reach Brain Server: {e}"))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("invalid Brain response: {e}"))?;
    if !status.is_success() {
        return Err(payload
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("verification session mint rejected")
            .to_string());
    }
    let session = payload
        .get("data")
        .and_then(|v| v.get("session"))
        .ok_or_else(|| "Brain response omitted verification session".to_string())?;
    let issued_token = payload
        .get("data")
        .and_then(|v| v.get("token"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brain response omitted verification token".to_string())?;
    let expires_at = session
        .get("expires_at")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brain response omitted expiry".to_string())?
        .to_string();
    let scope = session
        .get("scope")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brain response omitted scope".to_string())?
        .to_string();
    if scope != "control:verify" {
        return Err("Brain returned an unexpected verification scope".to_string());
    }
    let path = brain_server::verification_session_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create session directory: {e}"))?;
    }
    let file = ControlSessionFile {
        token: issued_token.to_string(),
        expires_at: expires_at.clone(),
        scope: scope.clone(),
    };
    let bytes = serde_json::to_vec(&file)
        .map_err(|e| format!("cannot encode verification session: {e}"))?;
    #[cfg(unix)]
    {
        use std::fs::OpenOptions;
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut handle = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| format!("cannot create verification session file: {e}"))?;
        handle
            .write_all(&bytes)
            .map_err(|e| format!("cannot write verification session: {e}"))?;
        handle
            .sync_all()
            .map_err(|e| format!("cannot flush verification session: {e}"))?;
    }
    #[cfg(not(unix))]
    std::fs::write(&path, &bytes).map_err(|e| format!("cannot write verification session: {e}"))?;
    Ok(ControlSessionInfo { expires_at, scope })
}

/// Explicit human-confirmation action for Goal27's separate reopen scope.
/// Issuing this session creates no revision and cannot execute anything; it
/// merely permits one later local control request to ask Brain for a new
/// judgment.
#[tauri::command]
pub async fn enable_cli_reopen() -> Result<ControlSessionInfo, String> {
    if !brain_server::is_ready() {
        return Err("Brain Server is not ready".to_string());
    }
    let secret = std::env::var("NATIVE_BRIDGE_SECRET")
        .map_err(|_| "native control bridge is unavailable".to_string())?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("control client unavailable: {e}"))?;
    let response = client
        .post(format!(
            "{}/internal/control/session/reopen",
            brain_server::brain_api_url()
        ))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {secret}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body("{}")
        .send()
        .await
        .map_err(|e| format!("cannot reach Brain Server: {e}"))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("invalid Brain response: {e}"))?;
    if !status.is_success() {
        return Err(payload
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("reopen session mint rejected")
            .to_string());
    }
    let session = payload
        .get("data")
        .and_then(|v| v.get("session"))
        .ok_or_else(|| "Brain response omitted reopen session".to_string())?;
    let issued_token = payload
        .get("data")
        .and_then(|v| v.get("token"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brain response omitted reopen token".to_string())?;
    let expires_at = session
        .get("expires_at")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brain response omitted expiry".to_string())?
        .to_string();
    let scope = session
        .get("scope")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Brain response omitted scope".to_string())?
        .to_string();
    if scope != "control:reopen" {
        return Err("Brain returned an unexpected reopen scope".to_string());
    }
    let path = brain_server::reopen_session_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create session directory: {e}"))?;
    }
    let file = ControlSessionFile {
        token: issued_token.to_string(),
        expires_at: expires_at.clone(),
        scope: scope.clone(),
    };
    let bytes =
        serde_json::to_vec(&file).map_err(|e| format!("cannot encode reopen session: {e}"))?;
    #[cfg(unix)]
    {
        use std::fs::OpenOptions;
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut handle = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| format!("cannot create reopen session file: {e}"))?;
        handle
            .write_all(&bytes)
            .map_err(|e| format!("cannot write reopen session: {e}"))?;
        handle
            .sync_all()
            .map_err(|e| format!("cannot flush reopen session: {e}"))?;
    }
    #[cfg(not(unix))]
    std::fs::write(&path, &bytes).map_err(|e| format!("cannot write reopen session: {e}"))?;
    Ok(ControlSessionInfo { expires_at, scope })
}

#[tauri::command]
pub async fn disable_cli_approvals() -> Result<(), String> {
    if let Ok(secret) = std::env::var("NATIVE_BRIDGE_SECRET") {
        if let Ok(client) = reqwest::Client::builder().no_proxy().build() {
            let _ = client
                .post(format!(
                    "{}/internal/control/session/revoke",
                    brain_server::brain_api_url()
                ))
                .header(reqwest::header::AUTHORIZATION, format!("Bearer {secret}"))
                .send()
                .await;
        }
    }
    brain_server::clear_control_session();
    brain_server::clear_verification_session();
    brain_server::clear_reopen_session();
    Ok(())
}

#[tauri::command]
pub async fn disable_cli_verification() -> Result<(), String> {
    // Revoking all short-lived control sessions is intentional: disabling one
    // explicit human control surface must not leave another active by surprise.
    disable_cli_approvals().await
}

#[tauri::command]
pub async fn disable_cli_reopen() -> Result<(), String> {
    // Revoking all control sessions is intentional: the native bridge owns
    // the session family and never leaves a related authority active by
    // surprise when the owner disables one control surface.
    disable_cli_approvals().await
}

#[tauri::command]
pub async fn start_listening() -> Result<String, String> {
    Ok("监听已启动".to_string())
}

#[tauri::command]
pub async fn capture_screen() -> Result<String, String> {
    match screen_capture::capture_screen_base64().await {
        Ok(base64_data) => Ok(base64_data),
        Err(e) => Err(format!("屏幕捕获失败: {}", e)),
    }
}

#[tauri::command]
pub async fn capture_all_screens() -> Result<Vec<screen_capture::ScreenCaptureResult>, String> {
    match screen_capture::capture_all_screens().await {
        Ok(results) => Ok(results),
        Err(e) => Err(format!("多屏幕捕获失败: {}", e)),
    }
}

#[tauri::command]
pub async fn capture_screen_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    match screen_capture::capture_screen_region(x, y, width, height).await {
        Ok(png_data) => Ok(STANDARD.encode(&png_data)),
        Err(e) => Err(format!("区域捕获失败: {}", e)),
    }
}

#[tauri::command]
pub async fn get_clipboard() -> Result<String, String> {
    match clipboard::get_clipboard_content().await {
        Ok(Some(text)) => Ok(text),
        Ok(None) => Ok("".to_string()),
        Err(e) => Err(format!("读取剪贴板失败: {}", e)),
    }
}

#[tauri::command]
pub async fn get_clipboard_detailed() -> Result<clipboard::ClipboardContent, String> {
    match clipboard::get_clipboard_detailed().await {
        Ok(content) => Ok(content),
        Err(e) => Err(format!("读取剪贴板详情失败: {}", e)),
    }
}

#[tauri::command]
pub async fn set_clipboard(text: String) -> Result<String, String> {
    match clipboard::set_clipboard_text(text).await {
        Ok(_) => Ok("剪贴板已更新".to_string()),
        Err(e) => Err(format!("设置剪贴板失败: {}", e)),
    }
}

#[tauri::command]
pub async fn clear_clipboard() -> Result<String, String> {
    match clipboard::clear_clipboard().await {
        Ok(_) => Ok("剪贴板已清空".to_string()),
        Err(e) => Err(format!("清空剪贴板失败: {}", e)),
    }
}

#[tauri::command]
pub async fn send_to_brain_server(data: String) -> Result<String, String> {
    Ok(format!("已发送到 Brain Server: {}", data))
}

#[tauri::command]
pub fn get_system_status() -> SystemStatus {
    SystemStatus {
        brain_server_running: brain_server::is_ready(),
        udp_listener_running: true,
        last_event: None,
    }
}

#[tauri::command]
pub async fn start_brain_server(app_handle: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(brain_server::start)
        .await
        .map_err(|e| format!("执行线程阻塞错误: {}", e))??;

    let status_text = if brain_server::is_ready() {
        "Brain Server: 在线"
    } else {
        "Brain Server: 离线"
    };
    let _ = app_handle
        .tray_handle()
        .get_item("server_status")
        .set_title(status_text);
    Ok("Brain Server 已启动".to_string())
}

#[tauri::command]
pub async fn stop_brain_server(app_handle: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(brain_server::stop)
        .await
        .map_err(|e| format!("执行线程阻塞错误: {}", e))??;

    let status_text = if brain_server::is_ready() {
        "Brain Server: 在线"
    } else {
        "Brain Server: 离线"
    };
    let _ = app_handle
        .tray_handle()
        .get_item("server_status")
        .set_title(status_text);
    Ok("Brain Server 已停止".to_string())
}

#[tauri::command]
pub async fn restart_brain_server(app_handle: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(brain_server::restart)
        .await
        .map_err(|e| format!("执行线程阻塞错误: {}", e))??;

    let status_text = if brain_server::is_ready() {
        "Brain Server: 在线"
    } else {
        "Brain Server: 离线"
    };
    let _ = app_handle
        .tray_handle()
        .get_item("server_status")
        .set_title(status_text);
    Ok("Brain Server 已重启".to_string())
}

#[tauri::command]
pub fn set_close_behavior(behavior: String) {
    if behavior == "exit" {
        crate::CLOSE_TO_TRAY.store(false, std::sync::atomic::Ordering::SeqCst);
    } else {
        crate::CLOSE_TO_TRAY.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

#[tauri::command]
pub fn quit_app() {
    println!("[Omni-Context] 前端触发完全退出，正在清理 Brain Server...");
    let _ = brain_server::stop();
    std::process::exit(0);
}

#[tauri::command]
pub fn open_data_folder() -> Result<(), String> {
    brain_server::open_folder_in_explorer()
}

#[tauri::command]
pub fn open_logs_folder() -> Result<(), String> {
    brain_server::open_logs_folder()
}

#[derive(serde::Serialize)]
pub struct PairCodeInfo {
    pub code: String,
    pub lan_ip: String,
    pub port: u16,
}

#[tauri::command]
pub fn get_pair_code() -> PairCodeInfo {
    let code = brain_server::ensure_pair_code();
    let lan_ip = brain_server::get_lan_ip().unwrap_or_default();
    PairCodeInfo {
        code,
        lan_ip,
        port: brain_server::brain_port(),
    }
}

#[tauri::command]
pub fn regenerate_pair_code() -> PairCodeInfo {
    let code = brain_server::regenerate_pair_code();
    let lan_ip = brain_server::get_lan_ip().unwrap_or_default();
    PairCodeInfo {
        code,
        lan_ip,
        port: brain_server::brain_port(),
    }
}

#[tauri::command]
pub fn get_local_api_token() -> Result<String, String> {
    brain_server::ensure_local_token()
}

/// Private native -> Brain bridge helper. The bridge secret is process-local
/// and never enters renderer state, command arguments or logs. Endpoints are
/// loopback-only and accept only fixed semantic payloads.
async fn post_native_bridge(
    path: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let secret = std::env::var("NATIVE_BRIDGE_SECRET")
        .map_err(|_| "native control bridge is unavailable".to_string())?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("control client unavailable: {e}"))?;
    let response = client
        .post(format!("{}{path}", brain_server::brain_api_url()))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {secret}"))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("cannot reach Brain Server: {e}"))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("invalid Brain response: {e}"))?;
    if !status.is_success() {
        return Err(payload
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("NATIVE_BRIDGE_REJECTED")
            .to_string());
    }
    Ok(payload)
}

/// Execute exactly one already-approved, server-owned ready plan. The UI
/// supplies only `plan_id`; capability, adapter, inputs and approval material
/// are resolved by the loopback Brain endpoint and revalidated by the native
/// broker before spawn. There is intentionally no generic execute IPC.
#[tauri::command]
pub async fn execute_ready_plan(plan_id: String) -> Result<serde_json::Value, String> {
    if !crate::brain_server::is_ready() {
        return Err("Brain Server is not ready".to_string());
    }
    if !crate::execution_broker::ExecutionPlanWire::valid_plan_id(&plan_id) {
        return Err("PLAN_ID_INVALID".to_string());
    }
    let secret = std::env::var("NATIVE_BRIDGE_SECRET")
        .map_err(|_| "native control bridge is unavailable".to_string())?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("control client unavailable: {e}"))?;
    let response = client
        .get(format!(
            "{}/internal/control/plan/{}",
            brain_server::brain_api_url(),
            plan_id
        ))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {secret}"))
        .send()
        .await
        .map_err(|e| format!("cannot reach Brain Server: {e}"))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("invalid Brain response: {e}"))?;
    if !status.is_success() {
        return Err(payload
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("PLAN_LOOKUP_FAILED")
            .to_string());
    }
    let plan_value = payload
        .get("data")
        .and_then(|record| record.get("plan"))
        .ok_or_else(|| "Brain response omitted server-owned plan".to_string())?;
    let plan: crate::execution_broker::ExecutionPlanWire =
        serde_json::from_value(plan_value.clone())
            .map_err(|e| format!("PLAN_CONTRACT_INVALID: {e}"))?;
    // Fixed semantic binding map. No caller-controlled binding_id is accepted.
    let binding_id = match (plan.capability_id.as_str(), plan.adapter_id.as_str()) {
        ("github.issue.close", "github-cli") => "github-cli.issue.close",
        _ => return Err("CAPABILITY_NOT_DESKTOP_EXECUTABLE".to_string()),
    };
    let result = crate::execution_broker::global_broker()
        .execute(&plan, binding_id)
        .map_err(|e| e.to_string())?;
    // The native receipt is the authority handed to Brain. The renderer gets
    // only the receipt id and bounded process result, never the receipt's
    // approval/verification internals.
    let receipts = crate::execution_broker::global_broker()
        .receipts_for_plan(&plan_id)
        .map_err(|e| e.to_string())?;
    let receipt = receipts
        .into_iter()
        .next()
        .ok_or_else(|| "EXECUTION_RECEIPT_MISSING".to_string())?;
    let receipt_id = receipt.receipt_id.clone();
    let brain_sync = post_native_bridge(
        "/internal/control/native-receipt",
        serde_json::json!({ "plan_id": plan_id, "receipt": receipt }),
    )
    .await?;
    Ok(serde_json::json!({
        "execution": result,
        "receipt_id": receipt_id,
        "brain_sync": brain_sync.get("data").cloned().unwrap_or(serde_json::Value::Null),
    }))
}

/// Desktop-only approval action. The short-lived control session token stays
/// in the protected native file; the renderer supplies only the plan id.
#[tauri::command]
pub async fn approve_pending_plan(plan_id: String) -> Result<serde_json::Value, String> {
    if !crate::brain_server::is_ready() {
        return Err("Brain Server is not ready".to_string());
    }
    if !crate::execution_broker::ExecutionPlanWire::valid_plan_id(&plan_id) {
        return Err("PLAN_ID_INVALID".to_string());
    }
    let file = std::fs::read_to_string(brain_server::control_session_file())
        .map_err(|_| "CONTROL_APPROVAL_SESSION_REQUIRED".to_string())?;
    let session: ControlSessionFile =
        serde_json::from_str(&file).map_err(|_| "CONTROL_SESSION_INVALID".to_string())?;
    if session.scope != "control:approve" {
        return Err("CONTROL_SCOPE_INSUFFICIENT".to_string());
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("control client unavailable: {e}"))?;
    let response = client
        .post(format!(
            "{}/api/control/approve",
            brain_server::brain_api_url()
        ))
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", session.token),
        )
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&serde_json::json!({"plan_id": plan_id}))
        .send()
        .await
        .map_err(|e| format!("cannot reach Brain Server: {e}"))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("invalid Brain response: {e}"))?;
    if !status.is_success() {
        return Err(payload
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("APPROVAL_FAILED")
            .to_string());
    }
    Ok(payload)
}

/// Desktop-only read-back verification action. It uses the separately scoped
/// verification session and never retries the original write.
#[tauri::command]
pub async fn verify_pending_plan(plan_id: String) -> Result<serde_json::Value, String> {
    if !crate::brain_server::is_ready() {
        return Err("Brain Server is not ready".to_string());
    }
    if !crate::execution_broker::ExecutionPlanWire::valid_plan_id(&plan_id) {
        return Err("PLAN_ID_INVALID".to_string());
    }
    let file = std::fs::read_to_string(brain_server::verification_session_file())
        .map_err(|_| "CONTROL_VERIFICATION_SESSION_REQUIRED".to_string())?;
    let session: ControlSessionFile =
        serde_json::from_str(&file).map_err(|_| "CONTROL_SESSION_INVALID".to_string())?;
    if session.scope != "control:verify" {
        return Err("VERIFY_SCOPE_INSUFFICIENT".to_string());
    }
    // Reserve and execute the read-back through the native runner first. It
    // derives verification capability/inputs from the native receipt and
    // emits a single-use observation; no caller can supply either.
    let receipts = crate::execution_broker::global_broker()
        .receipts_for_plan(&plan_id)
        .map_err(|e| e.to_string())?;
    let receipt = receipts
        .into_iter()
        .next()
        .ok_or_else(|| "RECEIPT_NOT_FOUND".to_string())?;
    let observation = crate::execution_broker::global_broker()
        .perform_readback(&receipt.receipt_id)
        .map_err(|e| e.to_string())?;
    // The verification control session remains a separate human-enabled
    // scope. The native bridge carries the observation to Brain, where the
    // deterministic evaluator alone may decide VERIFIED/MISMATCH.
    let payload = post_native_bridge(
        "/internal/control/native-verification",
        serde_json::json!({ "plan_id": plan_id, "observation": observation }),
    )
    .await?;
    // Keep the session token intentionally unused beyond scope validation;
    // verification data travels only over the process-local bridge.
    let _ = session.token;
    Ok(payload)
}

fn valid_reopen_identifier(value: &str) -> bool {
    if value.is_empty() || value.len() > 200 {
        return false;
    }
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphanumeric() => {}
        _ => return false,
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | ':' | '-'))
}

fn validate_reopen_reason(reason: Option<String>) -> Result<Option<String>, String> {
    match reason {
        None => Ok(None),
        Some(value) => {
            if value.trim().is_empty()
                || value.len() > 4096
                || value.chars().any(|ch| ch.is_control())
            {
                return Err("REOPEN_REASON_INVALID".to_string());
            }
            Ok(Some(value))
        }
    }
}

/// Desktop-only Goal27 reopen action. The renderer supplies only a decision
/// locator plus optional audit reason/outcome locator. Root/parent/index,
/// evidence, plan, approval, execution and rollback fields are deliberately
/// absent: Brain derives them from its trusted immutable records.
#[tauri::command]
pub async fn reopen_decision(
    decision_id: String,
    reason: Option<String>,
    outcome_id: Option<String>,
) -> Result<serde_json::Value, String> {
    if !crate::brain_server::is_ready() {
        return Err("Brain Server is not ready".to_string());
    }
    if !valid_reopen_identifier(&decision_id) {
        return Err("DECISION_ID_INVALID".to_string());
    }
    if outcome_id
        .as_ref()
        .is_some_and(|value| !valid_reopen_identifier(value))
    {
        return Err("OUTCOME_ID_INVALID".to_string());
    }
    let reason = validate_reopen_reason(reason)?;
    let file = std::fs::read_to_string(brain_server::reopen_session_file())
        .map_err(|_| "CONTROL_REOPEN_SESSION_REQUIRED".to_string())?;
    let session: ControlSessionFile =
        serde_json::from_str(&file).map_err(|_| "CONTROL_SESSION_INVALID".to_string())?;
    if session.scope != "control:reopen" {
        return Err("REOPEN_SCOPE_INSUFFICIENT".to_string());
    }
    let mut body = serde_json::Map::new();
    body.insert(
        "decision_id".to_string(),
        serde_json::Value::String(decision_id),
    );
    if let Some(value) = reason {
        body.insert("reason".to_string(), serde_json::Value::String(value));
    }
    if let Some(value) = outcome_id {
        body.insert("outcome_id".to_string(), serde_json::Value::String(value));
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("control client unavailable: {e}"))?;
    let response = client
        .post(format!(
            "{}/api/control/reopen",
            brain_server::brain_api_url()
        ))
        .header(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", session.token),
        )
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .json(&serde_json::Value::Object(body))
        .send()
        .await
        .map_err(|e| format!("cannot reach Brain Server: {e}"))?;
    let status = response.status();
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("invalid Brain response: {e}"))?;
    if !status.is_success() {
        return Err(payload
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("REOPEN_FAILED")
            .to_string());
    }
    Ok(payload)
}

#[tauri::command]
pub fn regenerate_local_api_token() -> Result<String, String> {
    brain_server::regenerate_local_token()
}

#[tauri::command]
pub async fn trigger_precipitate() -> Result<String, String> {
    let jobs = crate::hardware_actions::execute_precipitate().await?;
    Ok(format!("沉淀完成（{} 个任务）", jobs.len()))
}

#[tauri::command]
pub async fn trigger_decision(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(window) = app.get_window("main") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }
    app.emit_all("hardware-decision-requested", ())
        .map_err(|error| error.to_string())?;
    Ok("决策助手已打开".to_string())
}

#[tauri::command]
pub async fn trigger_reset(app: tauri::AppHandle) -> Result<String, String> {
    app.emit_all("hardware-reset-transient-ui", ())
        .map_err(|error| error.to_string())?;
    Ok("已清理临时捕获/决策界面；记忆和设备凭据未更改".to_string())
}

#[cfg(test)]
mod goal27_reopen_input_tests {
    use super::{valid_reopen_identifier, validate_reopen_reason};

    #[test]
    fn reopen_accepts_only_bounded_identifier_locators() {
        assert!(valid_reopen_identifier("decision-goal27-1"));
        assert!(valid_reopen_identifier("outcome:goal27_1.0"));
        for invalid in [
            "",
            "../decision",
            "decision/other",
            "decision space",
            "-decision",
            "decision\nother",
        ] {
            assert!(
                !valid_reopen_identifier(invalid),
                "{invalid:?} must not be a reopen locator"
            );
        }
    }

    #[test]
    fn reopen_reason_cannot_be_a_hidden_control_channel() {
        assert_eq!(
            validate_reopen_reason(Some("owner reconsideration after mismatch".to_string()))
                .unwrap(),
            Some("owner reconsideration after mismatch".to_string()),
        );
        assert!(validate_reopen_reason(Some("\n".to_string())).is_err());
        assert!(validate_reopen_reason(Some("owner\u{0000}override".to_string())).is_err());
        assert!(validate_reopen_reason(Some("x".repeat(4097))).is_err());
    }
}

#[derive(serde::Deserialize)]
pub struct ShortcutDef {
    pub id: String,
    pub accelerator: String,
}

// 注册系统级全局热键。触发时向前端发 `global-shortcut` 事件（带 id），
// 由前端跑对应 handler（如沉淀捕获——这样在任何窗口前按都能抓当前屏幕）。
#[tauri::command]
pub fn register_global_shortcuts(
    app: tauri::AppHandle,
    shortcuts: Vec<ShortcutDef>,
) -> Result<(), String> {
    use tauri::{GlobalShortcutManager, Manager};
    let mut mgr = app.global_shortcut_manager();
    let _ = mgr.unregister_all();
    for s in shortcuts {
        let app2 = app.clone();
        let id = s.id.clone();
        let acc = s.accelerator.clone();
        if let Err(e) = mgr.register(acc.as_str(), move || {
            let _ = app2.emit_all("global-shortcut", id.clone());
        }) {
            eprintln!("[GlobalShortcut] 注册失败 {} ({}): {}", s.id, acc, e);
        }
    }
    Ok(())
}

use std::fs;
use std::path::Path;

#[derive(serde::Serialize)]
pub struct SupportedFile {
    pub path: String,
    pub name: String,
    pub size: u64,
}

#[tauri::command]
pub fn process_dropped_paths(
    paths: Vec<String>,
    extensions: Vec<String>,
) -> Result<Vec<SupportedFile>, String> {
    let mut files = Vec::new();
    let lower_extensions: Vec<String> = extensions.iter().map(|e| e.to_lowercase()).collect();

    fn is_supported(path: &Path, extensions: &[String]) -> bool {
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let dot_ext = format!(".{}", ext.to_lowercase());
            extensions.iter().any(|x| x == &dot_ext)
        } else {
            false
        }
    }

    fn supported_file(path: &Path, extensions: &[String]) -> Option<SupportedFile> {
        if !path.is_file() || !is_supported(path, extensions) {
            return None;
        }
        let metadata = fs::metadata(path).ok()?;
        let path_str = path.to_str()?;
        let name_str = path.file_name()?.to_str()?;
        Some(SupportedFile {
            path: path_str.to_string(),
            name: name_str.to_string(),
            size: metadata.len(),
        })
    }

    fn visit_dirs(
        dir: &Path,
        extensions: &[String],
        files: &mut Vec<SupportedFile>,
        depth: usize,
    ) -> Result<(), std::io::Error> {
        if depth > 10 {
            return Ok(());
        }
        if dir.is_dir() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.starts_with('.') {
                            continue;
                        }
                    }
                    visit_dirs(&path, extensions, files, depth + 1)?;
                } else if let Some(file) = supported_file(&path, extensions) {
                    files.push(file);
                }
            }
        }
        Ok(())
    }

    for p in paths {
        let path = Path::new(&p);
        if path.is_dir() {
            let _ = visit_dirs(path, &lower_extensions, &mut files, 0);
        } else if let Some(file) = supported_file(path, &lower_extensions) {
            files.push(file);
        }
    }

    Ok(files)
}

use crate::mcp_helper;

#[tauri::command]
pub fn mcp_get_server_command() -> mcp_helper::ServerCommand {
    mcp_helper::get_mcp_server_command()
}

#[tauri::command]
pub fn mcp_get_clients_status() -> Vec<mcp_helper::ClientStatus> {
    mcp_helper::get_mcp_clients_status()
}

#[tauri::command]
pub fn mcp_install_to(client_id: String) -> Result<(), String> {
    mcp_helper::install_mcp_to(&client_id)
}

#[tauri::command]
pub fn mcp_open_config_folder(client_id: String) -> Result<(), String> {
    mcp_helper::open_config_folder(&client_id)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ForegroundWindowInfo {
    pub title: String,
    pub process_name: String,
}

/// 获取当前前台窗口的标题和进程名（Windows）。
/// macOS / Linux 返回 TODO 占位符，后续补做。
#[tauri::command]
pub fn get_foreground_window_info() -> Result<ForegroundWindowInfo, String> {
    #[cfg(target_os = "windows")]
    {
        // SAFETY: 调用 Windows API，所有 unsafe 调用都有对应的安全检查
        unsafe {
            use windows::core::PWSTR;
            use windows::Win32::Foundation::CloseHandle;
            use windows::Win32::System::Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_NATIVE,
                PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
            };
            use windows::Win32::UI::WindowsAndMessaging::{
                GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
            };

            let hwnd = GetForegroundWindow();
            if hwnd.0 == 0 {
                return Err("无法获取前台窗口".to_string());
            }

            // 获取窗口标题
            let mut title_buf = [0u16; 512];
            let title_len = GetWindowTextW(hwnd, &mut title_buf);
            let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);

            // 获取进程 ID
            let mut process_id: u32 = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut process_id));

            let process_name = if process_id != 0 {
                // 打开进程句柄获取进程名
                let h_process = OpenProcess(
                    PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
                    false,
                    process_id,
                );
                match h_process {
                    Ok(handle) => {
                        let mut name_buf = [0u16; 260];
                        let mut name_len: u32 = name_buf.len() as u32;
                        let result = QueryFullProcessImageNameW(
                            handle,
                            PROCESS_NAME_NATIVE,
                            PWSTR(name_buf.as_mut_ptr()),
                            &mut name_len,
                        );
                        let _ = CloseHandle(handle);
                        if result.is_ok() {
                            let full_path =
                                String::from_utf16_lossy(&name_buf[..name_len as usize]);
                            // 只取文件名（去掉路径）
                            let name = std::path::Path::new(&full_path)
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or(full_path);
                            name
                        } else {
                            format!("PID:{}", process_id)
                        }
                    }
                    Err(_) => format!("PID:{}", process_id),
                }
            } else {
                "Unknown".to_string()
            };

            Ok(ForegroundWindowInfo {
                title,
                process_name,
            })
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // TODO: macOS 用 NSWorkspace.frontmostApplication，Linux 用 xdotool / XGetInputFocus
        // 本期仅 Windows，其他平台返回占位符
        Ok(ForegroundWindowInfo {
            title: "".to_string(),
            process_name: "".to_string(),
        })
    }
}

#[tauri::command]
pub fn get_broker_status() -> crate::execution_broker::BrokerStatus {
    crate::execution_broker::global_broker().status()
}

// CP3 shell-open closure replacement. The generic Tauri shell.open capability
// was removed from the WebView; the frontend can only name one of the
// semantic targets below and never supplies a URL, path, scheme or arguments.
// Each target maps to an exact hard-coded HTTPS URL in Rust.
#[tauri::command]
pub fn open_trusted_external_url(target_id: String) -> Result<(), String> {
    const TRUSTED_HTTPS_TARGETS: &[(&str, &str)] = &[
        ("openai", "https://platform.openai.com/api-keys"),
        ("deepseek", "https://platform.deepseek.com/api_keys"),
        ("siliconflow", "https://cloud.siliconflow.cn/account/ak"),
        ("moonshot", "https://platform.moonshot.cn/console/api-keys"),
        ("zhipu", "https://open.bigmodel.cn/usercenter/apikeys"),
        ("qwen", "https://dashscope.console.aliyun.com/apiKey"),
        ("volcengine", "https://console.volcengine.com/ark"),
        ("deepinfra", "https://deepinfra.com/dash/api_keys"),
        ("groq", "https://console.groq.com/keys"),
        ("openrouter", "https://openrouter.ai/keys"),
        ("gemini", "https://aistudio.google.com/app/apikey"),
    ];

    let url = TRUSTED_HTTPS_TARGETS
        .iter()
        .find(|(id, _)| *id == target_id.as_str())
        .map(|(_, url)| *url)
        .ok_or_else(|| format!("unknown trusted URL target_id: {target_id}"))?;

    if !url.starts_with("https://") {
        return Err(format!("trusted target {target_id} is not https"));
    }

    open_url_in_default_browser(url)
}

fn open_url_in_default_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let url_wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                None,
                PCWSTR::null(),
                PCWSTR(url_wide.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        if result.0 <= 32 {
            return Err(format!("ShellExecuteW failed with code {}", result.0));
        }
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod ipc_surface_tests {
    //! CP8 security surface regression: the WebView-visible Tauri command
    //! registry (main.rs generate_handler!) must never expose generic
    //! execution, read-back, outcome-finalize or approval-mutation commands.
    //! This is a structural source-level assertion over the real registry.

    const MAIN_SRC: &str = include_str!("main.rs");

    #[test]
    fn no_generic_execute_or_readback_ipc() {
        for forbidden in [
            "commands::execute_plan",
            "commands::executePlan",
            "commands::readback",
            "commands::readback_plan",
            "commands::readbackPlan",
            "commands::verify_plan",
            "commands::verifyPlan",
            "commands::run_readback",
            "commands::runReadback",
        ] {
            assert!(
                !MAIN_SRC.contains(forbidden),
                "forbidden command surface present: {forbidden}"
            );
        }
    }

    #[test]
    fn no_public_outcome_finalize_or_approval_mutation_ipc() {
        for forbidden in [
            "commands::submit_outcome",
            "commands::submitOutcome",
            "commands::finalize_outcome",
            "commands::outcome",
            "commands::receipt",
            "commands::approve_plan",
            "commands::approvePlan",
            "commands::grant_approval",
            "commands::revoke_approval",
            "commands::consume_approval",
        ] {
            assert!(
                !MAIN_SRC.contains(forbidden),
                "forbidden command surface present: {forbidden}"
            );
        }
    }
}
