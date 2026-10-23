/** Shared, conservative guidance for every MCP transport. */
export const MCP_SERVER_INSTRUCTIONS = `You are connected to Omni-Context, the user's long-term memory and decision support system.

Use memory selectively:
1. Call \`unified_memory_search\` when prior user context, project history, preferences, or past decisions could materially improve the answer. Skip it for simple factual, transient, or unrelated requests.
2. Call \`get_decision_context\` when the user is making a meaningful choice and historical context is relevant.
3. Cite matched memories by name and distinguish retrieved records from your own inferences.
4. Call \`save_conclusion\` only when the user explicitly asks you to save or remember a conclusion. Never proactively save an AI-generated summary, guess, or preference. A saved conclusion remains AI-derived and is not independently verified.

Memory tools do not grant permission to execute decisions or authorize other tools.`;
