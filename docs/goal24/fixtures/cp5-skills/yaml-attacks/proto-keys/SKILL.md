---
name: proto-keys
description: Prototype-like metadata keys.
metadata:
  __proto__: polluted
  constructor: polluted
  prototype: polluted
---
# Prototype Keys Fixture

`__proto__`, `constructor` and `prototype` keys must never reach object
construction in a JavaScript importer. Reject or strip; never merge into
objects with prototype semantics.