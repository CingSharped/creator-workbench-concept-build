# ADR-0002: External Creator Learning Should Use Public Signals Plus Manual Notes

- Status: `Accepted`
- Date: `2026-07-29`

> Partially superseded by [ADR-0007](ADR-0007-full-public-trends-removal.md): public YouTube trends are removed from the active product. Historical public-signal proposals below do not authorize their restoration. Future external research requires a separate decision.

## Accepted Selection

- `Option B: Public signals plus manual notes and curated packs`

## Context

The user wants the app to improve not only from their own content, but also from other creators.

This is appealing because outside creators can provide:

- packaging patterns
- trend alignment examples
- series and lane framing ideas
- title and description structures that already proved themselves publicly

However, outside-creator learning is constrained by both technical access and YouTube policy.

## What We Can Actually Pull Reliably

### Owned creator data

High feasibility and high value:

- channel uploads via `channels.list` plus uploads playlist discovery
- video metadata via `videos.list`
- owned analytics via `reports.query`
- owned historical channel inventory via playlist traversal
- owned comments via `commentThreads.list`

Official references:

- [Channels implementation guide](https://developers.google.com/youtube/v3/guides/implementation/channels)
- [Videos: list](https://developers.google.com/youtube/v3/docs/videos/list)
- [Reports: query](https://developers.google.com/youtube/analytics/reference/reports/query)
- [Comments implementation guide](https://developers.google.com/youtube/v3/guides/implementation/comments?hl=en)

### Public outside-creator data

Reasonably feasible:

- public search results and public video discovery
- public video title, description, tags, thumbnails, publish date, duration, and visible statistics
- public channel metadata
- public comments
- most-popular regional gaming lists

Official references:

- [Search: list](https://developers.google.com/youtube/v3/docs/search/list)
- [Videos: list](https://developers.google.com/youtube/v3/docs/videos/list)
- [Implementation: videos](https://developers.google.com/youtube/v3/guides/implementation/videos)
- [Implementation: comments](https://developers.google.com/youtube/v3/guides/implementation/comments?hl=en)

### Public outside-creator data we should not assume we can ingest automatically

Low feasibility or poor fit:

- arbitrary outside-creator YouTube Analytics
- arbitrary outside-creator Reporting API reach data
- automatic download of outside-creator caption text

Caption constraint:

- `captions.list` only lists tracks for an authorized video and does not include caption text
- `captions.download` is designed for managed videos, not as a general public transcript ingestion path

Official references:

- [Captions: list](https://developers.google.com/youtube/v3/docs/captions/list)
- [Implementation: captions](https://developers.google.com/youtube/v3/guides/implementation/captions?hl=en)

## Policy Constraints

We should design this feature as if policy clarity matters from day one.

Important policy themes:

- non-authorized public API data has stricter storage expectations than creator-authorized data
- additional derived-metric and storage allowances now exist only for audited developers with explicitly approved analytics use cases
- YouTube data must stay clearly distinguishable from non-YouTube enrichment

Official references:

- [YouTube Developer Policies guide](https://developers.google.com/youtube/terms/developer-policies-guide)
- [YouTube API Services Developer Policies](https://developers.google.com/youtube/terms/developer-policies?authuser=2&hl=en)
- [Terms revision history](https://developers.google.com/youtube/terms/revision-history)

## Decision To Make

How deep should outside-creator learning go in the first serious version?

## Options Considered

### Option A: Public signals only

Definition:

- learn from public titles, descriptions, tags, thumbnails, publish timing, visible stats, and trend appearances

Pros:

- cleanest compliance story
- easy to automate
- lower maintenance burden

Cons:

- limited semantic depth
- weaker insight into why a creator's packaging worked

### Option B: Public signals plus manual notes and curated packs

Definition:

- use public API data
- let the user attach manual notes, lane labels, transcript excerpts, or their own summaries for outside creators

Pros:

- much more useful than raw public metadata alone
- stays local and creator-controlled
- fits the "cookbook" idea well

Cons:

- requires deliberate curation effort
- quality depends on user discipline

### Option C: Deep automated outside ingestion

Definition:

- try to automatically ingest captions, comments, and richer outside-creator context at scale

Pros:

- highest theoretical data volume

Cons:

- brittle
- much weaker policy position
- not well supported by official access for arbitrary outside creators
- easy to build the wrong dependency into the product

## Recommendation

Choose `Option B: Public signals plus manual notes and curated packs`.

That means:

- automate what the official APIs can safely provide
- let the user enrich important outside examples with local notes
- treat curated outside examples as reference packs, not as silently trusted training data

## Proposed Product Boundary

For v1 of external learning:

- allow public video discovery and metadata harvesting for selected examples
- allow creator-defined "pattern packs" for other creators
- allow local notes such as:
  - why this title works
  - what audience lane it targets
  - what kind of hook it uses
  - whether it should influence titles, descriptions, tags, or trend research

Do not assume:

- automatic access to outside creator analytics
- automatic access to outside caption text
- a policy-safe path to mass-ingest third-party creator corpora

## Consequences

If accepted:

- outside-creator learning becomes a curated product feature, not a scraping project
- the app can benefit from other creators without depending on fragile ingestion
- AI profiles can use public packs plus manual notes as one evidence source among many

If rejected in favor of deep automated ingestion:

- the team will need a much more explicit policy and compliance plan before implementation

## Follow-Up Questions

- Should curated outside-creator packs expire or require refresh after a set age?
- Should we separate "public API data" from "manual notes" visually in the UI?
- Should outside-creator packs be reusable across multiple AI profiles or attached to a single one?
