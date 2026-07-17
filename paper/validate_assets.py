#!/usr/bin/env python3
"""Validate generated paper assets without modifying source evidence or evaluation state."""
from __future__ import annotations

import csv
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
PAPER = ROOT / "paper"
EVIDENCE = ROOT / "docs" / "omni-context-paper-evidence-v1"
checks = []

def check(name, passed, detail):
    checks.append({"check": name, "status": "PASS" if passed else "FAIL", "detail": detail})

expected_tables = ["main-results.tex","category-results.tex","category-details.tex","category-submetrics.tex","efficiency-results.tex","error-summary.tex","reproducibility-summary.tex"]
expected_figures = ["architecture","retrieval-pipeline","overall-comparison","category-comparison","coverage-funnel","latency-summary"]
check("table-count", all((PAPER/"tables"/name).is_file() for name in expected_tables), f"{len(expected_tables)} expected tables")
check("figure-count", all((PAPER/"figures"/f"{name}.{ext}").is_file() for name in expected_figures for ext in ("svg","pdf")), "6 SVG/PDF pairs")

audit = json.loads((PAPER/"evidence"/"number-audit.json").read_text(encoding="utf-8"))
audit_ok = all(n["status"] == "VERIFIED" and n["source_file"].startswith("docs/omni-context-paper-evidence-v1/") and (ROOT/n["source_file"]).exists() and n["used_in"] for n in audit["numbers"])
check("number-audit", audit_ok, f"{len(audit['numbers'])} verified entries with existing sources and consumers")

main = (PAPER/"tables"/"main-results.tex").read_text(encoding="utf-8")
required = ["7/7 & 0 & 0.840868", "35/35 & 0 & 0.884842", "248/250 & 2 & 0.866546", "69/70 & 1 & 0.552346"]
check("main-result-facts", all(x in main for x in required) and "250/250" not in main, "Required completion/error/score tuples are preserved")
check("aggregation-note", "category-macro" in main and "not strict component ablations" in main, "Aggregation and mode-comparison boundaries are explicit")

with (PAPER/"evidence"/"manuscript-claim-map.csv").open(encoding="utf-8", newline="") as handle:
    claims = list(csv.DictReader(handle))
check("claim-map", len(claims) >= 14 and all(r["status"] == "VERIFIED" and r["allowed_wording"] and r["forbidden_wording"] for r in claims), f"{len(claims)} bounded claims")

svg_ok = True
svg_detail = []
for name in expected_figures:
    path = PAPER/"figures"/f"{name}.svg"
    text = path.read_text(encoding="utf-8")
    try:
        root = ET.fromstring(text)
        width, height = root.attrib.get("width"), root.attrib.get("height")
        valid = bool(width and height and root.attrib.get("viewBox"))
    except Exception:
        valid = False
    standard_namespaces = ("w3.org", "purl.org", "creativecommons.org")
    external = [u for u in re.findall(r"https?://[^\s\"']+", text) if not any(domain in u for domain in standard_namespaces)]
    absolute = re.findall(r"(?<![A-Za-z])[A-Za-z]:[\\/]", text)
    valid = valid and not external and not absolute and "<image" not in text
    svg_ok &= valid
    svg_detail.append(f"{name}={'ok' if valid else 'bad'}")
check("svg-integrity", svg_ok, "; ".join(svg_detail))

pdf_ok = True
pdf_detail = []
for name in expected_figures:
    path = PAPER/"figures"/f"{name}.pdf"
    try:
        reader = PdfReader(path)
        page = reader.pages[0]
        box = page.mediabox
        valid = len(reader.pages) == 1 and float(box.width) > 100 and float(box.height) > 100
        pdf_detail.append(f"{name}={float(box.width):.0f}x{float(box.height):.0f}pt")
    except Exception as exc:
        valid = False
        pdf_detail.append(f"{name}=error:{exc}")
    pdf_ok &= valid
check("pdf-integrity", pdf_ok, "; ".join(pdf_detail))

main_tex = (PAPER/"manuscript"/"main.tex").read_text(encoding="utf-8")
paths_ok = True
for rel in re.findall(r"\\(?:input|includegraphics)(?:\[[^]]*\])?\{([^}]+)\}", main_tex):
    if rel in ("macros",) or rel.startswith("sections/"):
        base = PAPER/"manuscript"/rel
    else:
        base = PAPER/"manuscript"/rel
    candidates = [base, base.with_suffix(".tex"), base.with_suffix(".pdf"), base.with_suffix(".svg")]
    paths_ok &= any(p.exists() for p in candidates)
check("latex-paths", paths_ok, "All main.tex input and figure paths resolve from paper/manuscript")
latex_structure_ok = True
for tex in PAPER.rglob("*.tex"):
    content = tex.read_text(encoding="utf-8")
    begins = re.findall(r"\\begin\{([^}]+)\}", content)
    ends = re.findall(r"\\end\{([^}]+)\}", content)
    latex_structure_ok &= content.count("{") == content.count("}") and sorted(begins) == sorted(ends)
check("latex-structure", latex_structure_ok, "All TeX files have balanced braces and environments")

refs = (PAPER/"manuscript"/"references.bib").read_text(encoding="utf-8")
check("references", not re.search(r"@\w+\s*\{", refs), "No unverified BibTeX records")

text_suffixes = {".py", ".tex", ".bib", ".md", ".json", ".csv", ".txt", ".svg"}
all_text = "\n".join(p.read_text(encoding="utf-8", errors="ignore") for p in PAPER.rglob("*") if p.is_file() and p.suffix.lower() in text_suffixes)
check("secret-scan", not re.search(r"\bsk-[A-Za-z0-9_-]{20,}\b|Authorization\s*:\s*Bearer", all_text, re.I), "No API key or Authorization header pattern")
check("absolute-paths", not re.search(r"\b[A-Za-z]:[\\/]", all_text), "No absolute local path in committed paper assets")
locomo_numeric = re.search(r"LoCoMo\s*(?:Overall|=|score\s*[:=])\s*\d", all_text, re.I)
check("locomo-boundary", "LoCoMo is NOT RUN" in all_text and not locomo_numeric, "LoCoMo remains NOT RUN with no numeric result")

status = "PASS" if all(c["status"] == "PASS" for c in checks) else "FAIL"
report = {"schema_version": 1, "status": status, "checks": checks}
(PAPER/"evidence"/"asset-validation.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8", newline="\n")
print(json.dumps(report, indent=2))
raise SystemExit(0 if status == "PASS" else 1)
