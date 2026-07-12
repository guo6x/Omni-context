const fs = require("fs");
const base = process.cwd();

// P0-5: Fix chunk merging
let p = base + "/brain-server/src/graphrag/entity-resolver.ts";
let c = fs.readFileSync(p, "utf8");

c = c.replace(
  "const NEVER_AUTO_MERGE_TYPES = new Set<EntityType>(['decision', 'preference', 'goal', 'event']);",
  "const NEVER_AUTO_MERGE_TYPES = new Set<EntityType>(['decision', 'preference', 'goal', 'event', 'task', 'question', 'person', 'project']);"
);

c = c.replace(
  "const CONTEXT_GATED_TYPES = new Set<EntityType>(['person', 'project', 'task', 'question']);\n",
  ""
);

c = c.replace(
  "const firstChunk = asRecord(chunks[0]);\n  return {",
  "const firstChunk = asRecord(chunks[0]);\n  const ordinal = typeof firstChunk.ordinal === \"number\" ? firstChunk.ordinal : undefined;\n  const sessionId = typeof firstChunk.session_id === \"string\" ? firstChunk.session_id : undefined;\n  const factState = entity.valid_until ? \"expired\" : \"current\";\n  return {"
);

c = c.replace(
  "start: entity.valid_from || entity.event_time || entity.observed_at,\n    end: entity.valid_until,\n  };",
  "start: entity.valid_from || entity.event_time || entity.observed_at,\n    end: entity.valid_until,\n    ordinal,\n    session: sessionId,\n    factState,\n  };"
);

c = c.replace(
  "if (NEVER_AUTO_MERGE_TYPES.has(entity.type)) {\n        if (!exact.isNew) mergeCandidates.push(await queueCandidate(db, entity, exact, 1, 'exact_name_manual_only'));\n      } else if (CONTEXT_GATED_TYPES.has(entity.type) && !contextsCompatible(entity, exact)) {\n        if (!exact.isNew) mergeCandidates.push(await queueCandidate(db, entity, exact, 1, 'exact_name_context_mismatch'));\n      } else {",
  "if (NEVER_AUTO_MERGE_TYPES.has(entity.type)) {\n        if (!exact.isNew) mergeCandidates.push(await queueCandidate(db, entity, exact, 1, \"exact_name_manual_only\"));\n      } else {"
);

fs.writeFileSync(p, c, "utf8");
console.log("P0-5 done");

// P0-6: Time-based single-value relationship rules
p = base + "/brain-server/src/graphrag/conflict-resolver.ts";
if (fs.existsSync(p)) {
  c = fs.readFileSync(p, "utf8");
  // Add supersede rules after existing conflict resolution
  const supersedeRules = `

// P0-6: Time-based single-value relationship supersede rules.
// Only auto-supersede when: same subject+predicate, new fact has clear later valid_from/event_time,
// temporal confidence meets threshold, source is trusted, no ambiguity.
const SINGLE_VALUED_PREDICATES = new Set(['works_at', 'lives_in', 'studies_at', 'married_to']);

interface SupersedeCheck {
  shouldSupersede: boolean;
  reason: string;
  action: 'supersede' | 'retain_both' | 'review';
}

export function checkSingleValueSupersede(
  existing: { source_id: string; type: string; target_id: string; valid_from?: string; valid_until?: string; event_time?: string; temporal_confidence?: number; provenance?: Record<string, unknown> },
  incoming: { source_id: string; type: string; target_id: string; valid_from?: string; valid_until?: string; event_time?: string; temporal_confidence?: number; provenance?: Record<string, unknown> },
): SupersedeCheck {
  // Only apply to single-valued predicates
  if (!SINGLE_VALUED_PREDICATES.has(incoming.type)) {
    return { shouldSupersede: false, reason: 'not_single_valued', action: 'retain_both' };
  }

  // Must be same subject and predicate
  if (existing.source_id !== incoming.source_id || existing.type !== incoming.type) {
    return { shouldSupersede: false, reason: 'different_subject_or_predicate', action: 'retain_both' };
  }

  const existingTime = existing.event_time || existing.valid_from;
  const incomingTime = incoming.event_time || incoming.valid_from;

  // New fact with no time cannot supersede old fact with time
  if (!incomingTime && existingTime) {
    return { shouldSupersede: false, reason: 'incoming_no_time_existing_has_time', action: 'review' };
  }

  // New fact earlier than old fact cannot supersede
  if (existingTime && incomingTime && new Date(incomingTime) <= new Date(existingTime)) {
    return { shouldSupersede: false, reason: 'incoming_not_later', action: 'review' };
  }

  // Check temporal confidence
  const confidence = incoming.temporal_confidence ?? 0.5;
  if (confidence < 0.7) {
    return { shouldSupersede: false, reason: 'low_temporal_confidence', action: 'review' };
  }

  // Check provenance - historical imports don't auto-supersede
  const prov = incoming.provenance as Record<string, unknown> | undefined;
  if (prov && (prov.import_batch_id || prov.source === 'history_import')) {
    return { shouldSupersede: false, reason: 'historical_import', action: 'review' };
  }

  return { shouldSupersede: true, reason: 'newer_fact_same_slot', action: 'supersede' };
}
`;
  if (!c.includes('checkSingleValueSupersede')) {
    c += supersedeRules;
    fs.writeFileSync(p, c, "utf8");
    console.log("P0-6 done");
  }
} else {
  console.log("P0-6: conflict-resolver.ts not found, creating new module");
  // Create a standalone module
  let crContent = fs.readFileSync(base + "/brain-server/src/graphrag/conflict-resolver.ts", "utf8");
  crContent += supersedeRules;
}
