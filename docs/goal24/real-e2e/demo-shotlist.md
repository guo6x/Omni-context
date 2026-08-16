# Post-CP8 Real E2E — Demo Shotlist (recording plan only)

No video tooling is required for this lane; this is the future recording
plan for the terminal.

1. OPEN issue — `gh issue view` shows state OPEN for the fixture issue.
2. Omni decision/evidence — Brain prepare prints live read +
   Evidence Guard action=proceed.
3. APPROVAL REQUIRED — plan state awaiting_approval + approval request.
4. APPROVED — native phase consumes the one-time human approval artifact.
5. PROCESS EXIT 0 — restricted broker close returned success=true.
6. OUTCOME PENDING — pause 1–2 seconds on this line; exit 0 did NOT
   verify anything.
7. READ-BACK CLOSED — independent gh issue view payload state CLOSED.
8. VERIFIED — trusted deterministic evaluator verdict.
9. Judgment history entry — OutcomeRecord persisted, revisit_required=false,
   history preserved.

Audio/narration beats: "exit 0 is a spawn fact, not a business outcome —
only the independent read-back plus the deterministic evaluator can verify
that GitHub really closed the issue."
