# ARR 2026-10-12 review build

This directory is the ACL Rolling Review submission wrapper for the silent-omission paper.

## Target

Primary current window:

- ARR deadline: **2026-10-12 AoE**
- possible downstream commitments: NAACL 2027 / COLING 2027, subject to the cycle's commitment rules

Fallback:

- ARR 2027-01-04 for ACL 2027

## Official style provenance

Vendored unchanged from `acl-org/acl-style-files` master on 2026-10-07:

- `acl.sty` source blob SHA: `d9b74d0e6d1ea7a41929ff30111a112e1d23f959`
- `acl_natbib.bst` source blob SHA: `086cb0bc745cf1120aef9c99aa295ccdba3e736c`

Do not modify these style files.

## Page rule

ARR long paper:

- up to 8 pages of content;
- Limitations is required and placed after the Conclusion;
- optional Ethical Considerations may follow;
- references are unlimited.

## Build

From this directory:

```bash
pdflatex -interaction=nonstopmode -halt-on-error main.tex
bibtex8 main
pdflatex -interaction=nonstopmode -halt-on-error main.tex
pdflatex -interaction=nonstopmode -halt-on-error main.tex
```

## AI-assistance compliance

See `AI_ASSISTANCE_DISCLOSURE.md`.

The submission must truthfully disclose the scope of generative-AI writing/coding assistance in the Responsible NLP Checklist and, where required/permitted, in acknowledgements.

## Scientific freeze

Formatting conversion may not alter:

- P1/P2 samples;
- policy / retriever configuration;
- statistical methods;
- frozen result values;
- F6 concentration of the direct C1 effect;
- G4 qualified non-monotonic interpretation;
- identical C4/C5 retrieval surface;
- synthetic / non-deployment claim boundary.
