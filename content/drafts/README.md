# Drafts

Markdown files in this directory appear on the dashboard's `/content` page
under **Publish**, each with its own page at `/drafts/<filename-without-.md>`
(the full text with a copy button). They are hand-curated launch and
distribution assets — blog cross-posts, awesome-list PR text, newsletter
issues, forum posts you intend to write yourself — kept in version control so
the dashboard can show what is ready and in what order.

A draft leaves by being deleted or by flipping its `status`.

## Format

Front-matter, then the body:

```markdown
---
title: "Dev.to: how we cut our docs site's JS shell to zero"
order: 1
action: "Voice pass, then post with canonical set to the original"
channel: dev.to
status: ready to post
tags: distribution, geo
notes: >
  Longer guidance, folded across lines.
---

The full text, ready to paste.
```

| Field | Purpose |
|---|---|
| `title` | Shown on the row and the page |
| `order` | Publish sequence; the list is sorted by it |
| `action` | One imperative line: exactly what to do with this draft |
| `channel` | Where it goes (dev.to, GitHub, LinkedIn, newsletter, …) — becomes a chip |
| `status` | Free text. Anything starting with `ready` shows green; anything containing `approval` lands under **Approve** on the Today board |
| `tags` | Free text chip |
| `notes` | Context for the person posting |

A complete example: [`docs/examples/draft.md`](../../docs/examples/draft.md).

## The rule

Drafts are for channels where you publish under your own name and the text
is yours. They are not a place to stage community comments: the tool does
not generate participation text, and neither should you paste it here.
