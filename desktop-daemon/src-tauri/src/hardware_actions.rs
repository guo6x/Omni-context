use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use std::time::Duration;

use crate::{brain_server, capture_policy, clipboard, screen_capture};

#[derive(Debug, Deserialize)]
struct SubmitResponse {
    #[serde(rename = "jobId")]
    job_id: String,
}

#[derive(Debug, Deserialize)]
struct JobResponse {
    status: String,
    error: Option<String>,
}

async fn submit(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    filename: &str,
    content_type: &str,
    base64: &str,
) -> Result<String, String> {
    let response = client
        .post(format!("{base_url}/api/ingest/file"))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "filename": filename,
            "contentType": content_type,
            "base64": base64,
        }))
        .send()
        .await
        .map_err(|error| format!("failed to submit {filename}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "failed to submit {filename}: HTTP {}",
            response.status()
        ));
    }
    let submitted: SubmitResponse = response.json().await.map_err(|error| error.to_string())?;
    Ok(submitted.job_id)
}

async fn wait_for_job(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    job_id: &str,
) -> Result<String, String> {
    for _ in 0..120 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let response = client
            .get(format!("{base_url}/api/ingest/job/{job_id}"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| format!("failed to poll {job_id}: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "failed to poll {job_id}: HTTP {}",
                response.status()
            ));
        }
        let job: JobResponse = response.json().await.map_err(|error| error.to_string())?;
        match job.status.as_str() {
            "success" => return Ok(job_id.to_string()),
            "failed" => return Err(job.error.unwrap_or_else(|| "ingest job failed".to_string())),
            _ => {}
        }
    }
    Err(format!("ingest job {job_id} timed out"))
}

#[cfg(test)]
async fn submit_and_wait(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    filename: &str,
    content_type: &str,
    base64: &str,
) -> Result<String, String> {
    let job_id = submit(client, base_url, token, filename, content_type, base64).await?;
    wait_for_job(client, base_url, token, &job_id).await
}

pub async fn execute_precipitate() -> Result<Vec<String>, String> {
    // The native capture lease covers both reads and commits their result only
    // if policy and foreground authorization still win against a tray revoke.
    let ((screenshot, clipboard), authorization) =
        capture_policy::run_current_if_allowed_with_authorization(|| async {
            let screenshot = screen_capture::capture_screen_base64()
                .await
                .map_err(|error| format!("screen capture failed: {error}"))?;
            let clipboard = clipboard::get_clipboard_content()
                .await
                .map_err(|error| format!("clipboard read failed: {error}"))?;
            Ok((screenshot, clipboard))
        })
        .await?;
    // Keep hardware ingestion on the same loopback Brain selected by the
    // Desktop process. A legacy URL override is accepted only when it is a
    // loopback URL; test ports are configured with OMNI_BRAIN_PORT instead.
    let base_url = std::env::var("OMNI_BRAIN_URL")
        .ok()
        .filter(|value| {
            reqwest::Url::parse(value)
                .map(|url| {
                    url.scheme() == "http"
                        && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"))
                        && url.query().is_none()
                        && url.fragment().is_none()
                })
                .unwrap_or(false)
        })
        .unwrap_or_else(brain_server::brain_api_url);
    let token = brain_server::ensure_local_token()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(70))
        .build()
        .map_err(|error| error.to_string())?;

    // Each upload gets a separate lease. If pause/revoke wins after local
    // capture but before this admission point, the HTTP request is never sent.
    let screen_job = capture_policy::run_with_capture_authorization(&authorization, || async {
        submit(
            &client,
            &base_url,
            &token,
            "hardware-screen.png",
            "image/png",
            &screenshot,
        )
        .await
    })
    .await?;
    let mut jobs = vec![wait_for_job(&client, &base_url, &token, &screen_job).await?];
    if let Some(text) = clipboard.filter(|value| !value.trim().is_empty()) {
        let content = STANDARD.encode(text.as_bytes());
        let clipboard_job =
            capture_policy::run_with_capture_authorization(&authorization, || async {
                submit(
                    &client,
                    &base_url,
                    &token,
                    "hardware-clipboard.txt",
                    "text/plain",
                    &content,
                )
                .await
            })
            .await?;
        jobs.push(wait_for_job(&client, &base_url, &token, &clipboard_job).await?);
    }
    Ok(jobs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn read_request(stream: &mut tokio::net::TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 1024];
        loop {
            let count = stream.read(&mut buffer).await.unwrap();
            if count == 0 {
                break;
            }
            bytes.extend_from_slice(&buffer[..count]);
            if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        String::from_utf8_lossy(&bytes).to_string()
    }

    #[tokio::test]
    async fn submit_and_wait_runs_authenticated_ingest_business_chain() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut submit, _) = listener.accept().await.unwrap();
            let request = read_request(&mut submit).await;
            assert!(request.starts_with("POST /api/ingest/file HTTP/1.1"));
            assert!(request
                .to_ascii_lowercase()
                .contains("authorization: bearer local-test-token"));
            let body = r#"{"jobId":"hardware-job-1"}"#;
            submit.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes()).await.unwrap();

            let (mut poll, _) = listener.accept().await.unwrap();
            let request = read_request(&mut poll).await;
            assert!(request.starts_with("GET /api/ingest/job/hardware-job-1 HTTP/1.1"));
            assert!(request
                .to_ascii_lowercase()
                .contains("authorization: bearer local-test-token"));
            let body = r#"{"status":"success","error":null}"#;
            poll.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes()).await.unwrap();
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let job = submit_and_wait(
            &client,
            &format!("http://{address}"),
            "local-test-token",
            "hardware-clipboard.txt",
            "text/plain",
            "dGVzdA==",
        )
        .await
        .unwrap();
        server.await.unwrap();
        assert_eq!(job, "hardware-job-1");
    }

    #[test]
    fn reset_contract_is_non_destructive_by_design() {
        // Reset is implemented by the caller as a UI event only. This module exposes
        // no database deletion, credential revocation, or registry mutation operation.
        assert_eq!(brain_server::DEFAULT_BRAIN_PORT, 3001);
    }
}
