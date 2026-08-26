//! Private Brain -> native approval bridge.
//!
//! This listener is deliberately not a Tauri command and is never documented
//! as a public API. It binds loopback only, rejects browser Origin headers,
//! authenticates with a random 256-bit startup secret, and accepts one fixed
//! semantic operation: a server-owned plan-bound approval grant.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::thread;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};

use super::approval::digest::constant_time_eq;
use super::approval::{ActorKind, ApprovalRecord};
use super::{
    global_broker, ApprovalReferenceWire, AuthorityLevelWire, ExecutionPlanWire,
    PlanApprovalGrantRequest,
};

pub const DEFAULT_PORT: u16 = 3002;

#[derive(Debug, Clone)]
pub struct NativeBridgeHandle {
    pub secret: String,
    pub port: u16,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GrantRequestWire {
    plan: ExecutionPlanWire,
    approval_request_id: String,
    actor_id: String,
    actor_kind: ActorKind,
    actor_authority: AuthorityLevelWire,
    expires_at: String,
    approval_binding_digest: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct VerifyRequestWire {
    approval_reference: ApprovalReferenceWire,
    plan: ExecutionPlanWire,
}

#[derive(Debug, Serialize)]
struct ResponseBody<T: Serialize> {
    ok: bool,
    data: Option<T>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct VerifyGrantBody {
    valid: bool,
    grant: Option<VerifyGrantMetadata>,
}

#[derive(Debug, Serialize)]
struct VerifyGrantMetadata {
    actor: VerifyActor,
    authority: AuthorityLevelWire,
    granted_at: String,
    expires_at: String,
    native_record_id: String,
    token_reference: String,
    token_digest: String,
}

#[derive(Debug, Serialize)]
struct VerifyActor {
    actor_id: String,
    actor_kind: ActorKind,
    authority_level: AuthorityLevelWire,
    source: &'static str,
}

fn verify_body(record: ApprovalRecord) -> VerifyGrantBody {
    VerifyGrantBody {
        valid: true,
        grant: Some(VerifyGrantMetadata {
            actor: VerifyActor {
                actor_id: record.actor_id,
                actor_kind: record.actor_kind,
                authority_level: record.actor_authority,
                source: "trusted_local",
            },
            authority: record.actor_authority,
            granted_at: record.granted_at,
            expires_at: record.expires_at,
            native_record_id: record.approval_id,
            token_reference: record.token_reference,
            token_digest: record.token_digest,
        }),
    }
}

fn response<T: Serialize>(stream: &mut TcpStream, status: &str, body: ResponseBody<T>) {
    let bytes = serde_json::to_vec(&body)
        .unwrap_or_else(|_| b"{\"ok\":false,\"error\":\"INTERNAL_CONTROL_ERROR\"}".to_vec());
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        bytes.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(&bytes);
}

fn loopback(addr: SocketAddr) -> bool {
    addr.ip().is_loopback()
}

fn authorized(headers: &str, secret: &str) -> bool {
    let has_origin = headers
        .lines()
        .any(|line| line.to_ascii_lowercase().starts_with("origin:"));
    if has_origin {
        return false;
    }
    headers.lines().any(|line| {
        let lower = line.to_ascii_lowercase();
        if !lower.starts_with("authorization:") {
            return false;
        }
        line.split_once(':')
            .map(|(_, value)| constant_time_eq(value.trim(), &format!("Bearer {secret}")))
            .unwrap_or(false)
    })
}

fn host_allowed(headers: &str, port: u16) -> bool {
    let expected = [
        format!("localhost:{port}"),
        format!("127.0.0.1:{port}"),
        format!("[::1]:{port}"),
    ];
    headers
        .lines()
        .find_map(|line| {
            let lower = line.to_ascii_lowercase();
            if lower.starts_with("host:") {
                Some(
                    line.split_once(':')
                        .map(|(_, value)| value.trim().to_ascii_lowercase()),
                )
            } else {
                None
            }
        })
        .flatten()
        .map(|host| expected.iter().any(|item| item == &host))
        .unwrap_or(false)
}

fn handle(mut stream: TcpStream, peer: SocketAddr, secret: &str, port: u16) {
    if !loopback(peer) {
        response(
            &mut stream,
            "403 Forbidden",
            ResponseBody {
                ok: false,
                data: None::<serde_json::Value>,
                error: Some("CONTROL_REMOTE_ADDRESS_REJECTED".into()),
            },
        );
        return;
    }
    let mut bytes = Vec::new();
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
    if stream.read_to_end(&mut bytes).is_err() {
        return;
    }
    let text = String::from_utf8_lossy(&bytes);
    let Some((headers, body)) = text.split_once("\r\n\r\n") else {
        return;
    };
    if !host_allowed(headers, port) || !authorized(headers, secret) {
        response(
            &mut stream,
            "401 Unauthorized",
            ResponseBody {
                ok: false,
                data: None::<serde_json::Value>,
                error: Some("CONTROL_AUTH_REQUIRED".into()),
            },
        );
        return;
    }
    let mut request_line = headers
        .lines()
        .next()
        .unwrap_or_default()
        .split_whitespace();
    let method = request_line.next().unwrap_or_default();
    let path = request_line.next().unwrap_or_default();
    if method != "POST" || !matches!(path, "/internal/native/approve" | "/internal/native/verify") {
        response(
            &mut stream,
            "404 Not Found",
            ResponseBody {
                ok: false,
                data: None::<serde_json::Value>,
                error: Some("NOT_FOUND".into()),
            },
        );
        return;
    }
    let parsed = serde_json::from_str::<serde_json::Value>(body);
    let Ok(value) = parsed else {
        response(
            &mut stream,
            "400 Bad Request",
            ResponseBody {
                ok: false,
                data: None::<serde_json::Value>,
                error: Some("INVALID_JSON".into()),
            },
        );
        return;
    };
    if path == "/internal/native/approve" {
        let Ok(request) = serde_json::from_value::<GrantRequestWire>(value) else {
            response(
                &mut stream,
                "400 Bad Request",
                ResponseBody {
                    ok: false,
                    data: None::<serde_json::Value>,
                    error: Some("PLAN_NOT_APPROVABLE".into()),
                },
            );
            return;
        };
        let result = global_broker().grant_approval_for_plan(PlanApprovalGrantRequest {
            plan: &request.plan,
            approval_request_id: Some(request.approval_request_id),
            actor_id: request.actor_id,
            actor_kind: request.actor_kind,
            actor_authority: request.actor_authority,
            expires_at: request.expires_at,
            expected_binding_digest: &request.approval_binding_digest,
        });
        match result {
            Ok(reference) => response(
                &mut stream,
                "200 OK",
                ResponseBody {
                    ok: true,
                    data: Some(reference),
                    error: None,
                },
            ),
            Err(error) => response(
                &mut stream,
                "409 Conflict",
                ResponseBody {
                    ok: false,
                    data: None::<serde_json::Value>,
                    error: Some(format!("{:?}", error.code)),
                },
            ),
        }
    } else {
        let Ok(request) = serde_json::from_value::<VerifyRequestWire>(value) else {
            response(
                &mut stream,
                "400 Bad Request",
                ResponseBody {
                    ok: false,
                    data: None::<serde_json::Value>,
                    error: Some("INVALID_JSON".into()),
                },
            );
            return;
        };
        let result =
            global_broker().verify_approval_for_plan(&request.approval_reference, &request.plan);
        match result {
            Ok(record) => response(
                &mut stream,
                "200 OK",
                ResponseBody {
                    ok: true,
                    data: Some(verify_body(record)),
                    error: None,
                },
            ),
            Err(error) => response(
                &mut stream,
                "409 Conflict",
                ResponseBody {
                    ok: false,
                    data: None::<serde_json::Value>,
                    error: Some(format!("{:?}", error.code)),
                },
            ),
        }
    }
}

pub fn start() -> NativeBridgeHandle {
    let mut random = [0_u8; 32];
    getrandom::getrandom(&mut random).expect("native bridge requires secure OS randomness");
    let secret = URL_SAFE_NO_PAD.encode(random);
    let requested_port = std::env::var("NATIVE_BRIDGE_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_PORT);
    let listener = TcpListener::bind(("127.0.0.1", requested_port))
        .expect("bind native control bridge loopback socket");
    let port = listener
        .local_addr()
        .expect("native bridge local address")
        .port();
    let secret_for_thread = secret.clone();
    thread::spawn(move || {
        for incoming in listener.incoming() {
            let Ok(stream) = incoming else {
                continue;
            };
            let peer = stream
                .peer_addr()
                .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 0)));
            let secret = secret_for_thread.clone();
            thread::spawn(move || handle(stream, peer, &secret, port));
        }
    });
    NativeBridgeHandle { secret, port }
}
