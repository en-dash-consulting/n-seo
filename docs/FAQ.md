# FAQ

**What does it cost?**
Nothing. The Search Console and GA4 APIs are free within quotas that ordinary
use never approaches. The optional LLM module runs whatever local command you
give it; if that is a paid CLI, that is your cost, not the tool's.

**Can I install it inside my website's repository?**
No — and `n-seo init` refuses to, so you cannot do it by accident. n-seo is a
standalone project. It writes a config, an action queue, content drafts and a
`data/` tree that the daily run rewrites every morning; inside a site repo all
of that gets committed, and usually deployed. It reads your sites through the
Search Console and GA4 APIs, so it has no reason to sit in their code. Put the
instance anywhere else — `~/my-sites` is fine — and list the sites you own in
its config. One instance can watch as many sites as you like. `--force`
overrides the check if you have a reason.

**Do I have to read all these docs?**
No. `n-seo init` installs seven skills into your instance, so setup and daily
use are a conversation: open the directory in Claude Code (or any agent that
reads `.claude/skills/`) and say "set this up for my sites", "what should I
work on today?", "do the first one". The agent reads the queue over a
read-only MCP server, follows the operating rules in the generated
`CLAUDE.md`, and cannot publish or change a site on its own. The docs are the
reference behind the skills, not a prerequisite.

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
Yes, since 0.2.0, and CI runs the full test suite on Windows on every commit
rather than taking the claim on trust. You need Node 20+ and Python 3.10+;
`curl` ships with Windows 10 and later. There is no `openssl` requirement on
any platform any more — the service-account JWT is signed with node's crypto
module. Schedule the daily run with Task Scheduler, using the task definition
in `ops/templates/n-seo-daily-task.xml` (see [SCHEDULING.md](SCHEDULING.md)).

Two differences worth knowing. Commands in the `hooks` block go to `cmd.exe`
rather than `/bin/sh`, so write them in its syntax or point them at a script.
And use `n-seo daily` (or `npm run daily`) rather than `python3 ops/daily.py`:
Windows installs Python as `python`, and the `python3.exe` it ships is a stub
that opens the Microsoft Store instead of running anything. The CLI finds the
real interpreter for you, and `$PYTHON` overrides it.

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
Check the "last crawled" column first. A verdict is only as current as the
crawl behind it, and the page flags verdicts older than 90 days as stale — a
page rewritten since then is being judged on content Google has not seen. For
a stale verdict, request indexing once and let the recrawl settle it.

For a *fresh* soft 404, requesting indexing is the wrong move: Google already
fetched the page, got a 200, and decided the content was an error or empty.
Asking again re-runs the same judgement and spends the daily quota. Fetch the
URL yourself and pick the real cause — the page renders its content in
JavaScript and the crawler saw an empty shell, or it is genuinely thin, or it
is an error page returning 200 and should return 404 or 410 and leave the
sitemap. Fix that, then request indexing. n-seo's indexing page names the
check to run for each verdict.

**A daily step failed. What now?**
Open `/logs` (or `data/daily-ops.log`), then run `n-seo doctor`. A 401
or 403 from Google means the service account lost access or the key file
moved. A run that fails every network step at once was offline; the next run
will recover. Steps are independent — one failing does not stop the others.

**Can I run it for clients?**
Yes; one config per install, or several sites in one config. The license is
MIT.
