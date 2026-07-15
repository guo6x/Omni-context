# Error attribution

All seven terminal errors are evaluation-infrastructure failures at embedding preflight. Extraction, candidate generation, grouping, reranking, selection, Answer, Judge, and scoring were never reached.

Accordingly Extraction Failure, Retrieval Failure, Evidence Selection Failure, Memory Pipeline Unresolved, and Answer Generation Failure are `not_evaluated`, not zero. Scoring Defect is 0 because the scoring implementation was unchanged and never invoked for these failed rows.
