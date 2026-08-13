//! Goal24 Checkpoint 4 - GitHub CLI read-only adapter core (Lane A).
//!
//! Implements the five CP4 read-only capabilities on top of the frozen CP3
//! `ExecutionBinding` contract and the existing `Broker`. CP4 enables no
//! writes, no production execute IPC and no process execution outside the
//! broker.
//!
//! Binding IDs:     github-cli.repo.inspect, github-cli.issue.search,
//!                  github-cli.issue.read, github-cli.pr.read,
//!                  github-cli.pr.checks.read
//! Capability IDs:  github.repo.inspect, github.issue.search,
//!                  github.issue.read, github.pr.read,
//!                  github.pr.checks.read
//!
//! `github.pr.checks.read` reads `statusCheckRollup` from
//! `gh pr view --json` and extracts checks in Rust; `gh pr checks` is
//! deliberately not used (its non-zero "pending" exit semantics would
//! require a broker-wide change).

pub mod adapter;
pub mod bindings;
pub mod bootstrap;
pub mod discovery;
pub mod inputs;
pub mod outputs;

#[cfg(test)]
mod tests;

/// Stable adapter identifier, matched against `ExecutionPlan.adapter_id`.
pub const ADAPTER_ID: &str = "github-cli";
