# Retrieval diagnosis

The successful single-scene and failed batch use the same result envelope, but not the same product behavior. The successful Top-10 contains the Candidate v3.1 structured format in all 10 items, including exact value, state key, raw quote, real Agent labels, and event evidence. The failed batch contains that format in 0 of 70 items, has no event source ID, contains 55 support-note items and 25 relationship IDs, and promotes people, values, checkpoints, options, and note names into `source_agents`.

The wiring explains the discontinuity. `benchmark/cognitive/src/cli.mjs` hard-codes `brainServerRoot` to the Benchmark checkout. It offers no external product-root argument and performs no expected-commit or build-hash check. At Benchmark commit `0494070`, that checkout's Brain Server is materially older than product commit `2e300ac`: the Evidence Selector, Retrieval Trace, and Evidence Fidelity source files are absent. The batch therefore could not have executed Candidate v3.1's selector, even though the separately prepared single-scene build did.

Root cause is classified as `WRONG_SERVER_INSTANCE + OLD_OR_STALE_BUILD + SELECTOR_BYPASSED`. This is a Benchmark runtime wiring defect and does not consume a product repair round. Retrieval weights and product ranking must remain unchanged until the runner launches and attests the dedicated product Worktree.
