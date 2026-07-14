# Candidate v1 / v2 comparison

Formal Answer/Judge metrics use 199-question runs. Retrieval proxies are labeled separately because Candidate v1 did not persist them as formal run metrics.

| Metric | Candidate v1 | Candidate v2 | Change |
|---|---:|---:|---:|
| Binary Accuracy (formal) | 0.4824 | 0.5025 | +0.0201 |
| Answerable Accuracy (formal) | 0.4013 | 0.4079 | +0.0066 |
| Single-hop (formal) | 0.2188 | 0.2500 | +0.0313 |
| Multi-hop (formal) | 0.3846 | 0.3846 | 0.0000 |
| Temporal (formal) | 0.4595 | 0.5135 | +0.0541 |
| Open-domain (formal) | 0.4571 | 0.4286 | -0.0286 |
| Evidence Precision (formal) | 0.4518 | 0.6868 | +0.2349 |
| Final Context Recall (task proxy vs formal v2) | 0.4830 | 0.5867 | +0.1037 |
| Final Context Recall (same conservative recomputation) | 0.4600 | 0.5867 | +0.1267 |
| Recall@10 (task proxy vs offline v2) | 0.6130 | 0.6267 | +0.0137 |
| Recall@10 (same ablation A vs F) | 0.6333 | 0.6267 | -0.0066 |
| Gold-present accuracy (task proxy vs formal v2) | 0.5690 | 0.5341 | -0.0349 |
| Gold-present accuracy (same conservative method) | 0.4928 | 0.5341 | +0.0413 |

The admission significance gate passed through Final Context Recall (+0.1037 versus the task proxy), not Recall@10. The Answer layer improved overall accuracy modestly and Evidence Precision substantially. Temporal improved; open-domain regressed and is retained as a P1 risk.

Candidate v2 model content is 552.04 MiB versus 129.12 MiB for the former small model (+422.92 MiB). Formal total latency was P50 7.850 s / P95 12.265 s. Observed local Brain Server working-set proxy was about 1.13-1.18 GB (private memory observed up to about 1.61 GB during rebuild).

The locally retained pre-v2 installers are only size proxies because Candidate v1 did not archive an installer manifest. Against those files, MSI size changed from 275,907,464 to 605,786,932 bytes (+329,879,468), and NSIS changed from 199,453,433 to 530,217,243 bytes (+330,763,810). Candidate v2 installer hashes are recorded in `evidence/installer-manifest.json`; the older files are not relabeled as formal Candidate v1 artifacts.
