# LoCoMo Status

`NOT RUN — CANDIDATE V3.1 IS NOT BOUND TO THE EXISTING HELD-OUT AUTHORIZATION`.

The repository contains a real LoCoMo runner and an official-dataset manifest. The held-out gate, however, is cryptographically bound to the older `Omni-Context Evaluation Freeze v1`, annotated tag `omni-context-evaluation-freeze-v1`, and its peeled commit. Candidate v3.1 is frozen by the distinct tag `evaluation-freeze-candidate-v3.1` at product commit `17dc1d0107b0474de84058205a91b302ba290a74`.

Running the old authorized worktree would evaluate the old frozen product, not Candidate v3.1. Bypassing or rewriting that gate after Candidate freeze would violate the evaluation rules. Therefore the local official dataset path was located but its content was not opened, hashed, parsed, or run, and Conversations 2-10 remain unaccessed.
