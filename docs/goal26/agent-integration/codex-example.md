# Codex example

Configure the external client with the Brain MCP URL and an
`AGENT_PILOT` credential supplied through an environment variable. Do not put
the credential in a checked-in MCP configuration, command argument, URL, log,
or screenshot.

Ask with `agent_ask`, inspect with `agent_inspect`, and observe with
`agent_outcome`. Human approval and Desktop execution remain separate local
actions. A Codex runtime claim is valid only when the protocol-real harness or
the actual local runtime has been run and recorded in the pilot proof artifact.
