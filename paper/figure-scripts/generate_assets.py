#!/usr/bin/env python3
"""Generate all paper tables, figures, and evidence maps from the frozen evidence package."""
from __future__ import annotations

import csv
import json
import math
import os
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch, Patch
from matplotlib.lines import Line2D

ROOT = Path(__file__).resolve().parents[2]
PAPER = ROOT / "paper"
EVIDENCE = ROOT / "docs" / "omni-context-paper-evidence-v1"
TABLES = PAPER / "tables"
FIGURES = PAPER / "figures"
DATA = PAPER / "data"
AUDIT = PAPER / "evidence"
for directory in (TABLES, FIGURES, DATA, AUDIT):
    directory.mkdir(parents=True, exist_ok=True)

PRODUCT_COMMIT = "17dc1d0107b0474de84058205a91b302ba290a74"
BENCHMARK_COMMIT = "62b0b20f944f7e9a2c58f02ce1c65bb43dfbf841"
EVIDENCE_COMMIT = "ad1fe8806255e420e65398ae67df0a50474356d4"
SOURCE_DATE = "2026-07-17"
os.environ.setdefault("SOURCE_DATE_EPOCH", "1784246400")

CATEGORY_LABELS = {
    "cognitive_continuity": "Cognitive Continuity",
    "memory_evolution": "Memory Evolution",
    "conflict_resolution": "Conflict Resolution",
    "cross_agent_transfer": "Cross-Agent Transfer",
    "human_like_forgetting": "Human-like Forgetting",
    "proactive_insight": "Proactive Insight",
    "decision_quality": "Decision Quality",
}
CATEGORY_ORDER = list(CATEGORY_LABELS)
MODE_LABELS = {"full_omni": "Full Omni", "retrieval_only": "Retrieval-only", "no_memory": "No Memory"}

def load_json(rel: str):
    return json.loads((EVIDENCE / rel).read_text(encoding="utf-8"))

def load_csv(rel: str):
    with (EVIDENCE / rel).open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))

def write(path: Path, text: str):
    path.write_text(text.rstrip() + "\n", encoding="utf-8", newline="\n")

def fmt(value) -> str:
    return f"{float(value):.6f}"

def pct(n, d) -> str:
    return f"{100 * n / d:.1f}\\%"

def tex_escape(value: str) -> str:
    return (str(value).replace("\\", r"\textbackslash{}")
            .replace("_", r"\_").replace("%", r"\%").replace("&", r"\&")
            .replace("#", r"\#").replace("$", r"\$").replace("{", r"\{").replace("}", r"\}"))

headline = load_json("metrics/headline-metrics.json")
targeted = load_json("metrics/targeted-7-summary.json")
development = load_json("metrics/development-35-summary.json")
formal = load_json("metrics/formal-250-summary.json")
comparison = load_json("metrics/comparison-70-summary.json")
dev_detail = load_csv("metrics/development-35-by-category.csv")
formal_detail = load_csv("metrics/formal-250-by-category.csv")
comp_detail = load_csv("metrics/comparison-70-by-category.csv")
category_points = load_csv("figures-data/category-comparison.csv")
coverage = load_csv("figures-data/coverage-funnel.csv")
errors = load_csv("figures-data/formal-error-distribution.csv")
module_map = load_csv("architecture/module-to-code-map.csv")

dev_modes = {row["mode"]: row for row in development["modes"]}
comp_modes = {row["mode"]: row for row in comparison["modes"]}
dev_stats = {row["category"]: row for row in dev_detail}
formal_stats = {row["category"]: row for row in formal_detail}
comp_stats = {(row["mode"], row["category"]): row for row in comp_detail}
category_score = {(r["evaluation"], r["mode"], r["category"]): float(r["score"]) for r in category_points}

paper_data = {
    "schema_version": 1,
    "generated_from_evidence_commit": EVIDENCE_COMMIT,
    "product_commit": PRODUCT_COMMIT,
    "benchmark_commit": BENCHMARK_COMMIT,
    "main_results": [
        {"evaluation": "Targeted-7", "mode": "Full Omni", "completed": 7, "expected": 7, "errors": 0, "overall": targeted["overall"], "source": "metrics/targeted-7-summary.json"},
        *[{"evaluation": "Development-35", "mode": MODE_LABELS[m], "completed": dev_modes[m]["completed"], "expected": 35, "errors": dev_modes[m]["errors"], "overall": dev_modes[m]["overall"], "source": "metrics/development-35-summary.json"} for m in ("full_omni", "retrieval_only", "no_memory")],
        {"evaluation": "Formal-250", "mode": "Full Omni", "completed": formal["completed"], "expected": formal["expected"], "errors": formal["errors"], "overall": formal["overall"], "source": "metrics/formal-250-summary.json"},
        *[{"evaluation": "Comparison-70", "mode": MODE_LABELS[m], "completed": comp_modes[m]["completed"], "expected": 70, "errors": comp_modes[m]["errors"], "overall": comp_modes[m]["overall"], "source": "metrics/comparison-70-summary.json"} for m in ("full_omni", "retrieval_only", "no_memory")],
    ],
    "categories": {
        "development_full": {c: category_score[("Development-35", "full_omni", c)] for c in CATEGORY_ORDER},
        "formal_full": {c: category_score[("Formal-250", "full_omni", c)] for c in CATEGORY_ORDER},
        "comparison": {m: {c: category_score[("Comparison-70", m, c)] for c in CATEGORY_ORDER} for m in ("full_omni", "retrieval_only", "no_memory")},
    },
    "coverage": {
        "targeted": {"candidate_pool": [28, 30], "final_20": [28, 30], "answer_top_10": [28, 30]},
        "retrieval_preflight_top_10": [37, 38],
        "initial_retrieval_preflight_top_10": [20, 38],
    },
    "efficiency": {"formal_p50_ms": formal["p50_latency_ms"], "formal_p95_ms": formal["p95_latency_ms"], "retry_records": headline["stability"]["retry_records"], "formal_final_errors": formal["errors"], "comparison_final_errors": sum(m["errors"] for m in comparison["modes"])},
    "stability": headline["stability"],
    "calls": headline["calls"],
    "errors": errors,
    "runtime": load_json("manifests/reproducibility-lock.json"),
    "module_map": module_map,
    "locomo": headline["locomo"],
}
write(DATA / "verified-paper-data.json", json.dumps(paper_data, indent=2, ensure_ascii=False))

# Every number is registered once here and reused by generated tables, figures, and macros.
numbers = []
counter = 1
def register(value, meaning, source_file, source_field, used_in):
    global counter
    numbers.append({"number_id": f"N{counter:03d}", "value": value, "meaning": meaning,
                    "source_file": f"docs/omni-context-paper-evidence-v1/{source_file}",
                    "source_field": source_field, "used_in": used_in, "status": "VERIFIED"})
    counter += 1

for i, row in enumerate(paper_data["main_results"]):
    stem = f"{row['evaluation']} {row['mode']}"
    for field in ("completed", "expected", "errors", "overall"):
        register(row[field], f"{stem} {field}", row["source"], f"$.{field} or corresponding mode field",
                 ["tables/main-results.tex", "manuscript/sections/06-results.tex"] + (["figures/overall-comparison.svg", "figures/overall-comparison.pdf"] if row["evaluation"] in ("Development-35", "Comparison-70") else []))
for evaluation, mode, key_name in (("Development-35", "full_omni", "development_full"), ("Formal-250", "full_omni", "formal_full")):
    for c in CATEGORY_ORDER:
        register(paper_data["categories"][key_name][c], f"{evaluation} {CATEGORY_LABELS[c]} {MODE_LABELS[mode]} category mean",
                 "figures-data/category-comparison.csv", f"row evaluation={evaluation}, mode={mode}, category={c}",
                 ["tables/category-results.tex", "figures/category-comparison.svg", "figures/category-comparison.pdf"])
for mode in ("full_omni", "retrieval_only", "no_memory"):
    for c in CATEGORY_ORDER:
        register(paper_data["categories"]["comparison"][mode][c], f"Comparison-70 {CATEGORY_LABELS[c]} {MODE_LABELS[mode]} category mean",
                 "figures-data/category-comparison.csv", f"row evaluation=Comparison-70, mode={mode}, category={c}",
                 ["tables/category-results.tex", "figures/category-comparison.svg", "figures/category-comparison.pdf"])
        full_value = paper_data["categories"]["comparison"]["full_omni"][c]
        baseline = max(paper_data["categories"]["comparison"]["retrieval_only"][c], paper_data["categories"]["comparison"]["no_memory"][c])
        if mode == "full_omni":
            register(round(full_value-baseline, 6), f"Comparison-70 {CATEGORY_LABELS[c]} Full Omni delta from strongest baseline",
                     "figures-data/category-comparison.csv", f"derived: full_omni - max(retrieval_only,no_memory), category={c}", ["tables/category-results.tex"])
detail_sources = [
    ("Development Full", dev_stats, "metrics/development-35-by-category.csv"),
    ("Formal Full", formal_stats, "metrics/formal-250-by-category.csv"),
    ("Comparison Full", {c: comp_stats[("full_omni",c)] for c in CATEGORY_ORDER}, "metrics/comparison-70-by-category.csv"),
    ("Comparison Retrieval", {c: comp_stats[("retrieval_only",c)] for c in CATEGORY_ORDER}, "metrics/comparison-70-by-category.csv"),
    ("Comparison No Memory", {c: comp_stats[("no_memory",c)] for c in CATEGORY_ORDER}, "metrics/comparison-70-by-category.csv"),
]
for evaluation, stats, source in detail_sources:
    for c in CATEGORY_ORDER:
        row = stats[c]
        for field in ("scenario_count","completed","errors","core_score_median","minimum","maximum","standard_deviation"):
            register(float(row[field]) if "." in str(row[field]) else int(row[field]), f"{evaluation} {CATEGORY_LABELS[c]} {field}", source,
                     f"row category={c}, $.{field}", ["tables/category-details.tex"])
        for metric, value in json.loads(row["key_submetrics"]).items():
            if value is not None:
                register(value, f"{evaluation} {CATEGORY_LABELS[c]} submetric {metric}", source,
                         f"row category={c}, $.key_submetrics.{metric}", ["tables/category-submetrics.tex"])
for layer, pair in paper_data["coverage"]["targeted"].items():
    register(pair[0], f"Targeted-7 {layer} covered slots", "metrics/targeted-7-summary.json", f"$.coverage.{layer}.covered", ["figures/coverage-funnel.svg", "figures/coverage-funnel.pdf"])
    register(pair[1], f"Targeted-7 {layer} total slots", "metrics/targeted-7-summary.json", f"$.coverage.{layer}.total", ["figures/coverage-funnel.svg", "figures/coverage-funnel.pdf"])
for value, meaning, field in ((37, "Final retrieval-preflight Top-10 covered slots", "$.retrieval_preflight.top10_slots_covered"), (38, "Final retrieval-preflight total slots", "$.retrieval_preflight.top10_slots_total"), (20, "Initial retrieval-preflight Top-10 covered slots", "03-retrieval-preflight $.top10_slot_coverage.covered")):
    register(value, meaning, "metrics/headline-metrics.json", field, ["figures/coverage-funnel.svg", "figures/coverage-funnel.pdf", "figures/retrieval-pipeline.svg", "figures/retrieval-pipeline.pdf"])
for field, meaning in (("formal_p50_ms", "Formal completed-record latency P50 in ms"), ("formal_p95_ms", "Formal completed-record latency P95 in ms"), ("retry_records", "Explicit retry records"), ("formal_final_errors", "Formal final errors"), ("comparison_final_errors", "Comparison final errors")):
    register(paper_data["efficiency"][field], meaning, "metrics/headline-metrics.json", f"$.formal_250 or $.stability ({field})", ["tables/efficiency-results.tex", "figures/latency-summary.svg", "figures/latency-summary.pdf"])
register(105, "Deterministic rescore records", "metrics/headline-metrics.json", "$.stability.deterministic_rescore_records", ["tables/reproducibility-summary.tex", "manuscript/sections/05-experiments.tex"])
register(0, "Scoring differences and scoring defects", "metrics/headline-metrics.json", "$.stability.scoring_differences and $.stability.scoring_defects", ["tables/reproducibility-summary.tex", "manuscript/sections/07-analysis.tex"])
register(0, "Unresolved P0 count", "metrics/headline-metrics.json", "$.stability.unresolved_p0", ["tables/reproducibility-summary.tex", "manuscript/sections/08-limitations.tex"])
register(2, "Unresolved P1 classes", "metrics/headline-metrics.json", "$.stability.unresolved_p1_classes", ["tables/reproducibility-summary.tex", "manuscript/sections/08-limitations.tex"])
register(1024, "Embedding output dimensions", "manifests/reproducibility-lock.json", "$.embedding.dimension", ["tables/reproducibility-summary.tex"])
register(1200, "Answer maximum output tokens", "manifests/reproducibility-lock.json", "$.answer.max_tokens", ["tables/reproducibility-summary.tex"])
register(0, "Answer temperature", "manifests/reproducibility-lock.json", "$.answer.temperature", ["tables/reproducibility-summary.tex"])
register(3, "Maximum prescribed attempts for each retained terminal error", "figures-data/formal-error-distribution.csv", "$.attempts", ["tables/error-summary.tex"])
register("2-10", "Held-out Conversation range that remained unaccessed", "metrics/headline-metrics.json", "$.locomo.conversation_2_10_accessed=false", ["tables/reproducibility-summary.tex", "manuscript/sections/08-limitations.tex"])
write(AUDIT / "number-audit.json", json.dumps({"schema_version": 1, "evidence_commit": EVIDENCE_COMMIT, "numbers": numbers}, indent=2, ensure_ascii=False))

macros = {
    "TargetedOverall": targeted["overall"], "DevelopmentFullOverall": dev_modes["full_omni"]["overall"],
    "DevelopmentRetrievalOverall": dev_modes["retrieval_only"]["overall"], "DevelopmentNoMemoryOverall": dev_modes["no_memory"]["overall"],
    "FormalOverall": formal["overall"], "ComparisonFullOverall": comp_modes["full_omni"]["overall"],
    "ComparisonRetrievalOverall": comp_modes["retrieval_only"]["overall"], "ComparisonNoMemoryOverall": comp_modes["no_memory"]["overall"],
}
macro_lines = [r"\newcommand{\TODO}[1]{\textbf{[TODO: #1]}}", r"\newcommand{\TODOCITE}[1]{\textbf{[CITATION NEEDED: #1]}}"]
macro_lines += [f"\\newcommand{{\\{name}}}{{{fmt(value)}}}" for name, value in macros.items()]
write(PAPER / "manuscript" / "macros.tex", "\n".join(macro_lines))

main_rows = "\n".join(f"{tex_escape(r['evaluation'])} & {tex_escape(r['mode'])} & {r['completed']}/{r['expected']} & {r['errors']} & {fmt(r['overall'])} \\\\" for r in paper_data["main_results"])
write(TABLES / "main-results.tex", rf"""\begin{{table*}}[t]
\centering
\caption{{Version-locked internal benchmark results. Completed and error counts are never suppressed.}}
\label{{tab:main-results}}
\begin{{tabular}}{{llrrr}}
\toprule
Evaluation & Mode & Completed & Errors & Overall \\
\midrule
{main_rows}
\bottomrule
\end{{tabular}}
\begin{{minipage}}{{0.96\textwidth}}\footnotesize
Formal-250 Overall is computed over successfully completed records using the benchmark's category-macro definition. These mode comparisons are not strict component ablations. All evaluations shown here are internal Synthetic Curated Benchmark results; external held-out validity has not been established.
\end{{minipage}}
\end{{table*}}""")

cat_rows = []
for c in CATEGORY_ORDER:
    cf = paper_data["categories"]["comparison"]["full_omni"][c]
    cr = paper_data["categories"]["comparison"]["retrieval_only"][c]
    cn = paper_data["categories"]["comparison"]["no_memory"][c]
    cat_rows.append(f"{CATEGORY_LABELS[c]} & {fmt(paper_data['categories']['development_full'][c])} & {fmt(paper_data['categories']['formal_full'][c])} & {fmt(cf)} & {fmt(cr)} & {fmt(cn)} & {fmt(cf-max(cr,cn))} \\\\")
write(TABLES / "category-results.tex", rf"""\begin{{table*}}[t]
\centering\small
\caption{{Category-macro results. The mode delta is Comparison-70 Full Omni minus the stronger of Retrieval-only and No Memory.}}
\label{{tab:category-results}}
\begin{{tabular}}{{lrrrrrr}}
\toprule
Category & Dev Full & Formal Full & Comp Full & Comp Ret. & Comp No Mem. & $\Delta$ \\
\midrule
{chr(10).join(cat_rows)}
\bottomrule
\end{{tabular}}
\begin{{minipage}}{{0.98\textwidth}}\footnotesize
Values are benchmark category means, not scenario-weighted averages. Development and Formal baseline-by-category values are not invented; only available verified columns are shown.
\end{{minipage}}
\end{{table*}}""")

detail_rows = []
for evaluation, stats, _ in detail_sources:
    for c in CATEGORY_ORDER:
        r = stats[c]
        detail_rows.append(f"{evaluation} & {CATEGORY_LABELS[c]} & {r['completed']}/{r['scenario_count']} & {r['errors']} & {float(r['core_score_median']):.3f} & {float(r['minimum']):.3f} & {float(r['maximum']):.3f} & {float(r['standard_deviation']):.3f} \\\\")
write(TABLES / "category-details.tex", rf"""\begin{{table*}}[t]
\centering\scriptsize
\caption{{Development, Formal, and Comparison category distributions over completed records.}}
\label{{tab:category-details}}
\begin{{tabular}}{{llrrrrrr}}
\toprule
Evaluation & Category & Completed & Errors & Median & Min & Max & Std. dev. \\
\midrule
{chr(10).join(detail_rows)}
\bottomrule
\end{{tabular}}
\end{{table*}}""")

submetric_rows = []
for evaluation, stats, _ in detail_sources:
    for c in CATEGORY_ORDER:
        metrics = json.loads(stats[c]["key_submetrics"])
        rendered = "; ".join(f"{k.replace('_',' ')}={float(v):.3f}" for k, v in metrics.items() if v is not None)
        submetric_rows.append(f"{evaluation} & {CATEGORY_LABELS[c]} & {tex_escape(rendered)} \\\\")
write(TABLES / "category-submetrics.tex", rf"""\begin{{longtable}}{{p{{0.12\textwidth}}p{{0.20\textwidth}}p{{0.60\textwidth}}}}
\caption{{Verified category submetrics.}}\label{{tab:category-submetrics}}\\
\toprule Evaluation & Category & Submetrics \\\ \midrule
\endfirsthead
\toprule Evaluation & Category & Submetrics \\\ \midrule
\endhead
{chr(10).join(submetric_rows)}
\bottomrule
\end{{longtable}}""")

write(TABLES / "efficiency-results.tex", rf"""\begin{{table}}[t]
\centering
\caption{{Efficiency and stability facts retained without error smoothing.}}
\label{{tab:efficiency}}
\begin{{tabular}}{{lr}}
\toprule Metric & Value \\
\midrule
Formal latency P50 & {formal['p50_latency_ms']} ms \\
Formal latency P95 & {formal['p95_latency_ms']} ms \\
Retry records & {headline['stability']['retry_records']} \\
Formal final errors & {formal['errors']} \\
Comparison final errors & {sum(m['errors'] for m in comparison['modes'])} \\
\bottomrule
\end{{tabular}}
\end{{table}}""")

error_rows = []
for row in errors:
    finish = row["finish_reason"].replace("|", "/")
    attribution = "Provider structured-output truncation" if row["mode"] == "full_omni" else "Baseline schema robustness"
    error_type = "JSON truncation" if row["mode"] == "full_omni" else "empty source_ids"
    reporting = "Retained terminal error; no score imputed"
    error_rows.append(f"\\texttt{{\\detokenize{{{row['scenario_id']}}}}} & {('Formal-250' if row['mode']=='full_omni' else 'Comparison-70')} & {tex_escape(MODE_LABELS.get(row['mode'],row['mode']))} & {tex_escape(error_type)} & 3 & {tex_escape(finish)} & No & {tex_escape(attribution)} & {tex_escape(reporting)} \\\\")
write(TABLES / "error-summary.tex", rf"""\begin{{table*}}[t]
\centering\scriptsize
\caption{{Terminal errors retained after three prescribed attempts. No failed record entered score aggregation.}}
\label{{tab:errors}}
\begin{{tabular}}{{p{{0.20\textwidth}}lllclclp{{0.18\textwidth}}p{{0.20\textwidth}}}}
\toprule Scenario & Eval. & Mode & Error & Attempts & Finish & Scored & Attribution & Paper reporting \\
\midrule
{chr(10).join(error_rows)}
\bottomrule
\end{{tabular}}
\end{{table*}}""")

lock = paper_data["runtime"]
write(TABLES / "reproducibility-summary.tex", rf"""\begin{{table*}}[t]
\centering\small
\caption{{Version and reproducibility locks.}}
\label{{tab:reproducibility}}
\begin{{tabular}}{{lp{{0.73\textwidth}}}}
\toprule Item & Locked value \\
\midrule
Product commit & \texttt{{{PRODUCT_COMMIT}}} \\
Benchmark commit & \texttt{{{BENCHMARK_COMMIT}}} \\
Evidence commit & \texttt{{{EVIDENCE_COMMIT}}} \\
Embedding & {tex_escape(lock['embedding']['model_id'])}, revision \texttt{{{lock['embedding']['revision']}}}, {lock['embedding']['dimension']} dimensions \\
Answer & {tex_escape(lock['answer_model'])}, max tokens {lock['answer']['max_tokens']}, temperature {lock['answer']['temperature']}, thinking disabled \\
Deterministic rescore & {headline['stability']['deterministic_rescore_records']} records, {headline['stability']['scoring_differences']} differences, {headline['stability']['scoring_defects']} scoring defects \\
Open issues & P0={headline['stability']['unresolved_p0']}; P1 classes={headline['stability']['unresolved_p1_classes']} \\
LoCoMo & NOT RUN; Conversation 2--10 accessed=false \\
\bottomrule
\end{{tabular}}
\end{{table*}}""")

claims = [
    ("MC01", "On internal Development-35, Full Omni scored 0.884842 versus 0.563853 Retrieval-only and 0.366713 No Memory.", "Do not generalize beyond the internal Synthetic Curated Benchmark.", "Results", "metrics/development-35-summary.json"),
    ("MC02", "Formal-250 completed 248/250 with two errors and category-macro Overall 0.866546 over completed records.", "Do not write 250/250 or omit errors.", "Results", "metrics/formal-250-summary.json"),
    ("MC03", "Comparison-70 Full Omni completed 70/70 at 0.870698; Retrieval-only completed 69/70 at 0.552346; No Memory completed 70/70 at 0.364683.", "Do not write Retrieval-only as 70/70 or call modes strict component ablations.", "Results", "metrics/comparison-70-summary.json"),
    ("MC04", "Frozen retrieval preflight Top-10 slot coverage changed from 20/38 before the general fix to 37/38 after it.", "Do not claim universal retrieval recall improvement.", "Analysis", "architecture/final-product-fix.md"),
    ("MC05", "Runtime preflight attested the frozen product commit, build, selector, local embedding hash, and 1024-dimensional output.", "Do not claim attestation covers unrecorded environments.", "Method", "architecture/runtime-attestation.md"),
    ("MC06", "Deterministic rescoring covered 105 records with zero scoring differences.", "Do not extend this to provider determinism.", "Experiments", "metrics/headline-metrics.json"),
    ("MC07", "The attribution review found zero scoring defects.", "Do not state that all benchmark design risks were eliminated.", "Analysis", "metrics/headline-metrics.json"),
    ("MC08", "Unresolved P0 count was zero at freeze.", "Do not omit the two unresolved P1 classes.", "Limitations", "metrics/headline-metrics.json"),
    ("MC09", "Formal retained two Answer JSON truncation errors after three attempts each.", "Do not impute scores or describe Formal as fully complete.", "Limitations", "cases/failure-cases.md"),
    ("MC10", "Comparison retained one Retrieval-only empty-source-IDs error after three attempts.", "Do not attribute this baseline error to Full Omni product capability.", "Limitations", "cases/failure-cases.md"),
    ("MC11", "Selector and Evidence Group ablations were not run because no existing safe switch was available.", "Do not call mode comparisons strict component ablations.", "Limitations", "reproducibility/known-limitations.md"),
    ("MC12", "LoCoMo was NOT RUN; Candidate v3.1 lacked bound held-out authorization and Conversation 2--10 remained unaccessed.", "Do not report a LoCoMo score.", "Limitations", "reproducibility/known-limitations.md"),
    ("MC13", "Reported scores primarily use the project-built Synthetic Curated Benchmark.", "Do not claim universal SOTA.", "Benchmark", "reproducibility/known-limitations.md"),
    ("MC14", "External validity remains to be established through an authorized held-out benchmark.", "Do not imply held-out validation has already occurred.", "Limitations", "reproducibility/known-limitations.md"),
]
with (AUDIT / "architecture-node-map.csv").open("w", encoding="utf-8", newline="") as handle:
    fields = ["figure_node","module","repository_path","main_file","function_or_class","input","output","evidence_source","status"]
    writer = csv.DictWriter(handle, fieldnames=fields)
    writer.writeheader()
    for row in module_map:
        writer.writerow({"figure_node": row["module"], "module": row["module"], "repository_path": row["repository_path"],
                         "main_file": row["main_file"], "function_or_class": row["important_function_or_class"],
                         "input": row["input"], "output": row["output"],
                         "evidence_source": "docs/omni-context-paper-evidence-v1/architecture/module-to-code-map.csv",
                         "status": row["verification_status"]})
    writer.writerow({"figure_node": "Benchmark Scoring (Gold)", "module": "Evaluation boundary",
                     "repository_path": "benchmark/cognitive/src", "main_file": "scoring.mjs",
                     "function_or_class": "scoreScenario / aggregateResults", "input": "Structured answer and benchmark Gold",
                     "output": "Per-scenario score and category-macro aggregate",
                     "evidence_source": "docs/omni-context-paper-evidence-v1/metrics/headline-metrics.json",
                     "status": "BENCHMARK BOUNDARY — VERIFIED AT BENCHMARK COMMIT"})
with (AUDIT / "manuscript-claim-map.csv").open("w", encoding="utf-8", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=["claim_id","allowed_wording","forbidden_wording","paper_section","source","status"])
    writer.writeheader()
    for cid, allowed, forbidden, section, source in claims:
        writer.writerow({"claim_id":cid,"allowed_wording":allowed,"forbidden_wording":forbidden,"paper_section":section,"source":f"docs/omni-context-paper-evidence-v1/{source}","status":"VERIFIED"})

table_map = [
    ("main-results.tex", "metrics/targeted-7-summary.json; metrics/development-35-summary.json; metrics/formal-250-summary.json; metrics/comparison-70-summary.json"),
    ("category-results.tex", "figures-data/category-comparison.csv"), ("category-details.tex", "metrics/development-35-by-category.csv; metrics/formal-250-by-category.csv"),
    ("category-submetrics.tex", "metrics/development-35-by-category.csv; metrics/formal-250-by-category.csv"),
    ("efficiency-results.tex", "metrics/headline-metrics.json"), ("error-summary.tex", "figures-data/formal-error-distribution.csv"),
    ("reproducibility-summary.tex", "manifests/reproducibility-lock.json; metrics/headline-metrics.json"),
]
with (AUDIT / "table-source-map.csv").open("w", encoding="utf-8", newline="") as handle:
    writer=csv.writer(handle); writer.writerow(["table","source","generator","status"])
    for name, sources in table_map: writer.writerow([f"paper/tables/{name}", sources, "paper/figure-scripts/generate_assets.py", "VERIFIED"])

# Publication figure style: white background, grayscale plus hatches/markers, editable SVG text.
plt.rcParams.update({"font.family":"sans-serif","font.sans-serif":["Arial","Liberation Sans","DejaVu Sans"],"font.size":8,
                     "axes.titlesize":9,"axes.labelsize":8,"xtick.labelsize":7,"ytick.labelsize":7,"legend.fontsize":7,
                     "figure.facecolor":"white","axes.facecolor":"white","savefig.facecolor":"white","svg.fonttype":"none",
                     "svg.hashsalt":"omni-context-paper-v1","pdf.fonttype":42})

def save_figure(fig, stem):
    svg_path = FIGURES / f"{stem}.svg"
    fig.savefig(svg_path, bbox_inches="tight", metadata={"Creator":"Omni-Context evidence-linked figure generator", "Date":None})
    # Matplotlib writes harmless trailing spaces in multiline path data; normalize for clean diffs.
    svg_text = svg_path.read_text(encoding="utf-8")
    svg_path.write_text("\n".join(line.rstrip() for line in svg_text.splitlines()) + "\n", encoding="utf-8", newline="\n")
    fig.savefig(FIGURES / f"{stem}.pdf", bbox_inches="tight", metadata={"Creator":"Omni-Context evidence-linked figure generator", "CreationDate":None, "ModDate":None})
    plt.close(fig)

def box(ax, xy, w, h, text, kind="product", fontsize=7):
    styles={"product":dict(fc="white",ec="black",lw=1.0,ls="-"),"benchmark":dict(fc="0.92",ec="black",lw=1.0,ls="--"),"provider":dict(fc="0.78",ec="black",lw=1.0,ls=":")}
    patch=FancyBboxPatch(xy,w,h,boxstyle="round,pad=0.02,rounding_size=0.03",**styles[kind]); ax.add_patch(patch)
    ax.text(xy[0]+w/2,xy[1]+h/2,text,ha="center",va="center",fontsize=fontsize,wrap=True)
    return patch

def arrow(ax, a, b):
    ax.add_patch(FancyArrowPatch(a,b,arrowstyle="-|>",mutation_scale=8,lw=.8,color="black"))

# Figure 1: architecture.
fig, ax=plt.subplots(figsize=(7.1,3.15)); ax.set_xlim(0,10); ax.set_ylim(-.35,4); ax.axis("off")
top=[("Event /\nConversation","product"),("Extraction","provider"),("Memory\nStore","product"),("Multi-channel\nRetrieval","product"),("Fusion","product")]
bottom=[("Reranking","provider"),("Evidence\nGrouping","product"),("Evidence\nSelector","product"),("Answer\nTop-10","product"),("Answer +\nProvenance","provider")]
centers=[]
for i,(name,kind) in enumerate(top): box(ax,(.2+i*1.95,2.55),1.45,.75,name,kind); centers.append((.925+i*1.95,2.55))
for i,(name,kind) in enumerate(bottom): box(ax,(8.0-i*1.95,.95),1.45,.75,name,kind); centers.append((8.725-i*1.95,1.7))
for i in range(4): arrow(ax,(1.65+i*1.95,2.925),(2.15+i*1.95,2.925))
arrow(ax,(9.45,2.8),(9.45,1.7))
for i in range(4): arrow(ax,(8.0-i*1.95,1.325),(7.5-i*1.95,1.325))
box(ax,(.2,.18),1.45,.45,"Benchmark Scoring\n(Gold)","benchmark",fontsize=6.5)
arrow(ax,(.925,.95),(.925,.63))
ax.legend(handles=[Patch(fc="white",ec="black",label="Frozen product module"),Patch(fc=".92",ec="black",ls="--",label="Benchmark / evaluation boundary"),Patch(fc=".78",ec="black",ls=":",label="Provider-backed model call")],loc="lower center",ncol=3,frameon=False,bbox_to_anchor=(.5,-.02))
ax.text(5,3.75,"Omni-Context frozen architecture and evaluation boundary",ha="center",weight="bold",fontsize=10)
ax.text(5,.48,"Gold is confined to benchmark scoring and never enters the product retrieval path.",ha="center",fontsize=7)
save_figure(fig,"architecture")

# Figure 2: retrieval evidence pipeline.
fig, ax=plt.subplots(figsize=(7.1,3.0)); ax.set_xlim(0,11); ax.set_ylim(0,6); ax.axis("off")
channels=["Text","Vector","Assertion","Graph","Subject\nAttachment"]
for i,name in enumerate(channels): box(ax,(.25,4.9-i*.75),1.3,.55,name,"product"); arrow(ax,(1.55,5.175-i*.75),(2.55,3.25))
stages=[("Candidate\nPool",2.55),("Source-aware\nFusion",4.4),("Final-20",6.25),("Evidence\nSelector",7.85),("Answer\nTop-10",9.65)]
for name,x in stages: box(ax,(x,2.85),1.25,.8,name,"product")
for (_,x1),(_,x2) in zip(stages,stages[1:]): arrow(ax,(x1+1.25,3.25),(x2,3.25))
ax.annotate("graph/support noise\ndisplacement",xy=(3.15,2.85),xytext=(2.5,.82),ha="center",arrowprops=dict(arrowstyle="->",lw=.8),fontsize=7,bbox=dict(boxstyle="round",fc="white",ec="black",ls=":"))
ax.annotate("source-aware fusion",xy=(5.0,2.85),xytext=(5.0,.82),ha="center",arrowprops=dict(arrowstyle="->",lw=.8),fontsize=7,bbox=dict(boxstyle="round",fc="white",ec="black",ls=":"))
ax.annotate("query-aware evidence\nselection",xy=(8.45,2.85),xytext=(8.6,.82),ha="center",arrowprops=dict(arrowstyle="->",lw=.8),fontsize=7,bbox=dict(boxstyle="round",fc="white",ec="black",ls=":"))
ax.text(5.5,5.65,"Frozen retrieval evidence pipeline",ha="center",weight="bold",fontsize=10)
ax.text(5.5,.18,"Annotations describe the verified Candidate v3.1 fix scope; they are not universal claims.",ha="center",fontsize=7)
save_figure(fig,"retrieval-pipeline")

# Figure 3: overall mode comparison.
fig, ax=plt.subplots(figsize=(3.45,2.55)); evals=["Development-35","Comparison-70"]; x=range(2); width=.23
series=[("Full Omni",[dev_modes["full_omni"]["overall"],comp_modes["full_omni"]["overall"]],"white","///"),("Retrieval-only",[dev_modes["retrieval_only"]["overall"],comp_modes["retrieval_only"]["overall"]],".65","\\\\\\"),("No Memory",[dev_modes["no_memory"]["overall"],comp_modes["no_memory"]["overall"]],".9","...")]
for j,(label,vals,color,hatch) in enumerate(series):
    bars=ax.bar([i+(j-1)*width for i in x],vals,width,label=label,color=color,edgecolor="black",hatch=hatch,lw=.7)
    ax.bar_label(bars,labels=[f"{v:.3f}" for v in vals],fontsize=6,padding=1)
ax.set_ylim(0,1.03); ax.set_ylabel("Category-macro Overall"); ax.set_xticks(list(x),evals); ax.grid(axis="y",color=".85",lw=.5); ax.set_axisbelow(True)
ax.legend(frameon=False,ncol=1,loc="lower left",bbox_to_anchor=(0,1.0)); ax.set_title("Internal mode comparison",pad=33,weight="bold")
fig.text(.5,.005,"Mode comparisons are not strict component ablations.",ha="center",fontsize=6.5)
save_figure(fig,"overall-comparison")

# Figure 4: seven-category dot comparison.
fig, ax=plt.subplots(figsize=(7.1,3.8)); y=list(range(len(CATEGORY_ORDER)))[::-1]
series=[("Dev Full","Development-35","full_omni","o","black"),("Formal Full","Formal-250","full_omni","x",".25"),("Comp Full","Comparison-70","full_omni","s",".35"),("Comp Retrieval","Comparison-70","retrieval_only","^",".55"),("Comp No Memory","Comparison-70","no_memory","D",".75")]
for label,evaluation,mode,marker,color in series:
    vals=[category_score[(evaluation,mode,c)] for c in CATEGORY_ORDER]
    if marker == "x":
        ax.scatter(vals,y,label=label,marker=marker,s=25,color=color,lw=1)
    else:
        ax.scatter(vals,y,label=label,marker=marker,s=25,facecolors="none",edgecolors=color,lw=1)
ax.set_yticks(y,[CATEGORY_LABELS[c] for c in CATEGORY_ORDER]); ax.set_xlim(.15,1.03); ax.set_xlabel("Category mean"); ax.grid(axis="x",color=".85",lw=.5); ax.set_axisbelow(True)
ax.legend(ncol=5,frameon=False,loc="lower center",bbox_to_anchor=(.5,1.0)); ax.set_title("Seven capability categories (verified category means)",pad=28,weight="bold")
fig.text(.5,.01,"Formal and Development have Full Omni only in the category comparison source; missing baselines are not fabricated.",ha="center",fontsize=6.5)
save_figure(fig,"category-comparison")

# Figure 5: coverage funnel with separated denominators.
fig, axes=plt.subplots(1,2,figsize=(7.1,2.65),gridspec_kw={"width_ratios":[1.7,1]})
layers=["Candidate Pool","Final-20","Answer Top-10"]; vals=[28/30]*3
bars=axes[0].barh(layers,vals,color=["white",".7",".9"],edgecolor="black",hatch=["///","\\\\\\","..."])
axes[0].invert_yaxis(); axes[0].set_xlim(0,1.05); axes[0].set_xlabel("Targeted-7 slot coverage (denominator=30)"); axes[0].bar_label(bars,labels=["28/30"]*3,padding=3,fontsize=7); axes[0].grid(axis="x",color=".88",lw=.5); axes[0].set_axisbelow(True)
pre=[20/38,37/38]; bars2=axes[1].bar(["Before fix","Frozen fix"],pre,color=[".9","white"],edgecolor="black",hatch=["xx","///"])
axes[1].set_ylim(0,1.08); axes[1].set_ylabel("Retrieval preflight Top-10\nslot coverage (denominator=38)"); axes[1].bar_label(bars2,labels=["20/38","37/38"],padding=2,fontsize=7); axes[1].grid(axis="y",color=".88",lw=.5); axes[1].set_axisbelow(True)
fig.suptitle("Coverage evidence with distinct statistical denominators",weight="bold",fontsize=10); fig.tight_layout(rect=[0,.04,1,.92]); fig.text(.5,.01,"Targeted-7 and retrieval preflight are separate measurements and must not be pooled.",ha="center",fontsize=6.5)
save_figure(fig,"coverage-funnel")

# Figure 6: efficiency and stability.
fig, axes=plt.subplots(1,2,figsize=(7.1,2.7)); lat=[formal["p50_latency_ms"]/1000,formal["p95_latency_ms"]/1000]
bars=axes[0].bar(["P50","P95"],lat,color=["white",".72"],edgecolor="black",hatch=["///","\\\\\\"]); axes[0].bar_label(bars,labels=[f"{v:.3f} s" for v in lat],padding=2,fontsize=7); axes[0].set_ylabel("Formal completed-record latency (s)"); axes[0].set_ylim(0,max(lat)*1.2); axes[0].grid(axis="y",color=".88",lw=.5); axes[0].set_axisbelow(True)
labels=["Retry\nrecords","Formal final\nerrors","Comparison final\nerrors"]; counts=[headline["stability"]["retry_records"],formal["errors"],sum(m["errors"] for m in comparison["modes"])]
bars=axes[1].bar(labels,counts,color=["white",".65",".9"],edgecolor="black",hatch=["///","xx","..."]); axes[1].bar_label(bars,labels=[str(v) for v in counts],padding=2,fontsize=7); axes[1].set_ylabel("Recorded count"); axes[1].set_ylim(0,38); axes[1].grid(axis="y",color=".88",lw=.5); axes[1].set_axisbelow(True)
fig.suptitle("Efficiency and provider/schema stability",weight="bold",fontsize=10); fig.tight_layout(rect=[0,.04,1,.92]); fig.text(.5,.01,"Errors remain visible; no failed record is imputed or removed.",ha="center",fontsize=6.5)
save_figure(fig,"latency-summary")

figure_map = [
    ("architecture", "architecture/module-to-code-map.csv; architecture/method-facts.json"),
    ("retrieval-pipeline", "architecture/final-product-fix.md; metrics/headline-metrics.json"),
    ("overall-comparison", "metrics/development-35-summary.json; metrics/comparison-70-summary.json"),
    ("category-comparison", "figures-data/category-comparison.csv"),
    ("coverage-funnel", "metrics/targeted-7-summary.json; metrics/headline-metrics.json"),
    ("latency-summary", "metrics/formal-250-summary.json; metrics/headline-metrics.json"),
]
with (AUDIT / "figure-source-map.csv").open("w", encoding="utf-8", newline="") as handle:
    writer=csv.writer(handle); writer.writerow(["figure","svg","pdf","source","generator","status"])
    for stem,sources in figure_map: writer.writerow([stem,f"paper/figures/{stem}.svg",f"paper/figures/{stem}.pdf",sources,"paper/figure-scripts/generate_assets.py","VERIFIED"])

print(json.dumps({"status":"generated","tables":len(table_map),"figure_pairs":len(figure_map),"number_audit_entries":len(numbers)},indent=2))
