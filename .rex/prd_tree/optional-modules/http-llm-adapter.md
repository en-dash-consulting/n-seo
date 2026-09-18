---
id: "1cfe13b3-03cb-4834-b32a-027554cae933"
level: "feature"
title: "HTTP LLM adapter"
status: "completed"
source: "manual"
startedAt: "2026-09-17T16:21:45.944Z"
completedAt: "2026-09-17T16:21:45.944Z"
endedAt: "2026-09-17T16:21:45.944Z"
acceptanceCriteria:
  - "`modules.llm.http` takes `provider` (`anthropic` or `openai`), `model`, an optional `baseUrl` and a key resolved from the environment; `http` wins when configured and its key resolves, otherwise the CLI command runs, and with neither the scan records candidates only."
description: "Call an OpenAI-compatible or Anthropic HTTP endpoint instead of a CLI."
lastModified: "2026-09-17T16:21:45.955Z"
---
