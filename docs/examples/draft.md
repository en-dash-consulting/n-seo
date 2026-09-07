---
title: "Dev.to: how we cut our docs site's JS shell to zero and doubled AI referrals"
order: 1
action: "Voice pass, then post on dev.to with the canonical URL set to the original on docs.example.com"
channel: dev.to
status: ready to post
tags: distribution, geo
notes: >
  Cross-post, not a new article: set the canonical to the original so the
  ranking stays with your domain. Post mid-week morning in your audience's
  timezone. Reply to the first few comments the same day.
---

# How we cut our docs site's JS shell to zero and doubled AI referrals

Six months ago every page on docs.example.com served about 400 bytes of
visible text and a 1.2 MB bundle. Google coped. Nothing else did: Bing indexed
eleven pages, and referrals from ChatGPT and Perplexity were a rounding error.

Here is what we changed, in the order it mattered, with the numbers.

## 1. Server-render the content, keep the app

…

## 2. Let the crawlers in

…

## 3. Add llms.txt and llms-full.txt

…

## What moved

| | Before | After 90 days |
|---|---|---|
| Pages indexed by Bing | 11 | 212 |
| AI-assistant referral sessions / month | 9 | 21 |
| Google clicks / day | 140 | 165 |

The whole change was a week of work. The measuring took longer than the
doing, and that was the point.
