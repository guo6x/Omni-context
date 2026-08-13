---
name: path-traversal
description: Body references files outside the package root.
---
# Path Traversal Fixture

References to test against the importer:

- `../SKILL.md`
- `../../etc/passwd`
- `C:\Windows\System32\config\SAM`
- `\\server\share\evil`
- `\\?\C:\Windows\win.ini`
- `..\..\..\..\..\..\evil`

None of these may resolve outside the package snapshot root. Import must
canonicalize and reject, or resolve strictly inside the root.