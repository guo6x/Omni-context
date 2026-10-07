# ARR Submission Checklist — Silent Omission Paper

**Primary window:** ARR 2026 October cycle  
**Deadline:** 2026-10-12 AoE  
**Paper type:** Long paper

## Hard desk-reject gates

- [ ] Official ACL review style is used unchanged.
- [ ] Main content is at most 8 pages.
- [ ] A section titled **Limitations** appears after the Conclusion.
- [ ] Review PDF contains no author names, affiliations, identifying acknowledgements, or non-anonymous repository links.
- [ ] All citations and cross-references resolve.
- [ ] No overfull content crosses ACL margins.
- [ ] Paper is self-contained; essential correctness does not depend on supplementary material.
- [ ] Responsible NLP Checklist is completed with specific section references / justifications.
- [ ] Generative-AI assistance is disclosed truthfully in the checklist.
- [ ] AI assistance is not represented as authorship.
- [ ] Any supplementary code/data bundle is anonymized.

## Scientific claim gates

- [ ] Do not claim novelty for evidence sufficiency.
- [ ] Do not claim novelty for evidence coverage.
- [ ] Do not claim novelty for evidence obligations / evidence ledgers.
- [ ] Core novelty remains the **policy-relative silent-omission mechanism**.
- [ ] Direct C1 effect concentration in F6 is prominent, not hidden.
- [ ] C2–C4 family-level failures are reported.
- [ ] G4 remains qualified: no strict recall→safety monotonic law.
- [ ] C5 is described as a formal mechanism test with oracle-quality coverage information.
- [ ] C5 is not described as a deployable solution.
- [ ] McNemar/bootstrap statistics are not interpreted as real-world prevalence estimates.
- [ ] “Silent” means no cue under the frozen declared policy checks, not statistical indistinguishability to every detector.

## Closest-work gates

Must explicitly position against:

- SURE-RAG — visible evidence sufficiency / selective answering;
- HALT — evidence-coverage-based stopping;
- Evidence-Obligation Pool-Gated Retrieval — obligation ledger / warrant gate;
- Before Answering — deletion-construction / memory-size shortcut;
- STALE — later evidence available but state revision fails;
- Revoked but Still Authoritative — already-revoked record remains retrievable.

## AI assistance disclosure

Responsible NLP Checklist wording should truthfully state that generative AI was used extensively for:

- research framing;
- literature-search assistance;
- manuscript drafting and revision;
- LaTeX / code generation;
- reviewer-style critique;
- artifact and consistency checking.

Human author(s) remain responsible for every scientific claim, citation, experiment, numeric result, and submitted text.

See:

`AI_ASSISTANCE_DISCLOSURE.md`

## Supplementary material

Potential anonymous supplement:

- P1/P2 preregistration and freeze manifests;
- formal benchmark specification;
- deterministic policy / retriever source;
- raw per-family P2 rows;
- figure-generation sources;
- reproducibility manifest.

Do not expose:

- GitHub username;
- repository owner URL;
- commit author email;
- previous TMLR submission identity or non-anonymous discussion links.

## Submission decision

Submit to ARR only if all hard gates above are green.

After ARR reviews/meta-review, choose downstream venue according to the cycle rules and topical fit; do not dual-commit the same paper.
