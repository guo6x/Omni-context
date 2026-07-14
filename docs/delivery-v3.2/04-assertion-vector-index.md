# Assertion vector index

Assertions are first-class semantic records in independent `vec_assertions`; they are never disguised as entities. The schema stores assertion ID, content hash, model/revision, dimension, profile/serialization versions, timestamps, and temporal validity.

Re-embedding is triggered by fact text, subject/object, original predicate, literal/source/provenance, time/validity, model/profile, or serialization changes. Invalidated assertions are removed from current retrieval. Integrity scanning reports missing, zero, NaN, wrong-dimension, orphan, and stale rows.

Verified fixed-v1 extraction rebuild:

```text
active entities=382, vectors=382, coverage=1.0
active assertions=423, vectors=423, coverage=1.0
zero=0, NaN=0, wrong_dimension=0, orphan=0, stale=0
```

Formal-run extraction exposed and fixed an additional incremental-index defect: auto-merged aliases were being inserted into `vec_entities`. Merged aliases are now excluded at write time as well as during full rebuild.
