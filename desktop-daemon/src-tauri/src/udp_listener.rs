use crate::ButtonEvent;
use anyhow::{anyhow, Result};
use tokio::net::UdpSocket;
use tokio::sync::mpsc::Sender;

pub async fn start_udp_listener(event_tx: Sender<ButtonEvent>) -> Result<()> {
    // 默认仅监听本机回环，避免 LAN 上任意进程都能触发截图/剪贴板读取。
    // 如需接入物理硬件按钮等远端触发器，显式 export OMNI_UDP_BIND=0.0.0.0:9090。
    let bind_addr =
        std::env::var("OMNI_UDP_BIND").unwrap_or_else(|_| "127.0.0.1:9090".to_string());
    let socket = UdpSocket::bind(&bind_addr).await?;
    println!("UDP 监听器已启动 ({})", bind_addr);
    
    let mut buf = [0; 1024];
    
    loop {
        match socket.recv_from(&mut buf).await {
            Ok((len, addr)) => {
                let msg = String::from_utf8_lossy(&buf[..len]);
                println!("收到来自 {} 的消息: {}", addr, msg.trim());
                
                let event = match msg.trim() {
                    "precipitate" => ButtonEvent::Precipitate,
                    "decision" => ButtonEvent::Decision,
                    "reset" => ButtonEvent::Reset,
                    _ => {
                        println!("未知命令: {}", msg);
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
