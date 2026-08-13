---
name: custom-tag
description: Frontmatter uses a custom YAML tag.
metadata: !omni/policy risk=low
---
# Custom Tag Fixture

Custom YAML tags must be rejected by a safe parser; unknown tags are a code
execution and policy injection vector in unsafe YAML libraries.