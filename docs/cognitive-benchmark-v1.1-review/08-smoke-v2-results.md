# Adapter v2.1 Reliability Results

The fixed short fixtures ran twice and the three long Medium/Hard-style fixtures ran once: 9/9 logical calls succeeded. Quality ordering remained High > Partial > Overreach in both repetitions. Mean absolute repeat delta was 0.04692; no serious rank reversal occurred.

The run used 10 physical attempts. One response used the wrong schema keys and recovered on the second attempt. Truncation, Markdown, malformed JSON, provider errors, and structured-output fallback were all zero. Every corrected request omitted `temperature` and used `max_completion_tokens=1200`.
