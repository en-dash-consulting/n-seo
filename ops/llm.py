"""Optional LLM inference, behind modules.llm. Two ways to reach a model.

  command (default)
      Any CLI that reads a prompt on stdin and prints a reply on stdout —
      `claude -p --model claude-sonnet-5`, `llm -m gpt-4o`,
      `ollama run llama3`, or a shell script.

  http
      An HTTP endpoint, for machines with no CLI signed in — which is every
      container and every server you did not log into by hand. Configure:

        "llm": {
          "enabled": true,
          "http": {
            "provider": "anthropic",              // or "openai"
            "model": "claude-sonnet-5",
            "fastModel": "claude-haiku-4-5-20251001",
            "apiKeyEnv": "ANTHROPIC_API_KEY",     // read from the env or .env
            "baseUrl": ""                          // optional, for a gateway
          }
        }

      `provider: "openai"` speaks the OpenAI chat-completions shape, so it
      also covers the many gateways and local servers that emulate it.

`http` wins when it is configured and its key resolves; otherwise the CLI
path runs. Nothing that comes back is applied automatically: callers turn
replies into briefings or proposals a human accepts or ignores.
"""
import json
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402
from http_util import curl_json  # noqa: E402

ANTHROPIC_VERSION = "2023-06-01"
MAX_TOKENS = 4096


def _enabled() -> dict | None:
    m = seo_config.module("llm")
    return m if m.get("enabled") else None


def http_config(fast: bool = False) -> dict | None:
    """The resolved HTTP config, or None when it is absent or has no key."""
    m = _enabled()
    if not m:
        return None
    h = m.get("http")
    if not isinstance(h, dict):
        return None
    provider = str(h.get("provider") or "").lower()
    model = (h.get("fastModel") if fast else None) or h.get("model")
    if provider not in ("anthropic", "openai") or not model:
        return None
    key = seo_config.env(str(h.get("apiKeyEnv") or ""))
    if not key:
        return None
    return {"provider": provider, "model": str(model),
            "baseUrl": str(h.get("baseUrl") or "").rstrip("/"), "key": key}


def command(fast: bool = False) -> list[str] | None:
    m = _enabled()
    if not m:
        return None
    cmd = (m.get("fastCommand") if fast else None) or m.get("command") or ""
    parts = shlex.split(str(cmd))
    if not parts or not shutil.which(parts[0]):
        return None
    return parts


def available(fast: bool = False) -> bool:
    return http_config(fast) is not None or command(fast) is not None


def _http_infer(cfg: dict, prompt: str, fast: bool) -> str | None:
    timeout = 120 if fast else 300
    if cfg["provider"] == "anthropic":
        url = (cfg["baseUrl"] or "https://api.anthropic.com") + "/v1/messages"
        args = ["-X", "POST",
                "-H", f"x-api-key: {cfg['key']}",
                "-H", f"anthropic-version: {ANTHROPIC_VERSION}",
                "-H", "Content-Type: application/json",
                "-d", json.dumps({"model": cfg["model"], "max_tokens": MAX_TOKENS,
                                  "messages": [{"role": "user", "content": prompt}]}),
                url]
    else:
        url = (cfg["baseUrl"] or "https://api.openai.com") + "/v1/chat/completions"
        args = ["-X", "POST",
                "-H", f"Authorization: Bearer {cfg['key']}",
                "-H", "Content-Type: application/json",
                "-d", json.dumps({"model": cfg["model"],
                                  "messages": [{"role": "user", "content": prompt}]}),
                url]
    try:
        resp = curl_json(args, timeout=timeout, attempts=2, label=f"llm {cfg['provider']}")
    except (RuntimeError, OSError) as exc:
        print(f"  llm: {exc}", file=sys.stderr)
        return None
    try:
        if cfg["provider"] == "anthropic":
            out = "".join(b.get("text", "") for b in resp["content"] if b.get("type") == "text")
        else:
            out = resp["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        detail = resp.get("error") if isinstance(resp, dict) else resp
        print(f"  llm: unexpected response: {json.dumps(detail)[:200]}", file=sys.stderr)
        return None
    return (out or "").strip() or None


def infer(prompt: str, fast: bool = False) -> str | None:
    """A reply, or None when the module is off, nothing is reachable, or the
    call fails or times out. Never raises: every caller degrades instead."""
    http = http_config(fast)
    if http:
        return _http_infer(http, prompt, fast)
    parts = command(fast)
    if not parts:
        return None
    try:
        p = subprocess.run(parts, input=prompt, capture_output=True, text=True,
                           timeout=120 if fast else 300)
    except (subprocess.TimeoutExpired, OSError) as exc:
        print(f"  llm: {exc}", file=sys.stderr)
        return None
    if p.returncode != 0:
        print(f"  llm: exit {p.returncode}: {p.stderr.strip()[:200]}", file=sys.stderr)
        return None
    out = p.stdout.strip()
    return out or None
