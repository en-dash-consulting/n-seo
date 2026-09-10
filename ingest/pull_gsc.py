#!/usr/bin/env python3
"""Pull Search Console data for every configured property into data/gsc/.

Datasets per property, two windows each:
  queries.json      — by query        (what people search)
  pages.json        — by page         (what lands)
  query_page.json   — by query+page   (striking-distance analysis)
  dates.json        — by date         (trend; full window only)
and *_90d.json twins for the trailing 90 days — the decision window. The
16-month window (Search Console's maximum) is for totals and history.

Properties come from n-seo.config.json (ingest/seo_config.py); a domain
property covers its subdomains, so several sites can share one pull.
Stdlib only; HTTP via curl (see http_util.py).
"""

import json
import sys
from datetime import date, timedelta
from urllib.parse import quote

import google_auth
import seo_config
from http_util import get_json, post_json

API = "https://searchconsole.googleapis.com/webmasters/v3/sites"

DATASETS = {
    "queries": ["query"],
    "pages": ["page"],
    "query_page": ["query", "page"],
    "dates": ["date"],
}


def pull(token, site_url, dimensions, start, end):
    rows, start_row = [], 0
    url = f"{API}/{quote(site_url, safe='')}/searchAnalytics/query"
    while True:
        body = {
            "startDate": start, "endDate": end,
            "dimensions": dimensions,
            "rowLimit": 25000, "startRow": start_row,
            "dataState": "final",
        }
        resp = post_json(url, body, token, label=site_url[:60])
        if "error" in resp:
            return {"error": resp["error"], "rows": rows}
        batch = resp.get("rows", [])
        rows.extend(batch)
        if len(batch) < 25000:
            break
        start_row += 25000
    return {"rows": rows}


def main():
    props = seo_config.gsc_properties()
    if not props:
        print("no site has a gscProperty configured — nothing to pull")
        return 0
    end = (date.today() - timedelta(days=3)).isoformat()      # GSC finalizes ~3 days behind
    start_full = (date.today() - timedelta(days=488)).isoformat()   # ~16 months (GSC max)
    start_recent = (date.today() - timedelta(days=93)).isoformat()  # trailing 90d
    token = google_auth.access_token(google_auth.WEBMASTERS_RO)

    available = {
        e["siteUrl"]
        for e in get_json(API, token, label="sites list").get("siteEntry", [])
        if "siteUrl" in e
    }
    who = google_auth.service_account_email() or "your Google account"

    out_root = seo_config.DATA / "gsc"
    windows = [("", start_full), ("_90d", start_recent)]
    had_error = False
    for site_url, slug in props.items():
        if site_url not in available:
            print(f"{slug}: {site_url} is not accessible — verify the property in "
                  f"Search Console and add {who} as a user; skipping")
            continue
        site_dir = out_root / slug
        site_dir.mkdir(parents=True, exist_ok=True)
        for suffix, start in windows:
            for name, dims in DATASETS.items():
                if suffix and name == "dates":
                    continue  # the daily series is windowable from the full pull
                result = pull(token, site_url, dims, start, end)
                if "error" in result:
                    # Writing zero rows here would read as a traffic collapse
                    # on the dashboard tomorrow. Keep yesterday's snapshot and
                    # let the step fail so daily.py records and notifies it.
                    print(f"{slug:28s} {name}{suffix:5s} ERROR (kept previous): "
                          f"{result['error'].get('message', '?')[:70]}")
                    had_error = True
                    continue
                payload = {
                    "site": site_url, "dimensions": dims,
                    "startDate": start, "endDate": end,
                    "rowCount": len(result["rows"]),
                    "rows": result["rows"],
                }
                (site_dir / f"{name}{suffix}.json").write_text(json.dumps(payload), encoding="utf-8")
                print(f"{slug:28s} {name}{suffix:5s} {len(result['rows'])} rows")

    print(f"\nWindows: {start_full} and {start_recent} -> {end}\nSaved under {out_root}")
    return 1 if had_error else 0


if __name__ == "__main__":
    sys.exit(main())
