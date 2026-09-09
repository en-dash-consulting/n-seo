#!/usr/bin/env python3
"""Publish the exported mirror somewhere (modules.publish).

`ops/export_static.py` builds a read-only copy of the dashboard into
`site/`. Getting that copy to wherever people read it — a bucket, an object
store, a box over ssh — is the other half, and it used to mean writing an
`afterRun` hook by hand. This makes it a normal pipeline step, so it is
logged, retried once and recorded in `last-run.json` like everything else.

  python3 ops/publish.py              # publish site/ to modules.publish.destination

Targets:

  gcs      gcloud storage rsync site <dest> --recursive
  s3       aws s3 sync site <dest>
  rsync    rsync -a site/ <dest>
  command  run modules.publish.command — the escape hatch for anything else

`delete` adds each tool's "remove what is no longer here" flag, which is what
makes the mirror match the export rather than accumulate stale pages. Set
`dryRun` to print the command without running it: that is how you rehearse a
cutover against a bucket that is already serving something.

`env` is merged into the child's environment only — a deployment that keeps
its cloud credentials in an isolated config directory points at it there,
without exporting it for the whole daily run. Values are never printed.
"""

import os
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402

TARGETS = ("gcs", "s3", "rsync", "command")

# target -> the binary that must be on PATH ("command" runs a shell string)
BINARY = {"gcs": "gcloud", "s3": "aws", "rsync": "rsync"}

DEST_EXAMPLE = {
    "gcs": "gs://your-bucket",
    "s3": "s3://your-bucket",
    "rsync": "user@host:/srv/n-seo-mirror",
}


def site_dir() -> Path:
    return seo_config.INSTANCE / "site"


def build_command(mod: dict, site: Path):
    """(command, shell) for the configured target.

    `command` is an argv list for the three built-in targets and a shell
    string for `command`; `shell` says which. Raises ValueError with a
    message meant for the operator, not a stack trace.
    """
    target = (mod.get("target") or "").strip()
    if target not in TARGETS:
        raise ValueError(
            f"unknown publish target {target!r} — use one of: {', '.join(TARGETS)}")

    if target == "command":
        cmd = (mod.get("command") or "").strip()
        if not cmd:
            raise ValueError(
                "modules.publish.command is empty — target 'command' needs the "
                "shell command that publishes site/")
        return cmd, True

    dest = (mod.get("destination") or "").strip()
    if not dest:
        raise ValueError(
            f"modules.publish.destination is empty — set it to something like "
            f"{DEST_EXAMPLE[target]} for target {target!r}")

    delete = bool(mod.get("delete"))
    if target == "gcs":
        argv = ["gcloud", "storage", "rsync", str(site), dest, "--recursive"]
        if delete:
            argv.append("--delete-unmatched-destination-objects")
    elif target == "s3":
        argv = ["aws", "s3", "sync", str(site), dest]
        if delete:
            argv.append("--delete")
    else:  # rsync — the trailing slash copies the contents, not the directory
        argv = ["rsync", "-a", str(site) + "/", dest]
        if delete:
            argv.append("--delete")
    return argv, False


def child_env(mod: dict) -> dict:
    """The daily run's environment plus modules.publish.env.

    `~` and $VARS in the values are expanded so a credentials path can be
    written the way a person would type it.
    """
    env = dict(os.environ)
    for k, v in (mod.get("env") or {}).items():
        if isinstance(k, str) and k:
            env[k] = os.path.expanduser(os.path.expandvars(str(v)))
    return env


def main() -> int:
    if not seo_config.enabled("publish"):
        print("modules.publish is off — nothing to publish")
        return 0
    mod = seo_config.module("publish")

    site = site_dir()
    try:
        cmd, shell = build_command(mod, site)
    except ValueError as exc:
        print(f"publish: {exc}", file=sys.stderr)
        return 1

    if not site.is_dir():
        print(f"publish: nothing to publish — {site} does not exist. Enable "
              f"modules.staticExport so the daily run builds it first.",
              file=sys.stderr)
        return 1

    target = mod["target"]
    binary = BINARY.get(target)
    if binary and shutil.which(binary) is None:
        print(f"publish: {binary!r} is not on PATH — target {target!r} needs it "
              f"(install it, or use target 'command')", file=sys.stderr)
        return 1

    printable = cmd if shell else " ".join(shlex.quote(a) for a in cmd)
    # Key names only: a publish env is where credentials paths and tokens live.
    env_keys = sorted(k for k in (mod.get("env") or {}) if isinstance(k, str) and k)
    if env_keys:
        print(f"publish: env {', '.join(env_keys)}")

    if mod.get("dryRun"):
        print(f"publish: DRY RUN — would run:\n  {printable}\n"
              f"publish: set modules.publish.dryRun to false to publish for real")
        return 0

    print(f"publish: {printable}")
    p = subprocess.run(cmd, shell=shell, cwd=seo_config.INSTANCE, env=child_env(mod))
    if p.returncode != 0:
        print(f"publish: FAILED (exit {p.returncode}) — {target} → "
              f"{mod.get('destination') or 'command'}", file=sys.stderr)
        return 1
    print(f"publish: {site.name}/ → {mod.get('destination') or 'command'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
