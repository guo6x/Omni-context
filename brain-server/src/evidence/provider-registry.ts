/**
 * Goal24 Checkpoint 6 (Lane A) - internal Evidence Provider Registry.
 *
 * The registry holds trusted application-code providers only. It is never
 * exposed over MCP, REST, Tauri IPC or an LLM tool, so external content can
 * never dynamically register a provider (future plugin/provider loading is
 * a separate security checkpoint).
 *
 * Deterministic ordering: providersForClass returns providers sorted by
 * priority descending, with priority ties broken by provider_id ascending.
 * The same ordering is the canonical "primary wins" order used by the
 * coverage builder for conflict partition.
 */

import {
  EVIDENCE_CLASS_PATTERN,
} from '../capabilities/contracts.js';
import {
  EvidenceProviderV1MetadataSchema,
  type EvidenceProviderV1,
} from './provider.js';
import { EvidenceError } from './errors.js';

export class EvidenceProviderRegistry {
  private readonly providers = new Map<string, EvidenceProviderV1>();

  /**
   * Register a provider. provider_id is unique: re-registering the same id,
   * even with a different instance or version, is rejected
   * (EVIDENCE_PROVIDER_DUPLICATE) so callers can never silently swap the
   * authority behind a provider id.
   */
  register(provider: EvidenceProviderV1): void {
    const metadata = EvidenceProviderV1MetadataSchema.safeParse(provider.metadata);
    if (!metadata.success) {
      throw new EvidenceError(
        'EVIDENCE_INPUT_INVALID',
        `provider metadata is invalid: ${metadata.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const providerId = metadata.data.provider_id;
    if (this.providers.has(providerId)) {
      throw new EvidenceError(
        'EVIDENCE_PROVIDER_DUPLICATE',
        `provider '${providerId}' is already registered; duplicate ids (including different versions) are rejected`,
      );
    }
    this.providers.set(providerId, provider);
  }

  get(providerId: string): EvidenceProviderV1 | undefined {
    return this.providers.get(providerId);
  }

  /** All providers in canonical deterministic order. */
  list(): EvidenceProviderV1[] {
    return sortProviders([...this.providers.values()]);
  }

  /** Providers that declare support for the class, canonical order. */
  providersForClass(classId: string): EvidenceProviderV1[] {
    if (!EVIDENCE_CLASS_PATTERN.test(classId)) {
      throw new EvidenceError('EVIDENCE_INPUT_INVALID', `invalid evidence class id '${classId}'`);
    }
    return sortProviders(
      this.list().filter((provider) => provider.metadata.supported_classes.includes(classId)),
    );
  }
}

/** Canonical deterministic provider order: priority desc, then provider_id asc. */
export function sortProviders(providers: readonly EvidenceProviderV1[]): EvidenceProviderV1[] {
  return [...providers].sort((a, b) => {
    if (a.metadata.priority !== b.metadata.priority) {
      return b.metadata.priority - a.metadata.priority;
    }
    return a.metadata.provider_id < b.metadata.provider_id ? -1 : 1;
  });
}