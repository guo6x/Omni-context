#!/usr/bin/env python3
import argparse
import json
import os
import random
import re
from pathlib import Path

import numpy as np
from rank_bm25 import BM25Okapi
from sentence_transformers import SentenceTransformer

MODEL_ID = "BAAI/bge-small-en-v1.5"
MODEL_REVISION = "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a"
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
BUDGETS = [2, 4, 6]
SEED = 20261007

TOKEN_RE = re.compile(r"[a-z0-9]+")

def tokenize(text: str):
    return TOKEN_RE.findall(text.lower())

def stable_top(scores, docs, k):
    order = sorted(range(len(docs)), key=lambda i: (-float(scores[i]), docs[i]["document_id"]))
    return [docs[i]["document_id"] for i in order[:k]]

def load_cases(path):
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source_jsonl")
    ap.add_argument("output_json")
    args = ap.parse_args()

    random.seed(SEED)
    np.random.seed(SEED)
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

    cases = load_cases(args.source_jsonl)

    model = SentenceTransformer(
        MODEL_ID,
        revision=MODEL_REVISION,
        device="cpu",
    )

    rows = []
    for case in cases:
        docs = case["documents"]
        texts = [d["fact"] for d in docs]

        tokenized_docs = [tokenize(t) for t in texts]
        bm25 = BM25Okapi(tokenized_docs)
        bm25_scores = bm25.get_scores(tokenize(case["query"]))

        doc_emb = model.encode(
            texts,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        query_emb = model.encode(
            [QUERY_PREFIX + case["query"]],
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )[0]
        dense_scores = np.matmul(doc_emb, query_emb)

        for retriever, scores in [
            ("BM25_OKAPI", bm25_scores),
            ("BGE_SMALL_EN_V1_5", dense_scores),
        ]:
            for k in BUDGETS:
                rows.append({
                    "case_id": case["case_id"],
                    "retriever": retriever,
                    "k": k,
                    "document_ids": stable_top(scores, docs, k),
                })

    out = {
        "schema_version": 1,
        "status": "DEVELOPMENT_ONLY",
        "source_cases": len(cases),
        "retrievers": {
            "BM25_OKAPI": {
                "package": "rank-bm25",
                "version": "0.2.2",
                "tokenizer": "lowercase ASCII alphanumeric regex [a-z0-9]+",
            },
            "BGE_SMALL_EN_V1_5": {
                "model": MODEL_ID,
                "revision": MODEL_REVISION,
                "query_prefix": QUERY_PREFIX,
                "normalize_embeddings": True,
                "similarity": "cosine via normalized dot product",
                "device": "cpu",
            },
        },
        "budgets": BUDGETS,
        "seed": SEED,
        "rows": rows,
    }
    Path(args.output_json).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(json.dumps({
        "status": out["status"],
        "source_cases": len(cases),
        "ranking_rows": len(rows),
        "budgets": BUDGETS,
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
    }, indent=2))

if __name__ == "__main__":
    main()
