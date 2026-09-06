#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod brain_server;
mod clipboard;
mod commands;
// CP3 wires only the read-only broker status surface; the execution core is
// exercised by tests and opened to IPC in CP4 with the GitHub adapter.
#[cfg_attr(not(test), allow(dead_code))]
mod execution_broker;
// CP4 adapter core: five read-only GitHub CLI bindings compiled against the
// frozen CP3 broker. Production registration is best-effort at startup via
// github_cli::bootstrap; no generic execute IPC is exposed. The typed
// output parsers are exercised by tests and by the E2E harness only.
#[cfg_attr(not(test), allow(dead_code))]
mod github_cli;
mod hardware;
mod hardware_actions;
#[cfg_attr(not(test), allow(dead_code))]
mod local_git;
mod log_writer;
mod mcp_helper;
mod screen_capture;
mod udp_listener;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri::{CustomMenuItem, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem};
use tokio::sync::mpsc;

pub static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true); // 默认最小化到托盘

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum ButtonEvent {
    Precipitate,
    Decision,
    Reset,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SystemStatus {
    pub brain_server_running: bool,
    pub udp_listener_running: bool,
    pub last_event: Option<String>,
}

#[tokio::main]
async fn main() {
    // Native approval authority is initialized before Brain and uses durable
    // app-data paths so replay protection survives a restart. The bridge
    // secret is process-local and inherited only by the Brain child.
    let broker_data = brain_server::user_data_dir();
    std::fs::create_dir_all(&broker_data).expect("create native broker data directory");
    execution_broker::configure_global_broker_with_persistence(
        &broker_data.join("approval-store.json"),
        &broker_data.join("plan-ledger.json"),
        &broker_data.join("execution-receipts.json"),
    );
    let native_bridge = execution_broker::native_control::start();
    std::env::set_var("NATIVE_BRIDGE_SECRET", &native_bridge.secret);
    std::env::set_var(
        "NATIVE_BRIDGE_URL",
        format!("http://127.0.0.1:{}", native_bridge.port),
    );

    // CP4 + Post-CP8: best-effort production registration of the five
    // read-only GitHub CLI bindings plus the single production write binding
    // github.issue.close and the github.issue.read read-back binding
    // (trusted config -> standard install -> PATH discovery). No
    // machine-specific path is hardcoded in product source; this dev machine
    // pins gh.exe through the trusted OMNI_GITHUB_CLI_EXE config.
    let gh_bootstrap =
        github_cli::bootstrap::bootstrap_production(crate::execution_broker::global_broker());
    if let Some(path) = &gh_bootstrap.resolved_gh {
        println!(
            "[Omni-Context] GitHub CLI adapter ready: {} ({} read-only, {} write, {} read-back)",
            path.display(),
            gh_bootstrap.read_only_bindings,
            gh_bootstrap.write_bindings,
            gh_bootstrap.readback_bindings
        );
    } else {
        println!(
            "[Omni-Context] GitHub CLI adapter unavailable: {}",
            gh_bootstrap.message
        );
    }
    let git_bootstrap = local_git::bootstrap_production(
        crate::execution_broker::global_broker(),
        broker_data.join("git-workspaces"),
    );
    if let Some(path) = &git_bootstrap.resolved_git {
        println!(
            "[Omni-Context] local Git adapter ready: {} ({} bindings)",
            path.display(),
            git_bootstrap.registered_bindings
        );
    } else {
        println!(
            "[Omni-Context] local Git adapter unavailable: {}",
            git_bootstrap.message
        );
    }
    println!("[Omni-Context] 启动桌面守护进程...");

    let show = CustomMenuItem::new("show_main".to_string(), "显示主窗口");
    let status_text = if brain_server::is_ready() {
        "Brain Server: 在线"
    } else {
        "Brain Server: 启动中"
    };
    let status = CustomMenuItem::new("server_status".to_string(), status_text).disabled();
    let restart = CustomMenuItem::new("restart_server".to_string(), "重启 Brain Server");
    let open_data = CustomMenuItem::new("open_data".to_string(), "打开数据目录");
    let open_logs = CustomMenuItem::new("open_logs".to_string(), "打开日志目录");
    let settings = CustomMenuItem::new("settings".to_string(), "设置...");
    let pause_capture = CustomMenuItem::new("pause_capture".to_string(), "暂停抓取");
    let quit = CustomMenuItem::new("quit".to_string(), "退出 Omni-Context");

    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(status)
        .add_item(restart)
        .add_item(open_data)
        .add_item(open_logs)
        .add_item(settings)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(pause_capture)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                if let Some(window) = app.get_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            SystemTrayEvent::MenuItemClick { id, .. } => {
                match id.as_str() {
                    "show_main" => {
                        if let Some(window) = app.get_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "restart_server" => {
                        let app_handle = app.clone();
                        let _ = app
                            .tray_handle()
                            .get_item("server_status")
                            .set_title("Brain Server: 重启中");
                        std::thread::spawn(move || {
                            let result = brain_server::restart();
                            let status_text = if result.is_ok() && brain_server::is_ready() {
                                "Brain Server: 在线"
                            } else {
                                "Brain Server: 离线"
                            };
                            let _ = app_handle
                                .tray_handle()
                                .get_item("server_status")
                                .set_title(status_text);
                        });
                    }
                    "open_data" => {
                        let _ = brain_server::open_folder_in_explorer();
                    }
                    "open_logs" => {
                        let _ = brain_server::open_logs_folder();
                    }
                    "settings" => {
                        if let Some(window) = app.get_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("open-settings", ());
                        }
                    }
                    "pause_capture" => {
                        // 发送事件给前端切换暂停状态
                        if let Some(window) = app.get_window("main") {
                            let _ = window.emit("toggle-capture-pause", ());
                        }
                    }
                    "quit" => {
                        println!("[Omni-Context] 正在通过托盘菜单退出应用，清理 Brain Server...");
                        let _ = brain_server::stop();
                        std::process::exit(0);
                    }
                    _ => {}
                }
            }
            _ => {}
        })
        .setup(|app| {
            let hardware_registry_path = app
                .path_resolver()
                .app_data_dir()
                .ok_or_else(|| anyhow::anyhow!("unable to resolve app data directory"))?
                .join("hardware-devices.json");
            hardware::initialize_registry(hardware_registry_path).map_err(anyhow::Error::msg)?;

            // Brain Server 冷启动可能需要几十秒加载数据库和索引，放到后台避免桌面窗口卡住。
            let startup_handle = app.app_handle().clone();
            std::thread::spawn(move || {
                let result = brain_server::start();
                match &result {
                    Ok(()) => {
                        if let Some(pid) = brain_server::get_pid() {
                            println!("[Omni-Context] Brain Server 已启动 (PID: {})", pid);
                        }
                    }
                    Err(e) => {
                        eprintln!("[Omni-Context] 警告: Brain Server 启动失败: {}", e);
                        eprintln!("[Omni-Context] 请确保 Node.js 已安装且 brain-server 已构建");
                    }
                }

                let status_text = if result.is_ok() && brain_server::is_ready() {
                    "Brain Server: 在线"
                } else {
                    "Brain Server: 离线"
                };
                let _ = startup_handle
                    .tray_handle()
                    .get_item("server_status")
                    .set_title(status_text);
            });

            // 启动 30 秒后检查更新（避免拖慢启动）。
            // 仅当配置启用 updater（active=true）时 tauri-build 才会发出 cfg(updater)，
            // AppHandle::updater() 方法随之才存在。CI 用 updater 关闭的配置打包，
            // 故对整段更新检查加 cfg 守卫，关闭时直接编译掉、跳过检查。
            #[cfg(updater)]
            {
                let update_handle = app.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                    println!("[Omni-Context] 检查更新...");
                    match update_handle.updater().check().await {
                        Ok(response) => {
                            if response.is_update_available() {
                                println!(
                                    "[Omni-Context] 发现新版本: {}",
                                    response.current_version()
                                );
                                let body = response.body().map(|s| s.clone()).unwrap_or_default();
                                let date =
                                    response.date().map(|d| d.to_string()).unwrap_or_default();
                                let _ = update_handle.emit_all(
                                    "update-available",
                                    serde_json::json!({
                                        "version": response.current_version(),
                                        "body": body,
                                        "date": date,
                                    }),
                                );
                            } else {
                                println!("[Omni-Context] 已是最新版本");
                            }
                        }
                        Err(e) => {
                            eprintln!("[Omni-Context] 检查更新失败: {}", e);
                        }
                    }
                });
            }

            let (event_tx, mut event_rx) = mpsc::channel::<udp_listener::HardwareRequest>(32);

            let udp_event_tx = event_tx.clone();
            let hardware_app = app.handle();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = udp_listener::start_udp_listener(udp_event_tx).await {
                    eprintln!("[Omni-Context] UDP 监听器错误: {}", e);
                }
            });

            tauri::async_runtime::spawn(async move {
                while let Some(request) = event_rx.recv().await {
                    let event = request.event;
                    let event_name = match event {
                        ButtonEvent::Precipitate => "precipitate",
                        ButtonEvent::Decision => "decision",
                        ButtonEvent::Reset => "reset",
                    };

                    println!("[Omni-Context] 收到事件: {}", event_name);

                    match event {
                        ButtonEvent::Precipitate => {
                            let result = hardware_actions::execute_precipitate().await;
                            let _ = hardware_app.emit_all("hardware-precipitate-result", &result);
                            let completion = result
                                .map(|jobs| format!("ingested {} capture job(s)", jobs.len()));
                            let _ = request.reply.send(completion);
                        }
                        ButtonEvent::Decision => {
                            if let Some(window) = hardware_app.get_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                            let _ = hardware_app.emit_all("hardware-decision-requested", ());
                            let _ = request
                                .reply
                                .send(Ok("decision assistant opened".to_string()));
                        }
                        ButtonEvent::Reset => {
                            // Reset only clears transient capture/decision UI state. It never
                            // deletes memories, revokes devices, or rotates credentials.
                            let _ = hardware_app.emit_all("hardware-reset-transient-ui", ());
                            let _ = request
                                .reply
                                .send(Ok("transient UI state reset".to_string()));
                        }
                    }
                }
            });

            println!("[Omni-Context] 桌面守护进程已启动");
            Ok(())
        })
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if event.window().label() == "main" {
                    if CLOSE_TO_TRAY.load(Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = event.window().hide();
                    } else {
                        println!("[Omni-Context] 窗口关闭且配置为直接退出，正在清理...");
                        let _ = brain_server::stop();
                        std::process::exit(0);
                    }
                }
            }
            tauri::WindowEvent::Destroyed if event.window().label() == "main" => {
                println!("[Omni-Context] 主窗口销毁，清理中...");
                if let Err(e) = brain_server::stop() {
                    eprintln!("[Omni-Context] Brain Server 停止失败: {}", e);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_listening,
            commands::capture_screen,
            commands::capture_all_screens,
            commands::capture_screen_region,
            commands::get_clipboard,
            commands::get_clipboard_detailed,
            commands::set_clipboard,
            commands::clear_clipboard,
            commands::send_to_brain_server,
            commands::get_system_status,
            commands::start_brain_server,
            commands::stop_brain_server,
            commands::restart_brain_server,
            commands::trigger_precipitate,
            commands::trigger_decision,
            commands::trigger_reset,
            commands::register_global_shortcuts,
            commands::set_close_behavior,
            commands::quit_app,
            commands::open_data_folder,
            commands::open_logs_folder,
            commands::process_dropped_paths,
            commands::mcp_get_server_command,
            commands::mcp_get_clients_status,
            commands::mcp_install_to,
            commands::mcp_open_config_folder,
            commands::get_foreground_window_info,
            commands::get_pair_code,
            commands::regenerate_pair_code,
            commands::get_local_api_token,
            commands::execute_ready_plan,
            commands::approve_pending_plan,
            commands::verify_pending_plan,
            commands::reopen_decision,
            commands::get_broker_status,
            commands::open_trusted_external_url,
            commands::regenerate_local_api_token,
            commands::enable_cli_approvals,
            commands::disable_cli_approvals,
            commands::enable_cli_verification,
            commands::disable_cli_verification,
            commands::enable_cli_reopen,
            commands::disable_cli_reopen,
            hardware::list_hardware_devices,
            hardware::pair_hardware_device,
            hardware::unpair_hardware_device,
            hardware::forget_hardware_device,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Tauri 退出后的清理（保险措施）
    println!("[Omni-Context] 应用退出，清理 Brain Server...");
    let _ = brain_server::stop();
}
