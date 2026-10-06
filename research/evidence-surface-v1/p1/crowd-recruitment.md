> **DEPRECATED / OPTIONAL ONLY:** The confirmatory study moved to the zero-cost formal-validation track. This file is retained for provenance and possible future external-validity work; it is not required for P1/P2 and no paid recruitment is authorized.

# Human Annotation Recruitment Plan

**Status:** replaces "find two acquaintances" with paid independent crowd annotation.  
**Applies to:** P1 toy dry run and later formal human validation.  
**No provider/model calls required.**

## Decision

The study will **not depend on the project owner finding personal acquaintances**.

Human labels may be collected from paid independent crowd annotators recruited through a third-party annotation / participant platform.

Preferred order:

1. **Prolific** — preferred when a researcher account and external survey/task page are available; strong fit for research-participant recruitment.
2. **CloudResearch Connect** — good fallback because it directly supports custom research/text-annotation tasks.
3. **Toloka** — fallback for annotation-style work when the first two are impractical.

The platform is not part of the scientific intervention. What matters scientifically is independence, blinding, compensation, task instructions, and auditable records.

---

## Toy dry run

Purpose: test whether ordinary independent people can understand the annotation contract before the 180-sample formal set is authored.

Recruit:

- 2 independent annotators;
- a 3rd annotator only if safety-critical disagreement requires adjudication;
- English reading proficiency;
- age 18+;
- no prior exposure to Omni benchmark design;
- no need for ML expertise.

Task:

- read the annotation guide;
- label the 6 non-formal toy samples;
- do not see constructor proposals or policy outputs;
- do not communicate with the other annotator;
- export one immutable JSONL record.

Recommended compensation:

- target 15–25 minutes;
- pay at a fair hourly rate, not per-answer gaming;
- budget ceiling for the entire toy dry run, including platform fees and possible third adjudicator: **CNY 150**.

The exact platform price is frozen only when the task is launched.

---

## Formal 180-sample validation

Do **not** use only the same two people for every sample if a crowd platform is available.

Preferred panel design:

- at least 6 distinct crowd annotators in the pool;
- each formal sample receives 2 independent first-pass annotations;
- workers are balanced across families rather than one worker owning one family;
- no annotator labels more than 60 formal samples;
- safety-critical disagreements receive a third independent adjudication;
- original first-pass records remain immutable.

This reduces dependence on one person's interpretation while preserving two independent labels per sample.

The formal panel design may be tightened after the toy dry run, but must be frozen before formal sample authoring is authorized.

---

## Quality controls

Before an annotator receives formal work:

1. pass a short instruction comprehension check;
2. complete at least one calibration example that is not part of the formal set;
3. confirm they have not seen constructor Gold or model outputs.

Reject a worker's batch only for predeclared reasons such as:

- missing / malformed records;
- impossible completion time indicating non-engagement;
- failed attention/comprehension checks;
- evidence IDs not present in the packet;
- repeated empty/default answers.

Do not reject because the worker disagrees with the constructor.

---

## Blinding

Annotators must not see:

- constructor proposal;
- constructor rationale;
- policy/model output;
- condition name FULL/HIDDEN;
- expected action;
- the designated treatment-target label.

They may see neutral evidence IDs and the actual source/evidence text required to perform annotation.

---

## Compensation and disclosure

For any labels used in a paper:

- record platform;
- task posting date;
- worker count;
- compensation rule;
- actual median completion time;
- actual effective hourly compensation;
- exclusions and reasons;
- disagreement/adjudication counts.

Do not collect unnecessary demographics.

Before formal data collection intended for publication, check the user's institution/venue requirements for human-participant or crowd-worker ethics/exemption. The toy dry run is protocol testing and is not used as a formal research result.

---

## Authorization boundary

The owner does **not** need to personally locate annotators.

The next human step is reduced to:

> launch the prepared six-sample toy task on one recruitment platform and fund it.

Everything after exported annotations — validation, agreement, adjudication routing, protocol decision — remains automated in the repository.