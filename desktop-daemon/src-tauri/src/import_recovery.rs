//! Durable, content-free import recovery sidecar.
//!
//! WebView2 localStorage is the renderer's fast path, but a hard native stop
//! can happen before its profile database has flushed. Keep the same opaque
//! recovery payload in the per-user Omni-Context directory so the next
//! renderer can repair localStorage before mounting the import surfaces.

use std::path::PathBuf;

const MAX_PAYLOAD_BYTES: usize = 128 * 1024;
const MAX_RECORDS: usize = 1_000;

fn recovery_path() -> PathBuf {
    crate::brain_server::user_data_dir().join("import-recovery.json")
}

fn validate_payload(payload: &str) -> Result<(), String> {
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err("import recovery payload exceeds bounded size".to_string());
    }
    let value: serde_json::Value = serde_json::from_str(payload)
        .map_err(|error| format!("invalid import recovery payload: {error}"))?;
    let Some(records) = value.as_array() else {
        return Err("import recovery payload must be an array".to_string());
    };
    if records.len() > MAX_RECORDS {
        return Err("import recovery payload contains too many records".to_string());
    }
    const ALLOWED_KEYS: &[&str] = &["kind", "owner", "jobId", "attemptId", "savedAt"];
    for record in records {
        let Some(object) = record.as_object() else {
            return Err("import recovery records must be objects".to_string());
        };
        if object
            .keys()
            .any(|key| !ALLOWED_KEYS.contains(&key.as_str()))
        {
            return Err(
                "import recovery records may contain only opaque IDs and timestamps".to_string(),
            );
        }

        let owner = object
            .get("owner")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "import recovery record owner is required".to_string())?;
        if !matches!(owner, "onboarding" | "library" | "file-drop") {
            return Err("import recovery record owner is invalid".to_string());
        }

        let kind = match object.get("kind") {
            // The first v1 rollout stored jobs without an explicit kind.
            None => "job",
            Some(value) => value
                .as_str()
                .ok_or_else(|| "import recovery record kind is invalid".to_string())?,
        };
        if !matches!(kind, "job" | "uncertain") {
            return Err("import recovery record kind is invalid".to_string());
        }

        let saved_at = object
            .get("savedAt")
            .and_then(serde_json::Value::as_f64)
            .ok_or_else(|| "import recovery record savedAt is required".to_string())?;
        if !saved_at.is_finite() {
            return Err("import recovery record savedAt is invalid".to_string());
        }

        fn valid_id(value: Option<&serde_json::Value>) -> bool {
            value
                .and_then(serde_json::Value::as_str)
                .map(|id| !id.is_empty() && id.len() <= 128)
                .unwrap_or(false)
        }

        match kind {
            "job" => {
                if object.contains_key("attemptId") || !valid_id(object.get("jobId")) {
                    return Err(
                        "import recovery job record must contain only a bounded jobId".to_string(),
                    );
                }
            }
            "uncertain" => {
                if object.contains_key("jobId") || !valid_id(object.get("attemptId")) {
                    return Err(
                        "import recovery uncertain record must contain only a bounded attemptId"
                            .to_string(),
                    );
                }
            }
            _ => unreachable!(),
        }
    }
    Ok(())
}

#[cfg(windows)]
fn publish_temporary(
    temporary: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let mut from = temporary.as_os_str().encode_wide().collect::<Vec<_>>();
    from.push(0);
    let mut to = destination.as_os_str().encode_wide().collect::<Vec<_>>();
    to.push(0);
    unsafe {
        MoveFileExW(
            PCWSTR(from.as_ptr()),
            PCWSTR(to.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| format!("cannot publish import recovery sidecar: {error}"))
}

#[cfg(not(windows))]
fn publish_temporary(
    temporary: &std::path::Path,
    destination: &std::path::Path,
) -> Result<(), String> {
    std::fs::rename(temporary, destination)
        .map_err(|error| format!("cannot publish import recovery sidecar: {error}"))
}

#[tauri::command]
pub fn load_import_recovery() -> Result<String, String> {
    let path = recovery_path();
    match std::fs::read_to_string(path) {
        Ok(payload) => {
            validate_payload(&payload)?;
            Ok(payload)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok("[]".to_string()),
        Err(error) => Err(format!("cannot read import recovery sidecar: {error}")),
    }
}

#[tauri::command]
pub fn save_import_recovery(payload: String) -> Result<(), String> {
    validate_payload(&payload)?;
    let path = recovery_path();
    let parent = path
        .parent()
        .ok_or_else(|| "import recovery sidecar has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("cannot create import recovery directory: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, payload)
        .map_err(|error| format!("cannot write import recovery sidecar: {error}"))?;
    if let Err(error) = publish_temporary(&temporary, &path) {
        // Keep the previous snapshot intact when replacement is unavailable;
        // a failed write must never erase the only recoverable receipt.
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_payload, MAX_RECORDS};

    #[test]
    fn accepts_legacy_job_only_record_shape() {
        validate_payload(r#"[{"owner":"file-drop","jobId":"job-1","savedAt":1}]"#)
            .expect("legacy job shape should remain readable");
    }

    #[test]
    fn rejects_unbounded_or_sensitive_record_fields() {
        assert!(
            validate_payload(r#"[{"owner":"file-drop","jobId":"job-1","token":"secret"}]"#)
                .is_err()
        );
        assert!(validate_payload(&"x".repeat(128 * 1024 + 1)).is_err());
        let records = (0..=MAX_RECORDS)
            .map(|index| {
                format!("{{\"owner\":\"file-drop\",\"jobId\":\"job-{index}\",\"savedAt\":{index}}}")
            })
            .collect::<Vec<_>>()
            .join(",");
        assert!(validate_payload(&format!("[{records}]")).is_err());
    }

    #[test]
    fn rejects_invalid_owner_kind_timestamp_and_mixed_ids() {
        assert!(validate_payload(r#"[{"owner":"other","jobId":"job-1","savedAt":1}]"#).is_err());
        assert!(validate_payload(
            r#"[{"owner":"file-drop","kind":"unknown","jobId":"job-1","savedAt":1}]"#
        )
        .is_err());
        assert!(
            validate_payload(r#"[{"owner":"file-drop","jobId":"job-1","savedAt":"1"}]"#).is_err()
        );
        assert!(validate_payload(r#"[{"owner":"file-drop","kind":"job","jobId":"job-1","attemptId":"attempt-1","savedAt":1}]"#).is_err());
        assert!(validate_payload(
            r#"[{"owner":"file-drop","kind":"uncertain","attemptId":"","savedAt":1}]"#
        )
        .is_err());
    }
}
