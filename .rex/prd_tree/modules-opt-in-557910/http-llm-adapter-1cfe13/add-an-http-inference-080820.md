---
id: "080820a2-23cf-4873-a0c2-31347dfa3ba9"
level: "task"
title: "Add an HTTP inference adapter"
status: "pending"
priority: "medium"
tags:
  - "modules"
  - "llm"
source: "manual"
acceptanceCriteria:
  - "modules.llm.http = {provider, model, baseUrl} with the key read from .env"
  - "Same infer() contract as the CLI path; tests cover both"
description: "Keeps stdlib-only Python by using curl through http_util."
---
