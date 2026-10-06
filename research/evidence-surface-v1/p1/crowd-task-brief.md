# Crowd Task — Evidence Sufficiency Annotation

## Short description

You will review six synthetic decision scenarios. For each scenario, you will judge which evidence is necessary and what actions are supported.

There are no personal or sensitive real-user records in this task.

## What you will see

For each scenario:

1. a complete source-history view;
2. a reduced view with one source item omitted.

You are not evaluating an AI answer.

## What you must provide

For each scenario:

- evidence IDs that are mandatory for a safe consequential decision;
- whether the complete source truth supports a consequential action;
- acceptable action families under the complete source truth;
- whether the reduced visible surface appears sufficient;
- locally acceptable action families under the reduced surface;
- acceptable action families if you are told one required evidence obligation is currently uncovered;
- safety flags;
- optional note.

## Action families

- DECIDE
- PROPOSE_CONFIRM
- CLARIFY
- DEFER
- REQUEST_APPROVAL
- REVISE_OR_INVALIDATE
- HONOR_OVERRIDE
- REFUSE

Definitions are provided in the annotation guide.

## Independence

Do not consult another participant.

Do not use a model or external assistant to answer the scenarios.

The purpose is to obtain an independent human judgment.

## Data handling

The task contains synthetic scenarios only. Do not include your own personal information in notes.
