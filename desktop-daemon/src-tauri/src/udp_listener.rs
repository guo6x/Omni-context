use crate::hardware::{self, HardwareAction};
use crate::ButtonEvent;
use anyhow::Result;
use serde::Serialize;
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio::sync::{mpsc::Sender, oneshot};

pub struct HardwareRequest {
    pub event: ButtonEvent,
    pub reply: oneshot::Sender<Result<String, String>>,
}

#[derive(Debug, Serialize)]
struct HardwareAck {
    version: u8,
    accepted: bool,
    status: &'static str,
    detail: String,
}

impl HardwareAck {
    fn success(status: &'static str, detail: impl Into<String>) -> Self {
        Self {
            version: 1,
            accepted: true,
            status,
            detail: detail.into(),
        }
    }

    fn failure(status: &'static str, detail: impl Into<String>) -> Self {
        Self {
            version: 1,
            accepted: false,
            status,
            detail: detail.into(),
        }
    }
}

async fn dispatch_packet(
    event_tx: &Sender<HardwareRequest>,
    packet: &[u8],
    ip: &str,
) -> HardwareAck {
    let action = match hardware::verify_packet(packet, ip) {
        Ok(action) => action,
        Err(error) => return HardwareAck::failure("rejected", error),
    };
    if action == HardwareAction::Heartbeat {
        return HardwareAck::success("accepted", "heartbeat verified");
    }
    let event = match action {
        HardwareAction::Precipitate => ButtonEvent::Precipitate,
        HardwareAction::Decision => ButtonEvent::Decision,
        HardwareAction::Reset => ButtonEvent::Reset,
        HardwareAction::Heartbeat => unreachable!(),
    };
    let (reply, completed) = oneshot::channel();
    if event_tx
        .send(HardwareRequest { event, reply })
        .await
        .is_err()
    {
        return HardwareAck::failure("dispatch_failed", "desktop action queue is unavailable");
    }
    match tokio::time::timeout(Duration::from_secs(75), completed).await {
        Ok(Ok(Ok(detail))) => HardwareAck::success("completed", detail),
        Ok(Ok(Err(error))) => HardwareAck::failure("action_failed", error),
        Ok(Err(_)) => HardwareAck::failure("action_failed", "desktop action worker stopped"),
        Err(_) => HardwareAck::failure("action_timeout", "desktop action exceeded 75 seconds"),
    }
}

pub async fn start_udp_listener(event_tx: Sender<HardwareRequest>) -> Result<()> {
    // 默认仅监听本机回环，避免 LAN 上任意进程都能触发截图/剪贴板读取。
    // 如需接入物理硬件按钮等远端触发器，显式 export OMNI_UDP_BIND=0.0.0.0:9090。
    let bind_addr = std::env::var("OMNI_UDP_BIND").unwrap_or_else(|_| "127.0.0.1:9090".to_string());
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

    let mut buf = [0; 2048];

    loop {
        match socket.recv_from(&mut buf).await {
            Ok((len, addr)) => {
                let ack = dispatch_packet(&event_tx, &buf[..len], &addr.ip().to_string()).await;
                if !ack.accepted {
                    // Never log packet contents: they contain an authentication signature.
                    eprintln!(
                        "[UDP Listener] packet from {} ended as {}",
                        addr, ack.status
                    );
                }
                if let Ok(bytes) = serde_json::to_vec(&ack) {
                    if let Err(error) = socket.send_to(&bytes, addr).await {
                        eprintln!("[UDP Listener] failed to send acknowledgement: {error}");
                    }
                }
            }
            Err(e) => {
                eprintln!("接收 UDP 数据失败: {}", e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    use std::fs;

    #[tokio::test]
    async fn signed_packet_dispatches_action_and_returns_completion() {
        let _guard = hardware::HARDWARE_TEST_LOCK.lock().unwrap();
        let path = std::env::temp_dir().join(format!("omni-udp-e2e-{}.json", std::process::id()));
        let _ = fs::remove_file(&path);
        hardware::initialize_registry(path.clone()).unwrap();
        let secret = [31_u8; 32];
        hardware::pair_hardware_device(
            "esp32-udp-test".to_string(),
            hex::encode(secret),
            Some("udp test".to_string()),
        )
        .unwrap();
        let timestamp = chrono::Utc::now().timestamp();
        let nonce = "00112233445566778899aabbccddeeff";
        let canonical = format!("1|esp32-udp-test|decision|{timestamp}|{nonce}");
        let mut mac = Hmac::<Sha256>::new_from_slice(&secret).unwrap();
        mac.update(canonical.as_bytes());
        let packet = serde_json::to_vec(&serde_json::json!({
            "version": 1,
            "device_id": "esp32-udp-test",
            "action": "decision",
            "timestamp": timestamp,
            "nonce": nonce,
            "signature": hex::encode(mac.finalize().into_bytes()),
        }))
        .unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<HardwareRequest>(1);
        let worker = tokio::spawn(async move {
            let request = rx.recv().await.unwrap();
            assert!(matches!(request.event, ButtonEvent::Decision));
            request
                .reply
                .send(Ok("decision assistant opened".to_string()))
                .unwrap();
        });
        let ack = dispatch_packet(&tx, &packet, "127.0.0.1").await;
        worker.await.unwrap();
        assert!(ack.accepted);
        assert_eq!(ack.status, "completed");
        assert_eq!(ack.detail, "decision assistant opened");
        let _ = fs::remove_file(path);
    }
}
