# Post-CP8 Real E2E — Real Run Procedure

## 0. Preconditions

1. `gh auth status` confirms the operator account owns the target repo
   (ADMIN) and uses HTTPS. No token is ever read, printed or inherited.
2. The target is ONE disposable fixture issue. Existing real issues are
   never touched. Fixture policy:
   - A. an existing disposable test issue is reused if one exists;
   - B. otherwise EXACTLY ONE fixture issue is created OUTSIDE Omni (plain
     `gh issue create`, recorded as TEST_SETUP_OUTSIDE_OMNI) in a repo the
     account owns, with the exact title
     `[DRG2-E2E] Disposable issue-close verification fixture` and the body
     "This issue exists only to verify the Omni-Context real read-back E2E.
     Safe to close."
3. If ownership cannot be confirmed: STOP (OWNER_TEST_TARGET_REQUIRED).
4. If gh auth is missing: REAL_E2E_EXTERNAL_RUN=BLOCKED_GITHUB_AUTH (code
   complete, DRG-2 cannot PASS).

## 1. Brain prepare phase

```
npx tsx scripts/goal24-real-e2e/brain-phase.ts prepare --owner <owner> --repo <repo> --issue <N>
```

- STEP 1: live GitHub read (gh issue view / gh repo view through the
  harness-local trusted provider) → evidence candidates (asserted).
- STEP 2: CP6 Evidence Surface Runtime → guard action must be `proceed`;
  a CLOSED pre-state aborts with NO_EFFECT_REQUIRED (no redundant write).
- STEP 3: decision record created (decision_id).
- STEP 4: CP7 authorize → plan (awaiting_approval), approval request,
  binding digest. Outputs `brain-before.json` into the bridge dir
  (`.tmp/real-e2e`).

## 2. Human approval artifact

The operator writes a ONE-TIME file (e.g.
`.tmp/real-e2e/approval.txt`) containing exactly:

```
APPROVE <owner>/<repo>#<N>
```

Nothing else grants approval. The native phase consumes (deletes) the file;
a missing or mismatched artifact BLOCKS the write. No auto-approve flag
exists.

## 3. Native phase

```
OMNI_REAL_E2E_RUN=1 OMNI_REAL_E2E_BRIDGE=.tmp/real-e2e \
  OMNI_REAL_E2E_APPROVAL_FILE=.tmp/real-e2e/approval.txt \
  OMNI_GITHUB_CLI_EXE=D:\environment\github-cli\bin\gh.exe \
  cargo test --bin omni-context-desktop goal24_real_e2e_native_phase -- --ignored --nocapture
```

- Rebuilds the plan from the compiled capability + canonical inputs and
  proves the CP7 binding digest equals the Brain-bound digest.
- Grants native approval (Owner, single-use), consumes it, spawns the
  restricted broker close, persists the receipt, performs ONE independent
  read-back, exports `native-after.json`.
- Transcript moment: `PROCESS EXIT = 0` and
  `OUTCOME = PENDING` (native side has NO outcome authority).

## 4. Brain verify phase

```
npx tsx scripts/goal24-real-e2e/brain-phase.ts verify
```

- Applies the native-issued grant (CP7 verified-grant path).
- Opens the CP8 Outcome → must be PENDING.
- One bounded attempt with the trusted read-back observation.
- Trusted deterministic evaluator: exact number + state CLOSED ⇒ VERIFIED;
  OPEN ⇒ MISMATCH; anything else ⇒ INCONCLUSIVE/VERIFICATION_FAILED.
- Persists the OutcomeRecord and writes the machine-readable proof
  (`docs/goal24/real-e2e/real-e2e-proof.json`) + outcome JSON.

## 5. Independent final confirmation (outside Omni)

```
gh issue view <N> --repo <owner>/<repo> --json number,state,closedAt
```

The GitHub-side CLOSED state is the final external witness recorded in the
proof.
