//! Goal24 Checkpoint 4 - strict GitHub CLI input schemas (Lane A).
//!
//! Every capability input is a `#[serde(deny_unknown_fields)]` Rust struct.
//! Callers can only provide semantic fields (owner/repo/number/query/state/
//! limit); they can never provide an executable, flags, argv, cwd or env.
//!
//! CP4 Integration aligns the validators exactly with the TypeScript runtime
//! subset and the machine-readable contract
//! (`docs/goal24/cp4-github-readonly-contract.json`): owner 1..=39 chars
//! matching `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`, repo 1..=100 chars matching
//! `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, query rejects NUL and C0 control
//! characters. No trimming: padded values are rejected, matching the Zod
//! schemas.

use serde::{Deserialize, Serialize};

use crate::github_cli::outputs::{GithubCliError, GithubCliErrorCode};

/// Maximum accepted length for an owner name (contract: 1..=39).
pub const OWNER_MAX_CHARS: usize = 39;
/// Maximum accepted length for a repository name (contract: 1..=100).
pub const REPO_MAX_CHARS: usize = 100;
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

/// Reject a name that does not match an exact ASCII pattern.
///
/// `pattern_ok` mirrors the TypeScript/Zod regexes character by character:
/// owner `[A-Za-z0-9][A-Za-z0-9-]*`, repo `[A-Za-z0-9][A-Za-z0-9._-]*`. No
/// trimming and no Unicode letters are accepted (identical to the Zod
/// subset). This automatically rejects `/`, `\`, NUL, C0 control characters,
/// whitespace, empty values and a leading dash.
fn validate_patterned_name(
    name: &str,
    field: &str,
    max_chars: usize,
    allow_repo_extras: bool,
) -> Result<String, GithubCliError> {
    let reject = |reason: &str| {
        GithubCliError::new(
            GithubCliErrorCode::GhInputInvalid,
            format!("{field} rejected: {reason}"),
        )
    };

    let mut chars = name.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphanumeric() => {}
        Some(_) => {
            return Err(reject("first character must be [A-Za-z0-9]"));
        }
        None => {
            return Err(reject("must not be empty"));
        }
    }

    for ch in chars {
        let ok = if allow_repo_extras {
            ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-'
        } else {
            ch.is_ascii_alphanumeric() || ch == '-'
        };
        if !ok {
            return Err(reject(
                "contains a forbidden character (allowed: [A-Za-z0-9] plus '.', '_', '-' for repo, '-' for owner)",
            ));
        }
    }

    if name.chars().count() > max_chars {
        return Err(reject(&format!("exceeds {max_chars} characters")));
    }
    Ok(name.to_string())
}

/// Validate an owner against the contract subset
/// `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$` (max 39 chars, no trimming).
pub fn validate_owner(name: &str, field: &str) -> Result<String, GithubCliError> {
    validate_patterned_name(name, field, OWNER_MAX_CHARS, false)
}

/// Validate a repo against the contract subset
/// `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$` (max 100 chars, no trimming).
pub fn validate_repo(name: &str, field: &str) -> Result<String, GithubCliError> {
    validate_patterned_name(name, field, REPO_MAX_CHARS, true)
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

/// Validate a search query: bounded length, NUL and C0 control characters
/// rejected. Everything else (spaces, leading dashes, shell metacharacters,
/// Unicode) stays pure data and is carried as ONE argv value.
pub fn validate_query(query: &str) -> Result<(), GithubCliError> {
    if query.chars().count() > SEARCH_QUERY_MAX_CHARS {
        return Err(GithubCliError::new(
            GithubCliErrorCode::GhInputInvalid,
            format!("query exceeds {} characters", SEARCH_QUERY_MAX_CHARS),
        ));
    }
    for ch in query.chars() {
        let code = ch as u32;
        if code <= 0x1f || code == 0x7f {
            return Err(GithubCliError::new(
                GithubCliErrorCode::GhInputInvalid,
                "query contains a NUL or C0 control character",
            ));
        }
    }
    Ok(())
}
