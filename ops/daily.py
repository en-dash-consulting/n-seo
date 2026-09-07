#!/usr/bin/env python3
"""The daily run: refresh every snapshot, diff, digest, export.

Portable replacement for a shell script — schedule it with launchd, cron or
systemd (see docs/SCHEDULING.md), or run it by hand any time:

  python3 ops/daily.py                 # everything the config enables
  python3 ops/daily.py --list          # show the steps and which are on
  python3 ops/daily.py --only probe,gsc
  python3 ops/daily.py --skip index-status --no-network-wait

Each step is a subprocess; its output is teed to the console and to
data/daily-ops.log. A failed step is retried once after waiting for the
network — on a laptop, a run that fires on wake usually fails only because
Wi-Fi is not up yet. Results land in data/last-run.json for the dashboard.
"""

import argparse
import json
import platform
import subprocess
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ingest"))
import seo_config  # noqa: E402

ROOT = seo_config.ROOT
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


def run_step(script: str) -> bool:
    p = subprocess.Popen([sys.executable, str(ROOT / script)], cwd=ROOT,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in p.stdout:
        log("  " + line.rstrip("\n"))
    return p.wait() == 0


def notify(text: str):
    if not seo_config.enabled("notifications") or platform.system() != "Darwin":
        return
    subprocess.run(["osascript", "-e",
                    f'display notification "{text}" with title "seo-agent daily run"'],
                   capture_output=True)


def git_autocommit():
    if not seo_config.enabled("gitAutoCommit"):
        return
    paths = [p for p in ("docs/daily-log.md", "docs/reports", "site") if (ROOT / p).exists()]
    if not paths:
        return
    subprocess.run(["git", "add", *paths], cwd=ROOT, capture_output=True)
    staged = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode != 0
    if not staged:
        return
    c = subprocess.run(["git", "commit", "-q", "-m", f"Daily refresh {date.today().isoformat()}"],
                       cwd=ROOT, capture_output=True, text=True)
    if c.returncode != 0:
        log(f"git: commit FAILED — {(c.stderr or c.stdout).strip()[:200]}")
        return
    log("git: committed daily refresh")
    remotes = subprocess.run(["git", "remote"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    if remotes:
        p = subprocess.run(["git", "push", "-q"], cwd=ROOT, capture_output=True, text=True)
        log("git: pushed" if p.returncode == 0 else f"git: push FAILED ({p.stderr.strip()[:120]})")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="list steps and exit")
    ap.add_argument("--only", help="comma-separated step names to run")
    ap.add_argument("--skip", help="comma-separated step names to skip")
    ap.add_argument("--no-network-wait", action="store_true")
    args = ap.parse_args()

    enabled_steps = [(n, s) for n, s, gate in STEPS if gate is None or seo_config.enabled(gate)]
    if args.list:
        for n, s, gate in STEPS:
            on = gate is None or seo_config.enabled(gate)
            print(f"  {'on ' if on else 'off'}  {n:18s} {s}" + (f"  (modules.{gate})" if gate else ""))
        return 0

    only = set(args.only.split(",")) if args.only else None
    skip = set(args.skip.split(",")) if args.skip else set()
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
        log("note: no seo-agent.config.json — running on the example config")
    if not args.no_network_wait:
        wait_for_network()

    results, failures = [], []
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

    seo_config.DATA.mkdir(parents=True, exist_ok=True)
    (seo_config.DATA / "last-run.json").write_text(json.dumps({
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "failures": "; ".join(failures),
        "steps": results,
    }, indent=1))

    if failures:
        notify(f"{', '.join(failures)} failed — see the Logs page")
    git_autocommit()
    log(f"=== done ({len(failures)} failures) ===")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
