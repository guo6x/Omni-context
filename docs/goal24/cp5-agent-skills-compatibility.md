# CP5 Agent Skills Compatibility (Lane C)

Goal24 Checkpoint 5, Lane C. Documentation-only evidence for the Skill
Registry / Agent Skills security oracle. No runtime was modified.

## 1. Official sources reviewed (2026-08-13)

| Source | URL | Access | Weight |
|---|---|---|---|
| Agent Skills open standard specification | https://agentskills.io/specification | fetched in full (HTML and `.md`) | canonical open-standard definition |
| OpenAI official guide: Skills in the API | https://developers.openai.com/api/docs/guides/tools-skills | official search snippets (direct fetch returned HTTP 403 from this network) | official OpenAI definition |
| OpenAI Cookbook: Skills in API | https://developers.openai.com/cookbook/examples/skills_in_api | official search snippets (same 403) | official OpenAI usage/upload behavior |
| Anthropic official docs: Agent Skills overview | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview | official search snippets (domain unreachable from this network) | official Anthropic definition |
| Anthropic official docs: Skills for enterprise | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise | official search snippets | official security posture |
| Local Codex skill package (lived example) | `C:\Users\00\.codex\skills\.system\openai-docs\SKILL.md` | read directly | observed variant of the format on this machine |

Blog reposts were not used as substitutes for any official definition.

## 2. Current format assumptions

### 2.1 Directory structure (open standard)

A skill is a directory containing at minimum one `SKILL.md`:

```text
skill-name/
  SKILL.md        # required: metadata + instructions
  scripts/        # optional: executable code
  references/     # optional: documentation
  assets/         # optional: templates/resources
  ...             # any additional files/directories
```

### 2.2 SKILL.md frontmatter (open standard fields)

| Field | Required | Constraints |
|---|---|---|
| `name` | yes | 1-64 chars; lowercase letters, digits, hyphens only; must not start/end with `-`; no consecutive `--`; must match the parent directory name |
| `description` | yes | 1-1024 chars, non-empty |
| `license` | no | license name or reference to a bundled license file |
| `compatibility` | no | 1-500 chars if provided; environment requirements |
| `metadata` | no | map of string keys to string values |
| `allowed-tools` | no | space-separated string of pre-approved tools (experimental) |

The body after the frontmatter is unrestricted Markdown: the skill
instructions. The agent loads the whole body once the skill is activated.

### 2.3 Progressive disclosure (open standard)

- Metadata (~100 tokens): `name` + `description` are loaded at startup for
  every skill.
- Instructions (< 5000 tokens recommended): the full `SKILL.md` body is
  loaded when the skill is activated.
- Resources (as needed): files under `scripts/`, `references/`, `assets/`
  are loaded only when required.
- `SKILL.md` should stay under 500 lines; file references should be relative
  from the skill root and one level deep.

### 2.4 OpenAI specifics (official guide/cookbook)

- A skill is a versioned bundle of files plus a `SKILL.md` manifest
  (front matter + instructions), usable in hosted and local shell
  environments.
- Skills are compatible with the open Agent Skills standard.
- `SKILL.md` matching is case-insensitive; exactly one `skill.md`/`SKILL.md`
  is allowed per bundle.
- Frontmatter validation follows the Agent Skills specification (`name`
  field in particular).
- `POST /v1/skills` uploads and validates a skill bundle, extracting `name`
  and `description` from the manifest frontmatter.

### 2.5 Anthropic specifics (official docs)

- Every skill requires a `SKILL.md` with YAML frontmatter.
- `name`: max 64 chars, lowercase letters/numbers/hyphens, no XML tags,
  reserved words forbidden (`anthropic`, `claude`), must match the directory
  name.
- `description`: max 1024 chars (Claude.ai UI additionally limits to 200),
  non-empty, no XML tags, third person with triggering conditions.
- Managed agents: max 500 skills per session. The API attaches prebuilt
  skills by `type: anthropic` + `skill_id` and custom skills by their
  `skill_*` id.
- Enterprise security page (official): bundled scripts run with full
  environment access; instruction manipulation (directives to ignore safety
  rules, hide actions, alter behavior conditionally) is rated high risk;
  guidance is to review `SKILL.md` and all referenced files, run scripts in
  a sandbox, and never deploy skills from untrusted sources without a full
  audit. A malicious skill can direct an agent to execute arbitrary code.

### 2.6 Local Codex variant observed on this machine

The shipped Codex `openai-docs` skill uses the same shape plus a
`metadata:` block (`short-description`) and quoted string scalars:

```yaml
---
name: "openai-docs"
description: "..."
metadata:
  short-description: "..."
---
```

Consistent with the open standard: `name`/`description` required,
`metadata` as an arbitrary string map, body as unrestricted instructions.

## 3. Security implications of the external format

- A skill is an untrusted procedural artifact: its body instructs an agent
  that holds real permissions. Displaying or activating it is a prompt
  injection surface.
- Frontmatter is metadata, not safety policy. Nothing in `SKILL.md` may set
  risk, evidence, trust, approval, or execution authority in Omni.
- `scripts/` exists in the external ecosystems precisely for execution;
  Anthropic officially warns those scripts get full environment access.
  Omni CP5 intentionally does not support execution (see below).
- `allowed-tools` is experimental and varies between implementations. Omni
  treats it as inert descriptive text; it never grants tools.
- Name/description grammars (no XML tags, length caps, reserved words) exist
  partly to stop metadata-level injection; Omni must enforce the same
  grammar at import.

## 4. Omni CP5 compatibility matrix

| Item | CP5 position |
|---|---|
| OpenAI Agent Skills: discovery/import compatibility | COMPATIBLE: read `SKILL.md` frontmatter (`name`, `description`, optional fields), snapshot every package file. Hosted/API-side skill ids are out of CP5 scope; CP5 imports local directories/archives only. |
| Anthropic Agent Skills: discovery/import compatibility | COMPATIBLE: same subset; Anthropic reserved-word and name-grammar constraints are additionally enforced. |
| `SKILL.md` | supported (exactly one case-insensitive manifest file per package) |
| YAML frontmatter | supported subset: `name` (validated), `description` (validated), `license`, `compatibility`, `metadata` (string map), `allowed-tools` (inspected only). Unknown fields rejected-or-ignored, never interpreted as policy. |
| `resources/` (`references/`, `assets/`, other files) | snapshot supported (inert bytes + metadata) |
| `scripts/` | snapshot/inspection only. Execution unsupported in CP5. |
| Omni safety manifest (`omni-skill.json`) | required for executable eligibility; canonical per-capability safety posture; skill may only tighten, never loosen (see threat model). |
| Auto trust | never. Trust originates only from explicit owner action outside the package. |

## 5. Script execution: a security profile, not an omission

External Agent Skills ecosystems allow bundled scripts to run (with full
environment access in Anthropic products). Omni CP5 deliberately supports
only import / snapshot / inspect. Script execution is NOT SUPPORTED IN CP5
as a security profile. If execution is ever added, it must go through an
independent sandbox and execution policy plus its own formal checkpoint.

See `cp5-skill-threat-model.md` for the threat model and
`cp5-skill-adversarial-vectors.json` for the machine-readable oracle.