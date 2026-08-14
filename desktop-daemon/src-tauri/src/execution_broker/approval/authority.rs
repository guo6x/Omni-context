//! Goal24 Checkpoint 7 (Lane B) - native approval authority.
//!
//! The authority is the execution-authority owner, not the Decision Kernel.
//! It grants bounded single-use approvals from secure random grant material,
//! verifies presented `ApprovalReferenceWire` strings only against the
//! trusted store record, and consumes grants atomically. The structural
//! presence of a reference is never proof: the native store is the only
//! source of approval authority.

use std::path::PathBuf;

use crate::execution_broker::policy::{authority_rank, ExecutionRiskPolicy};
use crate::execution_broker::types::{
    ApprovalReferenceWire, AuthorityLevelWire, BrokerError, ErrorCode, ExecutionPlanWire,
};

use super::digest::{approval_binding_digest, new_token_reference, token_digest};
use super::store::ApprovalStore;
use super::types::{ActorKind, ApprovalRecord, ApprovalStatus};

/// Native approval policy version (compiled; callers cannot choose it).
pub const APPROVAL_POLICY_VERSION: &str = "goal24-approval-policy-v1";

/// CP7 V1 maximum grant lifetime: 15 minutes. Approvals are never unlimited.
pub const MAX_GRANT_LIFETIME_MS: i64 = 15 * 60 * 1000;

/// Native-side grant request. Only trusted crate code can construct one; no
/// Tauri command exposes a grant entry point in CP7.
pub struct GrantRequest<'a> {
    pub plan: &'a ExecutionPlanWire,
    pub approval_request_id: Option<String>,
    pub actor_id: String,
    pub actor_kind: ActorKind,
    pub actor_authority: AuthorityLevelWire,
    /// RFC3339 grant expiry. Must be > granted_at, <= plan expiry (when the
    /// plan has one) and within the 15-minute maximum lifetime.
    pub expires_at: String,
    /// Compiled binding risk policy the grant is bound to.
    pub binding_policy: &'a ExecutionRiskPolicy,
}

/// Map a stored approval status to its machine-readable rejection.
pub(crate) fn status_error(record: &ApprovalRecord) -> BrokerError {
    let id = &record.approval_id;
    match record.status {
        ApprovalStatus::Pending => BrokerError::new(
            ErrorCode::ApprovalNotGranted,
            format!("approval {id} is still pending"),
        ),
        ApprovalStatus::Denied => BrokerError::new(
            ErrorCode::ApprovalDenied,
            format!("approval {id} was denied"),
        ),
        ApprovalStatus::Revoked => BrokerError::new(
            ErrorCode::ApprovalRevoked,
            format!("approval {id} was revoked"),
        ),
        ApprovalStatus::Consumed => BrokerError::new(
            ErrorCode::ApprovalConsumed,
            format!("approval {id} was already consumed (single-use)"),
        ),
        ApprovalStatus::Expired => BrokerError::new(
            ErrorCode::ApprovalExpired,
            format!("approval {id} is expired"),
        ),
        ApprovalStatus::Granted => BrokerError::new(
            ErrorCode::InternalError,
            format!("approval {id} status is granted but not verifiable"),
        ),
    }
}

/// The native approval authority. Owns the store; grants are bounded and
/// single-use; verification and consume are fail-closed.
pub struct ApprovalAuthority {
    store: ApprovalStore,
}

impl ApprovalAuthority {
    /// Volatile in-memory authority (used by `Broker::new`; unit tests only).
    pub fn in_memory() -> Self {
        Self {
            store: ApprovalStore::in_memory(),
        }
    }

    /// Persistent authority over a trusted injected store path.
    pub fn persistent(store_path: PathBuf) -> Self {
        Self {
            store: ApprovalStore::persistent(store_path),
        }
    }

    /// True while the backing store is initialized and healthy.
    pub fn is_healthy(&self) -> bool {
        self.store.is_healthy()
    }

    /// Degraded store reason, when unhealthy.
    pub fn degradation(&self) -> Option<BrokerError> {
        self.store.degradation()
    }

    /// Grant with the trusted native clock.
    pub fn grant(&self, request: &GrantRequest<'_>) -> Result<ApprovalReferenceWire, BrokerError> {
        self.grant_at(request, chrono::Utc::now())
    }

    /// Grant with an injected clock (used by tests for expiry windows).
    pub fn grant_at(
        &self,
        request: &GrantRequest<'_>,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<ApprovalReferenceWire, BrokerError> {
        if let Some(err) = self.store.degradation() {
            return Err(err);
        }

        // granted_at must never be in the future (trusted native clock).
        if now > chrono::Utc::now() {
            return Err(BrokerError::new(
                ErrorCode::PlanRejectedInvalid,
                "granted_at is in the future; the native clock is not trusted forward",
            ));
        }

        // Actor authority must meet the compiled binding requirement.
        if authority_rank(request.actor_authority)
            < authority_rank(request.binding_policy.required_authority)
        {
            return Err(BrokerError::new(
                ErrorCode::ApprovalActorAuthorityInsufficient,
                format!(
                    "actor authority {:?} is below the required {:?}",
                    request.actor_authority, request.binding_policy.required_authority
                ),
            ));
        }

        let granted_at = now;
        let granted_at_str = granted_at.to_rfc3339();
        let expires_at = chrono::DateTime::parse_from_rfc3339(&request.expires_at)
            .map_err(|_| {
                BrokerError::new(
                    ErrorCode::PlanRejectedInvalid,
                    "approval expires_at must be a valid RFC3339 timestamp",
                )
            })?
            .with_timezone(&chrono::Utc);
        if expires_at <= granted_at {
            return Err(BrokerError::new(
                ErrorCode::PlanRejectedInvalid,
                "approval expires_at must be strictly after granted_at",
            ));
        }
        let lifetime_ms = (expires_at - granted_at).num_milliseconds();
        if lifetime_ms > MAX_GRANT_LIFETIME_MS {
            return Err(BrokerError::new(
                ErrorCode::PlanRejectedInvalid,
                format!(
                    "approval grant lifetime {lifetime_ms}ms exceeds the CP7 maximum {MAX_GRANT_LIFETIME_MS}ms"
                ),
            ));
        }
        if let Some(plan_expires) = &request.plan.expires_at {
            let plan_expires = chrono::DateTime::parse_from_rfc3339(plan_expires)
                .map_err(|_| {
                    BrokerError::new(
                        ErrorCode::PlanRejectedInvalid,
                        "plan expires_at must be a valid RFC3339 timestamp",
                    )
                })?
                .with_timezone(&chrono::Utc);
            if expires_at > plan_expires {
                return Err(BrokerError::new(
                    ErrorCode::PlanRejectedInvalid,
                    "approval expires_at exceeds the plan expires_at",
                ));
            }
        }

        let approval_binding_digest =
            approval_binding_digest(request.plan, APPROVAL_POLICY_VERSION)?;
        let token_reference = new_token_reference()?;
        let mut grant_material = [0u8; 32];
        getrandom::getrandom(&mut grant_material).map_err(|err| {
            BrokerError::new(
                ErrorCode::InternalError,
                format!("secure random source unavailable: {err}"),
            )
        })?;
        let token_digest =
            token_digest(&grant_material, &approval_binding_digest, &token_reference);

        let record = ApprovalRecord {
            approval_id: format!("appr_{}", super::digest::random_hex32()?),
            approval_request_id: request.approval_request_id.clone(),
            plan_id: request.plan.plan_id.clone(),
            approval_binding_digest,
            capability_id: request.plan.capability_id.clone(),
            capability_version: request.plan.capability_version.clone(),
            risk_policy_snapshot: *request.binding_policy,
            actor_id: request.actor_id.clone(),
            actor_kind: request.actor_kind,
            actor_authority: request.actor_authority,
            policy_version: APPROVAL_POLICY_VERSION.to_string(),
            granted_at: granted_at_str,
            expires_at: request.expires_at.clone(),
            token_reference,
            token_digest,
            status: ApprovalStatus::Granted,
            consumed_at: None,
            execution_id: None,
        };
        let reference = ApprovalReferenceWire {
            approval_id: record.approval_id.clone(),
            plan_id: record.plan_id.clone(),
            granted_by: record.actor_id.clone(),
            granted_at: record.granted_at.clone(),
            policy_version: record.policy_version.clone(),
            token_reference: record.token_reference.clone(),
            token_digest: record.token_digest.clone(),
        };
        self.store.insert(record)?;
        Ok(reference)
    }

    /// Verify a presented approval reference against the trusted store.
    /// The strings alone are never trusted; every field is checked against the
    /// native record and the plan it was granted for.
    pub fn verify(
        &self,
        approval: &ApprovalReferenceWire,
        plan: &ExecutionPlanWire,
        binding_policy: &ExecutionRiskPolicy,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<ApprovalRecord, BrokerError> {
        if let Some(err) = self.store.degradation() {
            return Err(err);
        }
        let record = self.store.get(&approval.approval_id)?.ok_or_else(|| {
            BrokerError::new(
                ErrorCode::ApprovalRecordNotFound,
                format!("approval_id not found: {}", approval.approval_id),
            )
        })?;

        if record.plan_id != approval.plan_id || record.plan_id != plan.plan_id {
            return Err(BrokerError::new(
                ErrorCode::ApprovalWrongPlan,
                "approval was granted for a different plan_id",
            ));
        }
        if !ApprovalStore::token_fields_match(
            &record,
            &approval.token_reference,
            &approval.token_digest,
        ) {
            return Err(BrokerError::new(
                ErrorCode::ApprovalInvalidToken,
                "approval token fields do not match the native store record",
            ));
        }
        if approval.policy_version != APPROVAL_POLICY_VERSION {
            return Err(BrokerError::new(
                ErrorCode::ApprovalBindingMismatch,
                format!(
                    "unsupported approval policy version \"{}\"; the native authority only supports {APPROVAL_POLICY_VERSION}",
                    approval.policy_version
                ),
            ));
        }
        if record.policy_version != approval.policy_version {
            return Err(BrokerError::new(
                ErrorCode::ApprovalBindingMismatch,
                "approval policy_version does not match the native record",
            ));
        }
        let recomputed = approval_binding_digest(plan, &approval.policy_version)?;
        if !super::digest::constant_time_eq(&recomputed, &record.approval_binding_digest) {
            return Err(BrokerError::new(
                ErrorCode::ApprovalBindingMismatch,
                "plan mutated after grant: approval binding digest mismatch",
            ));
        }
        if record.risk_policy_snapshot != *binding_policy {
            return Err(BrokerError::new(
                ErrorCode::ApprovalRiskMismatch,
                "compiled binding risk policy does not match the granted snapshot",
            ));
        }
        if authority_rank(record.actor_authority)
            < authority_rank(binding_policy.required_authority)
        {
            return Err(BrokerError::new(
                ErrorCode::ApprovalActorAuthorityInsufficient,
                "granting actor authority is below the compiled binding requirement",
            ));
        }
        if record.status != ApprovalStatus::Granted {
            return Err(status_error(&record));
        }
        let granted_at =
            chrono::DateTime::parse_from_rfc3339(&record.granted_at).map_err(|_| {
                BrokerError::new(
                    ErrorCode::ApprovalExpired,
                    "approval granted_at is malformed",
                )
            })?;
        if granted_at > chrono::Utc::now() {
            return Err(BrokerError::new(
                ErrorCode::ApprovalExpired,
                "approval granted_at is in the future",
            ));
        }
        if !record.is_verifiable(&now) {
            return Err(BrokerError::new(
                ErrorCode::ApprovalExpired,
                "approval has expired",
            ));
        }
        Ok(record)
    }

    /// Atomically consume a verified granted approval. Exactly one concurrent
    /// caller can succeed; the other is rejected.
    pub fn consume(
        &self,
        approval_id: &str,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<ApprovalRecord, BrokerError> {
        self.store.consume_if_granted(approval_id, &now)
    }

    /// Record the execution id on a consumed approval (audit only).
    pub fn record_execution_id(
        &self,
        approval_id: &str,
        execution_id: &str,
    ) -> Result<(), BrokerError> {
        self.store.record_execution_id(approval_id, execution_id)
    }

    /// Deny a pending/granted approval (never an executed one).
    pub fn deny(&self, approval_id: &str) -> Result<(), BrokerError> {
        self.store.deny(approval_id)
    }

    /// Revoke before consume: never executes again. After consume: audit only.
    pub fn revoke(&self, approval_id: &str) -> Result<(), BrokerError> {
        self.store.revoke(approval_id)
    }

    /// Test-only time travel for the expiry gate.
    pub fn force_expire_for_test(
        &self,
        approval_id: &str,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Result<(), BrokerError> {
        self.store.force_expire_for_test(approval_id, &now)
    }
}
