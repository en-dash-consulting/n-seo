# Scheduling the daily run and the dashboard

Two things should always be running: the **dashboard** (a long-lived process
serving the configured port) and the **daily run** (`ops/daily.py`, once a
morning). Both are plain processes; pick the scheduler your OS already has.

## macOS (launchd)

The install script fills in the templates under `ops/templates/`, copies them
to `~/Library/LaunchAgents`, and loads them:

```sh
ops/install-launchd.sh            # installs n-seo.dashboard and n-seo.daily
ops/install-launchd.sh --uninstall
```

What it installs:

| Label | Does | Log |
|---|---|---|
| `n-seo.dashboard` | `npx tsx src/server.tsx`, KeepAlive, starts at login | `data/dashboard.log` |
| `n-seo.daily` | `python3 ops/daily.py` at 07:00 local | `data/daily-launchd.log` (launchd), `data/daily-ops.log` (the run itself) |

Manual equivalent: copy the two plists from `ops/templates/`, replace
`__REPO__`, `__NODE_BIN__` and `__HOME__`, then
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.n-seo.*.plist`.

**Runs on wake.** A `StartCalendarInterval` job that misses its slot because
the machine was asleep fires as soon as the machine wakes. On wake the network
is usually not up yet, which is why `ops/daily.py` waits (up to five minutes)
for connectivity before it starts. A machine that stays shut all day skips
that day; there is no catch-up.

**After code changes** the dashboard service does not reload itself:

```sh
launchctl kickstart -k gui/$(id -u)/n-seo.dashboard
```

For iterative development use `npm run dev` in a terminal — but stop it
before relying on the service again, since both bind the same port.

## Linux (cron)

```sh
crontab -e
```

Paste the line from `ops/templates/n-seo.cron`, adjusting the path:

```
0 7 * * * cd /path/to/n-seo && /usr/bin/python3 ops/daily.py >> data/daily-cron.log 2>&1
```

Cron does not run missed jobs; if the machine is off at 07:00 that day is
skipped. Run the dashboard with the systemd unit below, or with any process
supervisor you already use.

## Linux (systemd user units)

`ops/templates/` has three units:

| File | Purpose |
|---|---|
| `n-seo-dashboard.service` | the dashboard, `Restart=always` |
| `n-seo-daily.service` | one run of `ops/daily.py` |
| `n-seo-daily.timer` | `OnCalendar=*-*-* 07:00:00`, `Persistent=true` (runs a missed slot on next boot) |

```sh
mkdir -p ~/.config/systemd/user
sed "s|__REPO__|$PWD|g" ops/templates/n-seo-dashboard.service > ~/.config/systemd/user/n-seo-dashboard.service
sed "s|__REPO__|$PWD|g" ops/templates/n-seo-daily.service     > ~/.config/systemd/user/n-seo-daily.service
cp ops/templates/n-seo-daily.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now n-seo-dashboard.service n-seo-daily.timer
loginctl enable-linger "$USER"     # keep user units running when you are logged out
```

Check on them with `systemctl --user status n-seo-dashboard` and
`journalctl --user -u n-seo-daily`.

## Running by hand

```sh
python3 ops/daily.py                   # everything
python3 ops/daily.py --list            # the step names
python3 ops/daily.py --only gsc,ga4    # a subset
python3 ops/daily.py --skip index-status
python3 ops/daily.py --no-network-wait
```

Each run appends to `data/daily-ops.log`, writes `data/last-run.json` (which
the dashboard shows as the run status chip), and appends a dated entry to
`docs/daily-log.md`. Re-running on the same day replaces that day's entry
rather than stacking a second one.

## Logs, in one place

| File | What |
|---|---|
| `data/daily-ops.log` | stdout of every daily run, appended |
| `data/last-run.json` | timestamp, failed step names, per-step timing |
| `docs/daily-log.md` | the human-readable daily entry (also on `/logs`) |
| `data/dashboard.log` | dashboard stdout/stderr under launchd |
