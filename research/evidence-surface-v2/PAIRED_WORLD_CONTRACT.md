# V2 Surface-Identical Paired-World Contract

## Purpose

V1 established a policy-relative failure: the frozen policy did not react to some missing transition evidence.

V2 needs a stronger construct. A paired-world example contains two different underlying worlds that expose **exactly the same downstream policy input** while requiring **disjoint decisive actions**.

The point is not to claim that no system can ever recover the hidden state. The point is to isolate what is and is not identifiable from the decision-visible surface alone.

## Definition

For world w, let S(w) be the complete input exposed to a downstream decision policy.

A valid paired-world instance (w_A, w_B) satisfies:

1. **Surface identity:** S(w_A) = S(w_B) exactly after canonical serialization.
2. **Truth difference:** the hidden world states differ.
3. **Decisive incompatibility:** the sets of valid decisive actions A_A and A_B are nonempty and disjoint.
4. **No Gold leakage:** S contains no hidden state, treatment label, correct action, coverage-complete label, or equivalent world-truth field.
5. **No hidden-event ID leakage:** hidden transition event IDs do not appear as visible evidence source IDs.
6. **Shared fallback vocabulary:** the pair declares one or more safe fallback actions such as DEFER or CLARIFY.

The validator enforces items 1-6 mechanically where they are syntactic.

## Proposition 1 — deterministic surface-only limitation

Let pi be any deterministic policy whose only input is S.

For a valid pair:

S(w_A) = S(w_B)

therefore:

pi(S(w_A)) = pi(S(w_B)).

Because A_A and A_B are disjoint, a single decisive output cannot be valid in both worlds.

Therefore:

> If a deterministic surface-only policy emits a decisive action on a valid paired-world input, that action is invalid in at least one member of the pair.

This is an information-boundary statement, not a model-performance claim.

## Proposition 2 — equal-weight stochastic bound

Let q(a | S) be any stochastic surface-only policy. The output distribution is identical in both worlds because S is identical.

For an equal-weight pair with disjoint valid decisive-action sets A_A and A_B:

P(correct decisive | pair)
= 1/2 * q(A_A | S) + 1/2 * q(A_B | S)
<= 1/2.

Fallback probability does not violate this bound; it reduces decisive completion.

Thus a surface-only stochastic policy can trade completion for safety, but cannot obtain decisive correctness above 50% on an equal-weight, two-world pair solely from the shared surface.

This bound applies to the constructed pair distribution. It is not a prevalence claim about real-world tasks.

## What breaks the bound

The bound is broken only when the system receives information not contained in the identical surface, for example:

- acquisition-ledger state;
- source sequence/high-water marks;
- source-head versus retrieved-head consistency;
- revision/tombstone index state;
- trusted workflow completion metadata;
- an oracle world-truth label.

V2 distinguishes deployable acquisition-side signals from oracle labels.

## Experimental consequence

The primary V2 question is no longer:

> Does deleting one required evidence record increase UDR?

It becomes:

> When the decision-visible surface is insufficient to identify which world the agent is in, can a non-oracle acquisition-side completeness mechanism recover enough information to reduce world-action violations without collapsing task completion?

## Non-claims

This contract does not establish:

- that real deployments frequently produce such paired surfaces;
- that every missing-evidence event is observationally indistinguishable;
- that always deferring is a useful product policy;
- that an acquisition ledger is perfectly reliable;
- that the hidden world state is unknowable to a system with additional trusted channels.

Those are empirical questions for V2.
