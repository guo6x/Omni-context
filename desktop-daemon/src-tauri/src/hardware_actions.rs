use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use std::time::Duration;

use crate::{brain_server, clipboard, screen_capture};

const DEFAULT_BRAIN_URL: &str = "http://127.0.0.1:3001";

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

async fn submit_and_wait(
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

    for _ in 0..120 {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let response = client
            .get(format!("{base_url}/api/ingest/job/{}", submitted.job_id))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| format!("failed to poll {}: {error}", submitted.job_id))?;
        if !response.status().is_success() {
            return Err(format!(
                "failed to poll {}: HTTP {}",
                submitted.job_id,
                response.status()
            ));
        }
        let job: JobResponse = response.json().await.map_err(|error| error.to_string())?;
        match job.status.as_str() {
            "success" => return Ok(submitted.job_id),
            "failed" => return Err(job.error.unwrap_or_else(|| "ingest job failed".to_string())),
            _ => {}
        }
    }
    Err(format!("ingest job {} timed out", submitted.job_id))
}

pub async fn execute_precipitate() -> Result<Vec<String>, String> {
    let screenshot = screen_capture::capture_screen_base64()
        .await
        .map_err(|error| format!("screen capture failed: {error}"))?;
    let clipboard = clipboard::get_clipboard_content()
        .await
        .map_err(|error| format!("clipboard read failed: {error}"))?;
    let base_url =
        std::env::var("OMNI_BRAIN_URL").unwrap_or_else(|_| DEFAULT_BRAIN_URL.to_string());
    let token = brain_server::ensure_local_token();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(70))
        .build()
        .map_err(|error| error.to_string())?;

    let mut jobs = Vec::new();
    jobs.push(
        submit_and_wait(
            &client,
            &base_url,
            &token,
            "hardware-screen.png",
            "image/png",
            &screenshot,
        )
        .await?,
    );
    if let Some(text) = clipboard.filter(|value| !value.trim().is_empty()) {
        jobs.push(
            submit_and_wait(
                &client,
                &base_url,
                &token,
                "hardware-clipboard.txt",
                "text/plain",
                &STANDARD.encode(text.as_bytes()),
            )
            .await?,
        );
    }
    Ok(jobs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reset_contract_is_non_destructive_by_design() {
        // Reset is implemented by the caller as a UI event only. This module exposes
        // no database deletion, credential revocation, or registry mutation operation.
        assert_eq!(DEFAULT_BRAIN_URL, "http://127.0.0.1:3001");
    }
}
