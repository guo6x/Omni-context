//! Goal24 Checkpoint 4 - GitHub CLI adapter tests (pure; no process spawn,
//! no network, no remote state changes).
//!
//! Coverage: strict input rejection, one-value query/argv safety, exact argv
//! snapshots for all five capabilities, fail-closed output parsers,
//! filesystem discovery rules and adapter/binding metadata. Every process
//! interaction goes through the frozen CP3 broker; nothing here spawns
//! `gh` or any other process.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Map, Value};

use crate::execution_broker::{
    build_child_env, validate_cwd, Broker, BrokerExecutionResult, ExecutionBinding,
    ExecutionPlanWire, BASE_ENV_VARS, DEFAULT_OUTPUT_MAX_BYTES,
};
use crate::github_cli::adapter::{GitHubCliAdapter, GitHubCliContext, GH_ENV_ALLOWLIST};
use crate::github_cli::bindings::{
    Capability, GithubCliBinding, ISSUE_LIST_FIELDS, ISSUE_VIEW_FIELDS, PR_CHECKS_FIELDS,
    PR_READ_FIELDS, REPO_INSPECT_FIELDS,
};
use crate::github_cli::discovery::{
    discover, path_discovery_candidates_from, standard_install_candidates, validate_trusted_gh,
    DiscoverySource,
};
use crate::github_cli::inputs::{
    parse_inputs, validate_owner, validate_repo, OwnerRepoInput, OWNER_MAX_CHARS, REPO_MAX_CHARS,
    SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, SEARCH_LIMIT_MIN, SEARCH_QUERY_MAX_CHARS,
};
use crate::github_cli::outputs::{
    parse_issue_read, parse_issue_search, parse_pr_checks, parse_pr_read, parse_repo_inspect,
    GithubCliError, GithubCliErrorCode, RepoInspectOutput,
};
use crate::github_cli::ADAPTER_ID;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn map_of(pairs: &[(&str, Value)]) -> Map<String, Value> {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_string(), value.clone()))
        .collect()
}

fn owner_repo_map() -> Map<String, Value> {
    map_of(&[("owner", json!("octocat")), ("repo", json!("Hello-World"))])
}

fn argv_for(capability: Capability, inputs: &Map<String, Value>) -> Vec<String> {
    capability
        .build_argv(inputs)
        .unwrap()
        .into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

fn assert_input_err(capability: Capability, inputs: &Map<String, Value>) {
    let err = capability.build_argv(inputs).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhInputInvalid, "{err}");
}

fn expected_args(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_string()).collect()
}

fn assert_only_known_flags(argv: &[String]) {
    assert!(
        argv[0] == "repo" || argv[0] == "issue" || argv[0] == "pr",
        "first argv element must be a gh subcommand token, got {:?}",
        argv[0]
    );
    for arg in argv.iter().skip(1) {
        if arg.starts_with("--") {
            assert!(
                arg.starts_with("--json=")
                    || arg.starts_with("--repo=")
                    || arg.starts_with("--search=")
                    || arg.starts_with("--state=")
                    || arg.starts_with("--limit="),
                "unexpected flag element {arg:?} in {argv:?}"
            );
        }
    }
}

fn exec_result(stdout: &str, exit_code: i32) -> BrokerExecutionResult {
    BrokerExecutionResult {
        execution_id: "execution-1".to_string(),
        plan_id: "plan-12345678".to_string(),
        capability_id: "github.repo.inspect".to_string(),
        adapter_id: "github-cli".to_string(),
        started_at: "2026-08-13T00:00:00Z".to_string(),
        finished_at: "2026-08-13T00:00:01Z".to_string(),
        duration_ms: 1000,
        resolved_executable: "C:\\Program Files\\GitHub CLI\\gh.exe".to_string(),
        executable_fingerprint: "size=1;mtime=1".to_string(),
        exit_code: Some(exit_code),
        success: exit_code == 0,
        timed_out: false,
        cancelled: false,
        stdout: stdout.to_string(),
        stderr: String::new(),
        stdout_truncated: false,
        stderr_truncated: false,
        stdout_bytes_seen: stdout.len() as u64,
        stderr_bytes_seen: 0,
        output_redacted: false,
        error_code: None,
        error_message: None,
    }
}

fn timed_out_result(stdout: &str) -> BrokerExecutionResult {
    let mut result = exec_result(stdout, 0);
    result.timed_out = true;
    result.success = false;
    result
}

fn cancelled_result(stdout: &str) -> BrokerExecutionResult {
    let mut result = exec_result(stdout, 0);
    result.cancelled = true;
    result.success = false;
    result
}

fn truncated_result(stdout: &str) -> BrokerExecutionResult {
    let mut result = exec_result(stdout, 0);
    result.stdout_truncated = true;
    result
}

fn test_work_root(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "omni-context-gh-test-{}-{}",
        std::process::id(),
        name
    ))
}

const REPO_JSON: &str = r#"{
  "nameWithOwner": "octocat/Hello-World",
  "description": "My first repository",
  "visibility": "PUBLIC",
  "isPrivate": false,
  "isArchived": false,
  "defaultBranchRef": {"name": "main"},
  "url": "https://github.com/octocat/Hello-World",
  "viewerPermission": "READ"
}"#;

// ---------------------------------------------------------------------------
// A. Strict input model
// ---------------------------------------------------------------------------

#[test]
fn input_unknown_keys_are_rejected() {
    for key in [
        "ghPath",
        "executable",
        "command",
        "shell",
        "argv",
        "cwd",
        "env",
        "json",
        "jq",
        "template",
    ] {
        let mut map = owner_repo_map();
        map.insert(key.to_string(), json!("C:\\evil\\gh.exe"));
        let err = parse_inputs::<OwnerRepoInput>(&map).unwrap_err();
        assert_eq!(err.code, GithubCliErrorCode::GhInputInvalid, "key {key}");
    }
}

#[test]
fn input_missing_required_keys_are_rejected() {
    let missing_owner = map_of(&[("repo", json!("Hello-World"))]);
    assert_input_err(Capability::RepoInspect, &missing_owner);
    let missing_repo = map_of(&[("owner", json!("octocat"))]);
    assert_input_err(Capability::RepoInspect, &missing_repo);
}

#[test]
fn owner_repo_forbidden_values_are_rejected() {
    let long_owner = "x".repeat(40);
    let long_repo = "x".repeat(101);
    let owner_bad = [
        "",
        "   ",
        ".",
        "..",
        "-octocat",
        "_octocat",
        ".octocat",
        " octocat",
        "octocat ",
        "octo/cat",
        "octo\\cat",
        "octo cat",
        "octo\tcat",
        "octo\u{7}cat",
        "octo\u{0}cat",
        "octo\r\ncat",
        long_owner.as_str(),
    ];
    let repo_bad = [
        "",
        "   ",
        ".",
        "..",
        "-octocat",
        "_octocat",
        ".octocat",
        " octocat",
        "octocat ",
        "octo/cat",
        "octo\\cat",
        "octo cat",
        "octo\tcat",
        "octo\u{7}cat",
        "octo\u{0}cat",
        "octo\r\ncat",
        long_repo.as_str(),
    ];
    for bad in &owner_bad {
        assert!(
            validate_owner(bad, "owner").is_err(),
            "owner should reject {bad:?}"
        );
    }
    for bad in &repo_bad {
        assert!(
            validate_repo(bad, "repo").is_err(),
            "repo should reject {bad:?}"
        );
    }
}

#[test]
fn owner_repo_valid_names_are_accepted_verbatim_and_bounded() {
    assert_eq!(validate_owner("octocat", "owner").unwrap(), "octocat");
    assert_eq!(validate_owner("9to5", "owner").unwrap(), "9to5");
    assert_eq!(validate_owner(&"a".repeat(39), "owner").unwrap().len(), 39);
    assert_eq!(validate_repo("Hello-World", "repo").unwrap(), "Hello-World");
    assert_eq!(
        validate_repo("repo.with_dots-1", "repo").unwrap(),
        "repo.with_dots-1"
    );
    assert_eq!(validate_repo(&"a".repeat(100), "repo").unwrap().len(), 100);

    assert!(validate_owner(&"a".repeat(40), "owner").is_err());
    assert!(validate_repo(&"a".repeat(101), "repo").is_err());

    // Padded values are rejected, not trimmed (Zod/contract parity).
    let map = map_of(&[
        ("owner", json!(" octocat ")),
        ("repo", json!(" Hello-World ")),
    ]);
    assert_input_err(Capability::RepoInspect, &map);
}

#[test]
fn issue_search_query_rejects_nul_and_c0_controls() {
    for bad in [
        "a\u{0}b", "a\u{1}b", "a\u{7}b", "a\u{1f}b", "a\u{7f}b", "a\tb", "a\nb", "a\rb",
    ] {
        let mut map = owner_repo_map();
        map.insert("query".to_string(), json!(bad));
        assert_input_err(Capability::IssueSearch, &map);
    }
    for ok in [
        "-label:bug",
        "foo bar",
        "--web",
        "--repo=evil",
        "; calc.exe",
        "| whoami",
    ] {
        let mut map = owner_repo_map();
        map.insert("query".to_string(), json!(ok));
        let argv = argv_for(Capability::IssueSearch, &map);
        assert!(
            argv.iter().any(|arg| arg == &format!("--search={ok}")),
            "query {ok:?} must stay one fused argv value: {argv:?}"
        );
    }
}
#[test]
fn issue_and_pr_number_zero_is_rejected() {
    let mut map = owner_repo_map();
    map.insert("number".to_string(), json!(0));
    assert_input_err(Capability::IssueRead, &map);
    assert_input_err(Capability::PrRead, &map);
    assert_input_err(Capability::PrChecksRead, &map);
}

#[test]
fn issue_and_pr_negative_or_non_integer_number_is_rejected() {
    for bad in [json!(-1), json!(1.5), json!("42"), json!(null)] {
        let mut map = owner_repo_map();
        map.insert("number".to_string(), bad.clone());
        assert_input_err(Capability::IssueRead, &map);
        assert_input_err(Capability::PrRead, &map);
    }
}

#[test]
fn issue_search_limit_zero_and_101_are_rejected() {
    for limit in [0u64, 101] {
        let mut map = owner_repo_map();
        map.insert("limit".to_string(), json!(limit));
        assert_input_err(Capability::IssueSearch, &map);
    }
}

#[test]
fn issue_search_limit_bounds_are_accepted() {
    for limit in [1u64, 100] {
        let mut map = owner_repo_map();
        map.insert("limit".to_string(), json!(limit));
        let argv = argv_for(Capability::IssueSearch, &map);
        assert!(argv.contains(&format!("--limit={limit}")), "{argv:?}");
    }
}

#[test]
fn issue_search_state_enum_is_strict() {
    let mut bad_state = owner_repo_map();
    bad_state.insert("state".to_string(), json!("OPEN"));
    assert_input_err(Capability::IssueSearch, &bad_state);

    for state in ["open", "closed", "all"] {
        let mut map = owner_repo_map();
        map.insert("state".to_string(), json!(state));
        let argv = argv_for(Capability::IssueSearch, &map);
        assert!(argv.contains(&format!("--state={state}")), "{argv:?}");
    }
}

#[test]
fn issue_search_query_too_long_is_rejected() {
    let mut map = owner_repo_map();
    map.insert("query".to_string(), json!("x".repeat(1025)));
    assert_input_err(Capability::IssueSearch, &map);
}

#[test]
fn issue_search_query_nul_is_rejected() {
    let mut map = owner_repo_map();
    map.insert("query".to_string(), json!("is:open\u{0}label:bug"));
    assert_input_err(Capability::IssueSearch, &map);
}

// ---------------------------------------------------------------------------
// B. Query and flag safety (everything stays one argv VALUE)
// ---------------------------------------------------------------------------

#[test]
fn issue_search_query_is_always_one_argv_value() {
    let cases = [
        "is:open label:bug",
        "-label:bug",
        "--web",
        "--repo evil",
        "; calc.exe",
        "| whoami",
        "\u{6807}\u{7b7e}:\u{6587}\u{6863} \u{1f600}",
    ];
    for query in cases {
        let mut map = owner_repo_map();
        map.insert("query".to_string(), json!(query));
        let argv = argv_for(Capability::IssueSearch, &map);
        assert!(
            argv.contains(&format!("--search={query}")),
            "query {query:?} must remain one value in {argv:?}"
        );
        assert!(!argv.contains(&"--web".to_string()), "{argv:?}");
        assert!(!argv.contains(&"--repo evil".to_string()), "{argv:?}");
        assert_only_known_flags(&argv);
    }
}

#[test]
fn adversarial_query_never_becomes_flags_or_commands() {
    let queries = [
        "--web",
        "--jq=.title",
        "--template={{.title}}",
        "--hostname evil.example.com",
        "-R other/evil",
        "; calc.exe",
        "| whoami",
        "&& del C:\\Windows",
        "$(whoami)",
        "`cmd /C calc`",
        "\u{7a7a}\u{683c} \u{67e5}\u{8be2}",
        "\u{65e5}\u{672c}\u{8a9e}\u{30af}\u{30a8}\u{30ea} \u{1f600}",
    ];
    for query in queries {
        let mut map = owner_repo_map();
        map.insert("query".to_string(), json!(query));
        let argv = argv_for(Capability::IssueSearch, &map);
        assert!(
            argv.contains(&format!("--search={query}")),
            "{query:?} must stay one data value in {argv:?}"
        );
        assert_only_known_flags(&argv);
        assert_eq!(argv.len(), 5, "issue list --repo --search --json");
    }
}

// ---------------------------------------------------------------------------
// C. Exact argv snapshots (all five capabilities)
// ---------------------------------------------------------------------------

#[test]
fn repo_inspect_argv_snapshot() {
    let argv = argv_for(Capability::RepoInspect, &owner_repo_map());
    let mut expected = expected_args(&["repo", "view", "octocat/Hello-World"]);
    expected.push(format!("--json={REPO_INSPECT_FIELDS}"));
    assert_eq!(argv, expected);
    assert_only_known_flags(&argv);
}

#[test]
fn issue_search_argv_snapshot_with_all_options() {
    let mut map = owner_repo_map();
    map.insert("query".to_string(), json!("is:open label:bug"));
    map.insert("state".to_string(), json!("open"));
    map.insert("limit".to_string(), json!(42));
    let argv = argv_for(Capability::IssueSearch, &map);
    let mut expected = expected_args(&[
        "issue",
        "list",
        "--repo=octocat/Hello-World",
        "--search=is:open label:bug",
        "--state=open",
        "--limit=42",
    ]);
    expected.push(format!("--json={ISSUE_LIST_FIELDS}"));
    assert_eq!(argv, expected);
    assert_only_known_flags(&argv);
}

#[test]
fn issue_search_argv_snapshot_with_defaults() {
    let argv = argv_for(Capability::IssueSearch, &owner_repo_map());
    // Omitting `limit` relies on gh's own default (30), documented here.
    let mut expected = expected_args(&["issue", "list", "--repo=octocat/Hello-World"]);
    expected.push(format!("--json={ISSUE_LIST_FIELDS}"));
    assert_eq!(argv, expected);
    assert!(!argv.iter().any(|arg| arg.starts_with("--limit=")));
    assert_eq!(SEARCH_LIMIT_DEFAULT, 30);
    assert_only_known_flags(&argv);
}

#[test]
fn issue_read_argv_snapshot() {
    let mut map = owner_repo_map();
    map.insert("number".to_string(), json!(42));
    let argv = argv_for(Capability::IssueRead, &map);
    let mut expected = expected_args(&["issue", "view", "42", "--repo=octocat/Hello-World"]);
    expected.push(format!("--json={ISSUE_VIEW_FIELDS}"));
    assert_eq!(argv, expected);
    assert_only_known_flags(&argv);
}

#[test]
fn pr_read_argv_snapshot() {
    let mut map = owner_repo_map();
    map.insert("number".to_string(), json!(42));
    let argv = argv_for(Capability::PrRead, &map);
    let mut expected = expected_args(&["pr", "view", "42", "--repo=octocat/Hello-World"]);
    expected.push(format!("--json={PR_READ_FIELDS}"));
    assert_eq!(argv, expected);
    assert_only_known_flags(&argv);
}

#[test]
fn pr_checks_read_argv_snapshot() {
    let mut map = owner_repo_map();
    map.insert("number".to_string(), json!(42));
    let argv = argv_for(Capability::PrChecksRead, &map);
    let mut expected = expected_args(&["pr", "view", "42", "--repo=octocat/Hello-World"]);
    expected.push(format!("--json={PR_CHECKS_FIELDS}"));
    assert_eq!(argv, expected);
    assert_only_known_flags(&argv);
    assert!(argv.iter().any(|arg| arg.contains("statusCheckRollup")));
    assert!(
        !argv.iter().any(|arg| arg == "checks"),
        "must not use `gh pr checks`"
    );
}

#[test]
fn json_field_lists_never_contain_caller_flags() {
    for fields in [
        REPO_INSPECT_FIELDS,
        ISSUE_LIST_FIELDS,
        ISSUE_VIEW_FIELDS,
        PR_READ_FIELDS,
        PR_CHECKS_FIELDS,
    ] {
        assert!(!fields.contains("--web"), "{fields}");
        assert!(!fields.contains("--jq"), "{fields}");
        assert!(!fields.contains("--template"), "{fields}");
    }
}

// ---------------------------------------------------------------------------
// D. Fail-closed output parsers
// ---------------------------------------------------------------------------

#[test]
fn repo_inspect_parser_accepts_valid_json() {
    let parsed: RepoInspectOutput = parse_repo_inspect(&exec_result(REPO_JSON, 0)).unwrap();
    assert_eq!(parsed.name_with_owner, "octocat/Hello-World");
    assert_eq!(parsed.description.as_deref(), Some("My first repository"));
    assert_eq!(parsed.visibility, "PUBLIC");
    assert!(!parsed.is_private);
    assert!(!parsed.is_archived);
    assert_eq!(parsed.default_branch_ref.as_ref().unwrap().name, "main");
    assert_eq!(parsed.url, "https://github.com/octocat/Hello-World");
    assert_eq!(parsed.viewer_permission, "READ");
}

#[test]
fn repo_inspect_parser_tolerates_null_description_and_missing_branch() {
    let json = r#"{
      "nameWithOwner": "octocat/Hello-World",
      "description": null,
      "visibility": "PUBLIC",
      "isPrivate": false,
      "isArchived": true,
      "url": "https://github.com/octocat/Hello-World",
      "viewerPermission": "READ",
      "stargazerCount": 42
    }"#;
    let parsed = parse_repo_inspect(&exec_result(json, 0)).unwrap();
    assert!(parsed.description.is_none());
    assert!(parsed.default_branch_ref.is_none());
    assert!(parsed.is_archived);
}

#[test]
fn issue_search_parser_accepts_valid_list_json() {
    let json = r#"[
      {
        "number": 1,
        "title": "Found a bug",
        "state": "OPEN",
        "stateReason": "REOPENED",
        "url": "https://github.com/octocat/Hello-World/issues/1",
        "createdAt": "2026-01-01T00:00:00Z",
        "updatedAt": "2026-01-02T00:00:00Z",
        "author": {"login": "octocat"},
        "labels": [{"name": "bug", "color": "d73a4a"}]
      }
    ]"#;
    let parsed = parse_issue_search(&exec_result(json, 0)).unwrap();
    assert_eq!(parsed.len(), 1);
    let issue = &parsed[0];
    assert_eq!(issue.number, 1);
    assert_eq!(issue.title, "Found a bug");
    assert_eq!(issue.state, "OPEN");
    assert_eq!(issue.state_reason.as_deref(), Some("REOPENED"));
    assert_eq!(issue.author.login, "octocat");
    assert_eq!(issue.labels.len(), 1);
    assert_eq!(issue.labels[0].name, "bug");
    assert!(issue.body.is_none());
}

#[test]
fn issue_read_parser_accepts_valid_view_json() {
    let json = r#"{
      "number": 1,
      "title": "Found a bug",
      "body": "details",
      "state": "OPEN",
      "stateReason": "",
      "url": "https://github.com/octocat/Hello-World/issues/1",
      "author": {"login": "octocat"},
      "labels": [],
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-02T00:00:00Z",
      "closedAt": null
    }"#;
    let parsed = parse_issue_read(&exec_result(json, 0)).unwrap();
    assert_eq!(parsed.number, 1);
    assert_eq!(parsed.body.as_deref(), Some("details"));
    assert_eq!(parsed.state_reason.as_deref(), Some(""));
    assert!(parsed.closed_at.is_none());
}

#[test]
fn pr_read_parser_accepts_valid_pr_json() {
    let json = r#"{
      "number": 1,
      "title": "Add feature",
      "body": "",
      "state": "OPEN",
      "url": "https://github.com/octocat/Hello-World/pull/1",
      "author": {"login": "octocat"},
      "isDraft": false,
      "baseRefName": "main",
      "headRefName": "feature",
      "mergeable": "MERGEABLE",
      "mergeStateStatus": "CLEAN",
      "reviewDecision": "APPROVED",
      "statusCheckRollup": [
        {"name": "CI", "status": "COMPLETED", "conclusion": "SUCCESS", "detailsUrl": "https://ci.example/1"}
      ],
      "createdAt": "2026-01-01T00:00:00Z",
      "updatedAt": "2026-01-02T00:00:00Z"
    }"#;
    let parsed = parse_pr_read(&exec_result(json, 0)).unwrap();
    assert_eq!(parsed.number, 1);
    assert!(!parsed.is_draft);
    assert_eq!(parsed.base_ref_name, "main");
    assert_eq!(parsed.head_ref_name, "feature");
    assert_eq!(parsed.mergeable.as_deref(), Some("MERGEABLE"));
    assert_eq!(parsed.review_decision.as_deref(), Some("APPROVED"));
    let checks = parsed.status_check_rollup.as_ref().unwrap();
    assert_eq!(checks.len(), 1);
    assert_eq!(checks[0].name.as_deref(), Some("CI"));
    assert_eq!(checks[0].conclusion.as_deref(), Some("SUCCESS"));
}

#[test]
fn pr_checks_parser_extracts_status_check_rollup() {
    let json = r#"{
      "number": 1,
      "title": "Add feature",
      "state": "OPEN",
      "url": "https://github.com/octocat/Hello-World/pull/1",
      "headRefName": "feature",
      "statusCheckRollup": [
        {"name": "CI", "status": "COMPLETED", "conclusion": "SUCCESS"}
      ]
    }"#;
    let parsed = parse_pr_checks(&exec_result(json, 0)).unwrap();
    assert_eq!(parsed.number, 1);
    assert_eq!(parsed.state, "OPEN");
    assert_eq!(parsed.head_ref_name, "feature");
    assert_eq!(parsed.checks.len(), 1);
    assert_eq!(parsed.checks[0].name.as_deref(), Some("CI"));
    assert_eq!(parsed.checks[0].status, "COMPLETED");
}

#[test]
fn pr_checks_parser_tolerates_null_rollup() {
    let json = r#"{
      "number": 1,
      "title": "Add feature",
      "state": "OPEN",
      "url": "https://github.com/octocat/Hello-World/pull/1",
      "headRefName": "feature",
      "statusCheckRollup": null
    }"#;
    let parsed = parse_pr_checks(&exec_result(json, 0)).unwrap();
    assert!(parsed.checks.is_empty());
}

#[test]
fn parser_rejects_invalid_json() {
    let err = parse_repo_inspect(&exec_result("{not json", 0)).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhJsonInvalid);
}

#[test]
fn parser_rejects_truncated_json() {
    let err = parse_repo_inspect(&exec_result("{\"nameWithOwner\":\"octocat", 0)).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhJsonInvalid);
}

#[test]
fn parser_rejects_trailing_garbage_after_json() {
    let err = parse_repo_inspect(&exec_result("{} extra", 0)).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhJsonInvalid);
}

#[test]
fn parser_rejects_missing_required_field() {
    let json = r#"{"nameWithOwner": "octocat/Hello-World", "visibility": "PUBLIC", "isPrivate": false, "isArchived": false, "viewerPermission": "READ"}"#;
    let err = parse_repo_inspect(&exec_result(json, 0)).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhJsonInvalid);
}

#[test]
fn parser_rejects_nonzero_exit() {
    let err = parse_repo_inspect(&exec_result("", 1)).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhCliFailed);
}

#[test]
fn parser_classifies_exit_4_as_auth_not_ready() {
    let err = parse_repo_inspect(&exec_result("", 4)).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhAuthNotReady);
}

#[test]
fn parser_rejects_timed_out_result() {
    let err = parse_repo_inspect(&timed_out_result(REPO_JSON)).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhCliFailed);
}

#[test]
fn parser_rejects_cancelled_result() {
    let err = parse_repo_inspect(&cancelled_result(REPO_JSON)).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhCliFailed);
}

#[test]
fn parser_rejects_truncated_stdout_flag() {
    let err = parse_repo_inspect(&truncated_result(REPO_JSON)).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhOutputTruncated);
}

#[test]
fn parser_never_treats_stderr_as_semantics() {
    let mut result = exec_result(REPO_JSON, 0);
    result.stderr = "GraphQL error: could not resolve to a Repository".to_string();
    let parsed = parse_repo_inspect(&result).unwrap();
    assert_eq!(parsed.name_with_owner, "octocat/Hello-World");
}

#[test]
fn reserved_not_found_codes_are_declared_but_never_emitted() {
    // gh reports not-found as generic exit code 1; these codes are reserved
    // for a future structured probe and no CP4 parser emits them.
    assert_eq!(
        GithubCliErrorCode::GhRepositoryNotFound.as_str(),
        "GH_REPOSITORY_NOT_FOUND"
    );
    assert_eq!(
        GithubCliErrorCode::GhIssueNotFound.as_str(),
        "GH_ISSUE_NOT_FOUND"
    );
    assert_eq!(GithubCliErrorCode::GhPrNotFound.as_str(), "GH_PR_NOT_FOUND");
}

// ---------------------------------------------------------------------------
// E. Discovery rules
// ---------------------------------------------------------------------------

#[test]
fn discovery_rejects_bare_gh_name() {
    let err = validate_trusted_gh(std::path::Path::new("gh")).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhExecutableNotReady);
}

#[test]
fn discovery_rejects_missing_file() {
    let missing = std::env::temp_dir().join("omni-gh-missing-7f3a-absent.exe");
    let err = validate_trusted_gh(&missing).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhExecutableNotReady);
}

#[cfg(windows)]
#[test]
fn discovery_rejects_non_exe_extensions() {
    for name in ["gh.cmd", "gh.bat", "gh.ps1", "gh"] {
        let path = std::env::temp_dir().join(format!("omni-gh-discovery-{name}"));
        std::fs::write(&path, b"placeholder").unwrap();
        let result = validate_trusted_gh(&path);
        let _ = std::fs::remove_file(&path);
        let err = result.unwrap_err();
        assert_eq!(err.code, GithubCliErrorCode::GhExecutableNotReady, "{name}");
    }
}

#[cfg(windows)]
#[test]
fn discovery_accepts_exe_extension_regular_file() {
    let path = std::env::temp_dir().join("omni-gh-discovery-ok.exe");
    std::fs::write(&path, b"placeholder").unwrap();
    let result = validate_trusted_gh(&path);
    let _ = std::fs::remove_file(&path);
    let canonical = result.unwrap();
    assert!(canonical.is_absolute());
    assert_eq!(
        canonical
            .extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase),
        Some("exe".to_string())
    );
}

#[test]
fn path_discovery_only_produces_absolute_gh_exe_candidates() {
    let candidates = path_discovery_candidates_from("C:\\Tools;relative\\bin;D:\\env\\bin;");
    assert_eq!(candidates.len(), 2);
    for candidate in &candidates {
        assert!(candidate.is_absolute(), "{candidate:?}");
        assert_eq!(
            candidate.file_name().and_then(|name| name.to_str()),
            Some("gh.exe"),
            "{candidate:?}"
        );
    }
}

#[test]
fn standard_install_candidates_are_absolute_gh_exe_paths() {
    for candidate in standard_install_candidates() {
        assert!(candidate.is_absolute(), "{candidate:?}");
        assert_eq!(
            candidate.file_name().and_then(|name| name.to_str()),
            Some("gh.exe"),
            "{candidate:?}"
        );
    }
}

#[test]
fn discovery_ordering_prefers_bootstrap_then_standard_then_path() {
    let bootstrap = [std::env::temp_dir().join("boot").join("gh.exe")];
    let candidates = discover(&bootstrap);
    let sources: Vec<DiscoverySource> = candidates
        .iter()
        .map(|candidate| candidate.source)
        .collect();

    let first_path = sources
        .iter()
        .position(|source| *source == DiscoverySource::PathDiscovery);
    let last_standard = sources
        .iter()
        .rposition(|source| *source == DiscoverySource::StandardInstall);
    let last_bootstrap = sources
        .iter()
        .rposition(|source| *source == DiscoverySource::TrustedBootstrap);

    if let (Some(first_path), Some(last_standard)) = (first_path, last_standard) {
        assert!(
            last_standard < first_path,
            "standard installs must precede PATH discovery: {sources:?}"
        );
    }
    if let (Some(last_bootstrap), Some(first_path)) = (last_bootstrap, first_path) {
        assert!(
            last_bootstrap < first_path,
            "bootstrap must precede PATH discovery: {sources:?}"
        );
    }
    if let Some(last_bootstrap) = last_bootstrap {
        assert_eq!(sources[last_bootstrap], DiscoverySource::TrustedBootstrap);
        assert!(sources[..last_bootstrap]
            .iter()
            .all(|source| *source == DiscoverySource::TrustedBootstrap));
    }
}

// ---------------------------------------------------------------------------
// F. Adapter, context and binding metadata
// ---------------------------------------------------------------------------

#[test]
fn adapter_accepts_trusted_exe_and_registers_five_bindings() {
    let exe = std::env::current_exe().unwrap();
    let adapter = GitHubCliAdapter::new(exe, test_work_root("register")).unwrap();
    let broker = Broker::new();
    adapter.register_all(&broker);
    let mut ids = broker.status().registered_bindings;
    ids.sort();
    assert_eq!(
        ids,
        vec![
            "github-cli.issue.read",
            "github-cli.issue.search",
            "github-cli.pr.checks.read",
            "github-cli.pr.read",
            "github-cli.repo.inspect",
        ]
    );
    assert!(
        !broker.status().execute_ipc_enabled,
        "no production execute IPC"
    );
}

#[test]
fn adapter_rejects_relative_or_missing_gh() {
    let err = GitHubCliAdapter::new(PathBuf::from("gh"), test_work_root("rel")).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhExecutableNotReady);

    let missing = std::env::temp_dir().join("omni-gh-missing-7f3a-absent.exe");
    let err = GitHubCliAdapter::new(missing, test_work_root("missing")).unwrap_err();
    assert_eq!(err.code, GithubCliErrorCode::GhExecutableNotReady);
}

#[cfg(windows)]
#[test]
fn adapter_rejects_non_exe_extensions() {
    for name in ["gh.cmd", "gh.bat", "gh.ps1", "gh"] {
        let path = std::env::temp_dir().join(format!("omni-gh-adapter-{name}"));
        std::fs::write(&path, b"placeholder").unwrap();
        let result = GitHubCliAdapter::new(path.clone(), test_work_root(name));
        let _ = std::fs::remove_file(&path);
        let err = result.unwrap_err();
        assert_eq!(err.code, GithubCliErrorCode::GhExecutableNotReady, "{name}");
    }
}

#[test]
fn discover_and_new_never_spawns_and_never_hands_bare_gh_to_broker() {
    // Machine-dependent: a valid installed gh.exe yields Ok (validated path),
    // otherwise GH_EXECUTABLE_NOT_READY. Either way no process is spawned.
    match GitHubCliAdapter::discover_and_new(&[], test_work_root("discover")) {
        Ok(adapter) => {
            let broker = Broker::new();
            adapter.register_all(&broker);
            assert_eq!(broker.status().registered_bindings.len(), 5);
            let exe = adapter.context().gh_executable_candidates()[0].clone();
            assert!(exe.is_absolute());
            assert!(exe.to_string_lossy().ends_with("gh.exe"));
        }
        Err(err) => assert_eq!(err.code, GithubCliErrorCode::GhExecutableNotReady, "{err}"),
    }
}

#[test]
fn binding_metadata_matches_contract() {
    let exe = validate_trusted_gh(&std::env::current_exe().unwrap()).unwrap();
    let context = Arc::new(GitHubCliContext::new(exe, test_work_root("meta")).unwrap());

    let expected_env: Vec<String> = GH_ENV_ALLOWLIST
        .iter()
        .map(|name| (*name).to_string())
        .collect();

    for capability in Capability::ALL {
        let binding = GithubCliBinding::new(context.clone(), capability);
        assert_eq!(binding.binding_id(), capability.binding_id());
        assert_eq!(binding.adapter_id(), ADAPTER_ID);
        assert_eq!(binding.adapter_id(), "github-cli");
        assert_eq!(binding.capability_id(), capability.capability_id());
        assert_eq!(binding.executable_candidates().len(), 1);
        assert!(binding.executable_candidates()[0].is_absolute());
        assert_eq!(binding.env_allowlist(), &expected_env[..]);
        assert_eq!(
            binding.allowed_cwd_roots(),
            &[context.work_root().to_path_buf()][..]
        );
        let limits = binding.output_limits();
        assert_eq!(limits.stdout_max_bytes, DEFAULT_OUTPUT_MAX_BYTES);
        assert_eq!(limits.stderr_max_bytes, DEFAULT_OUTPUT_MAX_BYTES);
    }
}

#[test]
fn derive_cwd_ignores_inputs_and_stays_in_work_root() {
    let exe = validate_trusted_gh(&std::env::current_exe().unwrap()).unwrap();
    let context = Arc::new(GitHubCliContext::new(exe, test_work_root("cwd")).unwrap());
    let binding = GithubCliBinding::new(context.clone(), Capability::RepoInspect);

    let hostile = map_of(&[
        ("owner", json!("octocat")),
        ("repo", json!("Hello-World")),
        ("cwd", json!("C:\\Windows\\System32")),
        ("path", json!("C:\\")),
    ]);
    let derived = binding.derive_cwd(&hostile).unwrap();
    assert_eq!(derived, context.work_root());
    assert!(context.allowed_cwd_roots().contains(&derived));
}

#[test]
fn build_argv_unknown_keys_rejected_at_binding_level() {
    let context = Arc::new(
        GitHubCliContext::new(
            validate_trusted_gh(&std::env::current_exe().unwrap()).unwrap(),
            test_work_root("binding"),
        )
        .unwrap(),
    );
    let binding = GithubCliBinding::new(context, Capability::RepoInspect);
    let mut map = owner_repo_map();
    map.insert("ghExecutable".to_string(), json!("C:\\evil.exe"));
    let err = binding.build_argv(&map).unwrap_err();
    assert!(err.contains("GH_INPUT_INVALID"), "{err}");
}

// ---------------------------------------------------------------------------
// CP4 Integration: cross-language contract conformance, child env and the
// real Broker E2E harness (ignored by default; run with -- --ignored)
// ---------------------------------------------------------------------------

#[test]
fn contract_json_conformance_matches_rust_bindings() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let contract_path = manifest_dir
        .join("..")
        .join("..")
        .join("docs")
        .join("goal24")
        .join("cp4-github-readonly-contract.json");
    let raw = std::fs::read_to_string(&contract_path).expect("contract json readable");
    let contract: serde_json::Value = serde_json::from_str(&raw).expect("contract json valid");

    let subset = &contract["input_safe_subset"];
    assert_eq!(
        subset["owner"]["max_length"].as_u64().unwrap() as usize,
        OWNER_MAX_CHARS
    );
    assert_eq!(
        subset["owner"]["pattern"].as_str().unwrap(),
        "^[A-Za-z0-9][A-Za-z0-9-]{0,38}$"
    );
    assert_eq!(
        subset["repo"]["max_length"].as_u64().unwrap() as usize,
        REPO_MAX_CHARS
    );
    assert_eq!(
        subset["repo"]["pattern"].as_str().unwrap(),
        "^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$"
    );
    assert_eq!(
        subset["query"]["max_length"].as_u64().unwrap() as usize,
        SEARCH_QUERY_MAX_CHARS
    );
    assert_eq!(
        subset["limit"]["minimum"].as_u64().unwrap(),
        SEARCH_LIMIT_MIN
    );
    assert_eq!(
        subset["limit"]["maximum"].as_u64().unwrap(),
        SEARCH_LIMIT_MAX
    );
    assert_eq!(
        subset["limit"]["default"].as_u64().unwrap(),
        SEARCH_LIMIT_DEFAULT
    );
    assert_eq!(subset["number"]["minimum"].as_u64().unwrap(), 1);

    let capabilities = contract["capabilities"].as_array().unwrap();
    assert_eq!(capabilities.len(), 5);
    for (index, capability) in capabilities.iter().enumerate() {
        let expected_id = Capability::ALL[index].capability_id();
        assert_eq!(capability["capability_id"].as_str().unwrap(), expected_id);
        assert_eq!(capability["version"].as_str().unwrap(), "1.0.0");
        assert_eq!(capability["authority"].as_str().unwrap(), "L0");
        assert_eq!(capability["risk"].as_str().unwrap(), "low");
        assert_eq!(
            capability["side_effect_class"].as_str().unwrap(),
            "read_only"
        );
        assert!(!capability["reversible"].as_bool().unwrap());
        assert_eq!(capability["required_evidence"].as_array().unwrap().len(), 0);
    }
    let required: Vec<String> = capabilities
        .iter()
        .map(|capability| {
            capability["inputs"]["required"]
                .as_array()
                .unwrap()
                .iter()
                .map(|field| field.as_str().unwrap())
                .collect::<Vec<_>>()
                .join(",")
        })
        .collect();
    assert_eq!(
        required,
        vec![
            "owner,repo",
            "owner,repo",
            "owner,repo,number",
            "owner,repo,number",
            "owner,repo,number",
        ]
    );
}

#[test]
fn gh_child_env_excludes_tokens_host_repo_config_and_proxy() {
    let mut parent = std::collections::HashMap::new();
    for name in [
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GH_ENTERPRISE_TOKEN",
        "GITHUB_ENTERPRISE_TOKEN",
        "GH_HOST",
        "GH_REPO",
        "GH_CONFIG_DIR",
        "GH_BROWSER",
        "BROWSER",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "PATH",
        "OPENAI_API_KEY",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "SystemRoot",
        "TEMP",
        "TMP",
    ] {
        parent.insert(name.to_string(), format!("value-of-{name}"));
    }
    let allowlist: Vec<String> = GH_ENV_ALLOWLIST
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    let env = build_child_env(BASE_ENV_VARS, &allowlist, &parent);
    let names: Vec<String> = env
        .iter()
        .map(|(name, _)| name.to_string_lossy().to_string())
        .collect();

    for present in ["USERPROFILE", "APPDATA", "LOCALAPPDATA"] {
        assert!(
            names.iter().any(|name| name == present),
            "{present} expected"
        );
    }
    for excluded in [
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GH_ENTERPRISE_TOKEN",
        "GITHUB_ENTERPRISE_TOKEN",
        "GH_HOST",
        "GH_REPO",
        "GH_CONFIG_DIR",
        "GH_BROWSER",
        "BROWSER",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "PATH",
        "OPENAI_API_KEY",
    ] {
        assert!(
            !names.iter().any(|name| name == excluded),
            "{excluded} must never be inherited"
        );
    }
}

// ---------------------------------------------------------------------------
// Real Broker E2E (ignored by default). These tests inject the dev-machine
// trusted runtime candidate explicitly (test-only) and run the full
// ExecutionPlan -> Broker -> pinned gh.exe -> JSON parser path. When gh auth
// is not configured the adapter must report GH_AUTH_NOT_READY (exit 4)
// without panics, prompts or hangs; with auth configured the typed result is
// asserted.
// ---------------------------------------------------------------------------

#[cfg(windows)]
const DEV_TRUSTED_GH_EXE: &str = r"D:\environment\github-cli\bin\gh.exe";

#[cfg(windows)]
fn e2e_broker() -> Option<(Broker, Arc<GitHubCliContext>)> {
    let exe = PathBuf::from(DEV_TRUSTED_GH_EXE);
    if !exe.is_file() {
        return None;
    }
    let adapter = GitHubCliAdapter::new(exe, test_work_root("e2e")).ok()?;
    let broker = Broker::new();
    adapter.register_all(&broker);
    Some((broker, adapter.context()))
}

#[cfg(windows)]
fn e2e_plan(plan_id: &str, capability_id: &str, inputs: serde_json::Value) -> ExecutionPlanWire {
    serde_json::from_value(serde_json::json!({
        "plan_id": plan_id,
        "decision_id": "decision-cp4-e2e-0001",
        "capability_id": capability_id,
        "capability_version": "1.0.0",
        "adapter_id": "github-cli",
        "normalized_inputs": inputs,
        "required_approval": false,
        "approval": null,
        "risk_snapshot": {
            "risk_level": "low",
            "reversible": false,
            "side_effect_class": "read_only",
            "required_authority": "l0",
            "capability_version": "1.0.0"
        },
        "evidence_coverage_snapshot": { "entries": [] },
        "timeout_ms": 30000,
        "verification_plan": null,
        "rollback_plan": null,
        "state": "ready",
        "created_at": chrono::Utc::now().to_rfc3339(),
        "expires_at": null,
        "correlation_id": null,
        "requested_by": "cp4-e2e"
    }))
    .expect("e2e plan deserializes")
}

#[cfg(windows)]
fn e2e_observe_auth(label: &str, result: &Result<(), GithubCliError>) -> bool {
    match result {
        Ok(()) => {
            eprintln!("CP4_E2E_{label}=PASS");
            true
        }
        Err(err) if err.code == GithubCliErrorCode::GhAuthNotReady => {
            eprintln!("CP4_E2E_{label}=AUTH_REQUIRED pipeline-ok: {err}");
            true
        }
        Err(err) => {
            eprintln!("CP4_E2E_{label}=FAIL {err}");
            false
        }
    }
}

#[cfg(windows)]
fn e2e_fixture_number(var: &str) -> Option<u64> {
    std::env::var(var)
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|number| *number > 0)
}

#[cfg(windows)]
#[test]
#[ignore = "real GitHub read-only E2E through the Broker; requires gh auth on this host"]
fn e2e_repo_inspect_real_broker() {
    let Some((broker, _context)) = e2e_broker() else {
        eprintln!("CP4_E2E_REPO_INSPECT=SKIP trusted gh.exe not found");
        return;
    };
    let plan = e2e_plan(
        "plan-cp4-e2e-repo-inspect",
        "github.repo.inspect",
        serde_json::json!({ "owner": "guo6x", "repo": "Omni-context" }),
    );
    let result = broker
        .execute(&plan, "github-cli.repo.inspect")
        .expect("broker accepts ready plan");
    let observed = parse_repo_inspect(&result).map(|out| {
        assert_eq!(out.name_with_owner, "guo6x/Omni-context");
    });
    if observed.is_err() {
        eprintln!(
            "CP4_E2E_DEBUG repo.inspect exit={:?} stderr={:?}",
            result.exit_code, result.stderr
        );
    }
    assert!(e2e_observe_auth("REPO_INSPECT", &observed));
}

#[cfg(windows)]
#[test]
#[ignore = "real GitHub read-only E2E through the Broker; requires gh auth on this host"]
fn e2e_issue_search_real_broker() {
    let Some((broker, _context)) = e2e_broker() else {
        eprintln!("CP4_E2E_ISSUE_SEARCH=SKIP trusted gh.exe not found");
        return;
    };
    let plan = e2e_plan(
        "plan-cp4-e2e-issue-search",
        "github.issue.search",
        serde_json::json!({ "owner": "guo6x", "repo": "Omni-context", "limit": 5 }),
    );
    let result = broker
        .execute(&plan, "github-cli.issue.search")
        .expect("broker accepts ready plan");
    let observed = parse_issue_search(&result).map(|_issues| {});
    if observed.is_err() {
        eprintln!(
            "CP4_E2E_DEBUG issue.search exit={:?} stderr={:?}",
            result.exit_code, result.stderr
        );
    }
    assert!(e2e_observe_auth("ISSUE_SEARCH", &observed));
}

#[cfg(windows)]
#[test]
#[ignore = "real GitHub read-only E2E through the Broker; requires gh auth + fixture number"]
fn e2e_issue_read_fixture() {
    let Some(number) = e2e_fixture_number("OMNI_CP4_E2E_ISSUE_NUMBER") else {
        eprintln!("CP4_E2E_ISSUE_READ=NO_FIXTURE OMNI_CP4_E2E_ISSUE_NUMBER unset");
        return;
    };
    let Some((broker, _context)) = e2e_broker() else {
        eprintln!("CP4_E2E_ISSUE_READ=SKIP trusted gh.exe not found");
        return;
    };
    let plan = e2e_plan(
        "plan-cp4-e2e-issue-read",
        "github.issue.read",
        serde_json::json!({ "owner": "guo6x", "repo": "Omni-context", "number": number }),
    );
    let result = broker
        .execute(&plan, "github-cli.issue.read")
        .expect("broker accepts ready plan");
    let observed = parse_issue_read(&result).map(|issue| {
        assert_eq!(issue.number, number);
    });
    assert!(e2e_observe_auth("ISSUE_READ", &observed));
}

#[cfg(windows)]
#[test]
#[ignore = "real GitHub read-only E2E through the Broker; requires gh auth + fixture number"]
fn e2e_pr_read_fixture() {
    let Some(number) = e2e_fixture_number("OMNI_CP4_E2E_PR_NUMBER") else {
        eprintln!("CP4_E2E_PR_READ=NO_FIXTURE OMNI_CP4_E2E_PR_NUMBER unset");
        return;
    };
    let Some((broker, _context)) = e2e_broker() else {
        eprintln!("CP4_E2E_PR_READ=SKIP trusted gh.exe not found");
        return;
    };
    let plan = e2e_plan(
        "plan-cp4-e2e-pr-read",
        "github.pr.read",
        serde_json::json!({ "owner": "guo6x", "repo": "Omni-context", "number": number }),
    );
    let result = broker
        .execute(&plan, "github-cli.pr.read")
        .expect("broker accepts ready plan");
    let observed = parse_pr_read(&result).map(|pr| {
        assert_eq!(pr.number, number);
    });
    assert!(e2e_observe_auth("PR_READ", &observed));
}

#[cfg(windows)]
#[test]
#[ignore = "real GitHub read-only E2E through the Broker; requires gh auth + fixture number"]
fn e2e_pr_checks_read_fixture() {
    let Some(number) = e2e_fixture_number("OMNI_CP4_E2E_PR_NUMBER") else {
        eprintln!("CP4_E2E_PR_CHECKS_READ=NO_FIXTURE OMNI_CP4_E2E_PR_NUMBER unset");
        return;
    };
    let Some((broker, _context)) = e2e_broker() else {
        eprintln!("CP4_E2E_PR_CHECKS_READ=SKIP trusted gh.exe not found");
        return;
    };
    let plan = e2e_plan(
        "plan-cp4-e2e-pr-checks-read",
        "github.pr.checks.read",
        serde_json::json!({ "owner": "guo6x", "repo": "Omni-context", "number": number }),
    );
    let result = broker
        .execute(&plan, "github-cli.pr.checks.read")
        .expect("broker accepts ready plan");
    let observed = parse_pr_checks(&result).map(|checks| {
        assert_eq!(checks.number, number);
    });
    assert!(e2e_observe_auth("PR_CHECKS_READ", &observed));
}

#[test]
fn adapter_work_root_passes_broker_cwd_gate() {
    let exe = validate_trusted_gh(&std::env::current_exe().unwrap()).unwrap();
    let context = Arc::new(GitHubCliContext::new(exe, test_work_root("cwdgate")).unwrap());
    let derived = context.work_root().to_path_buf();
    assert!(derived.is_absolute(), "{derived:?}");
    #[cfg(windows)]
    assert!(
        !derived.to_string_lossy().starts_with(r"\\?\"),
        "verbatim prefix must be stripped: {derived:?}"
    );
    let validated = validate_cwd(&derived, context.allowed_cwd_roots());
    assert!(
        validated.is_ok(),
        "adapter cwd must pass the broker cwd gate: {validated:?}"
    );
}
