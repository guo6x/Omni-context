#!/usr/bin/env bash
# Runs the full embedding ablation matrix (audit task 6) once model downloads complete.
# All runs share identical passages (419 dated dialogue turns), identical 150 queries,
# identical gold labels and identical metric code. Only the embedding model / usage varies.
set -e
cd "$(dirname "$0")"
node retrieval-testbed.mjs --model Xenova/multilingual-e5-small --variant noprefix
node retrieval-testbed.mjs --model Xenova/multilingual-e5-small --variant e5prefix
node retrieval-testbed.mjs --model Xenova/multilingual-e5-base  --variant e5prefix --cache
node retrieval-testbed.mjs --model Xenova/multilingual-e5-large --variant e5prefix --cache
node retrieval-testbed.mjs --model Xenova/bge-m3 --variant bgestyle --pooling cls --cache
echo ALL-ABLATIONS-DONE
