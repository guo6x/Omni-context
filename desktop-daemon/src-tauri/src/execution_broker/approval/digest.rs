//! Goal24 Checkpoint 7 (Integration) - canonical digests and token material.
//!
//! This module is the Rust mirror of the TypeScript
//! `brain-server/src/approval/binding.ts` canonical rules. The cross-language
//! approval binding payload is the SAME 14-field object in both languages and
//! the binding digest is SHA-256 over its canonical JSON (see
//! `docs/goal24/cp7-approval-binding-contract.json`).
//!
//! Canonicalization rules (identical to TypeScript `canonicalJson`):
//! - object keys sorted by UTF-16 code units (JavaScript `Array.sort`
//!   default), never by `serde_json` map iteration order;
//! - arrays preserve order;
//! - strings are escaped exactly like `JSON.stringify` (including U+2028 /
//!   U+2029 escapes);
//! - numbers live in a strict shared domain: finite, absolute value <=
//!   `Number.MAX_SAFE_INTEGER`, shortest fixed-point decimal form (no
//!   exponent notation), at most 6 fractional digits, negative zero
//!   canonicalizes to `0`. Anything else fails closed with
//!   `PlanRejectedInvalid` so a plan that passed the Brain builder can never
//!   digest differently here.

use sha2::{Digest, Sha256};

use crate::execution_broker::types::{BrokerError, ErrorCode, ExecutionPlanWire};

/// Shared number domain bound: `Number.MAX_SAFE_INTEGER`.
pub const MAX_CANONICAL_NUMBER_ABS: u64 = 9_007_199_254_740_991;
/// Shared maximum fractional digits in canonical fixed-point form.
pub const MAX_CANONICAL_FRACTION_DIGITS: usize = 6;
/// Shared maximum canonical number text length (mirrors the TS bound).
pub const MAX_CANONICAL_NUMBER_CHARS: usize = 24;

fn number_domain_error(reason: &str) -> BrokerError {
    BrokerError::new(
        ErrorCode::PlanRejectedInvalid,
        format!("binding number domain violation: {reason}"),
    )
}

/// Lowercase hex SHA-256 of `data`.
pub fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Secure random hex (16 bytes -> 32 hex chars) via `getrandom`.
pub fn random_hex32() -> Result<String, BrokerError> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|err| {
        BrokerError::new(
            ErrorCode::InternalError,
            format!("secure random source unavailable: {err}"),
        )
    })?;
    let mut out = String::with_capacity(32);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    Ok(out)
}

/// High-entropy, unpredictable native token reference (prefix + 32 random hex).
pub fn new_token_reference() -> Result<String, BrokerError> {
    Ok(format!("grant_{}", random_hex32()?))
}

/// Token digest: SHA-256 over secure random grant material plus the approval
/// binding digest and the token reference. The authority computes this; a
/// caller-supplied `token_digest` is never accepted into the store.
pub fn token_digest(
    grant_material: &[u8],
    approval_binding_digest: &str,
    token_reference: &str,
) -> String {
    let mut payload = Vec::with_capacity(
        grant_material.len() + approval_binding_digest.len() + token_reference.len() + 2,
    );
    payload.extend_from_slice(grant_material);
    payload.push(b'\n');
    payload.extend_from_slice(approval_binding_digest.as_bytes());
    payload.push(b'\n');
    payload.extend_from_slice(token_reference.as_bytes());
    sha256_hex(&payload)
}

/// Constant-time equality for digests and token references.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    let mut acc = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        acc |= x ^ y;
    }
    acc == 0
}

/// Escape a string exactly like JavaScript `JSON.stringify`: `"`, `\`,
/// control characters (with the `\b \t \n \f \r` shortcuts) and U+2028 /
/// U+2029.
fn js_escape_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{09}' => out.push_str("\\t"),
            '\u{0A}' => out.push_str("\\n"),
            '\u{0C}' => out.push_str("\\f"),
            '\u{0D}' => out.push_str("\\r"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            ch if (ch as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => out.push(ch),
        }
    }
    out.push('"');
    out
}

/// Compare two strings by UTF-16 code units (the JavaScript default string
/// sort used by `canonicalJson`). Byte order only agrees with this for
/// strings below U+10000, so supplementary-plane characters must use this
/// comparator to stay 1:1 with TypeScript.
fn cmp_keys_utf16(a: &str, b: &str) -> std::cmp::Ordering {
    let mut ai = a.encode_utf16();
    let mut bi = b.encode_utf16();
    loop {
        match (ai.next(), bi.next()) {
            (Some(x), Some(y)) => match x.cmp(&y) {
                std::cmp::Ordering::Equal => continue,
                other => return other,
            },
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (None, None) => return std::cmp::Ordering::Equal,
        }
    }
}

/// Parse the shortest-round-trip text produced by ryu (via
/// `serde_json::Number::to_string`) into sign + digit string + fractional
/// digit count + decimal exponent.
fn parse_shortest_float(text: &str) -> Option<(bool, String, usize, i32)> {
    let mut chars = text.chars().peekable();
    let negative = if chars.peek() == Some(&'-') {
        chars.next();
        true
    } else {
        false
    };
    let mut digits = String::new();
    let mut frac_len = 0usize;
    let mut seen_dot = false;
    for ch in chars.by_ref() {
        match ch {
            '0'..='9' => {
                digits.push(ch);
                if seen_dot {
                    frac_len += 1;
                }
            }
            '.' if !seen_dot => seen_dot = true,
            'e' | 'E' => break,
            _ => return None,
        }
    }
    let exp_text: String = chars.collect();
    let exp: i32 = if exp_text.is_empty() {
        0
    } else {
        exp_text.parse().ok()?
    };
    if digits.is_empty() {
        return None;
    }
    Some((negative, digits, frac_len, exp))
}

/// Format a shortest float into the ECMAScript `Number::toString` form
/// (which is exactly what `JSON.stringify` emits), or `None` when the form is
/// outside the canonical number domain (exponent notation).
fn format_js_number(negative: bool, mut digits: String, mut frac_len: usize, exp: i32) -> String {
    let mut lead = 0usize;
    for ch in digits.chars() {
        if ch == '0' {
            lead += 1;
        } else {
            break;
        }
    }
    if lead == digits.len() {
        return "0".to_string();
    }
    if lead > 0 {
        digits = digits[lead..].to_string();
    }
    while frac_len > 0 && digits.ends_with('0') {
        digits.pop();
        frac_len -= 1;
    }
    let k = digits.len() as i32;
    let e = exp - frac_len as i32;
    let n = e + k;
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        let n = n as usize;
        out.push_str(&digits[..n]);
        out.push('.');
        out.push_str(&digits[n..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        let exponent = n - 1;
        if exponent >= 0 {
            out.push('+');
        }
        out.push_str(&exponent.to_string());
    }
    out
}

/// Cross-language canonical number text. Mirrors the TypeScript
/// `canonicalNumberString` domain checks exactly.
pub fn canonical_number_string(number: &serde_json::Number) -> Result<String, BrokerError> {
    if let Some(value) = number.as_i64() {
        if value == i64::MIN {
            return Err(number_domain_error(
                "integer magnitude exceeds the canonical safe range",
            ));
        }
        let magnitude = value.unsigned_abs();
        if magnitude > MAX_CANONICAL_NUMBER_ABS {
            return Err(number_domain_error(
                "number must not exceed Number.MAX_SAFE_INTEGER",
            ));
        }
        let text = value.to_string();
        if text.len() > MAX_CANONICAL_NUMBER_CHARS {
            return Err(number_domain_error(
                "number representation exceeds the canonical bound",
            ));
        }
        return Ok(text);
    }
    if let Some(value) = number.as_u64() {
        if value > MAX_CANONICAL_NUMBER_ABS {
            return Err(number_domain_error(
                "number must not exceed Number.MAX_SAFE_INTEGER",
            ));
        }
        let text = value.to_string();
        if text.len() > MAX_CANONICAL_NUMBER_CHARS {
            return Err(number_domain_error(
                "number representation exceeds the canonical bound",
            ));
        }
        return Ok(text);
    }
    let value = number
        .as_f64()
        .ok_or_else(|| number_domain_error("number is not representable"))?;
    if !value.is_finite() {
        return Err(number_domain_error(
            "numbers must be finite (NaN/Infinity rejected)",
        ));
    }
    if value == 0.0 {
        return Ok("0".to_string());
    }
    if value.abs() > MAX_CANONICAL_NUMBER_ABS as f64 {
        return Err(number_domain_error(
            "number must not exceed Number.MAX_SAFE_INTEGER",
        ));
    }
    let text = number.to_string();
    let (negative, digits, frac_len, exp) = parse_shortest_float(&text)
        .ok_or_else(|| number_domain_error("number text is not parseable"))?;
    let formatted = format_js_number(negative, digits, frac_len, exp);
    if formatted.contains(['e', 'E']) {
        return Err(number_domain_error(
            "numbers must use fixed-point notation (no exponent)",
        ));
    }
    if let Some(dot) = formatted.find('.') {
        if formatted.len() - dot - 1 > MAX_CANONICAL_FRACTION_DIGITS {
            return Err(number_domain_error(
                "numbers must have at most 6 fractional digits",
            ));
        }
    }
    if formatted.len() > MAX_CANONICAL_NUMBER_CHARS {
        return Err(number_domain_error(
            "number representation exceeds the canonical bound",
        ));
    }
    Ok(formatted)
}

/// Fail-closed walk over every JSON number in a binding input value.
pub fn assert_binding_number_domain(value: &serde_json::Value) -> Result<(), BrokerError> {
    match value {
        serde_json::Value::Number(number) => {
            canonical_number_string(number)?;
            Ok(())
        }
        serde_json::Value::Array(items) => items.iter().try_for_each(assert_binding_number_domain),
        serde_json::Value::Object(map) => map.values().try_for_each(assert_binding_number_domain),
        _ => Ok(()),
    }
}

/// Canonical JSON mirroring TypeScript `canonicalJson`: key-sorted (UTF-16
/// code units), arrays in order, `JSON.stringify` string escaping, strict
/// number domain.
pub fn canonical_json(value: &serde_json::Value) -> Result<String, BrokerError> {
    match value {
        serde_json::Value::Null => Ok("null".to_string()),
        serde_json::Value::Bool(v) => Ok(if *v { "true" } else { "false" }.to_string()),
        serde_json::Value::Number(number) => canonical_number_string(number),
        serde_json::Value::String(text) => Ok(js_escape_string(text)),
        serde_json::Value::Array(items) => {
            let mut parts = Vec::with_capacity(items.len());
            for item in items {
                parts.push(canonical_json(item)?);
            }
            Ok(format!("[{}]", parts.join(",")))
        }
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| cmp_keys_utf16(a, b));
            let mut parts = Vec::with_capacity(keys.len());
            for key in keys {
                parts.push(format!(
                    "{}:{}",
                    js_escape_string(key),
                    canonical_json(&map[key])?
                ));
            }
            Ok(format!("{{{}}}", parts.join(",")))
        }
    }
}

/// SHA-256 over the canonical JSON of a semantic value (risk snapshot,
/// verification plan, rollback plan, coverage snapshot). Mirrors the TS
/// `digestJsonValue` / `coverageDigest` helpers.
fn digest_json_value(value: &serde_json::Value) -> Result<String, BrokerError> {
    let canonical = canonical_json(value)?;
    Ok(sha256_hex(canonical.as_bytes()))
}

/// Serialize a typed binding sub-structure into a JSON value.
fn to_binding_json<T: serde::Serialize>(value: &T) -> Result<serde_json::Value, BrokerError> {
    serde_json::to_value(value).map_err(|err| {
        BrokerError::new(
            ErrorCode::PlanRejectedInvalid,
            format!("binding value cannot be serialized: {err}"),
        )
    })
}

/// Build the strict 14-field cross-language `ApprovalBindingPayload` object
/// from plan semantics. Digest fields are computed here; callers can never
/// inject one. The shared number domain is validated before any hashing.
pub fn approval_binding_payload(
    plan: &ExecutionPlanWire,
    policy_version: &str,
) -> Result<serde_json::Value, BrokerError> {
    let normalized_inputs = serde_json::Value::Object(plan.normalized_inputs.clone());
    assert_binding_number_domain(&normalized_inputs)?;

    let risk = to_binding_json(&plan.risk_snapshot)?;
    assert_binding_number_domain(&risk)?;

    let evidence = to_binding_json(&plan.evidence_coverage_snapshot)?;
    assert_binding_number_domain(&evidence)?;

    let verification = match &plan.verification_plan {
        Some(value) => {
            let json = to_binding_json(value)?;
            assert_binding_number_domain(&json)?;
            json
        }
        None => serde_json::Value::Null,
    };
    let rollback = match &plan.rollback_plan {
        Some(value) => {
            let json = to_binding_json(value)?;
            assert_binding_number_domain(&json)?;
            json
        }
        None => serde_json::Value::Null,
    };

    let normalized_inputs_digest = digest_json_value(&normalized_inputs)?;
    let risk_snapshot_digest = digest_json_value(&risk)?;
    let evidence_coverage_digest = digest_json_value(&evidence)?;
    let verification_plan_digest = if verification.is_null() {
        serde_json::Value::Null
    } else {
        serde_json::Value::String(digest_json_value(&verification)?)
    };
    let rollback_plan_digest = if rollback.is_null() {
        serde_json::Value::Null
    } else {
        serde_json::Value::String(digest_json_value(&rollback)?)
    };

    Ok(serde_json::json!({
        "plan_id": plan.plan_id,
        "decision_id": plan.decision_id,
        "capability_id": plan.capability_id,
        "capability_version": plan.capability_version,
        "adapter_id": plan.adapter_id,
        "normalized_inputs_digest": normalized_inputs_digest,
        "risk_snapshot_digest": risk_snapshot_digest,
        "evidence_coverage_digest": evidence_coverage_digest,
        "timeout_ms": plan.timeout_ms,
        "verification_plan_digest": verification_plan_digest,
        "rollback_plan_digest": rollback_plan_digest,
        "created_at": plan.created_at,
        "expires_at": plan.expires_at,
        "policy_version": policy_version,
    }))
}

/// Canonical approval binding digest: SHA-256 over the canonical JSON of the
/// 14-field payload. Mutating any bound field changes the digest and
/// invalidates the grant.
pub fn approval_binding_digest(
    plan: &ExecutionPlanWire,
    policy_version: &str,
) -> Result<String, BrokerError> {
    let payload = approval_binding_payload(plan, policy_version)?;
    let canonical = canonical_json(&payload)?;
    Ok(sha256_hex(canonical.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn num(text: &str) -> serde_json::Number {
        serde_json::from_str::<serde_json::Value>(text)
            .expect("number parses")
            .as_number()
            .expect("is a number")
            .clone()
    }

    #[test]
    fn canonical_json_is_key_order_independent() {
        let a = serde_json::json!({"b": 1, "a": [true, null, "x"]});
        let b = serde_json::json!({"a": [true, null, "x"], "b": 1});
        assert_eq!(canonical_json(&a).unwrap(), canonical_json(&b).unwrap());
        assert_eq!(
            canonical_json(&a).unwrap(),
            r#"{"a":[true,null,"x"],"b":1}"#
        );
    }

    #[test]
    fn canonical_json_sorts_keys_by_utf16_code_units() {
        // U+E000 (BMP private use) sorts AFTER a surrogate-pair emoji in
        // UTF-16 code-unit order, but BEFORE it in UTF-8 byte order.
        let emoji = "\u{1F600}";
        let private = "\u{E000}";
        let value = serde_json::json!({private: 1, emoji: 2});
        let canonical = canonical_json(&value).unwrap();
        let emoji_pos = canonical.find(emoji).expect("emoji present");
        let private_pos = canonical.find(private).expect("private present");
        assert!(
            emoji_pos < private_pos,
            "UTF-16 code-unit order must put the surrogate pair first: {canonical}"
        );
    }

    #[test]
    fn canonical_json_escapes_like_json_stringify() {
        let value = serde_json::json!({"k": "a\"b\\c\n\u{2028}\u{2029}"});
        let canonical = canonical_json(&value).unwrap();
        assert!(
            canonical.contains(r#""a\"b\\c\n\u2028\u2029""#),
            "{canonical}"
        );
    }

    #[test]
    fn number_domain_accepts_canonical_subset() {
        for text in [
            "0",
            "-0",
            "1",
            "-1",
            "1.5",
            "123456789",
            "9007199254740991",
            "0.000001",
        ] {
            let value =
                serde_json::json!({"n": serde_json::from_str::<serde_json::Value>(text).unwrap()});
            assert_binding_number_domain(&value).unwrap_or_else(|err| panic!("{text}: {err:?}"));
        }
    }

    #[test]
    fn negative_zero_canonicalizes_to_zero() {
        assert_eq!(canonical_number_string(&num("-0")).unwrap(), "0");
        assert_eq!(canonical_number_string(&num("0")).unwrap(), "0");
    }

    #[test]
    fn number_domain_rejects_out_of_domain() {
        for text in [
            "9007199254740992",
            "-9007199254740992",
            "1e21",
            "1e-7",
            "0.1234567",
            "0.30000000000000004",
        ] {
            let parsed = serde_json::from_str::<serde_json::Value>(text).expect("json parses");
            let value = serde_json::json!({"n": parsed});
            assert!(
                assert_binding_number_domain(&value).is_err(),
                "must reject out-of-domain number: {text}"
            );
        }
    }

    #[test]
    fn float_formatting_matches_javascript_number_to_string() {
        // Cases verified against `String(x)` / `JSON.stringify(x)` in JS.
        for (value, expected) in [
            (0.000001f64, "0.000001"),
            (0.5f64, "0.5"),
            (1.5f64, "1.5"),
            (2.0f64, "2"),
            (20.0f64, "20"),
            (123456.789f64, "123456.789"),
            (0.1f64, "0.1"),
        ] {
            let number = serde_json::Number::from_f64(value).unwrap();
            assert_eq!(canonical_number_string(&number).unwrap(), expected);
        }
    }

    #[test]
    fn token_reference_is_unpredictable() {
        let first = new_token_reference().expect("rng");
        let second = new_token_reference().expect("rng");
        assert_ne!(first, second);
        assert!(first.starts_with("grant_"));
        assert_eq!(first.len(), "grant_".len() + 32);
    }
}
