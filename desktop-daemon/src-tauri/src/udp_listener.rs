use crate::ButtonEvent;
use anyhow::{anyhow, Result};
use tokio::net::UdpSocket;
use tokio::sync::mpsc::Sender;

pub async fn start_udp_listener(event_tx: Sender<ButtonEvent>) -> Result<()> {
    let socket = UdpSocket::bind("0.0.0.0:9090").await?;
    println!("UDP 监听器已启动，监听端口 9090");
    
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
