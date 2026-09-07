# FAQ

**What does it cost?**
Nothing. The Search Console and GA4 APIs are free within quotas that ordinary
use never approaches. The optional LLM module runs whatever local command you
give it; if that is a paid CLI, that is your cost, not the tool's.

**Does it change my site?**
No. It reads your data, probes your pages, and produces a queue of actions
with evidence and specs. You make the change in your own repo and ship it.
The next daily run tells you whether it worked. The only files the app ever
writes are its own config, `config/backlog.json` (when you click accept /
watch / retire), and files under `data/`, `site/` and `docs/`.

**Can it post to Hacker News or Reddit for me?**
No, by design, and the docs ask any AI agent using the repo not to either.
The community modules find threads where your experience applies and write a
briefing — what the piece says, what the thread is debating, where you
genuinely connect. Generated participation is detectable and gets accounts
banned; a briefing gets you to the thread quickly and the words stay yours.

**Do I need Claude, or any LLM?**
No. Every data step and every page works without one. The `llm` module is
off by default; when on, it runs a shell command that reads a prompt on
stdin and prints a reply — the `claude` CLI by default, but any CLI with
that shape works (`llm`, `ollama run …`, your own script). It adds
proposals and verdicts to the opportunity scan and briefings to the digests.
Nothing it produces is applied automatically.

**Does it run on Windows?**
Not supported. The scripts assume `curl`, `openssl`, POSIX paths and one of
launchd / cron / systemd. WSL2 is likely to work but is untested.

**Where does my data go?**
Into `data/` on the machine that runs the pipeline, as JSON. The only network
calls are to the Google APIs you authorized, your own sites (the probe and
the metadata audit fetch pages like a browser would), and — if you enable
them — the HN Algolia API, Reddit's API, IndexNow, and your LLM command. The
static-export module writes HTML to `site/`; where you host that, and behind
what auth, is up to you. Nothing phones home.

**Can several people use one install?**
The dashboard is a plain HTTP server on the configured port with no accounts.
On a shared machine or a tunnel, everyone who can reach the port sees
everything and can click accept / watch / retire and change Settings. Put it
behind your own auth (a VPN, an identity-aware proxy, an SSH tunnel) if that
matters. The MCP HTTP endpoint is the one part with its own gate: a bearer
token, and it refuses to serve without one.

**How is "impact" estimated?**
Roughly, and only to order the queue. CTR gaps: impressions × (the CTR the
position should earn − the CTR it gets), per month. Striking distance: a
small fraction of impressions assumed to convert to clicks if the page
reaches the top five. Engagement mismatches: a share of the sessions that
currently bounce. Backlog items carry whatever estimate you typed. Impact ÷
effort (S=1, M=2.5, L=5) sorts the list. These are not forecasts and the
dashboard says so on every page that shows them.

**Why 90 days?**
Because a page you fixed last week must stop being accused within a season,
and a query cluster that died in the spring must stop looking alive in the
fall. Sixteen months is kept for totals and history; every decision uses the
trailing 90 days.

**Why the 28-day title freeze?**
Search engines re-evaluate a page after a title change and need weeks of
impression data to settle. Iterating inside that window destroys the
measurement, and a stream of title changes reads as manipulation.

**Search Console shows the last three days but the tool doesn't.**
The pipeline requests finalized data only (`dataState: final`), and Google
finalizes each day about three days late. The trailing three days always
fill in on later runs.

**The Trends page says "no traffic recorded yet" for a site.**
That is a connected site with empty data — new, or not yet ranking. It is
shown flat rather than omitted so you can tell "connected and quiet" from
"missing from the pipeline."

**The indexing page lists a "Soft 404" for a page that is fine.**
Check the "last crawled" column. A verdict is only as current as the crawl
behind it; the page flags verdicts older than 90 days as stale. Request
indexing and re-check rather than chasing a template bug.

**A daily step failed. What now?**
Open `/logs` (or `data/daily-ops.log`), then `python3 ops/doctor.py`. A 401
or 403 from Google means the service account lost access or the key file
moved. A run that fails every network step at once was offline; the next run
will recover. Steps are independent — one failing does not stop the others.

**Can I run it for clients?**
Yes; one config per install, or several sites in one config. The license is
MIT.
