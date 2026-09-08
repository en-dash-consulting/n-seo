#!/usr/bin/env python3
"""Per-page daily time series for the Trends view.

GSC: date x page, trailing 180 days, per property -> data/timeseries/gsc-<slug>.json
GA4: date x pagePath, trailing 180 days, per site  -> data/timeseries/ga4-<host>.json

Runs in the daily batch. Stdlib + curl.
"""

import json
import sys
from datetime import date, timedelta
from urllib.parse import quote

import google_auth
import seo_config
from http_util import post_json

OUT = seo_config.DATA / "timeseries"

# Both APIs cap a single response; page until a batch comes back short.
PAGE = 25000


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    had_error = False
    end = (date.today() - timedelta(days=3)).isoformat()
    start = (date.today() - timedelta(days=183)).isoformat()

    gsc_props = seo_config.gsc_properties()
    if gsc_props:
        tok = google_auth.access_token(google_auth.WEBMASTERS_RO)
        for site, slug in gsc_props.items():
            url = (f"https://searchconsole.googleapis.com/webmasters/v3/sites/"
                   f"{quote(site, safe='')}/searchAnalytics/query")
            rows, start_row, failed = [], 0, False
            while True:
                r = post_json(url, {
                    "startDate": start, "endDate": end,
                    "dimensions": ["date", "page"],
                    "rowLimit": PAGE, "startRow": start_row, "dataState": "final"},
                    tok, label=f"timeseries {slug}")
                if "error" in r:
                    # Keep the previous series rather than replacing a full
                    # one with a partial or empty write.
                    print(f"gsc  {slug:28s} ERROR (kept previous): "
                          f"{r['error'].get('message', '')[:70]}")
                    had_error = failed = True
                    break
                batch = r.get("rows", [])
                rows.extend(batch)
                if len(batch) < PAGE:
                    break
                start_row += PAGE
            if failed:
                continue
            (OUT / f"gsc-{slug}.json").write_text(json.dumps(
                {"site": site, "startDate": start, "endDate": end, "rows": rows}))
            print(f"gsc  {slug:28s} {len(rows)} date x page rows")

    ga4_props = seo_config.ga4_properties()
    if ga4_props:
        tok = google_auth.access_token(google_auth.ANALYTICS_RO)
        for host, prop in ga4_props.items():
            # 180 days x a few hundred pages passes 25,000 rows on a modest
            # site, and GA4 truncates silently — page until the batch is short.
            rows, offset, failed = [], 0, False
            while True:
                r = post_json(f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport", {
                    "dateRanges": [{"startDate": "180daysAgo", "endDate": "yesterday"}],
                    "dimensions": [{"name": "date"}, {"name": "pagePath"}],
                    "metrics": [{"name": "sessions"}],
                    "limit": PAGE, "offset": offset}, tok, label=f"ga4 timeseries {host}")
                if r.get("error"):
                    print(f"ga4  {host:28s} ERROR (kept previous): "
                          f"{r['error'].get('message', '')[:60]}")
                    had_error = failed = True
                    break
                batch = r.get("rows", [])
                rows.extend({"date": row["dimensionValues"][0]["value"],
                             "page": row["dimensionValues"][1]["value"],
                             "sessions": float(row["metricValues"][0]["value"])}
                            for row in batch)
                if len(batch) < PAGE:
                    break
                offset += PAGE
            if failed:
                continue
            (OUT / f"ga4-{host}.json").write_text(json.dumps({"site": host, "rows": rows}))
            print(f"ga4  {host:28s} {len(rows)} date x page rows")

    if not gsc_props and not ga4_props:
        print("no GSC or GA4 properties configured — nothing to pull")
    return 1 if had_error else 0


if __name__ == "__main__":
    sys.exit(main())
