"""Optional local LLM inference, behind modules.llm.

The command is whatever reads a prompt on stdin and prints a reply on
stdout — the default is the claude CLI (`claude -p --model sonnet`), but
`llm -m gpt-4o`, `ollama run llama3`, or a shell script all work. Nothing
that comes back is applied automatically: callers turn replies into
briefings or proposals a human accepts or ignores.
"""
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402


def command(fast: bool = False) -> list[str] | None:
    m = seo_config.module("llm")
    if not m.get("enabled"):
        return None
    cmd = (m.get("fastCommand") if fast else None) or m.get("command") or ""
    parts = shlex.split(str(cmd))
    if not parts or not shutil.which(parts[0]):
        return None
    return parts


def available(fast: bool = False) -> bool:
    return command(fast) is not None


def infer(prompt: str, fast: bool = False) -> str | None:
    """Run the configured command with `prompt` on stdin. None when the
    module is off, the binary is missing, or the call fails/times out."""
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
