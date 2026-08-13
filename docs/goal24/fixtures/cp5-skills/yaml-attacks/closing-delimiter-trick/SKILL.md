---
name: closing-delimiter-trick
description: Frontmatter closed with ... and a fake closing line in the body.
...
---
# Closing Delimiter Trick Fixture

The body below contains a line that looks like a closing delimiter:

---

Import must parse exactly one frontmatter block using the canonical closing
delimiter and must not re-open frontmatter parsing later in the body.