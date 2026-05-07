#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod udp_listener;
mod screen_capture;
mod clipboard;
mod commands;
mod brain_server;

use tauri::Manager;
use tokio::sync::mpsc;

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
    
    tauri::Builder::default()
        .setup(|app| {
            let _app_handle = app.app_handle().clone();
            
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
            // 窗口关闭时清理 Brain Server 进程
            if let tauri::WindowEvent::Destroyed = event.event() {
                println!("[Omni-Context] 窗口关闭，正在清理...");
                if let Err(e) = brain_server::stop() {
                    eprintln!("[Omni-Context] Brain Server 停止失败: {}", e);
                }
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Tauri 退出后的清理（保险措施）
    println!("[Omni-Context] 应用退出，清理 Brain Server...");
    let _ = brain_server::stop();
}
