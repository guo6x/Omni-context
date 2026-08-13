//! Goal24 Checkpoint 4 - strict GitHub CLI input schemas (Lane A).
//!
//! Every capability input is a `#[serde(deny_unknown_fields)]` Rust struct.
//! Callers can only provide semantic fields (owner/repo/number/query/state/
//! limit); they can never provide an executable, flags, argv, cwd or env.

use serde::{Deserialize, Serialize};

use crate::github_cli::outputs::{GithubCliError, GithubCliErrorCode};

/// Maximum accepted length for an owner or repository name (safety subset).
pub const OWNER_REPO_MAX_CHARS: usize = 100;
/// Maximum accepted length for an issue search query (pure data value).
pub const SEARCH_QUERY_MAX_CHARS: usize = 1024;
/// `gh issue list` default limit we rely on when the caller omits `limit`.
pub const SEARCH_LIMIT_DEFAULT: u64 = 30;
/// Inclusive lower bound for an explicit `limit`.
pub const SEARCH_LIMIT_MIN: u64 = 1;
/// Inclusive upper bound for an explicit `limit`.
pub const SEARCH_LIMIT_MAX: u64 = 100;

/// Shared owner/repo fields for all five capabilities.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerRepoInput {
    pub owner: String,
    pub repo: String,
}

/// `github.issue.search` - optional `state` (gh enum, lowercase wire names).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IssueStateInput {
    Open,
    Closed,
    All,
}

impl IssueStateInput {
    /// `gh issue list --state=<value>` argument value.
    pub fn as_arg(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
            Self::All => "all",
        }
    }
}

/// `github.issue.search`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IssueSearchInput {
    pub owner: String,
    pub repo: String,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub state: Option<IssueStateInput>,
    #[serde(default)]
    pub limit: Option<u64>,
}

/// `github.issue.read`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IssueReadInput {
    pub owner: String,
    pub repo: String,
    pub number: u64,
}

/// `github.pr.read` and `github.pr.checks.read`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrReadInput {
    pub owner: String,
    pub repo: String,
    pub number: u64,
}

/// Parse a strict input struct from broker `normalized_inputs`.
///
/// Unknown keys, missing required keys and wrong JSON types all fail with
/// `GH_INPUT_INVALID`; nothing is coerced or defaulted except the explicitly
/// `#[serde(default)]` optional fields.
pub fn parse_inputs<T>(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<T, GithubCliError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(serde_json::Value::Object(map.clone())).map_err(|err| {
        GithubCliError::new(
            GithubCliErrorCode::GhInputInvalid,
            format!("input validation failed: {err}"),
        )
    })
}

/// Validate an owner or repo name against the CP4 safety subset.
///
/// The name is trimmed, must be non-empty, at most 100 characters, must not
/// equal `.` or `..`, must not start with `-` and must contain no control
/// characters, whitespace, `/` or `\`. This is a deliberately small subset of
/// GitHub's full naming rules; anything outside it is unsupported in CP4.
pub fn validate_owner_repo(name: &str, field: &str) -> Result<String, GithubCliError> {
    let trimmed = name.trim();
    let reject = |reason: &str| {
        GithubCliError::new(
            GithubCliErrorCode::GhInputInvalid,
            format!("{field} rejected: {reason}"),
        )
    };

    if trimmed.is_empty() {
        return Err(reject("must not be empty"));
    }
    if trimmed.chars().count() > OWNER_REPO_MAX_CHARS {
        return Err(reject("exceeds 100 characters"));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(reject("'.' and '..' are not valid names"));
    }
    if trimmed.starts_with('-') {
        return Err(reject("must not start with '-'"));
    }
    for ch in trimmed.chars() {
        if ch.is_control() || ch.is_whitespace() || ch == '/' || ch == '\\' {
            return Err(reject(
                "contains a forbidden character (control, whitespace, '/' or '\\')",
            ));
        }
    }
    Ok(trimmed.to_string())
}

/// Validate a positive issue/PR number.
pub fn validate_number(number: u64, field: &str) -> Result<u64, GithubCliError> {
    if number == 0 {
        return Err(GithubCliError::new(
            GithubCliErrorCode::GhInputInvalid,
            format!("{field} must be a positive integer"),
        ));
    }
    Ok(number)
}

/// Validate an explicit search limit (`1..=100`).
pub fn validate_limit(limit: u64) -> Result<u64, GithubCliError> {
    if !(SEARCH_LIMIT_MIN..=SEARCH_LIMIT_MAX).contains(&limit) {
        return Err(GithubCliError::new(
            GithubCliErrorCode::GhInputInvalid,
            format!(
                "limit must be within {}..={}",
                SEARCH_LIMIT_MIN, SEARCH_LIMIT_MAX
            ),
        ));
    }
    Ok(limit)
}

/// Validate a search query: bounded length, and only NUL is rejected so that
/// everything else (spaces, CR/LF, leading dashes, Unicode) stays pure data.
pub fn validate_query(query: &str) -> Result<(), GithubCliError> {
    if query.chars().count() > SEARCH_QUERY_MAX_CHARS {
        return Err(GithubCliError::new(
            GithubCliErrorCode::GhInputInvalid,
            format!("query exceeds {} characters", SEARCH_QUERY_MAX_CHARS),
        ));
    }
    if query.contains('\u{0}') {
        return Err(GithubCliError::new(
            GithubCliErrorCode::GhInputInvalid,
            "query contains a NUL byte",
        ));
    }
    Ok(())
}
