#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod udp_listener;
mod screen_capture;
mod clipboard;
mod commands;
mod brain_server;
mod log_writer;
mod hardware;
mod mcp_helper;


use tauri::Manager;
use tokio::sync::mpsc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{CustomMenuItem, SystemTray, SystemTrayMenu, SystemTrayMenuItem, SystemTrayEvent};

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
    println!("[Omni-Context] 启动桌面守护进程...");
    
    // 启动 Brain Server 并记录结果
    match brain_server::start() {
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
    
    let show = CustomMenuItem::new("show_main".to_string(), "显示主窗口");
    let status_text = if brain_server::is_running() {
        "Brain Server: 在线"
    } else {
        "Brain Server: 离线"
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
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None::<Vec<&str>>))
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
                        let _ = brain_server::restart();
                        let status_text = if brain_server::is_running() {
                            "Brain Server: 在线"
                        } else {
                            "Brain Server: 离线"
                        };
                        let _ = app.tray_handle().get_item("server_status").set_title(status_text);
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
            let _app_handle = app.app_handle().clone();

            // 启动 30 秒后检查更新（避免拖慢启动）
            let update_handle = app.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                println!("[Omni-Context] 检查更新...");
                match update_handle.updater().check().await {
                    Ok(response) => {
                        if response.is_update_available() {
                            println!("[Omni-Context] 发现新版本: {}", response.current_version());
                            let body = response.body().map(|s| s.clone()).unwrap_or_default();
                            let date = response.date()
                                .map(|d| d.to_string()).unwrap_or_default();
                            let _ = update_handle.emit_all("update-available", serde_json::json!({
                                "version": response.current_version(),
                                "body": body,
                                "date": date,
                            }));
                        } else {
                            println!("[Omni-Context] 已是最新版本");
                        }
                    }
                    Err(e) => {
                        eprintln!("[Omni-Context] 检查更新失败: {}", e);
                    }
                }
            });

            let (event_tx, mut event_rx) = mpsc::channel::<ButtonEvent>(32);
            
            let udp_event_tx = event_tx.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = udp_listener::start_udp_listener(udp_event_tx).await {
                    eprintln!("[Omni-Context] UDP 监听器错误: {}", e);
                }
            });
            
            tauri::async_runtime::spawn(async move {
                while let Some(event) = event_rx.recv().await {
                    let event_name = match event {
                        ButtonEvent::Precipitate => "precipitate",
                        ButtonEvent::Decision => "decision",
                        ButtonEvent::Reset => "reset",
                    };
                    
                    println!("[Omni-Context] 收到事件: {}", event_name);
                    
                    match event {
                        ButtonEvent::Precipitate => {
                            println!("[Omni-Context] 执行沉淀操作...");
                            match screen_capture::capture_screen_base64().await {
                                Ok(base64_data) => {
                                    println!("[Omni-Context] 截图成功: {} 字符", base64_data.len());
                                }
                                Err(e) => {
                                    println!("[Omni-Context] 截图失败: {}", e);
                                }
                            }
                            match clipboard::get_clipboard_content().await {
                                Ok(Some(content)) => {
                                    println!("[Omni-Context] 剪贴板内容: {} 字符", content.len());
                                }
                                Ok(None) => {
                                    println!("[Omni-Context] 剪贴板为空");
                                }
                                Err(e) => {
                                    println!("[Omni-Context] 读取剪贴板失败: {}", e);
                                }
                            }
                        }
                        ButtonEvent::Decision => {
                            println!("[Omni-Context] 执行决策查询...");
                        }
                        ButtonEvent::Reset => {
                            println!("[Omni-Context] 执行重置操作...");
                        }
                    }
                }
            });
            
            println!("[Omni-Context] 桌面守护进程已启动");
            Ok(())
        })
        .on_window_event(|event| {
            match event.event() {
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
                tauri::WindowEvent::Destroyed => {
                    if event.window().label() == "main" {
                        println!("[Omni-Context] 主窗口销毁，清理中...");
                        if let Err(e) = brain_server::stop() {
                            eprintln!("[Omni-Context] Brain Server 停止失败: {}", e);
                        }
                    }
                }
                _ => {}
            }
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
            commands::regenerate_local_api_token,
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
