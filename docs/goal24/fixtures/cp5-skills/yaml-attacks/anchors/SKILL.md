---
name: anchors
description: Uses YAML anchors and aliases in frontmatter.
metadata:
  base: &base
    version: "1.0.0"
  copy: *base
---
# Anchors Fixture

Anchor/alias expansion can multiply the effective document size. Import must
bound the expanded value or reject aliases outright.