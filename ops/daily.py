#!/usr/bin/env python3
"""The daily run: refresh every snapshot, diff, digest, export.

Portable replacement for a shell script — schedule it with launchd, cron or
systemd (see docs/SCHEDULING.md), or run it by hand any time:

  python3 ops/daily.py                 # everything the config enables
  python3 ops/daily.py --list          # show the steps and which are on
  python3 ops/daily.py --only probe,gsc
  python3 ops/daily.py --skip index-status --no-network-wait
  python3 ops/daily.py --skip hooks       # steps only, no config hooks

Hooks (config `hooks`: beforeRun / afterStep.<name> / afterRun) are shell
commands run in the instance directory around the steps; a failing hook is
recorded as a failure but never aborts the run.

Each step is a subprocess; its output is teed to the console and to
data/daily-ops.log. A failed step is retried once after waiting for the
network — on a laptop, a run that fires on wake usually fails only because
Wi-Fi is not up yet. Results land in data/last-run.json for the dashboard.
"""

import argparse
import json
import os
import platform
import subprocess
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402

ROOT = seo_config.ROOT            # the engine: scripts run from here
INSTANCE = seo_config.INSTANCE    # the instance: data, log, git commits, hooks run here
LOG = seo_config.DATA / "daily-ops.log"

# (name, script, module gate or None)
STEPS = [
    ("probe",            "probes/site_probe.py",          None),
    ("gsc",              "ingest/pull_gsc.py",            None),
    ("ga4",              "ingest/pull_ga4.py",            None),
    ("timeseries",       "ingest/pull_timeseries.py",     None),
    ("metadata-audit",   "ingest/analyze_metadata.py",    "metadataAudit"),
    ("index-status",     "ingest/pull_index_status.py",   "indexStatus"),
    ("opportunity-scan", "ops/opportunity_scan.py",       "opportunityScan"),
    ("daily-diff",       "ops/daily_diff.py",             None),
    ("hn-digest",        "ops/hn_digest.py",              "hackerNews"),
    ("reddit-digest",    "ops/reddit_digest.py",          "reddit"),
    ("static-export",    "ops/export_static.py",          "staticExport"),
]


def log(line: str):
    print(line, flush=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as f:
        f.write(line.rstrip("\n") + "\n")


def wait_for_network(max_wait=300):
    waited = 0
    while waited < max_wait:
        p = subprocess.run(["curl", "-sf", "--max-time", "5", "-o", "/dev/null",
                            "https://www.google.com/generate_204"], capture_output=True)
        if p.returncode == 0:
            if waited:
                log(f"network: waited {waited}s for connectivity")
            return True
        time.sleep(10)
        waited += 10
    log(f"network: still down after {max_wait}s — continuing; network steps will fail")
    return False


def _hook_env(step: str | None = None) -> dict:
    env = dict(os.environ)
    env["N_SEO_ROOT"] = str(ROOT)
    env["N_SEO_INSTANCE"] = str(INSTANCE)
    if step:
        env["N_SEO_STEP"] = step
    return env


def run_step(script: str) -> bool:
    # Engine scripts run with cwd=ROOT; they find the instance through the
    # inherited N_SEO_INSTANCE (seo_config resolves it), never through cwd.
    p = subprocess.Popen([sys.executable, str(ROOT / script)], cwd=ROOT, env=_hook_env(),
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in p.stdout:
        log("  " + line.rstrip("\n"))
    return p.wait() == 0


def run_hook(cmd: str, step: str | None = None) -> bool:
    """One `hooks` command: a shell string run in the instance directory with
    N_SEO_ROOT / N_SEO_INSTANCE / N_SEO_STEP set. Output is teed like a step."""
    p = subprocess.Popen(cmd, shell=True, cwd=INSTANCE, env=_hook_env(step),
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in p.stdout:
        log("  " + line.rstrip("\n"))
    return p.wait() == 0


def run_hooks(kind: str, cmds: list, results: list, failures: list, step: str | None = None):
    """Run a hook list, recording each as hook:<kind>:<i>. A failing hook is a
    recorded failure, never an abort — the run's own steps still matter more."""
    for i, cmd in enumerate(cmds):
        name = f"hook:{kind}:{i}"
        t0 = time.time()
        log(f"--- {name}  $ {cmd}")
        ok = run_hook(cmd, step)
        if not ok:
            failures.append(name)
            log(f"{name} FAILED")
        results.append({"name": name, "ok": ok, "seconds": round(time.time() - t0, 1)})


def notify(text: str):
    if not seo_config.enabled("notifications") or platform.system() != "Darwin":
        return
    subprocess.run(["osascript", "-e",
                    f'display notification "{text}" with title "n-seo daily run"'],
                   capture_output=True)


def git_autocommit():
    if not seo_config.enabled("gitAutoCommit"):
        return
    # The instance is what has history worth committing; the engine is code.
    paths = [p for p in ("docs/daily-log.md", "docs/reports", "site") if (INSTANCE / p).exists()]
    if not paths:
        return
    subprocess.run(["git", "add", *paths], cwd=INSTANCE, capture_output=True)
    staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=INSTANCE).returncode != 0
    if not staged:
        return
    c = subprocess.run(["git", "commit", "-q", "-m", f"Daily refresh {date.today().isoformat()}"],
                       cwd=INSTANCE, capture_output=True, text=True)
    if c.returncode != 0:
        log(f"git: commit FAILED — {(c.stderr or c.stdout).strip()[:200]}")
        return
    log("git: committed daily refresh")
    remotes = subprocess.run(["git", "remote"], cwd=INSTANCE, capture_output=True, text=True).stdout.split()
    if remotes:
        p = subprocess.run(["git", "push", "-q"], cwd=INSTANCE, capture_output=True, text=True)
        log("git: pushed" if p.returncode == 0 else f"git: push FAILED ({p.stderr.strip()[:120]})")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="list steps and exit")
    ap.add_argument("--only", help="comma-separated step names to run")
    ap.add_argument("--skip", help="comma-separated step names to skip")
    ap.add_argument("--no-network-wait", action="store_true")
    args = ap.parse_args()

    enabled_steps = [(n, s) for n, s, gate in STEPS if gate is None or seo_config.enabled(gate)]
    hooks = seo_config.hooks()
    if args.list:
        e = seo_config.engine_info()
        print(f"  engine {e['version']} ({e['mode']}) — instance {e['instance']}")
        for c in hooks["beforeRun"]:
            print(f"  on   hook:before          $ {c}")
        for n, s, gate in STEPS:
            on = gate is None or seo_config.enabled(gate)
            print(f"  {'on ' if on else 'off'}  {n:18s} {s}" + (f"  (modules.{gate})" if gate else ""))
            for c in hooks["afterStep"].get(n, []):
                print(f"  {'on ' if on else 'off'}  hook:{n:13s}  $ {c}")
        for c in hooks["afterRun"]:
            print(f"  on   hook:after           $ {c}")
        return 0

    only = set(args.only.split(",")) if args.only else None
    skip = set(args.skip.split(",")) if args.skip else set()
    run_hooks_flag = "hooks" not in skip
    skip.discard("hooks")
    known = {n for n, _, _ in STEPS}
    for bad in (only or set()) | skip:
        if bad not in known:
            print(f"unknown step {bad!r}; known: {', '.join(known)}")
            return 2
    todo = [(n, s) for n, s in enabled_steps if (not only or n in only) and n not in skip]
    enabled_names = {n for n, _ in enabled_steps}
    for name in sorted((only or set()) - enabled_names):
        if name in dict(STEPS):
            print(f"note: {name} is disabled by its module in the config — skipped", file=sys.stderr)

    log(f"=== daily run {datetime.now():%Y-%m-%d %H:%M} ({len(todo)} steps) ===")
    if seo_config.using_example():
        log("note: no n-seo.config.json — running on the example config")
    if not args.no_network_wait:
        wait_for_network()

    results, failures = [], []
    if run_hooks_flag:
        run_hooks("before", hooks["beforeRun"], results, failures)
    for name, script in todo:
        t0 = time.time()
        log(f"--- {name}")
        ok = run_step(script)
        if not ok:
            log(f"{name} failed, waiting for network and retrying once")
            wait_for_network()
            ok = run_step(script)
            if ok:
                log(f"{name} recovered on retry")
        if not ok:
            failures.append(name)
            log(f"{name} FAILED")
        results.append({"name": name, "ok": ok, "seconds": round(time.time() - t0, 1)})
        if run_hooks_flag:
            run_hooks(name, hooks["afterStep"].get(name, []), results, failures, step=name)

    def write_last_run():
        seo_config.DATA.mkdir(parents=True, exist_ok=True)
        (seo_config.DATA / "last-run.json").write_text(json.dumps({
            "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "failures": "; ".join(failures),
            "steps": results,
        }, indent=1))

    write_last_run()
    if run_hooks_flag and hooks["afterRun"]:
        # afterRun sees a complete last-run.json (a mirror sync wants it), and
        # is then recorded in it too.
        run_hooks("after", hooks["afterRun"], results, failures)
        write_last_run()

    if failures:
        notify(f"{', '.join(failures)} failed — see the Logs page")
    git_autocommit()
    log(f"=== done ({len(failures)} failures) ===")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
