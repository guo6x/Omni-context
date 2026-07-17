# Official scoring boundary

The sealed runner does not vendor or reimplement either benchmark metric. A future authorized scoring phase must provide `--scorer-module=<absolute path>` from an independently pinned checkout. The module exports one asynchronous function:

```js
export async function score(lockedResults, officialGold) {
  // Format conversion and invocation of the pinned official evaluator only.
}
```

The CLI validates the same custodian authorization, preregistration hash, generation projection hash, product commit, adapter commit, and allowed subset before loading the scorer or Gold. It then re-verifies the locked result hash before and after scoring and writes metrics with exclusive-create semantics. Gold access is recorded separately as `phase=scoring`; the product and Answer provider are not available through this interface.

Before a formal run, the custodian must replace the pending script hashes in `official-interface-locks.json` with SHA-256 values from the authorized official checkouts and review the thin wrapper. No official records or Gold are present in this repository.

Public interfaces pinned without opening benchmark records:

- LongMemEval: `src/evaluation/evaluate_qa.py`, CLI `python evaluate_qa.py <metric_model> <hyp_file> <ref_file>`.
- LoCoMo: `task_eval/evaluation.py`, function `eval_question_answering(qas, eval_key='prediction', metric='f1')`.
