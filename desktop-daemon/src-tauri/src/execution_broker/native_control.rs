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
const MAX_CONTROL_HEADER_BYTES: usize = 64 * 1024;
const MAX_CONTROL_BODY_BYTES: usize = 512 * 1024;

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

/// Read exactly one HTTP request without waiting for the peer to close the
/// connection. HTTP clients (including Node's fetch) keep the connection open
/// while waiting for the response, so `read_to_end` would deadlock until the
/// socket timeout and surface as a misleading approval 502.
fn read_http_request(stream: &mut TcpStream) -> Result<Vec<u8>, &'static str> {
    const DELIMITER: &[u8] = b"\r\n\r\n";

    let mut bytes = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 4096];
    let header_end = loop {
        let read = stream.read(&mut chunk).map_err(|_| "CONTROL_READ_FAILED")?;
        if read == 0 {
            return Err("CONTROL_REQUEST_TRUNCATED");
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.len() > MAX_CONTROL_HEADER_BYTES {
            return Err("CONTROL_HEADERS_TOO_LARGE");
        }
        if let Some(index) = bytes
            .windows(DELIMITER.len())
            .position(|window| window == DELIMITER)
        {
            break index + DELIMITER.len();
        }
    };

    let headers = String::from_utf8(bytes[..header_end - DELIMITER.len()].to_vec())
        .map_err(|_| "CONTROL_HEADERS_INVALID")?;
    let content_length = parse_request_framing(&headers)?;
    if content_length > MAX_CONTROL_BODY_BYTES {
        return Err("CONTROL_BODY_TOO_LARGE");
    }
    let target = header_end
        .checked_add(content_length)
        .ok_or("CONTROL_BODY_TOO_LARGE")?;
    while bytes.len() < target {
        let read = stream.read(&mut chunk).map_err(|_| "CONTROL_READ_FAILED")?;
        if read == 0 {
            return Err("CONTROL_REQUEST_TRUNCATED");
        }
        bytes.extend_from_slice(&chunk[..read]);
        if bytes.len() > target {
            // One request per connection; ignore pipelined bytes rather than
            // allowing them to alter the parsed body.
            bytes.truncate(target);
            break;
        }
    }
    bytes.truncate(target);
    Ok(bytes)
}

fn parse_request_framing(headers: &str) -> Result<usize, &'static str> {
    let mut content_length = None;
    for (index, line) in headers.lines().enumerate() {
        if index == 0 {
            if line.trim().is_empty() {
                return Err("CONTROL_REQUEST_LINE_INVALID");
            }
            continue;
        }
        if line.is_empty()
            || line
                .as_bytes()
                .first()
                .is_some_and(|byte| *byte == b' ' || *byte == b'\t')
        {
            return Err("CONTROL_HEADERS_INVALID");
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err("CONTROL_HEADERS_INVALID");
        };
        if name.is_empty()
            || name.trim() != name
            || !name.bytes().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(
                        byte,
                        b'!' | b'#'
                            | b'$'
                            | b'%'
                            | b'&'
                            | b'\''
                            | b'*'
                            | b'+'
                            | b'-'
                            | b'.'
                            | b'^'
                            | b'_'
                            | b'`'
                            | b'|'
                            | b'~'
                    )
            })
        {
            return Err("CONTROL_HEADERS_INVALID");
        }
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err("CONTROL_TRANSFER_ENCODING_UNSUPPORTED");
        }
        if !name.eq_ignore_ascii_case("content-length") {
            continue;
        }
        let value = value.trim();
        if value.is_empty()
            || !value.bytes().all(|byte| byte.is_ascii_digit())
            || (value.len() > 1 && value.starts_with('0'))
        {
            return Err("CONTROL_CONTENT_LENGTH_INVALID");
        }
        let parsed = value
            .parse::<usize>()
            .map_err(|_| "CONTROL_CONTENT_LENGTH_INVALID")?;
        if let Some(previous) = content_length {
            if previous != parsed {
                return Err("CONTROL_CONTENT_LENGTH_CONFLICT");
            }
        } else {
            content_length = Some(parsed);
        }
    }
    content_length.ok_or("CONTROL_CONTENT_LENGTH_REQUIRED")
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
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
    let bytes = match read_http_request(&mut stream) {
        Ok(bytes) => bytes,
        Err(_) => return,
    };
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn read_from_chunks(chunks: Vec<Vec<u8>>) -> Result<Vec<u8>, &'static str> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind framing test listener");
        let address = listener.local_addr().expect("test listener address");
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(address).expect("connect framing test listener");
            for chunk in chunks {
                stream.write_all(&chunk).expect("write framing test chunk");
                std::thread::sleep(std::time::Duration::from_millis(2));
            }
        });
        let (mut server, _) = listener.accept().expect("accept framing test client");
        server
            .set_read_timeout(Some(std::time::Duration::from_secs(1)))
            .expect("set framing test timeout");
        let result = read_http_request(&mut server);
        client.join().expect("join framing test client");
        result
    }

    fn framed_request(body: &str) -> Vec<u8> {
        format!(
            "POST /internal/native/approve HTTP/1.1\r\nHost: 127.0.0.1:3312\r\nContent-Length: {}\r\n\r\n{}",
            body.len(), body
        )
        .into_bytes()
    }

    #[test]
    fn valid_json_request_is_read_to_declared_length() {
        let request = framed_request("{}");
        assert_eq!(read_from_chunks(vec![request.clone()]).unwrap(), request);
    }

    #[test]
    fn header_and_body_split_across_reads_are_supported() {
        let request = framed_request("{\"ok\":true}");
        let split = request
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .expect("request delimiter")
            + 4;
        let result = read_from_chunks(vec![request[..split].to_vec(), request[split..].to_vec()]);
        assert_eq!(result.unwrap(), request);
    }

    #[test]
    fn body_must_match_content_length_exactly() {
        let request = framed_request("{\"x\":1}");
        assert_eq!(read_from_chunks(vec![request]).unwrap().last(), Some(&b'}'));
    }

    #[test]
    fn truncated_body_is_rejected() {
        let request = b"POST /internal/native/approve HTTP/1.1\r\nHost: 127.0.0.1:3312\r\nContent-Length: 5\r\n\r\n{}";
        assert_eq!(
            read_from_chunks(vec![request.to_vec()]),
            Err("CONTROL_REQUEST_TRUNCATED")
        );
    }

    #[test]
    fn oversized_body_is_rejected() {
        let headers = format!(
            "POST /internal/native/approve HTTP/1.1\r\nContent-Length: {}\r\n\r\n",
            MAX_CONTROL_BODY_BYTES + 1
        );
        assert_eq!(
            read_from_chunks(vec![headers.into_bytes()]),
            Err("CONTROL_BODY_TOO_LARGE")
        );
    }

    #[test]
    fn oversized_headers_are_rejected() {
        let mut request = vec![b'a'; MAX_CONTROL_HEADER_BYTES + 1];
        request.extend_from_slice(b"\r\n\r\n");
        assert_eq!(
            read_from_chunks(vec![request]),
            Err("CONTROL_HEADERS_TOO_LARGE")
        );
    }

    #[test]
    fn missing_content_length_is_rejected() {
        let headers = "POST /internal/native/approve HTTP/1.1\r\nHost: 127.0.0.1:3312";
        assert_eq!(
            parse_request_framing(headers),
            Err("CONTROL_CONTENT_LENGTH_REQUIRED")
        );
    }

    #[test]
    fn invalid_and_negative_content_length_are_rejected() {
        for value in ["nope", "-1", "+1", "1,1", "", "02"] {
            let headers =
                format!("POST /internal/native/approve HTTP/1.1\r\nContent-Length: {value}");
            assert_eq!(
                parse_request_framing(&headers),
                Err("CONTROL_CONTENT_LENGTH_INVALID")
            );
        }
    }

    #[test]
    fn duplicate_equal_content_lengths_are_accepted() {
        let headers =
            "POST /internal/native/approve HTTP/1.1\r\nContent-Length: 2\r\nContent-Length: 2";
        assert_eq!(parse_request_framing(headers), Ok(2));
    }

    #[test]
    fn duplicate_conflicting_content_lengths_are_rejected() {
        let headers =
            "POST /internal/native/approve HTTP/1.1\r\nContent-Length: 2\r\nContent-Length: 3";
        assert_eq!(
            parse_request_framing(headers),
            Err("CONTROL_CONTENT_LENGTH_CONFLICT")
        );
    }

    #[test]
    fn transfer_encoding_and_te_content_length_smuggling_are_rejected() {
        for headers in [
            "POST /internal/native/approve HTTP/1.1\r\nTransfer-Encoding: chunked\r\nContent-Length: 2",
            "POST /internal/native/approve HTTP/1.1\r\nTransfer-Encoding: identity\r\nContent-Length: 2",
        ] {
            assert_eq!(parse_request_framing(headers), Err("CONTROL_TRANSFER_ENCODING_UNSUPPORTED"));
        }
    }

    #[test]
    fn malformed_headers_are_rejected() {
        let headers = "POST /internal/native/approve HTTP/1.1\r\nX-Bad-Header\r\nContent-Length: 2";
        assert_eq!(
            parse_request_framing(headers),
            Err("CONTROL_HEADERS_INVALID")
        );
    }

    #[test]
    fn pipelined_bytes_cannot_change_current_body() {
        let request = framed_request("{}");
        let mut pipelined = request.clone();
        pipelined.extend_from_slice(
            b"POST /internal/native/approve HTTP/1.1\r\nContent-Length: 9\r\n\r\nforged!!!",
        );
        assert_eq!(read_from_chunks(vec![pipelined]).unwrap(), request);
    }
}
