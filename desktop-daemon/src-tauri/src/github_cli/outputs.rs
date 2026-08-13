//! Goal24 Checkpoint 4 - GitHub CLI error model and typed output parsers.
//!
//! Parsers are fail-closed: they accept only a completed
//! `BrokerExecutionResult` whose process exited 0 without timeout/cancel and
//! whose stdout is one strict JSON document. Raw stderr is never used as
//! semantic output and English stderr text is never parsed for classification.

use serde::{Deserialize, Serialize};

use crate::execution_broker::BrokerExecutionResult;

// ---------------------------------------------------------------------------
// Adapter error model
// ---------------------------------------------------------------------------

/// Machine-readable GitHub CLI adapter error codes.
// The Gh prefix is intentional: variants map 1:1 to the required
// GH_* wire codes via SCREAMING_SNAKE_CASE.
#[allow(clippy::enum_variant_names)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GithubCliErrorCode {
    GhExecutableNotReady,
    GhInputInvalid,
    GhCliFailed,
    GhJsonInvalid,
    GhOutputTruncated,
    GhAuthNotReady,
    /// Reserved for a future structured not-found probe. `gh` reports
    /// not-found as generic exit code 1, indistinguishable from other CLI
    /// failures without parsing English stderr, so no CP4 parser emits it.
    GhRepositoryNotFound,
    /// Reserved for a future structured not-found probe (see above).
    GhIssueNotFound,
    /// Reserved for a future structured not-found probe (see above).
    GhPrNotFound,
}

impl GithubCliErrorCode {
    /// Exact wire spelling of the code.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::GhExecutableNotReady => "GH_EXECUTABLE_NOT_READY",
            Self::GhInputInvalid => "GH_INPUT_INVALID",
            Self::GhCliFailed => "GH_CLI_FAILED",
            Self::GhJsonInvalid => "GH_JSON_INVALID",
            Self::GhOutputTruncated => "GH_OUTPUT_TRUNCATED",
            Self::GhAuthNotReady => "GH_AUTH_NOT_READY",
            Self::GhRepositoryNotFound => "GH_REPOSITORY_NOT_FOUND",
            Self::GhIssueNotFound => "GH_ISSUE_NOT_FOUND",
            Self::GhPrNotFound => "GH_PR_NOT_FOUND",
        }
    }
}

/// Structured adapter error. `message` is a short, non-sensitive description.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubCliError {
    pub code: GithubCliErrorCode,
    pub message: String,
}

impl GithubCliError {
    pub fn new(code: GithubCliErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for GithubCliError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for GithubCliError {}

// ---------------------------------------------------------------------------
// Fail-closed pre-parse gate
// ---------------------------------------------------------------------------

/// Classify a completed execution result before JSON parsing.
///
/// Only a result that exited 0 (`success == true`, `exit_code == Some(0)`),
/// was neither timed out nor cancelled and has untruncated stdout may reach
/// JSON parsing. `exit_code == Some(4)` is the GitHub CLI "authentication
/// required" exit; every other non-zero exit is `GH_CLI_FAILED`.
fn precheck(result: &BrokerExecutionResult) -> Result<(), GithubCliError> {
    if result.cancelled {
        return Err(GithubCliError::new(
            GithubCliErrorCode::GhCliFailed,
            "gh execution was cancelled",
        ));
    }
    if result.timed_out {
        return Err(GithubCliError::new(
            GithubCliErrorCode::GhCliFailed,
            "gh execution timed out",
        ));
    }
    if !result.success || result.exit_code != Some(0) {
        return match result.exit_code {
            Some(4) => Err(GithubCliError::new(
                GithubCliErrorCode::GhAuthNotReady,
                "gh reported authentication is required (exit code 4)",
            )),
            Some(code) => Err(GithubCliError::new(
                GithubCliErrorCode::GhCliFailed,
                format!("gh exited with code {code}"),
            )),
            None => Err(GithubCliError::new(
                GithubCliErrorCode::GhCliFailed,
                "gh did not report an exit code",
            )),
        };
    }
    if result.stdout_truncated {
        return Err(GithubCliError::new(
            GithubCliErrorCode::GhOutputTruncated,
            "gh stdout was truncated; refusing to parse partial JSON",
        ));
    }
    Ok(())
}

/// Strict JSON parse after the fail-closed gate. `serde_json::from_str`
/// rejects partial JSON and any trailing data after the document.
fn parse_json<T>(result: &BrokerExecutionResult, capability: &str) -> Result<T, GithubCliError>
where
    T: for<'de> Deserialize<'de>,
{
    precheck(result)?;
    serde_json::from_str::<T>(&result.stdout).map_err(|err| {
        GithubCliError::new(
            GithubCliErrorCode::GhJsonInvalid,
            format!("{capability} stdout is not valid JSON: {err}"),
        )
    })
}

// ---------------------------------------------------------------------------
// Typed output schemas (camelCase wire names; extra gh fields are ignored)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DefaultBranchRefOutput {
    pub name: String,
}

/// `github.repo.inspect` output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoInspectOutput {
    #[serde(rename = "nameWithOwner")]
    pub name_with_owner: String,
    #[serde(default)]
    pub description: Option<String>,
    pub visibility: String,
    #[serde(rename = "isPrivate")]
    pub is_private: bool,
    #[serde(rename = "isArchived")]
    pub is_archived: bool,
    #[serde(default, rename = "defaultBranchRef")]
    pub default_branch_ref: Option<DefaultBranchRefOutput>,
    pub url: String,
    #[serde(rename = "viewerPermission")]
    pub viewer_permission: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhAuthorOutput {
    pub login: String,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueLabelOutput {
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

/// Shared issue shape for `github.issue.search` (list) and
/// `github.issue.read` (view). View-only fields are optional.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueOutput {
    pub number: u64,
    pub title: String,
    pub state: String,
    #[serde(default, rename = "stateReason")]
    pub state_reason: Option<String>,
    pub url: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub author: GhAuthorOutput,
    #[serde(default)]
    pub labels: Vec<IssueLabelOutput>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default, rename = "closedAt")]
    pub closed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusCheckRollupOutput {
    #[serde(default)]
    pub name: Option<String>,
    pub status: String,
    #[serde(default)]
    pub conclusion: Option<String>,
    #[serde(default, rename = "detailsUrl")]
    pub details_url: Option<String>,
}

/// `github.pr.read` output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrOutput {
    pub number: u64,
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    pub state: String,
    pub url: String,
    pub author: GhAuthorOutput,
    #[serde(rename = "isDraft")]
    pub is_draft: bool,
    #[serde(rename = "baseRefName")]
    pub base_ref_name: String,
    #[serde(rename = "headRefName")]
    pub head_ref_name: String,
    #[serde(default, rename = "mergeable")]
    pub mergeable: Option<String>,
    #[serde(default, rename = "mergeStateStatus")]
    pub merge_state_status: Option<String>,
    #[serde(default, rename = "reviewDecision")]
    pub review_decision: Option<String>,
    #[serde(default, rename = "statusCheckRollup")]
    pub status_check_rollup: Option<Vec<StatusCheckRollupOutput>>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// `github.pr.checks.read` output: checks extracted from the machine-readable
/// `statusCheckRollup` of `gh pr view --json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrChecksOutput {
    pub number: u64,
    pub state: String,
    #[serde(rename = "headRefName")]
    pub head_ref_name: String,
    pub checks: Vec<StatusCheckRollupOutput>,
}

/// Minimal `gh pr view --json` shape requested by `github.pr.checks.read`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrChecksViewOutput {
    number: u64,
    state: String,
    #[serde(rename = "headRefName")]
    head_ref_name: String,
    #[serde(default, rename = "statusCheckRollup")]
    status_check_rollup: Option<Vec<StatusCheckRollupOutput>>,
}

// ---------------------------------------------------------------------------
// Capability parsers
// ---------------------------------------------------------------------------

/// `github.repo.inspect` parser.
pub fn parse_repo_inspect(
    result: &BrokerExecutionResult,
) -> Result<RepoInspectOutput, GithubCliError> {
    parse_json(result, "github.repo.inspect")
}

/// `github.issue.search` parser.
pub fn parse_issue_search(
    result: &BrokerExecutionResult,
) -> Result<Vec<IssueOutput>, GithubCliError> {
    parse_json(result, "github.issue.search")
}

/// `github.issue.read` parser.
pub fn parse_issue_read(result: &BrokerExecutionResult) -> Result<IssueOutput, GithubCliError> {
    parse_json(result, "github.issue.read")
}

/// `github.pr.read` parser.
pub fn parse_pr_read(result: &BrokerExecutionResult) -> Result<PrOutput, GithubCliError> {
    parse_json(result, "github.pr.read")
}

/// `github.pr.checks.read` parser.
///
/// Implemented via `gh pr view --json=statusCheckRollup,...` so that pending
/// checks need no broker-wide exit-semantics change (`gh pr checks` would
/// require one and is deliberately not used).
pub fn parse_pr_checks(result: &BrokerExecutionResult) -> Result<PrChecksOutput, GithubCliError> {
    let view: PrChecksViewOutput = parse_json(result, "github.pr.checks.read")?;
    Ok(PrChecksOutput {
        number: view.number,
        state: view.state,
        head_ref_name: view.head_ref_name,
        checks: view.status_check_rollup.unwrap_or_default(),
    })
}
