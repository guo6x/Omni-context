# Venue-neutral LaTeX manuscript

This directory contains the submission-neutral LaTeX version of the silent-omission paper.

## Source-of-truth boundary

Empirical values are frozen in:

`../../p2/out/p2-results.json`

Frozen result blob SHA:

`e8a749a6707dbf4614b20ef6248f81eb43dd89d4`

The LaTeX value macros are centralized in `paper-values.tex`. Figures must not hand-select or silently alter frozen outcomes.

## Structure

- `main.tex` — venue-neutral wrapper
- `paper-values.tex` — frozen numeric macros
- `references.bib` — manuscript bibliography
- `sections/` — manuscript sections
- `figures/` — TikZ/PGFPlots figure sources

## Build

Recommended:

```bash
pdflatex -interaction=nonstopmode -halt-on-error main.tex
bibtex8 main
pdflatex -interaction=nonstopmode -halt-on-error main.tex
pdflatex -interaction=nonstopmode -halt-on-error main.tex
```

If standard `bibtex` is installed, it can replace `bibtex8`.

## Validation status

Completed on 2026-10-07:

- 5/5 TikZ/PGFPlots figures compiled successfully under TeX Live 2025;
- figure test PDF generated with no fatal TeX errors;
- venue-neutral full-paper compile check reached 9 pages;
- after the bibliography pass: no Overfull/Underfull box warnings and no unresolved citation/reference warnings in the local validation build;
- repository static audit: 15 TeX files checked, brace-balance errors = 0, environment-balance errors = 0;
- citation audit: 12 unique cited keys, missing bibliography keys = 0, unused bibliography entries = 0;
- control-character scan = 0;
- Figure 1 was explicitly constrained to `\linewidth` after an initial ~10.7 pt overflow was detected.

## Venue conversion rule

Do not rewrite the scientific content when moving to IJCAI/ACL/ECAI formatting.

A venue conversion may change:

- document class / style file;
- page geometry;
- heading formatting;
- bibliography style;
- float placement;
- appendix placement.

It may not change in response to formatting pressure:

- P1/P2 samples;
- policy or retrieval configuration;
- statistical methods;
- frozen result values;
- family heterogeneity;
- G4 qualified interpretation;
- C4/C5 identical-surface claim;
- claim boundaries.

## P3

P3 remains optional and is not required for this deterministic mechanism paper.
