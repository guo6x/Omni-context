---
name: case-alias
description: Mixed-case SKILL.md filename variant.
---
# Case Alias Fixture

This file is named Skill.md (mixed case). Case-insensitive filesystems alias
it to SKILL.md; importers must detect duplicate-manifest aliasing on
case-insensitive filesystems and reject packages containing more than one
case variant of the manifest name.