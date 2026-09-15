# Profiles — a method you can install

n-seo ships with an opinionated model: a 28-day freeze after any metadata
change, roughly eight of those a week, striking distance meaning positions
5–15, decisions on the trailing 90 days. Those numbers are a position, not a
law, and if you do this for a living yours are probably different.

A **profile** is that position, packaged. One config key, and every threshold
and policy the engine uses comes from your profile instead of ours.

```jsonc
{
  "profile": "patient",
  "sites": [ ... ]
}
```

## The three layers

```
engine defaults          what n-seo believes, in src/config.ts
   ↓  overridden by
the profile              what you or your agency believes
   ↓  overridden by
this instance            what this one client needs
```

The instance always wins. That matters more than it sounds: a client running
their agency's profile can always see, and change, exactly where their setup
departs from it. `n-seo profile` prints that list, and the Settings page shows
it beside the profile's name.

```
$ n-seo profile
profile   Patient 1.0.0
spec      patient
from      /opt/n-seo/profiles/patient

this instance overrides 2 value(s):

  operatingRules.titleFreezeDays  56 → 30
  rules.strikingDistance.maxRows  6 → 9
```

## What a profile can set

`n-seo.profile.json`, at the root of a directory or a package:

```jsonc
{
  "name": "Acme Search",
  "description": "How we run search for retail clients.",
  "version": "1.2.0",

  // The policy a human follows.
  "operatingRules": {
    "titleFreezeDays": 28,          // hands off a page's metadata this long
    "metadataChangesPerWeek": 8,    // batch size across the portfolio
    "decisionWindowDays": 90,       // decisions ride this window
    "historyMonths": 16             // the long view, for totals only
  },

  // The numbers the action engine ranks by.
  "rules": {
    "effortWeight":      { "S": 1, "M": 2.5, "L": 5 },
    "strikingDistance":  { "minPosition": 5, "maxPosition": 15, "minImpressions": 10,
                           "maxRows": 12, "impactPerImpression": 0.06 },
    "ctrGap":            { "minImpressions": 30, "belowExpectedRatio": 0.5 },
    "engagement":        { "minSessions": 30, "maxEngagement": 0.25, "maxCards": 3 },
    "trafficDrop":       { "minPriorSessions": 50, "dropRatio": 0.75 },
    "probe":             { "minVisibleTextBytes": 500 },
    "metadata":          { "maxFindings": 5 }
  },

  // Module defaults. The instance can still switch any of them.
  "modules": {
    "indexNow": { "enabled": true }
  },

  // The parts of a method that are not a number.
  "principles": [
    {
      "kind": "hard",
      "title": "Never write to a CMS without per-item approval",
      "body": "Show the exact before and after, get a yes on each one, then write."
    },
    { "title": "Judge by the path to a signup, not by clicks", "body": "..." }
  ]
}
```

### Principles

The most useful thing we learned building the first real profile: a
practitioner's method is barely distinguishable from ours in *thresholds* and
almost entirely distinguishable in *judgement*. The striking-distance floor
turned out never to bind once rows are sorted by impressions. What actually
differed was what to optimise for, what needs a human's approval, and what to
never automate.

None of that is a number, so `principles` carries it. Each has a `title`, a
`body`, and a `kind`:

- **`hard`** — a constraint. An agent must not cross it.
- **`guide`** — judgement it should apply.

They appear at the top of the action queue, on the Settings page, and — this
is the part that matters — `n-seo init` writes them into the instance's
`CLAUDE.md`. A principle the agent never reads is not an operating rule, it is
a note to yourself.

Set only what you disagree with. Anything absent is inherited, so a profile
that changes one threshold is three lines long.

## Shipped with the engine

| spec | what it is for |
|---|---|
| `default` | The engine's own model, written out so you can read what a profile controls. |
| `patient` | Low traffic, long sales cycle, or an owner who would rather ship three good changes a month than thirty. Longer freeze, smaller batches, a higher bar before anything is called a problem. |
| `aggressive` | A large site with traffic to spare, where missing an opportunity costs more than a wasted afternoon. Wider band, lower floors, longer queue. Keeps the 28-day freeze — that one is not a preference. |

`n-seo profile` lists them.

## Writing your own

A profile is a directory with an `n-seo.profile.json` in it. Three ways to
point at one:

```jsonc
"profile": "patient"                  // shipped with the engine
"profile": "./profiles/acme"          // a path, relative to the instance
"profile": "n-seo-profile-acme"       // an installed package
```

To publish one, make it a package whose root holds the file:

```
n-seo-profile-acme/
├── package.json
└── n-seo.profile.json
```

Then `npm i n-seo-profile-acme` in the instance and name it in the config.
Versioning the package versions the method, which is the point: "we moved you
to Acme Search 2.0" is a sentence a client can check.

## Priorities — the declarative half of custom rules

A threshold says *what counts as a finding*. A priority says *what you care
about*. They are different questions, and the second one is where a method
usually lives.

```jsonc
"rules": {
  "priorities": [
    {
      "why": "leads somewhere: a signup, a tool, an account",
      "when": { "pathMatches": "^/(tools|pricing|signup)" },
      "multiply": 1.5
    },
    {
      "why": "we have decided not to work on these",
      "when": { "pathMatches": "^/legal/" },
      "drop": true
    }
  ]
}
```

`when` matches on `host`, `pathMatches` (a regular expression against the
page's path), `tag`, and `kind`. A priority with no conditions matches
nothing — applying to the whole queue is never what anyone means, and is a
miserable way to learn the shape of the config.

`multiply` scales the impact that orders the queue. `drop` removes the card.
Several priorities compound, in the order they are written.

### Two rules the design will not bend on

**A priority may reorder or hide, never invent.** It cannot create a card, so
it cannot manufacture evidence. Everything in the queue still came from data.

**Every card it touches says so.** The impact number decides the order, so a
card whose number was adjusted carries the reason on its face and a
*reweighted* chip. `why` is required; a priority without one is ignored.
Ordering you cannot see the reason for is ordering you cannot argue with, and
the whole product rests on showing its working.

### Why this is not a plugin API

The obvious version of "custom rules" is letting a profile ship code. We are
not doing that, and the reason is not squeamishness about JavaScript:
installing someone's method would mean running their program on the machine
that holds your Search Console credentials and your service-account key. That
is a large amount of trust to ask for a list of thresholds.

Matching and weighting turned out to cover what people actually want to
express. A genuinely new *kind* of card — one that reads data no existing rule
reads — is still a fork, and `docs/PRD.md` carries that as an open question
rather than a decided one.

## When a profile cannot be found

The run fails, loudly, naming every location that was tried. It does **not**
fall back to the engine defaults. Someone running a client's portfolio on
their agency's method should never discover it quietly stopped applying —
a wrong answer you can see beats a plausible one you cannot.

`n-seo doctor` reports the same thing before the daily run gets there.

## What a profile cannot do

It cannot ship executable code. A profile is data: thresholds, policy numbers
and module defaults. Installing someone's method should not mean running
their code on the machine that holds your Search Console credentials.

Custom *rules* — new kinds of card, not new numbers for existing ones — are a
real gap, and the honest answer today is to fork the engine. `docs/PRD.md`
carries the open question.
