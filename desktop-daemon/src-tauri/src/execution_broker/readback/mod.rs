//! Goal24 Checkpoint 8 (Lane B) - native execution receipts and the
//! restricted read-back verification runner.
//!
//! Everything here is crate-internal: no `verifyPlan`, `runReadback` or
//! `readbackCapability` Tauri command exists (CP9 wires the bridge). The
//! read-back runner never executes rollback, never retries the original
//! write and never emits an `outcome_verified` claim.

mod binding;
mod parser;
pub(crate) mod receipt;
pub(crate) mod runner;
pub(crate) mod state_map;
pub(crate) mod store;
pub(crate) mod types;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod crash_tests;

#[cfg(test)]
mod cross_language_tests;

pub(crate) use binding::ReadbackBinding;
pub(crate) use runner::ReadbackRunner;
pub(crate) use store::ReceiptStore;
pub(crate) use types::{ExecutionReceipt, ReadbackObservationEnvelope};
