//! Goal24 Checkpoint 4 - GitHub CLI `ExecutionBinding` implementations.
//!
//! Five read-only bindings, each a fixed hardcoded argv template. Caller
//! input can only appear as *values* in fused single argv elements
//! (`--search=<query>`, `--repo=<owner/repo>`, `--state=<state>`,
//! `--limit=<n>`); callers can never add flags, subcommands, JSON field
//! lists, hostnames or executables. No shell parsing or joining happens
//! anywhere in this module.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::execution_broker::{ExecutionBinding, OutputLimits};
use crate::github_cli::adapter::GitHubCliContext;
use crate::github_cli::inputs::{
    parse_inputs, validate_limit, validate_number, validate_owner, validate_query, validate_repo,
    IssueReadInput, IssueSearchInput, OwnerRepoInput, PrReadInput,
};
use crate::github_cli::outputs::GithubCliError;
use crate::github_cli::ADAPTER_ID;

/// The five CP4 read-only capabilities. No write capability exists here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capability {
    RepoInspect,
    IssueSearch,
    IssueRead,
    PrRead,
    PrChecksRead,
}

impl Capability {
    /// All CP4 capabilities (registration order is irrelevant to the broker).
    pub const ALL: [Capability; 5] = [
        Capability::RepoInspect,
        Capability::IssueSearch,
        Capability::IssueRead,
        Capability::PrRead,
        Capability::PrChecksRead,
    ];

    /// Stable binding identifier (separate from the capability identifier).
    pub fn binding_id(self) -> &'static str {
        match self {
            Self::RepoInspect => "github-cli.repo.inspect",
            Self::IssueSearch => "github-cli.issue.search",
            Self::IssueRead => "github-cli.issue.read",
            Self::PrRead => "github-cli.pr.read",
            Self::PrChecksRead => "github-cli.pr.checks.read",
        }
    }

    /// Semantic capability identifier matched against `ExecutionPlan`.
    pub fn capability_id(self) -> &'static str {
        match self {
            Self::RepoInspect => "github.repo.inspect",
            Self::IssueSearch => "github.issue.search",
            Self::IssueRead => "github.issue.read",
            Self::PrRead => "github.pr.read",
            Self::PrChecksRead => "github.pr.checks.read",
        }
    }

    /// Build the exact argv for this capability from validated inputs.
    /// This is the only argv construction path for the GitHub CLI adapter.
    pub fn build_argv(self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, GithubCliError> {
        match self {
            Self::RepoInspect => repo_inspect_argv(inputs),
            Self::IssueSearch => issue_search_argv(inputs),
            Self::IssueRead => issue_read_argv(inputs),
            Self::PrRead => pr_read_argv(inputs),
            Self::PrChecksRead => pr_checks_read_argv(inputs),
        }
    }
}

// ---------------------------------------------------------------------------
// Hardcoded `--json` field lists (callers can never provide these)
// ---------------------------------------------------------------------------

pub(crate) const REPO_INSPECT_FIELDS: &str =
    "nameWithOwner,description,visibility,isPrivate,isArchived,defaultBranchRef,url,viewerPermission";
pub(crate) const ISSUE_LIST_FIELDS: &str =
    "number,title,state,stateReason,url,createdAt,updatedAt,author,labels";
pub(crate) const ISSUE_VIEW_FIELDS: &str =
    "number,title,body,state,stateReason,url,author,labels,createdAt,updatedAt,closedAt";
pub(crate) const PR_READ_FIELDS: &str = "number,title,body,state,url,author,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,createdAt,updatedAt";
pub(crate) const PR_CHECKS_FIELDS: &str = "number,title,state,url,headRefName,statusCheckRollup";

// ---------------------------------------------------------------------------
// argv helpers
// ---------------------------------------------------------------------------

fn os(value: &str) -> OsString {
    OsString::from(value)
}

/// One fused argv element `--<name>=<value>`. The value can never be split
/// into additional argv elements and never becomes a shell string.
fn fused(name: &str, value: &str) -> OsString {
    os(&format!("--{name}={value}"))
}

// ---------------------------------------------------------------------------
// Per-capability argv builders
// ---------------------------------------------------------------------------

/// `gh repo view <owner/repo> --json=<hardcoded fields>`
fn repo_inspect_argv(inputs: &Map<String, Value>) -> Result<Vec<OsString>, GithubCliError> {
    let input: OwnerRepoInput = parse_inputs(inputs)?;
    let owner = validate_owner(&input.owner, "owner")?;
    let repo = validate_repo(&input.repo, "repo")?;
    Ok(vec![
        os("repo"),
        os("view"),
        os(&format!("{owner}/{repo}")),
        fused("json", REPO_INSPECT_FIELDS),
    ])
}

/// `gh issue list --repo=<owner/repo> [--search=<query>] [--state=<state>] [--limit=<n>] --json=<hardcoded fields>`
fn issue_search_argv(inputs: &Map<String, Value>) -> Result<Vec<OsString>, GithubCliError> {
    let input: IssueSearchInput = parse_inputs(inputs)?;
    let owner = validate_owner(&input.owner, "owner")?;
    let repo = validate_repo(&input.repo, "repo")?;
    if let Some(query) = &input.query {
        validate_query(query)?;
    }
    if let Some(limit) = input.limit {
        validate_limit(limit)?;
    }

    let mut argv = vec![
        os("issue"),
        os("list"),
        fused("repo", &format!("{owner}/{repo}")),
    ];
    if let Some(query) = &input.query {
        argv.push(fused("search", query));
    }
    if let Some(state) = input.state {
        argv.push(fused("state", state.as_arg()));
    }
    if let Some(limit) = input.limit {
        argv.push(fused("limit", &limit.to_string()));
    }
    argv.push(fused("json", ISSUE_LIST_FIELDS));
    Ok(argv)
}

/// `gh issue view <number> --repo=<owner/repo> --json=<hardcoded fields>`
fn issue_read_argv(inputs: &Map<String, Value>) -> Result<Vec<OsString>, GithubCliError> {
    let input: IssueReadInput = parse_inputs(inputs)?;
    let owner = validate_owner(&input.owner, "owner")?;
    let repo = validate_repo(&input.repo, "repo")?;
    validate_number(input.number, "number")?;
    Ok(vec![
        os("issue"),
        os("view"),
        os(&input.number.to_string()),
        fused("repo", &format!("{owner}/{repo}")),
        fused("json", ISSUE_VIEW_FIELDS),
    ])
}

/// `gh pr view <number> --repo=<owner/repo> --json=<hardcoded fields>`
fn pr_read_argv(inputs: &Map<String, Value>) -> Result<Vec<OsString>, GithubCliError> {
    let input: PrReadInput = parse_inputs(inputs)?;
    let owner = validate_owner(&input.owner, "owner")?;
    let repo = validate_repo(&input.repo, "repo")?;
    validate_number(input.number, "number")?;
    Ok(vec![
        os("pr"),
        os("view"),
        os(&input.number.to_string()),
        fused("repo", &format!("{owner}/{repo}")),
        fused("json", PR_READ_FIELDS),
    ])
}

/// `gh pr view <number> --repo=<owner/repo> --json=<hardcoded fields incl. statusCheckRollup>`
///
/// Checks are extracted from `statusCheckRollup` by the output parser; the
/// `gh pr checks` subcommand is deliberately not used (its non-zero
/// "pending" exit semantics would require a broker-wide change).
fn pr_checks_read_argv(inputs: &Map<String, Value>) -> Result<Vec<OsString>, GithubCliError> {
    let input: PrReadInput = parse_inputs(inputs)?;
    let owner = validate_owner(&input.owner, "owner")?;
    let repo = validate_repo(&input.repo, "repo")?;
    validate_number(input.number, "number")?;
    Ok(vec![
        os("pr"),
        os("view"),
        os(&input.number.to_string()),
        fused("repo", &format!("{owner}/{repo}")),
        fused("json", PR_CHECKS_FIELDS),
    ])
}

// ---------------------------------------------------------------------------
// ExecutionBinding implementation
// ---------------------------------------------------------------------------

/// One compiled binding: a capability plus the shared trusted context.
pub struct GithubCliBinding {
    context: Arc<GitHubCliContext>,
    capability: Capability,
}

impl GithubCliBinding {
    pub fn new(context: Arc<GitHubCliContext>, capability: Capability) -> Self {
        Self {
            context,
            capability,
        }
    }
}

impl ExecutionBinding for GithubCliBinding {
    fn binding_id(&self) -> &str {
        self.capability.binding_id()
    }

    fn adapter_id(&self) -> &str {
        ADAPTER_ID
    }

    fn capability_id(&self) -> &str {
        self.capability.capability_id()
    }

    fn executable_candidates(&self) -> &[PathBuf] {
        self.context.gh_executable_candidates()
    }

    fn build_argv(&self, inputs: &Map<String, Value>) -> Result<Vec<OsString>, String> {
        self.capability
            .build_argv(inputs)
            .map_err(|err| err.to_string())
    }

    fn allowed_cwd_roots(&self) -> &[PathBuf] {
        self.context.allowed_cwd_roots()
    }

    fn derive_cwd(&self, _inputs: &Map<String, Value>) -> Result<PathBuf, String> {
        // Inputs can never influence cwd: the adapter-owned work root wins.
        Ok(self.context.work_root().to_path_buf())
    }

    fn env_allowlist(&self) -> &[String] {
        self.context.env_allowlist()
    }

    fn output_limits(&self) -> OutputLimits {
        self.context.output_limits()
    }
}
