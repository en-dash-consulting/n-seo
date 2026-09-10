#!/usr/bin/env python3
"""Pull GA4 data for every configured property into data/ga4/<host>/.

Per site (numeric `ga4Property` in the config), trailing 90 days:
  daily.json    — sessions/users by date
  sources.json  — sessions by sessionSource/sessionMedium (AI-referral detection
                  happens downstream from this file)
  landing.json  — sessions/engagement by landing page
  funnel.json   — only for the `conversions.site`: your key events by date,
                  optionally split by a custom dimension (e.g. which app or
                  page the signup came from)

Auth: analytics.readonly scope via ingest/google_auth.py. Stdlib + curl.
"""

import json
import sys
from datetime import date

import google_auth
import seo_config
from http_util import post_json

API = "https://analyticsdata.googleapis.com/v1beta"
RANGE = [{"startDate": "90daysAgo", "endDate": "yesterday"}]


def reports(conversions, host):
    base = {
        "daily": {
            "dateRanges": RANGE,
            "dimensions": [{"name": "date"}],
            "metrics": [{"name": "sessions"}, {"name": "totalUsers"}],
            "limit": 100,
        },
        "sources": {
            "dateRanges": RANGE,
            "dimensions": [{"name": "sessionSource"}, {"name": "sessionMedium"}],
            "metrics": [{"name": "sessions"}, {"name": "totalUsers"}],
            "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
            "limit": 200,
        },
        "landing": {
            "dateRanges": RANGE,
            "dimensions": [{"name": "landingPage"}],
            "metrics": [{"name": "sessions"}, {"name": "engagementRate"}],
            "orderBys": [{"metric": {"metricName": "sessions"}, "desc": True}],
            "limit": 100,
        },
    }
    if conversions and conversions.get("site") == host and conversions.get("events"):
        dims = [{"name": "date"}, {"name": "eventName"}]
        if conversions.get("sourceDimension"):
            dims.append({"name": conversions["sourceDimension"]})
        base["funnel"] = {
            "dateRanges": RANGE,
            "dimensions": dims,
            "metrics": [{"name": "eventCount"}],
            "dimensionFilter": {"filter": {"fieldName": "eventName", "inListFilter": {
                "values": list(conversions["events"])}}},
            "limit": 5000,
        }
    return base


def run_report(token, prop, body):
    return post_json(f"{API}/properties/{prop}:runReport", body, token, label=f"ga4 {prop}")


def main():
    props = seo_config.ga4_properties()
    if not props:
        print("no site has a ga4Property configured — nothing to pull")
        return 0
    conversions = seo_config.load()["conversions"]
    token = google_auth.access_token(google_auth.ANALYTICS_RO)
    out_root = seo_config.DATA / "ga4"

    had_error = False
    for host, prop in props.items():
        site_dir = out_root / host
        site_dir.mkdir(parents=True, exist_ok=True)
        for name, body in reports(conversions, host).items():
            resp = run_report(token, prop, body)
            # A custom dimension only works once registered in GA4 Admin
            # (Custom definitions). Fall back to date+event until then.
            if name == "funnel" and resp.get("error") and len(body["dimensions"]) == 3:
                fallback = dict(body, dimensions=body["dimensions"][:2])
                resp = run_report(token, prop, fallback)
            if resp.get("error"):
                # Keep the previous report rather than replacing it with an
                # empty one; the step fails and the run reports it.
                print(f"{host:28s} {name:8s} ERROR (kept previous): "
                      f"{resp['error'].get('message', '')[:60]}")
                had_error = True
                continue
            (site_dir / f"{name}.json").write_text(json.dumps(
                {"site": host, "property": f"properties/{prop}",
                 "pulled": date.today().isoformat(), **resp}), encoding="utf-8")
            print(f"{host:28s} {name:8s} {resp.get('rowCount', 0)} rows")

    print(f"\nSaved under {out_root}")
    return 1 if had_error else 0


if __name__ == "__main__":
    sys.exit(main())
