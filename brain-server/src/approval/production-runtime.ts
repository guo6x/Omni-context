/**
 * Production composition for the CP6 -> CP7 -> D1B-1 approval path.
 *
 * This module is intentionally the single place where the process creates
 * authorization state.  Plan creation and the fixed control facade receive
 * the same AuthorizationService object, so they necessarily share its
 * private AuthorizationStore, CP6 eligibility service, catalog, policy and
 * clock.  Nothing here publishes a store handle or a generic mutation API.
 */

import type { CapabilityDefinition } from '../capabilities/contracts.js';
import { GITHUB_READONLY_CAPABILITIES } from '../capabilities/github-readonly.js';
import { GITHUB_WRITE_CAPABILITIES } from '../capabilities/github-write.js';
import { GIT_LOCAL_CAPABILITIES } from '../capabilities/git-local.js';
import { HttpNativeApprovalClient } from '../control/native-bridge.js';
import type { ControlApprovalRuntime } from '../control/approval-facade.js';
import {
  EvidenceEligibilityService,
  EvidenceProviderRegistry,
  EvidenceSurfaceRuntime,
  GuardRunStore,
  QualifiedEvidenceStore,
  githubSubjectResolverRegistry,
  type EvidenceSurfaceRuntimeOptions,
} from '../evidence/index.js';
import type { ApprovalGrantVerifier } from './contracts.js';
import { AuthorizationService } from './authorization-service.js';
import { ServerVerificationRuntime } from '../control/verification-runtime.js';

const PRODUCTION_CAPABILITIES: readonly CapabilityDefinition[] = [
  ...GITHUB_READONLY_CAPABILITIES,
  ...GITHUB_WRITE_CAPABILITIES,
  ...GIT_LOCAL_CAPABILITIES,
];

export interface ProductionAuthorizationRuntimeOptions {
  /**
   * Trusted application-owned providers. Production presently ships an empty
   * registry; an explicit test fixture can supply deterministic providers to
   * exercise the real CP6 pipeline without adding a network control surface.
   */
  providers?: EvidenceProviderRegistry;
  /** Shared trusted clock for CP6 materialization and CP7 authorization. */
  clock?: () => Date;
  /** Test-only collection bounds; never derived from a caller request. */
  evidenceOptions?: Pick<
    EvidenceSurfaceRuntimeOptions,
    'limits' | 'maxRetrievalRounds' | 'perRoundTimeoutMs'
  >;
}

export interface ProductionAuthorizationRuntime {
  /** Internal plan-creation service, shared by identity with controlRuntime. */
  readonly authorizationService: AuthorizationService;
  /** CP6 entry point used by the server-owned decision/authorization path. */
  readonly evidenceRuntime: EvidenceSurfaceRuntime;
  /** Narrow interface consumed by the fixed public approval facade. */
  readonly controlRuntime: ControlApprovalRuntime;
  /** Narrow server-owned verifier consumed by the fixed D1B-2 route. */
  readonly verificationRuntime: ServerVerificationRuntime;
}

function productionCapabilityLookup(capabilityId: string): CapabilityDefinition | undefined {
  return PRODUCTION_CAPABILITIES.find((capability) => capability.id === capabilityId);
}

function nativeGrantVerifier(native: HttpNativeApprovalClient): ApprovalGrantVerifier {
  return {
    async verifyGrant({ plan, approval_reference }) {
      return native.verify(approval_reference, plan);
    },
  };
}

/**
 * Construct one process-local authorization runtime. The default verifier is
 * the real private native HTTP bridge; it fails closed when that authority is
 * absent. No second store or self-issued JavaScript grant exists here.
 */
export function createProductionAuthorizationRuntime(
  options: ProductionAuthorizationRuntimeOptions = {},
): ProductionAuthorizationRuntime {
  const clock = options.clock ?? (() => new Date());
  const providers = options.providers ?? new EvidenceProviderRegistry();
  const subjectResolvers = githubSubjectResolverRegistry();
  // These ledgers remain private to this composition root. Both CP6 and CP7
  // receive the same instances, but no runtime consumer receives a handle.
  const guardRunStore = new GuardRunStore();
  const qualifiedEvidenceStore = new QualifiedEvidenceStore();
  const evidenceRuntime = new EvidenceSurfaceRuntime({
    capabilityLookup: productionCapabilityLookup,
    providers,
    subjectResolvers,
    clock,
    guardRunStore,
    qualifiedEvidenceStore,
    ...options.evidenceOptions,
  });
  const eligibility = new EvidenceEligibilityService({
    guardRunStore,
    qualifiedEvidenceStore,
    capabilityLookup: productionCapabilityLookup,
    subjectResolvers,
    clock,
  });
  // Do not accept a verifier or a pre-issued grant here: production approval
  // is always re-verified through the private native bridge.
  const native = new HttpNativeApprovalClient();
  const authorizationService = new AuthorizationService({
    capabilityLookup: productionCapabilityLookup,
    evidenceEligibility: eligibility,
    grantVerifier: nativeGrantVerifier(native),
    clock,
  });

  const verificationRuntime = new ServerVerificationRuntime(
    (planId) => authorizationService.getAuthorizationRecord(planId),
    clock,
  );
  return {
    authorizationService,
    evidenceRuntime,
    controlRuntime: authorizationService,
    verificationRuntime,
  };
}
