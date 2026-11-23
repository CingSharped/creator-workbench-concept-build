# Splempy YouTube Shorts Review And AI Heuristics

As of 2026-07-19.

## Scope

This note reviews the public and owner-level YouTube Shorts data available for `@Splempy` and turns that review into practical AI metadata heuristics for the local creator workspace.

## Data Sources

- `vidIQ channel stats` for `@Splempy` covering `2026-01-01` to `2026-07-19`
- `vidIQ channel videos` for recent Shorts on `@Splempy`
- `vidIQ channel videos` for top-performing Shorts on `@Splempy`
- `vidIQ channel analytics` for `2026-06-01` to `2026-07-19` broken down by `day`, `creatorContentType`, and `video`

## Executive Summary

The channel is already functioning as a Shorts-first gaming channel, not a mixed-format channel.

The strongest patterns so far are:

- recognizable games or series
- co-op chaos, panic, betrayal, or sudden failure
- titles that describe a specific moment instead of a generic reaction
- short runtimes, usually around `16` to `22` seconds

The weakest patterns so far are:

- vague titles without a clear event
- clips that require too much prior context
- batches where the game or situation is less immediately recognizable

The biggest strategic issue is not upload consistency. The channel is already highly consistent. The bigger issue is `subscriber conversion`. Views are moving, but subscribers are mostly flat.

## Channel Snapshot

As of `2026-07-19`, `@Splempy` was:

- `1,590` subscribers
- `820,913` total views
- `1,667` total uploaded videos

From `2026-01-01` to `2026-07-19`, the channel added:

- `222,413` views
- `413` uploads
- effectively `0` net subscriber growth

This means the channel is already publishing at a serious pace. The problem is not lack of volume.

## Current Content Pattern

From the recent Shorts feed, the channel is clearly posting in game-specific batches instead of random one-offs.

Recent examples:

- `A Way Out` dominated late June 2026
- `Obey the Voice` dominated `2026-07-01` through `2026-07-06`
- `Crashout Crew` and party-chaos clips dominated from `2026-07-07` onward

That is useful. It means the AI should understand `series context` and not treat each clip as disconnected.

## Shorts-First Confirmation

From owner analytics for `2026-06-01` to `2026-07-19`:

- `shorts`: `44,621` views, `4,154` estimated minutes watched, `398` likes, `14` comments
- `liveStream`: `441` views, `16,448` estimated minutes watched, `45` likes, `1` comment
- `videoOnDemand`: `32` views, `208` estimated minutes watched, `0` likes, `0` comments

Interpretation:

- Shorts are doing almost all of the discovery work.
- Live content may still matter for deeper watch time, but not for current acquisition.
- Long-form is not a meaningful traffic source right now.

## What Has Been Working

### Strong recent Shorts

From owner analytics and recent upload data, the stronger recent Shorts included:

- `I can make it if I get to the button, before she gets to me` - `1,888` views
- `They won't stop breaking my milk` - `1,721` views
- `He is so stealthy` - `1,620` views
- `You can see every year on my forehead` - `1,494` views
- `He's so locked in, he's so ready` - `1,473` views
- `They won't be able to identify him by his face or D` - `1,448` views
- `The best attachment in the game, by far` - `1,160` views

### Stronger long-run Shorts

The public top Shorts list shows larger winners across the broader channel history:

- `Hold on or don't` - `17,465` views
- several `Little Nightmares` Shorts in the `4,000` to `5,000` range
- `It Takes Two` Shorts up to `3,913`
- multiple `Dark Souls`, `Elden Ring`, and `Halo` Shorts in the `1,500` to `3,000` range

### Common success traits

The better-performing titles usually do at least one of these well:

- describe a very specific event
- imply imminent failure or panic
- capture social chaos between players
- create immediate curiosity without becoming vague
- tie into a recognizable game or known content lane

Examples of stronger title shapes:

- `I can make it if I get to the button, before she gets to me`
- `They won't stop breaking my milk`
- `You can see every year on my forehead`
- `The best attachment in the game, by far`

These are not polished marketing headlines. They are `specific moment hooks`.

### Common public hashtag patterns

From the recent and top Shorts data, the recurring public hashtags visible in titles fall into three practical buckets:

- `game or series identity`
- `tone or outcome`
- `format or lane`

Common examples visible in the reviewed data:

- game or series identity:
  - `#awayout`
  - `#obeythevoice`
  - `#crashoutcrew`
  - `#littlenightmares`
  - `#ittakestwo`
  - `#eldenring`
  - `#eldenringcoop`
  - `#darksouls3`
  - `#darksouls`
  - `#ds3`
  - `#soulsborne`
  - `#halo`
  - `#halomcc`
  - `#halopc`

- tone or outcome:
  - `#funny`
  - `#fail`
  - `#gamingfail`
  - `#scary`
  - `#sus`
  - `#lootgoblin`

- format or lane:
  - `#shorts`
  - `#horrorgaming`
  - `#partygames`

Interpretation:

- your visible hashtag habit is already fairly consistent
- you often combine `one game tag`, `one tone tag`, and `one general format tag`
- the game-specific tags are doing more identity work than broad generic gaming tags

Important product note:

- this reviewed data clearly shows `public hashtags in titles`
- it does not reliably show the hidden YouTube `video tags` field
- the app should not treat those as the same metadata field

## What Has Been Underperforming

A lot of the recent `Obey the Voice` batch landed in the low hundreds despite solid posting consistency.

Examples:

- `Possibly the most horrific sound I have ever heard` - `91` views
- `Maybe taunting the voice wasn't the best thing to do` - `121` views
- `I saw you move, don't pretend you didn't` - `172` views
- `I caught her red handed, she's definitely cheating` - `75` views

This suggests:

- the game or scenario may be less instantly legible than the co-op chaos clips
- some titles are still more generic than the best-performing titles
- consistency alone does not overcome weaker topical pull

## Main Strategic Finding

The channel already knows how to generate clip volume.

The next improvement should be better `selection` and better `packaging`, not just more output.

The AI should help answer:

- which clips are most likely to work before publishing
- which title angle is strongest for the same clip
- when a title is too generic
- when a game or series reference should be surfaced more clearly

## AI Metadata Heuristics

These are the first heuristics worth encoding into the app.

### 1. Generate multiple title angles, not one title

For each clip, generate at least `3` title variants:

- `specific-fail`
- `panic-or-tension`
- `absurd-or-social-chaos`

This matches the channel's real winning patterns better than a single neutral title.

### 2. Prefer concrete event titles over generic reactions

Good:

- `They won't stop breaking my milk`
- `I can make it if I get to the button, before she gets to me`

Weak:

- `Oh no this is terrible`
- `I may have panicked a little`

Rule:

- Titles should name the situation, object, mechanic, or consequence.
- A reaction phrase on its own should be penalized.

### 3. Bias toward a small set of proven emotional frames

The AI should treat these as preferred hook families:

- chaos
- panic
- betrayal
- clutch
- humiliation
- absurdity
- sudden failure
- near-disaster

These fit the strongest recent and historical performers much better than generic summary language.

### 4. Keep titles punchy even when they are sentence-like

Working titles on this channel are often conversational, but they still need to stay tight.

Recommended title target:

- preferred range: `38` to `62` characters
- acceptable range: up to `75` characters if the hook stays sharp

The current metadata generator target of `45` to `75` characters is serviceable, but it should loosen toward shorter hooks for Shorts.

### 5. Detect when game recognition helps

For well-known or ongoing series, the AI should explicitly consider whether the game should appear in:

- the title
- the first hashtags
- the description opening line

This should be a decision, not a fixed rule. The goal is clarity without making every title look templated.

### 6. Keep the description lightweight, reusable, and block-based

For Shorts, the description is not the main hook.

The AI should generate:

- one short lead line
- one short support line
- optional CTA only if it sounds natural

The AI should not waste tokens on overlong description copy for Shorts-first workflows.

Recommended Shorts description block structure:

1. hook line
2. short context line
3. optional collaborator line when co-op partners are present
4. optional creator link block
5. optional collaborator link block
6. short hashtag line

Example structure:

```text
They would not stop breaking my milk.
Game: Crashout Crew with friends.

Featuring: @PartnerOne and @PartnerTwo

More from me:
YouTube: ...
TikTok: ...
Twitch: ...

Check out the crew:
PartnerOne: ...
PartnerTwo: ...

#crashoutcrew #funny #shorts
```

That is a much better fit for the product than asking the model to invent a brand-new paragraph style every time.

### 7. Keep tags narrow and series-aware

Public hashtags and internal platform tags should favor:

- the game
- the moment type
- the content lane

Examples:

- `#awayout`
- `#obeythevoice`
- `#crashoutcrew`
- `#gamingfail`
- `#funny`

The AI should avoid padding tags with weak generic gaming labels that do not change discoverability.

Recommended metadata separation:

- `public hashtags`
  - what appears in titles or descriptions
- `platform tags`
  - platform-specific keyword/tag metadata such as YouTube video tags
- `internal topic labels`
  - used only for AI memory, retrieval, and filtering inside the app

One generic `tags` field is likely too blunt for where this product is going.

### 8. Penalize vague language

The app should score down drafts that rely on phrases like:

- `this happened`
- `that was crazy`
- `oh no`
- `I panicked`
- `it was bad`

unless the title also contains a clear concrete subject.

### 9. Learn from approved and high-performing clips separately

The feedback loop should store at least three different signals:

- `approved`: you accepted the draft with little or no change
- `edited`: you changed the draft materially before saving
- `performed`: the published Short later crossed a useful threshold

This is important because `approved by you` and `performed on platform` are not the same signal.

### 10. Treat series context as a first-class input

The AI should know:

- current game or series
- whether this is horror, co-op chaos, Souls, shooter, or party-game content
- whether the channel is currently in a posting batch for that series

This should shape title vocabulary and description style.

### 11. Add reusable creator and collaborator profile blocks

Because the channel includes co-op content, the app should support reusable identity blocks instead of hardcoding links into every draft.

The AI should have access to:

- your own profile links by platform
- known collaborator names
- collaborator handles by platform
- whether each collaborator is present in the current clip

That enables description output such as:

- always include your own links when desired
- include collaborator attribution only when relevant
- keep naming and handles consistent across batches

This should be driven by structured app data first and AI text generation second.

## Scoring Rules Worth Adding Next

The first local scoring layer can be rule-based before it becomes more advanced.

Suggested checks:

- `specificity score`: does the title contain concrete nouns and verbs
- `generic reaction penalty`: does it rely on a vague reaction with no clear event
- `series clarity score`: is the game or content lane clear somewhere in the package
- `emotion hook score`: does it align with proven hook families
- `length score`: is the title in the preferred range
- `duplicate score`: does it look too similar to other recent titles in the same batch
- `description structure score`: does the description follow the expected short-form block layout
- `attribution completeness score`: if collaborators are marked present, are they properly attributed

## Retrieval Context Worth Adding

When generating metadata for a new clip, the app should eventually retrieve:

- the last `10` approved titles in the same series
- the top `10` performing titles in the same series
- the top `10` performing titles across the whole channel in the same hook family

This is the simplest local way to make the AI feel more tailored over time.

## Suggested Build Order

1. Add local feedback capture for `approved`, `edited`, and `rejected`.
2. Add multi-variant title generation for each clip.
3. Add a rule-based title scorer using the heuristics above.
4. Add series-aware context fields to the clip metadata workflow.
5. Add retrieval of approved and high-performing examples into the prompt.
6. Add vidIQ-assisted title, description, and tag checks after local generation.
7. Add a clip-level recommendation score before scheduling.

## Product Implication

The next AI upgrade should not be framed as `better prose`.

It should be framed as:

- better clip packaging
- better title selection
- better reuse of winning channel patterns
- better local memory of what this channel responds to

That is much more likely to improve results than simply swapping models or making prompts longer.
