//! Goal24 Checkpoint 7 (Lane B) - native approval subsystem.
//!
//! Approval Authority + persistent grant store + durable plan replay ledger.
//! Everything here is crate-internal; no Tauri command exposes grant/deny/
//! revoke (CP9 wires the approval UI).

pub(crate) mod authority;
pub(crate) mod digest;
pub(crate) mod ledger;
pub(crate) mod lock;
pub(crate) mod store;
mod types;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod crash_tests;
#[cfg(test)]
mod cross_language_tests;

#[cfg(test)]
mod oracle_tests;

pub(crate) use authority::{ApprovalAuthority, GrantRequest};
pub(crate) use ledger::PlanLedger;
pub(crate) use types::{ActorKind, ApprovalRecord};
