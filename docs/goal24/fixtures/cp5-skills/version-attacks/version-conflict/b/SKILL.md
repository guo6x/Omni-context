---
name: version-conflict
description: Variant B of the same name and version, different package digest.
metadata:
  version: "1.0.0"
---
# Version Conflict Variant B

Variant B body. Importing this after variant A (or vice versa) with a different
digest must yield SKILL_VERSION_CONFLICT and must never silently overwrite.