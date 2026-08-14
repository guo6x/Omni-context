//! Goal24 Checkpoint 8 (Lane B) - structured read-back parsing helpers.
//!
//! The Brain layer never parses arbitrary CLI stdout. Trusted
//! `ReadbackBinding`s convert bounded, redacted raw output into a structured
//! JSON-safe payload through `parse_json_payload` (strict JSON, no regex,
//! no natural-language "Success!" heuristics). Parse failures surface as
//! `parser_status=malformed`, and truncated output is upgraded to
//! `parser_status=truncated` by the runner so an incomplete payload can
//! never be reported as a complete parse.

use serde_json::Value;

use crate::execution_broker::approval::digest::{canonical_json, sha256_hex};
use crate::execution_broker::types::BrokerError;

use super::types::{ReadbackParseResult, ReadbackParserStatus, ReadbackRawOutput};

/// Strict JSON parse of a trusted binding's bounded stdout. Anything that is
/// not a single JSON document is `Malformed`.
pub fn parse_json_payload(raw: &ReadbackRawOutput) -> ReadbackParseResult {
    match serde_json::from_str::<Value>(raw.stdout.trim()) {
        Ok(value) => ReadbackParseResult {
            payload: value,
            status: ReadbackParserStatus::Parsed,
        },
        Err(_) => ReadbackParseResult {
            payload: Value::Null,
            status: ReadbackParserStatus::Malformed,
        },
    }
}

/// Final parser status after the truncation rule: truncated output can never
/// be reported as a complete parse.
pub fn final_parser_status(parsed: ReadbackParserStatus, truncated: bool) -> ReadbackParserStatus {
    if truncated {
        ReadbackParserStatus::Truncated
    } else {
        parsed
    }
}

/// SHA-256 over the canonical JSON of an observation payload.
pub fn payload_digest(payload: &Value) -> Result<String, BrokerError> {
    let canonical = canonical_json(payload)?;
    Ok(sha256_hex(canonical.as_bytes()))
}

/// Marker-delimited strict JSON extraction for trusted bindings whose child
/// runs inside the libtest harness (which prints its own banner lines).
/// Only the single line between `OMNI_READBACK_JSON_BEGIN` and
/// `OMNI_READBACK_JSON_END` is parsed; everything else is ignored. A missing
/// or repeated marker, an empty payload or a non-JSON segment is `Malformed`.
pub fn parse_marker_json(raw: &ReadbackRawOutput) -> ReadbackParseResult {
    const BEGIN: &str = "OMNI_READBACK_JSON_BEGIN";
    const END: &str = "OMNI_READBACK_JSON_END";
    let malformed = || ReadbackParseResult {
        payload: Value::Null,
        status: ReadbackParserStatus::Malformed,
    };
    let mut payload: Option<&str> = None;
    let mut lines = raw.stdout.lines();
    while let Some(line) = lines.next() {
        if line.trim() == BEGIN {
            if payload.is_some() {
                return malformed();
            }
            let Some(segment) = lines.next() else {
                return malformed();
            };
            if segment.trim() == END {
                return malformed();
            }
            match lines.next() {
                Some(next) if next.trim() == END => {}
                _ => return malformed(),
            }
            payload = Some(segment);
        }
    }
    match payload {
        Some(segment) => match serde_json::from_str::<Value>(segment.trim()) {
            Ok(value) => ReadbackParseResult {
                payload: value,
                status: ReadbackParserStatus::Parsed,
            },
            Err(_) => malformed(),
        },
        None => malformed(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_json_parse_rejects_natural_language() {
        let raw = ReadbackRawOutput {
            stdout: "Success! the merge completed".to_string(),
            stderr: String::new(),
            stdout_truncated: false,
            stderr_truncated: false,
            output_redacted: false,
        };
        let parsed = parse_json_payload(&raw);
        assert_eq!(parsed.status, ReadbackParserStatus::Malformed);
        assert_eq!(parsed.payload, Value::Null);
    }

    #[test]
    fn strict_json_parse_accepts_machine_readable_document() {
        let raw = ReadbackRawOutput {
            stdout: r#"{"value":"new","checks":[{"state":"SUCCESS"}]}"#.to_string(),
            stderr: String::new(),
            stdout_truncated: false,
            stderr_truncated: false,
            output_redacted: false,
        };
        let parsed = parse_json_payload(&raw);
        assert_eq!(parsed.status, ReadbackParserStatus::Parsed);
        assert_eq!(parsed.payload["value"], Value::String("new".to_string()));
    }

    #[test]
    fn truncated_output_never_reports_complete_parse() {
        assert_eq!(
            final_parser_status(ReadbackParserStatus::Parsed, true),
            ReadbackParserStatus::Truncated
        );
        assert_eq!(
            final_parser_status(ReadbackParserStatus::Malformed, true),
            ReadbackParserStatus::Truncated
        );
        assert_eq!(
            final_parser_status(ReadbackParserStatus::Parsed, false),
            ReadbackParserStatus::Parsed
        );
    }
}
