# Search and answer-engine growth playbook

How to grow organic traffic across one or more sites with this tool: **SEO**
(classic search), **AEO** (answer engines — featured snippets, People Also
Ask, AI Overviews) and **GEO** (generative engines — ChatGPT, Claude,
Perplexity citing or recommending your pages). No paid ads assumed.

## The operating loop: four planes

1. **Awareness (data in).** Pull Search Console and GA4 on a schedule; probe
   the live sites. Snapshot everything — rankings and AI-crawler behavior only
   make sense as trends. This is `ops/daily.py`.
2. **Analysis.** Turn the snapshots into questions with answers: which
   queries earn impressions but not clicks (title/description problem)? Which
   pages rank 5–15 (small changes move them to page one)? Which sitemap URLs
   has Google never fetched? Are AI crawlers allowed in? This is the action
   engine, the metadata audit, the indexing sweep, and the trend analysis.
3. **Action.** Ship the change in the site's own repo: a rewritten title, an
   answer-formatted section, structured data, internal links, an `llms.txt`.
   Ping IndexNow, resubmit the sitemap, request indexing where it matters.
4. **Measurement.** The next day's pull scores the last change. Every
   metadata change is dated so movement can be attributed, and stays in view
   as *watching* until the data speaks.

The dashboard is the awareness plane; you (optionally with an AI agent reading
the MCP server) are analysis and action.

## What actually moves each discipline

### SEO — Google and Bing organic

- **Crawlability first.** Correct `robots.txt`, a complete `sitemap.xml` with
  honest `lastmod`, real 404s (unknown paths return 404, not 200), one
  canonical host (https, and one of www/apex), canonical tags. The probe
  checks these daily; regressions are the cheapest thing to fix and the most
  common way SEO dies on a deploy.
- **Server-rendered content.** If the raw HTML is a JavaScript shell, Google
  mostly copes but Bing and every AI crawler see nothing. The probe reports
  visible text bytes on the homepage; under ~500 bytes usually means a shell.
  Static or server rendering is the single highest-leverage technical fix for
  a client-rendered site.
- **Indexed before ranked.** A page can sit in the sitemap for months as
  "Discovered — currently not indexed" and look identical to a page nobody
  searches for (both show zero impressions). The `/indexing` page separates
  the two. Spend manual "Request Indexing" quota on never-crawled pages that
  matter; a resubmitted sitemap and internal links move the rest.
- **Striking distance.** Queries at position 5–15 with real impressions are
  the best return per hour in SEO: add a section that answers the query
  verbatim (H2 phrased as the query, then a 40–60 word direct answer), add
  two or three internal links with the query as anchor text, update the
  modified date.
- **Title and description CTR.** High impressions and low CTR at a good
  position means the snippet is losing the click. Rewrite the title as the
  answer to the query (front-load the query words, stay under ~60
  characters); make the description one ~150-character sentence that
  answers it. Then leave it alone for 28 days.
- **Internal linking.** Most small sites barely link within themselves or to
  their sibling sites. Related-content blocks and footer cross-links pass
  authority from the pages that have it to the ones that need it.
- **Core Web Vitals.** Matters at the margin. Check occasionally; don't
  obsess.

### AEO — featured snippets, People Also Ask, AI Overviews

- **Answer-formatted pages.** A question as an H2, a 40–60 word direct
  answer immediately below it, then elaboration. This is the shape snippets
  and AI Overviews lift.
- **Structured data that fits.** `FAQPage`, `HowTo`, `Article`,
  `SoftwareApplication`, `Dataset` — whichever the page honestly is. The
  probe lists the JSON-LD types on each homepage.
- **Tables, ordered lists, definitions.** These get extracted far more often
  than prose walls. A comparison table between the hero and the body of a
  "X vs Y" page is a snippet magnet.

### GEO — being cited by ChatGPT, Claude, Perplexity

- **Let AI crawlers in.** `robots.txt` must not block GPTBot, ClaudeBot,
  Claude-Web, PerplexityBot, Google-Extended, CCBot, Bytespider,
  OAI-SearchBot — the probe flags any that are. Blocked crawlers cannot cite
  you.
- **`llms.txt` and `llms-full.txt`.** A markdown summary of the site with
  links to the pages that matter (and, in the full version, the content
  itself). Regenerate on every publish. The probe checks both exist.
- **Be the canonical explainer for a niche.** Language models cite pages
  that define or explain a thing plainly, with concrete numbers, code and
  steps. Generic content does not get cited; firsthand specifics do.
- **Freshness.** Generative engines over-select recently updated pages. Real
  content changes that move the modified date compound.
- **Measure it.** GA4 referral sessions from chatgpt.com, perplexity.ai,
  claude.ai, copilot.microsoft.com, gemini.google.com — the dashboard shows
  them per site and per month. This is the GEO scoreboard.

## Data plane

| Source | API | Auth | Gives you |
|---|---|---|---|
| Search Console | `searchconsole.googleapis.com` | service account (Full user on the property) | queries, impressions, CTR, position; sitemap state; per-URL index coverage |
| GA4 | Analytics Data API | service account (Viewer on the property) | sessions, sources (incl. AI referrals), landing-page engagement, conversion events |
| Live sites | plain HTTP | none | robots / sitemap / llms.txt / meta / SSR-ness / 404 behavior, daily |
| IndexNow | `api.indexnow.org` | a key you host at `/{key}.txt` | instant Bing/Copilot/Yandex pings on publish (optional module) |
| Hacker News, Reddit | public APIs | HN: none; Reddit: a free script app | threads where your expertise applies (optional modules; briefings only) |

## Content loops that work

- **Query gap → answer page.** The trend analysis surfaces rising queries no
  page targets. Draft an answer-formatted page in the site repo, review,
  ship, ping, watch.
- **Publish hook.** When a page ships: regenerate sitemap and `llms.txt`,
  add internal links from related pages, ping IndexNow, request indexing if
  it is a page that matters.
- **Regression sentinel.** The daily probe alerts when robots, sitemap,
  canonical, `llms.txt` or server-rendered content silently breaks. Deploys
  are where SEO dies; this is the smoke alarm.
- **Weekly review.** Read the *watching* list against the daily log. Items
  whose 28 days are up either graduate (data moved: note it, retire it) or
  become a new action (data didn't: what else could explain it?).

## What this tool will not do

It does not edit your sites, post to communities, send outreach, or promote
its own proposals into your queue. Those are the steps where judgment and
authenticity live, and they stay with you.
