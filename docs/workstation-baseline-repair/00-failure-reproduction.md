# Windows baseline repair — failure reproduction

Date: 2026-09-04

Base: 566252ca532788d949c508680d0258107c17a390

Worktree: D:\AI_code\Omni-context-worktrees\windows-baseline-repair

The quarantined clone and recovery patch/bundle were not used or modified.
No Goal27 branch, benchmark, Holdback payload, npm publication, or real
external write was used.

## Windows identity captured before edits

Native sources disagree on the friendly product label:

| Source | Product | Build | Other fields |
| --- | --- | --- | --- |
| [System.Environment]::OSVersion | version 10.0.26200.0 | 26200 | — |
| Win32_OperatingSystem | Microsoft Windows 11 家庭版 中文版 | 26200 | version 10.0.26200, x64 |
| Get-ComputerInfo | OsName=Microsoft Windows 11 家庭版 中文版 | 26200 | WindowsProductName=Windows 10 Home China, x64 |
| HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion | ProductName=Windows 10 Home China | CurrentBuild=26200 | DisplayVersion=25H2, UBR=9278, EditionID=CoreCountrySpecific, InstallationType=Client |

Operational identity for this repair: Windows 11-family runtime, build 26200,
edition CoreCountrySpecific, client installation, x64. The registry
ProductName discrepancy is recorded, not changed.

## Initial classifications

| Blocker | Initial classification | Reproduction result |
| --- | --- | --- |
| CLI test | TEST_DEFECT / host-auth contamination | run(['ask']) observes a real local token and reaches the offline Brain before argument validation |
| Rust test | TEST_DEFECT / process-global test-environment leakage | failing tests acquire the child lock but do not establish their required child mode |
| Desktop controlled verifier | WINDOWS_PORTABILITY_DEFECT + STALE_CONTROLLED_BASELINE | verifier hashes CRLF working-tree bytes; two snapshot entries also predate current authoritative Git blobs |
| Windows CLI smoke | WINDOWS_PORTABILITY_DEFECT | npm invokes cmd.exe with POSIX-only /dev/null redirection |

## 1. CLI failure

Command, from packages/omctx:

~~~text
npm.cmd test
~~~

Exit code: 1.

Test summary:

~~~text
ℹ tests 41
ℹ suites 0
ℹ pass 40
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
~~~

Exact failing test and stack:

~~~text
test at test\cli-parser.test.js:31:1
✖ parser: missing args - ask requires a situation
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  5 !== 4

      at TestContext.<anonymous> (packages/omctx/test/cli-parser.test.js:34:10)
      at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
~~~

The test expects EXIT.AUTH_ERROR=4; observed run() return value is 5,
EXIT.SERVICE_UNAVAILABLE.

The same behavior was isolated with:

~~~text
node --input-type=module -e "const {run}=await import('./src/cli.js'); const code=await run(['ask']); console.error('RETURN_CODE='+code);"
~~~

Captured streams:

~~~text
process exit code: 0
stdout: ""
stderr:
omctx: OMCTX_BRAIN_OFFLINE: Brain Server is not reachable: fetch failed
RETURN_CODE=5
~~~

The inline process exits zero because it does not assign process.exitCode; the
CLI run() result is the relevant value.

Metadata-only auth audit:

~~~text
%LOCALAPPDATA%\omni-context\local-token.txt
exists: true
length: 43 bytes
contents: not read
OMNI_LOCAL_API_TOKEN: absent
~~~

cli.js lines 89-92 build the client and perform ensureCompatibility() before
commands/ask.js line 14 validates the missing situation. With the host token,
the compatibility probe reaches the unavailable local Brain and returns 5.

Control run with LOCALAPPDATA redirected to a nonexistent temporary directory
and OMNI_LOCAL_API_TOKEN removed:

~~~text
process exit code: 0
stdout: ""
stderr:
omctx: OMCTX_AUTH_MISSING: no local API token found (set OMNI_LOCAL_API_TOKEN or run the Omni Desktop app once)
RETURN_CODE=4
~~~

This proves the product exit-code mapping is stable and the test is not
hermetic against a machine-local credential. Classification: TEST_DEFECT.
The repair is test isolation only. Public semantics remain unchanged:
usage=2, locked/future=3, authentication=4, service unavailable=5.

## 2. Rust failure

After preparing the isolated worktree frontend output with npm ci and npm run
build, the canonical full test command was run with no broker test-mode
variable inherited:

~~~text
$env:CARGO_HTTP_PROXY=''
$env:HTTP_PROXY=''
$env:HTTPS_PROXY=''
$env:ALL_PROXY=''
$env:RUST_BACKTRACE='1'
Remove-Item Env:OMNI_BROKER_TEST_MODE -ErrorAction SilentlyContinue
cargo test --locked --manifest-path desktop-daemon/src-tauri/Cargo.toml
~~~

Exit code: 1.

Observed final failure:

~~~text
test execution_broker::tests::executable_fingerprint_change_detected ... FAILED

thread 'execution_broker::tests::executable_fingerprint_change_detected' panicked at src\execution_broker\tests.rs:858:5:
assertion failed: result.success
stack backtrace:
...
failures:
    execution_broker::tests::executable_fingerprint_change_detected

test result: FAILED. 230 passed; 1 failed; 9 ignored; 0 measured; 0 filtered out
error: test failed, to rerun pass --bin omni-context-desktop
~~~

The earlier clean-primary reproduction selected the sibling
execution_broker::tests::executable_arbitrary_input_impossible at
src/execution_broker/tests.rs:814; the selected failure changes with suite
order, which is evidence of shared test state.

Each failing test passes alone. For example:

~~~text
cargo test --locked --manifest-path desktop-daemon/src-tauri/Cargo.toml execution_broker::tests::executable_fingerprint_change_detected -- --exact --nocapture
running 1 test
test execution_broker::tests::executable_fingerprint_change_detected ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 239 filtered out
exit code: 0
~~~

tests.rs lines 9-10 document a process-global environment protocol. The shared
lock is declared at line 28 and acquired by both failing tests at lines 801
and 844, but neither test sets OMNI_BROKER_TEST_MODE before its first child
execution. The child reads that variable at lines 152-156. Other tests set
modes such as sleep, large-output, or stderr; those values remain in the
process environment after their test completes.

Classification: deterministic TEST_DEFECT, not a Windows path, ACL, file
locking, process-tree, broker, approval, replay, binding, timeout,
environment-allowlist, or read-back security regression. The repair sets the
expected echo mode in these two tests while holding the existing lock. No
production code or security invariant changes.

After those two environment-leak fixes, the full suite exposed a second,
independent assertion defect:

~~~text
test execution_broker::approval::tests::concurrent_consume_exactly_one_wins ... FAILED

thread 'execution_broker::approval::tests::concurrent_consume_exactly_one_wins'
panicked at src\\execution_broker\\approval\\tests.rs:529:5:
assertion `left == right` failed
  left: Some(ApprovalConsumed)
 right: Some(PlanRejectedSingleUse)

test result: FAILED. 230 passed; 1 failed; 9 ignored
~~~

The targeted test passes or fails intermittently because the two threads race
between the pre-acceptance approval verification and the durable plan-ledger
acceptance. The losing thread therefore legitimately observes either
`PlanRejectedSingleUse` (the ledger wins the race) or `ApprovalConsumed` (the
winning thread consumes the approval before the loser finishes verification).
The target was also run alone repeatedly; every run had exactly one successful
execution, and no run produced two successes. The approval store's
compare-and-consume remains mutex-protected and single-use. Existing crash and
concurrency tests already accept both fail-closed codes. The repair changes
only this test assertion to accept that documented race outcome while
retaining the exact-one-success assertion; production semantics and security
invariants remain unchanged.

The first attempt before generating desktop-daemon/out failed earlier with:

~~~text
error: proc macro panicked
message: The distDir configuration is set to "../out" but this path doesn't exist
~~~

That was an ordinary worktree preparation issue, not the Rust test failure.

## 3. Desktop controlled-file verifier

Command, from desktop-daemon:

~~~text
npm.cmd run verify:controlled
~~~

Exit code: 1.

Exact output:

~~~text
[verify-controlled-files] Tauri/tooling attempted to modify controlled files:
  - src-tauri/src/brain_server.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/main.rs
Fix the cause, then re-run with --snapshot only if the change is intentional.
~~~

The verifier hashes working-tree bytes directly at
scripts/verify-controlled-files.mjs lines 39-40 using readFileSync. It does
not hash Git blobs or normalize text first.

Captured settings:

~~~text
.gitattributes: * text=auto
git config core.autocrlf: false
git check-attr: each of the three Rust files has text: auto
~~~

All three controlled files contain CRLF in the Windows checkout. Their
normalized-LF bytes equal their current Git blobs:

| File | Snapshot SHA-256 | Working-tree SHA-256 | Normalized LF / Git-blob SHA-256 |
| --- | --- | --- | --- |
| src-tauri/src/brain_server.rs | 93b33051c27db16a76025b7bd198ad186e82941fd552ae12a0b1d2feaad1b8db | b828208eeb9488c8ec72110c763c4d3b93eb8ba59251e94b90449a5cbfbf41de | f25dc00861c90dc65aab4129c52afed33add49224a413e9976cf981d96632a14 |
| src-tauri/src/commands.rs | ec2a2c9483358efd1ce88aa812e0f6c180503e086369749d5003c892f86bd26d | f2143f406aca8327358d9f8a852a7a7796d984dca3f360d36338b378b0e8a780 | ec2a2c9483358efd1ce88aa812e0f6c180503e086369749d5003c892f86bd26d |
| src-tauri/src/main.rs | 299a7c181ab793d8667237c6f05c6afecb73cee07d076de0b83b84ea6c2f3385 | 84baffa1cd9cb479e0a58eff424f58ee772e19610fb037f4116d75eb1718ecf1 | 92f70bdb842f3cd028ce086ed108efc231578c5301ddbf90537c565e58454c80 |

~~~

git diff --exit-code remains clean, confirming Git sees no unauthorized source
change. The commands.rs snapshot is the current canonical blob but the
verifier still rejects its CRLF checkout. The brain_server.rs and main.rs
snapshot entries are stale relative to current authoritative Git blobs. The
remaining 18 snapshot entries also record incidental CRLF checkout bytes and
become mismatches when the verifier adopts canonical LF hashing.

Classification:

- B: yes — working-tree representation differs only by CRLF/LF from canonical.
- C: yes — two committed snapshot values predate current authoritative source;
  18 other values encode incidental CRLF checkout bytes.
- D: yes — direct working-byte hashing makes verification depend on checkout representation.
- E: no — normalized working bytes equal current Git blobs for all three files.
- A: no as a source-integrity claim; no functional controlled source change found.

The security contract is controlled source integrity, not incidental platform
line-ending representation. The repair normalizes CRLF to LF for controlled
text files before hashing, updates the two stale source entries, and
canonicalizes the 18 raw-checkout entries to their independently verified
Git-blob hashes. No --snapshot regeneration was used before analysis.

## 4. Windows /dev/null failure

Command, from repository root:

~~~text
npm.cmd run cli:smoke
~~~

Exit code: 1.

Exact output:

~~~text
> omni-context@0.1.1 cli:smoke
> node packages/omctx/bin/omctx.js --help >/dev/null && node packages/omctx/bin/omctx.js version >/dev/null && node packages/omctx/bin/omctx.js version --json >/dev/null
The system cannot find the path specified.
~~~

The literal /dev/null occurs in:

~~~text
package.json:20
packages/omctx/package.json:21
~~~

Additional matches are intentionally not portability defects:

~~~text
.github/workflows/build.yml:79: POSIX shell block uses 2>/dev/null; preserve shell-specific behavior
.node-cache/node-v22.16.0-win-x64.exe: generated/binary cache string; do not edit
~~~

The root and package smoke scripts use redirection only to suppress output;
they do not depend on the null device for product behavior. The minimal
cross-platform repair removes the POSIX-only redirection from those two npm
scripts. The commands still fail on any nonzero CLI status and work on
Windows, Linux, and macOS.

## Pre-repair conclusion

All four original blockers are reproducible and have deterministic causes.
None requires a product-semantic relaxation:

1. CLI: test isolation fix only; public exit semantics unchanged.
2. Rust: test isolation fix only; broker/security semantics unchanged.
3. Desktop: canonical text hashing plus a fully canonicalized manifest; two
   entries were stale source baselines and 18 were raw checkout hashes.
4. CLI smoke: remove two POSIX-only npm redirections.
