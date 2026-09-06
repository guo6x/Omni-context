# Goal28 Lite capability/adapter guide

Goal28 adds one deliberately narrow second capability/adapter pair:

- capability: `git.branch.create`
- adapter: `git.local`
- trusted tool: a canonical local Git executable
- read-back capability: `git.branch.read`

The capability contract accepts only semantic inputs:

```json
{
  "repository_path": "absolute approved disposable repository path",
  "branch_name": "bounded local branch name",
  "start_point": "full lowercase 40-hex commit SHA"
}
```

`command`, `args`, `shell`, `cwd`, `env`, executable paths, and binding IDs are
not capability inputs. Unknown keys are rejected. The compiled native adapter
owns the trusted Git executable, the approved local work-root, the empty
environment allowlist, output limits, semantic argv construction, and the
canonical read-back parser. Branch creation is fixed to `git branch <branch>
<full-sha>` and read-back is fixed to `git rev-parse --verify
refs/heads/<branch>`.

The existing pipeline remains in force:

1. Brain evidence qualification requires an asserted, fresh
   `repository.current_state` fact with conflict rejection.
2. The existing `omni-context-evidence-decision-kernel-v1` produces the
   decision; Goal28 does not add or fork a kernel.
3. The existing authorization service creates an L1, medium-risk,
   reversible-write plan that is awaiting explicit human approval.
4. Approval grants authority but does not execute.
5. Explicit native execution consumes the single-use approval and creates one
   trusted native receipt.
6. Independent `git.branch.read` read-back supplies one strict lowercase
   40-hex `target_sha`; the existing outcome service changes PENDING to
   VERIFIED only when it matches the approved start point.

The native golden test uses a disposable temporary repository, creates one
fixture commit, proves that approval alone creates neither a branch nor a
receipt, executes exactly once through the native Broker, and verifies the
branch target through the registered read-back binding. It does not touch a
GitHub repository or any protected project ref.

Negative coverage includes unknown generic execution fields, option-like and
shell-significant branch names, missing approval, replay, and read-back
binding policy checks. Agent Pilot remains limited to its existing read-only
surfaces: it cannot approve, execute, control-verify, reopen, or access the
native broker.

Focused local checks:

```text
brain-server: npx vitest run tests/goal28-second-adapter.test.ts
desktop-daemon/src-tauri: cargo test --bin omni-context-desktop local_git::
desktop-daemon: npm run verify:controlled
root: npm run cli:test
root: npm run cli:smoke
```

POSIX execution was not run on this workstation. That limitation is recorded
in `docs/goal28/deferred-verification.json` and remains deferred to Goal29.
