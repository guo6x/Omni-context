use crate::brain_server;
use crate::SystemStatus;
use crate::screen_capture;
use crate::clipboard;
use base64::{engine::general_purpose::STANDARD, Engine};

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
pub async fn capture_screen_region(x: i32, y: i32, width: u32, height: u32) -> Result<String, String> {
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
        brain_server_running: brain_server::is_running(),
        udp_listener_running: true,
        last_event: None,
    }
}

#[tauri::command]
pub fn start_brain_server(app_handle: tauri::AppHandle) -> Result<String, String> {
    brain_server::start()?;
    let status_text = if brain_server::is_running() {
        "Brain Server: 在线"
    } else {
        "Brain Server: 离线"
    };
    let _ = app_handle.tray_handle().get_item("server_status").set_title(status_text);
    Ok("Brain Server 已启动".to_string())
}

#[tauri::command]
pub fn stop_brain_server(app_handle: tauri::AppHandle) -> Result<String, String> {
    brain_server::stop()?;
    let status_text = if brain_server::is_running() {
        "Brain Server: 在线"
    } else {
        "Brain Server: 离线"
    };
    let _ = app_handle.tray_handle().get_item("server_status").set_title(status_text);
    Ok("Brain Server 已停止".to_string())
}

#[tauri::command]
pub fn restart_brain_server(app_handle: tauri::AppHandle) -> Result<String, String> {
    brain_server::restart()?;
    let status_text = if brain_server::is_running() {
        "Brain Server: 在线"
    } else {
        "Brain Server: 离线"
    };
    let _ = app_handle.tray_handle().get_item("server_status").set_title(status_text);
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
        port: 3001,
    }
}

#[tauri::command]
pub fn regenerate_pair_code() -> PairCodeInfo {
    let code = brain_server::regenerate_pair_code();
    let lan_ip = brain_server::get_lan_ip().unwrap_or_default();
    PairCodeInfo {
        code,
        lan_ip,
        port: 3001,
    }
}

#[tauri::command]
pub fn get_local_api_token() -> Result<String, String> {
    Ok(brain_server::ensure_local_token())
}

#[tauri::command]
pub fn regenerate_local_api_token() -> Result<String, String> {
    Ok(brain_server::regenerate_local_token())
}

#[tauri::command]
pub async fn trigger_precipitate() -> Result<String, String> {
    println!("[Command] 触发沉淀操作");
    
    match screen_capture::capture_screen_base64().await {
        Ok(base64_data) => {
            println!("[Command] 屏幕捕获成功: {} 字符", base64_data.len());
        }
        Err(e) => {
            println!("[Command] 屏幕捕获失败: {}", e);
        }
    }
    
    match clipboard::get_clipboard_content().await {
        Ok(Some(text)) => {
            println!("[Command] 剪贴板内容: {} 字符", text.len());
        }
        Ok(None) => {
            println!("[Command] 剪贴板为空");
        }
        Err(e) => {
            println!("[Command] 读取剪贴板失败: {}", e);
        }
    }
    
    Ok("沉淀操作已触发".to_string())
}

#[tauri::command]
pub async fn trigger_decision() -> Result<String, String> {
    println!("[Command] 触发决策查询");
    Ok("决策查询已触发".to_string())
}

#[tauri::command]
pub async fn trigger_reset() -> Result<String, String> {
    println!("[Command] 触发重置");
    Ok("重置操作已触发".to_string())
}

#[derive(serde::Deserialize)]
pub struct ShortcutDef {
    pub id: String,
    pub accelerator: String,
}

// 注册系统级全局热键。触发时向前端发 `global-shortcut` 事件（带 id），
// 由前端跑对应 handler（如沉淀捕获——这样在任何窗口前按都能抓当前屏幕）。
#[tauri::command]
pub fn register_global_shortcuts(app: tauri::AppHandle, shortcuts: Vec<ShortcutDef>) -> Result<(), String> {
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
use std::path::{Path, PathBuf};

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
                } else if path.is_file() {
                    if is_supported(&path, extensions) {
                        if let Ok(metadata) = entry.metadata() {
                            if let Some(path_str) = path.to_str() {
                                if let Some(name_str) = path.file_name().and_then(|n| n.to_str()) {
                                    files.push(SupportedFile {
                                        path: path_str.to_string(),
                                        name: name_str.to_string(),
                                        size: metadata.len(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    for p in paths {
        let path = Path::new(&p);
        if path.is_dir() {
            let _ = visit_dirs(path, &lower_extensions, &mut files, 0);
        } else if path.is_file() {
            if is_supported(path, &lower_extensions) {
                if let Ok(metadata) = fs::metadata(path) {
                    if let Some(path_str) = path.to_str() {
                        if let Some(name_str) = path.file_name().and_then(|n| n.to_str()) {
                            files.push(SupportedFile {
                                path: path_str.to_string(),
                                name: name_str.to_string(),
                                size: metadata.len(),
                            });
                        }
                    }
                }
            }
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
            use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};
            use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_NATIVE, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
            use windows::Win32::Foundation::CloseHandle;

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
                            let full_path = String::from_utf16_lossy(&name_buf[..name_len as usize]);
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
