#!/usr/bin/env python3
"""Generate strict-ablation paper assets only from a completed machine report."""
from __future__ import annotations

import csv
import json
import os
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parents[2]
PAPER = ROOT / "paper"
SOURCE = ROOT / "docs" / "omni-context-next-phase-evidence" / "04-development-35-strict-ablations" / "strict-ablation-statistics.json"
CONDITIONS = [
    ("full_omni_fresh_control", "Full Omni fresh control"),
    ("selector_off", "Selector Off"),
    ("grouping_off", "Evidence Grouping Off"),
    ("source_aware_fusion_off", "Source-aware Fusion Off"),
]
PAIRS = [
    ("full_minus_selector_off", "Full minus Selector Off"),
    ("full_minus_grouping_off", "Full minus Grouping Off"),
    ("full_minus_source_aware_fusion_off", "Full minus Source-aware Fusion Off"),
]
os.environ.setdefault("SOURCE_DATE_EPOCH", "1784246400")


def fmt(value: float | None) -> str:
    return "--" if value is None else f"{float(value):.6f}"


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + "\n", encoding="utf-8", newline="\n")


def json_path(condition: str, field: str) -> str:
    return f"$.conditions.{condition}.{field}"


def main() -> None:
    report = json.loads(SOURCE.read_text(encoding="utf-8"))
    if report.get("status") != "completed":
        raise SystemExit("STRICT_ABLATION_REPORT_NOT_COMPLETED")
    if any(report["conditions"][key]["completed"] != 35 or report["conditions"][key]["errors"] != 0 for key, _ in CONDITIONS):
        raise SystemExit("STRICT_ABLATION_COMPLETION_GATE_FAILED")

    condition_rows = []
    audit_numbers = []
    for key, label in CONDITIONS:
        row = report["conditions"][key]
        overall = row["metrics"]["overall_cognitive_score"]
        candidate = row["evidence"]["candidate_pool"]["recall"]
        final20 = row["evidence"]["final_20"]["recall"]
        top10 = row["evidence"]["answer_top_10"]["recall"]
        condition_rows.append(
            f"{label} & {row['completed']} & {row['errors']} & {fmt(overall)} & {fmt(candidate)} & {fmt(final20)} & {fmt(top10)} \\\\"
        )
        for field, value in (
            ("completed", row["completed"]),
            ("errors", row["errors"]),
            ("metrics.overall_cognitive_score", overall),
            ("evidence.candidate_pool.recall", candidate),
            ("evidence.final_20.recall", final20),
            ("evidence.answer_top_10.recall", top10),
        ):
            audit_numbers.append({
                "condition": key,
                "field": field,
                "value": value,
                "source": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
                "json_path": json_path(key, field),
                "consumers": ["paper/tables/strict-ablations.tex"],
            })

    paired_rows = []
    means, lower_errors, upper_errors, labels = [], [], [], []
    for key, label in PAIRS:
        row = report["paired"][key]
        ci = row["bootstrap_95_ci"]
        paired_rows.append(
            f"{label} & {row['paired_n']} & {fmt(row['mean_difference'])} & {fmt(row['median_difference'])} & "
            f"{row['full_higher']}/{row['ablation_higher']}/{row['ties']} & [{fmt(ci['lower'])}, {fmt(ci['upper'])}] & "
            f"{fmt(row['wilcoxon']['p_two_sided'])} & {fmt(row['wilcoxon']['rank_biserial'])} & {fmt(row['effect_size']['paired_cohens_dz'])} \\\\"
        )
        means.append(row["mean_difference"])
        lower_errors.append(row["mean_difference"] - ci["lower"])
        upper_errors.append(ci["upper"] - row["mean_difference"])
        labels.append(label.removeprefix("Full minus "))
        for field, value in (
            ("paired_n", row["paired_n"]),
            ("mean_difference", row["mean_difference"]),
            ("median_difference", row["median_difference"]),
            ("full_higher", row["full_higher"]),
            ("ablation_higher", row["ablation_higher"]),
            ("ties", row["ties"]),
            ("bootstrap_95_ci.lower", ci["lower"]),
            ("bootstrap_95_ci.upper", ci["upper"]),
            ("wilcoxon.p_two_sided", row["wilcoxon"]["p_two_sided"]),
            ("wilcoxon.rank_biserial", row["wilcoxon"]["rank_biserial"]),
            ("effect_size.paired_cohens_dz", row["effect_size"]["paired_cohens_dz"]),
        ):
            audit_numbers.append({
                "comparison": key,
                "field": field,
                "value": value,
                "source": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
                "json_path": f"$.paired.{key}.{field}",
                "consumers": ["paper/tables/strict-ablations.tex", "paper/figures/strict-ablations.svg", "paper/figures/strict-ablations.pdf"],
            })

    table = f"""\\begin{{table*}}[t]
\\centering\\scriptsize
\\caption{{Internal Development-35 strict component ablations. Coverage uses the same frozen scenario facts and retrieval budgets for all conditions.}}
\\label{{tab:strict-ablations}}
\\begin{{tabular}}{{lrrrrrr}}
\\toprule
Condition & Completed & Errors & Overall & Candidate & Final-20 & Top-10 \\\\
\\midrule
{chr(10).join(condition_rows)}
\\bottomrule
\\end{{tabular}}

\\vspace{{0.5em}}
\\begin{{tabular}}{{lrrrrrrrr}}
\\toprule
Paired contrast & $n$ & Mean $\\Delta$ & Median $\\Delta$ & F/A/T & Bootstrap 95\\% CI & $p$ & Rank bis. & $d_z$ \\\\
\\midrule
{chr(10).join(paired_rows)}
\\bottomrule
\\end{{tabular}}
\\begin{{minipage}}{{0.98\\textwidth}}\\footnotesize
$\\Delta$ is Full Omni fresh control minus the named ablation for the same scenario. F/A/T counts scenarios where Full is higher, the ablation is higher, or tied. Confidence intervals use the preregistered fixed-seed 10,000-sample paired bootstrap; $p$ is the two-sided Wilcoxon signed-rank approximation. Earlier Full Omni / Retrieval-only / No Memory comparisons are mode comparisons. The new selector/grouping/fusion experiments are strict component ablations. These are internal Development-35 results, not external generalization evidence.
\\end{{minipage}}
\\end{{table*}}"""
    write(PAPER / "tables" / "strict-ablations.tex", table)

    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    colors = ["#2A6F97", "#3A7D44", "#A15C38"]
    bars = ax.bar(labels, means, color=colors, yerr=[lower_errors, upper_errors], capsize=5, width=0.62)
    ax.axhline(0, color="#333333", linewidth=0.8)
    ax.set_ylabel("Paired score difference\n(Full minus ablation)")
    ax.set_title("Internal Development-35 strict component effects")
    ax.grid(axis="y", color="#D9D9D9", linewidth=0.6, alpha=0.8)
    ax.set_axisbelow(True)
    for bar, value in zip(bars, means):
        ax.annotate(f"{value:.3f}", (bar.get_x() + bar.get_width() / 2, value), xytext=(0, 6 if value >= 0 else -14), textcoords="offset points", ha="center", fontsize=9)
    fig.tight_layout()
    for extension in ("svg", "pdf"):
        fig.savefig(PAPER / "figures" / f"strict-ablations.{extension}", bbox_inches="tight", metadata={"Creator": "Omni-Context deterministic paper asset generator"})
    plt.close(fig)

    write(PAPER / "evidence" / "ablation-number-audit.json", json.dumps({
        "schema_version": 1,
        "status": "VERIFIED",
        "dataset_sha256": report["dataset_sha256"],
        "bootstrap_iterations": report["bootstrap_iterations"],
        "bootstrap_seed": report["bootstrap_seed"],
        "numbers": audit_numbers,
    }, indent=2, ensure_ascii=False))

    claims = [
        ["AB01", "The four conditions completed 35/35 internal scenarios with zero terminal errors.", "Do not describe Development-35 as held-out or external validation.", "Results", "$.conditions", "VERIFIED"],
        ["AB02", "Each paired contrast uses the same scenarios and reports fixed-seed bootstrap and Wilcoxon statistics.", "Do not infer significance from aggregate scores alone.", "Results", "$.paired", "VERIFIED"],
        ["AB03", "Earlier Full Omni / Retrieval-only / No Memory comparisons are mode comparisons; these selector/grouping/fusion runs are strict component ablations.", "Do not relabel prior mode comparisons as component ablations.", "Experiments", "instrumentation and $.conditions", "VERIFIED"],
        ["AB04", "Only observed internal Development-35 differences may be stated.", "Do not claim any component is universally necessary.", "Analysis", "$.interpretation_scope", "VERIFIED"],
        ["AB05", "External LongMemEval and LoCoMo formal evaluations remain NOT RUN.", "Do not combine these ablations with an external-generalization claim.", "Limitations", "external preregistrations", "VERIFIED"],
    ]
    claim_path = PAPER / "evidence" / "ablation-claim-map.csv"
    claim_path.parent.mkdir(parents=True, exist_ok=True)
    with claim_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["claim_id", "allowed_wording", "forbidden_wording", "paper_section", "source_field", "status"])
        writer.writerows(claims)


if __name__ == "__main__":
    main()
