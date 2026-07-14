# Embedding usage profile

The embedding contract is now a versioned profile rather than a model-name switch. The E5-Large profile records model ID/revision, ONNX file, quantization, tokenizer, model hash, dimension, maximum tokens, prefixes, pooling, normalization, serialization versions, and usage-profile version.

Production behavior:

- query input is normalized once to `query: <text>`;
- entity and assertion input is normalized once to `passage: <text>`;
- an existing correct prefix is not duplicated;
- empty/whitespace input is rejected;
- mean pooling, attention mask, L2 normalization, and 512-token truncation remain active;
- profile fingerprint changes invalidate manifests and forbid old-vector reuse;
- local load failure is fatal; there is no hash or small-model fallback.

Active profile:

```text
usage_profile_version=e5-large-v1
fingerprint=369ab26bb142863960d7cf22bb1b79afda1195120079f4b8aea28e605f77b853
query_prefix="query: "
passage_prefix="passage: "
pooling=mean
normalize=true
max_tokens=512
```

Tests cover prefix-once behavior, empty rejection, query/passage divergence, profile invalidation, and refusal to reuse incompatible vectors.
