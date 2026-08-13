---
name: control-chars
description: [31mCONTROL[0m  bell
---
# Control Characters Fixture

The description above embeds C0 control characters (ESC, BEL) inside the
frontmatter value. Import must reject or sanitize them; they must never
reach logs or the inspector UI raw.