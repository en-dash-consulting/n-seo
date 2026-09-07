# Campaigns

One JSON file per standing outreach play — link and listing targets, message
templates, and a weekly send plan. Each appears on `/content` under
**Campaigns** and gets its own page at `/campaigns/<slug>` with the plan, the
templates, and the ranked target table. The MCP `campaigns` tool returns the
same data.

Sends are yours. The page prepares everything to personalize and go; nothing
here emails anyone.

## Format

```json
{
  "slug": "docs-listing-outreach",
  "name": "Docs listing and backlink outreach",
  "site": "docs.example.com",
  "summary": "one paragraph shown on the campaigns list",
  "voice": "how the messages should sound",
  "targets": [
    { "rank": 1, "name": "…", "category": "awesome-list", "url": "…", "contact": "how to reach them",
      "angle": "the hook", "value": "what you get", "likelihood": "high/medium/low + why",
      "evidence": "why you believe the likelihood", "status": "" }
  ],
  "templates": [ { "id": "A", "audience": "…", "subject": "…", "body": "…" } ],
  "plan": [ { "day": "Mon", "action": "…", "template": "A", "notes": "…" } ],
  "week2": "what happens after the first week",
  "later": "long plays",
  "cautions": [ "one follow-up maximum", "always disclose" ]
}
```

`status` on a target is free text — set it when you send ("sent 2026-08-14",
"merged", "declined") so the table shows what is in flight. The `slug` should
match the filename.

A complete example: [`docs/examples/campaign.json`](../../docs/examples/campaign.json).
