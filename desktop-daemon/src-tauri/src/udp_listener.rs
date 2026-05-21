use crate::hardware;
use crate::ButtonEvent;
use anyhow::Result;
use tokio::net::UdpSocket;
use tokio::sync::mpsc::Sender;

pub async fn start_udp_listener(event_tx: Sender<ButtonEvent>) -> Result<()> {
    // 默认仅监听本机回环，避免 LAN 上任意进程都能触发截图/剪贴板读取。
    // 如需接入物理硬件按钮等远端触发器，显式 export OMNI_UDP_BIND=0.0.0.0:9090。
    let bind_addr =
        std::env::var("OMNI_UDP_BIND").unwrap_or_else(|_| "127.0.0.1:9090".to_string());
    // 端口冲突时（如用户开了多个实例）不要把整个 spawn 任务带挂，而是
    // 打印明确提示并优雅退出 — 应用其他模块继续工作。
    let socket = match UdpSocket::bind(&bind_addr).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "[UDP Listener] 绑定 {} 失败: {} — 硬件触发功能将不可用，但桌面应用其他功能正常。可能 9090 端口被占用。",
                bind_addr, e
            );
            return Ok(());
        }
    };
    println!("UDP 监听器已启动 ({})", bind_addr);
    
    let mut buf = [0; 1024];
    
    loop {
        match socket.recv_from(&mut buf).await {
            Ok((len, addr)) => {
                let msg = String::from_utf8_lossy(&buf[..len]);
                let trimmed = msg.trim();
                println!("收到来自 {} 的消息: {}", addr, trimmed);

                // 任何 UDP 包都登记到硬件注册表，便于 UI 端做发现与配对。
                let ip_str = addr.ip().to_string();
                hardware::record_packet(&ip_str, trimmed);

                let event = match trimmed {
                    "precipitate" => ButtonEvent::Precipitate,
                    "decision" => ButtonEvent::Decision,
                    "reset" => ButtonEvent::Reset,
                    _ => {
                        println!("未知命令: {}", trimmed);
                        continue;
                    }
                };

                if let Err(e) = event_tx.send(event).await {
                    eprintln!("发送事件失败: {}", e);
                }
            }
            Err(e) => {
                eprintln!("接收 UDP 数据失败: {}", e);
            }
        }
    }
}
