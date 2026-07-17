# Omni-Context manuscript production assets

This directory is an editable, venue-neutral paper-production project linked exclusively to the frozen evidence package at `docs/omni-context-paper-evidence-v1/` and evidence commit `ad1fe8806255e420e65398ae67df0a50474356d4`.

It does not change product or benchmark behavior and does not rerun any evaluation.

## Entry points

- Manuscript: `manuscript/main.tex`
- Generated tables: `tables/`
- Editable SVG and vector PDF figures: `figures/`
- Unified verified data: `data/verified-paper-data.json`
- Number audit: `evidence/number-audit.json`
- Claim boundary map: `evidence/manuscript-claim-map.csv`

## Regenerate assets

Use a Python environment containing the pinned dependency in `figure-scripts/requirements.txt`:

```powershell
$env:PYTHONPATH='<PYTHON_DEPS>'
python paper/figure-scripts/generate_assets.py
python paper/validate_assets.py
```

The generation script reads the frozen evidence package once and emits the shared data file, LaTeX tables, macros, evidence maps, SVG figures, and PDF figures. Do not hand-edit generated numerical assets.

## LaTeX status

`main.tex` uses a generic two-column `article` layout. The current machine has no LaTeX toolchain, so the manuscript draft was not compiled. See `build/latex-status.txt`. No LaTeX distribution was installed automatically.

## Claim limits

- Keep Formal at 248/250 with two errors.
- Keep Comparison Retrieval-only at 69/70 with one error.
- Describe mode comparisons as internal comparisons, not strict component ablations.
- LoCoMo is NOT RUN and Conversation 2--10 remains unaccessed.
- Do not claim universal state of the art or external validity.
- `references.bib` is intentionally empty until verified references are supplied.
