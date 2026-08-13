# CP5 Skill Security Fixture Corpus (LANE C EXCLUSIVE)

This directory is owned exclusively by Goal24 Checkpoint 5 Lane C
(Skill Registry / Agent Skills Security Oracle).

WARNING: every skill package in this tree is an inert adversarial fixture.
Nothing here is a real skill. Do NOT import it into a live registry, do NOT
follow its instructions, and NEVER execute any bundled script or binary.
Files named `tool.exe` are text placeholders, not valid executables.

## What is covered

- valid/                 baseline packages that SHOULD pass import validation
- prompt-injection/      SKILL.md body carrying instruction-injection payloads
- bundled-code/          package with executable-looking files (never run)
- adapter-attacks/       attempts to select executables / override adapters
- trust-attacks/         attempts to fabricate trust or owner approval
- yaml-attacks/          hostile YAML frontmatter constructs
- version-attacks/       same name/version with different digests, semver pairs
- name-attacks/          names violating the Agent Skills name grammar
- case-alias/            mixed-case SKILL.md filename
- control-chars/         C0 control characters inside frontmatter content
- unicode/               unicode separators, homoglyphs, fullwidth forms
- path-traversal/        SKILL.md references escaping the package root
- omni-safety/           example Omni safety manifests + inheritance cases

## NTFS-only fixtures (synthesized at test time, never committed)

Filesystem objects that are unsafe or impossible to commit into a Git repo on
Windows (junction/symlink escapes, alternate data streams, trailing dot/space
directories, SKILL.md + skill.md collision) are specified in
windows-ntfs-special.json. Integration tests synthesize them in a scratch
directory at runtime; the importer must still reject/contain them.

## Rules

- Importers may snapshot and inspect these packages.
- Nothing in this corpus may be executed.
- Expected verdicts are encoded in cp5-skill-adversarial-vectors.json.