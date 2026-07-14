# E5-Large integration

Pinned production model:

```text
model_id=Xenova/multilingual-e5-large
upstream_family=intfloat/multilingual-e5-large
revision=a19b072cb4f0cc8bf98b4e46f90a787a61380979
onnx_file=onnx/model_quantized.onnx
quantization=QInt8
tokenizer=@xenova/transformers@2.17.2:XLMRobertaTokenizer
dimension=1024
onnx_sha256=0a8d65db9a36f810ba5da15249f13145fcdc7890e6656f1fd38cd8b7c4db1fca
```

The local immutable copy is at `D:\OmniContext-models-v3.2\Xenova\multilingual-e5-large`; nothing was downloaded to C:. Startup verifies the model hash and actual output dimension. The real Windows preflight was healthy and produced distinct query/passage vectors.

Rollback is explicit, not silent: `Xenova/multilingual-e5-small`, 384 dimensions, profile `e5-small-prefixed-v2`, pinned local-bundle revision and SHA. A separate rollback preflight passed, but no Candidate v2 query used it.
