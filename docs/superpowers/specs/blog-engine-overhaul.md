# Blog writing engine overhaul — editorial reading surface, autopilot, and a grounded pre-publish desk

**Status:** built autonomously 2026-08-30. Kick-off: *"I want you to autonomously
overhaul the blog writing engine… font family… autopilot content… writing
assistant… up-market magazine editorial… comments… admin stats… integrated
wysiwyg and drag/drop media… propose AN ADDITIONAL 5 significant design system
improvements… and additional 5 quality of life improvements for the author. do
this entirely autonomously."*

Grade: **Full autonomy** — no questions asked, every fork recorded in the
Decision Log below.

## What was already there

This is the part that shapes the whole design. The blog engine is not a green
field — three of the seven asks are already half-built, and the right move is to
finish and surface them rather than invent alongside them.

| Ask | Already exists | What is actually missing |
|---|---|---|
| 1. Font family picker | `FontFamily`/`FontSize` from `@tiptap/extension-text-style`, wired to a toolbar select in `RichEditor.svelte`; the sanitizer admits `font-family` **only** where it matches `var(--font-…)` | The Selawik/Segoe stack jkai uses is not a site token, so it cannot be offered; and there is no default |
| 2. Autopilot | The assistant produces anchored `Proposal`s, applies them, and snapshots the previous value into `blog_post_revisions` | Whole-document passes, a voice-locked rewrite mode, and a way to run one without a chat turn |
| 3. Writing assistant | `/assistant/auto-review` exists and returns ≤2 proposals | Nothing schedules it, nothing grounds it against external sources, and no finding survives a page reload |
| 4. Magazine editorial | — | The reading column is `max-w-2xl` (42rem) with one drop cap |
| 5. Comments | — | Nothing. No table, no route, no moderation |
| 6. Admin article stats | Four Umami round-trips per editor page load, rendered by **nothing** since `BlogStatsCard` was retired | Dwell time, referrers, a surface to read them on |
| 7. WYSIWYG + drag/drop | Paste and drop of images already work, including a capture-phase native fallback for screenshot pastes | Media reuse, resize/alignment, video, and everything that is not a bare image |

The single most valuable observation: **the editor is good and the reader
surface is thin.** Effort is weighted accordingly.

## Decision Log

Every entry is a fork that would otherwise have been a question.

### D1 — The font picker's default

*Options:* (a) redefine `--font-body` for `/blog` the way jkai does; (b) add a
new `--font-read` token offering the Selawik stack as one option among the
existing five; (c) hard-code the Segoe stack into the picker.

*Chosen:* **(b)**, with the reading surface defaulting to it.

*Why:* (c) is the one thing the sanitizer was explicitly built to prevent — the
`font-family` allow-list exists so the picker "cannot become an arbitrary-font
hole". (a) would silently restyle all thirteen existing posts. A new token is
additive: it extends the allow-list by one well-known value, keeps every
existing post rendering exactly as it does today, and lets the author opt a post
into the reading face. Selawik is already self-hosted in `app.css` under
OFL-1.1, so there is no new font payload and no licensing question.

*Reversible:* yes — deleting the token and its allow-list entry restores today's
behaviour, and posts that used it fall back to `--font-body`.

### D2 — Comments: build or embed

*Options:* (a) a third-party widget (Disqus/Giscus); (b) first-party table +
moderated queue; (c) reactions only, no free text.

*Chosen:* **(b)**, held for moderation by default.

*Why:* John's standing preference is free-tier and self-owned, and this site
already refuses to hand reader data to vendors — `sr-docs` names zero vendors on
purpose. A third-party widget also cannot be styled into the editorial system.
Held-by-default is the only responsible setting for an anonymous public POST on
a site with no captcha: nothing a stranger types is ever visible until John
admits it, so the worst case of a spam flood is a full moderation queue rather
than a defaced article.

*Reversible:* yes — the surface is one component and one API route; the table
can be dropped.

### D3 — Dwell time: Umami or first-party

*Options:* (a) read it from Umami; (b) record it first-party.

*Chosen:* **(b)** for dwell and scroll depth, **(a)** for pageviews/referrers
where Umami already answers.

*Why:* Umami's shipped API answers visits, visitors and referrers well, and
time-on-page only as a site-wide average — not per-article, and not honestly for
a single-page read where there is no second pageview to subtract. Dwell is the
metric John named explicitly, so it has to be measured rather than approximated.
A first-party beacon on `visibilitychange`/`pagehide` is ~40 lines and gives
per-article dwell, scroll depth and completion rate that Umami structurally
cannot.

*Reversible:* yes — the beacon is one component; the table is additive.

### D4 — Where the writing assistant's findings live

*Options:* (a) in `blog_assistant_messages` as more `proposal` rows; (b) a new
durable checklist table.

*Chosen:* **(b)**.

*Why:* a proposal is a *diff awaiting a decision*; a checklist item is a
*standing concern with a lifecycle* (open → resolved/dismissed, re-raised if the
text changes back). Overloading the messages table means every reload replays
findings that were already dealt with, which is precisely the failure that made
the old assistant noisy. A separate table also lets the pre-publish gate ask one
cheap question — "are there open blocking items?" — without reading a chat log.

*Reversible:* yes, additive table.

### D5 — Grounding searches: agentic or deterministic

*Options:* (a) give the checker a web-search tool and let it decide; (b) extract
claims deterministically, then search each one.

*Chosen:* **(b)** — rules find the claims, the model only judges them.

*Why:* this is the house pattern, stated in the daydreaming engine's memory as
"rules detect, the LLM only phrases", and it is what makes the run cheap,
repeatable and auditable. A model handed a search tool over a 1,400-word post
will search three times and declare the post checked. Deterministic extraction
gives a stable claim list, so the same post produces the same checklist twice,
and a claim that was cleared stays cleared.

*Reversible:* yes.

### D6 — Magazine width vs the design system

The brief explicitly licenses straying ("We can stray a little"). Taken as: the
**tokens do not change** — same palette, same display/mono faces, same radii and
rules — while the *layout grammar* of the reading surface does. New widths are
added as reading-surface variables rather than by editing the global scale, so
nothing outside `/blog` moves. Sitewide mirroring, which CLAUDE.md requires,
applies to the token set; it does not require every page to have one column
width.

### D7 — Autopilot never publishes, and never claims to be John

Autopilot writes into the editor as a proposal the author accepts or rejects; it
does not save silently and it cannot change `status`. Any post it touches is
stamped `authorship = 'assisted'` at minimum. This is not conservatism — the
voice corpus is five posts and 3,198 words, and feeding generated prose back
into it is model collapse in miniature. The `authorship` column exists for
exactly this reason and is load-bearing.

## The additional ten

Five for the reader, five for the author, chosen for value rather than novelty.

### Reader

1. **Reading progress + sticky article bar.** A hairline progress rule and, once
   the headline scrolls away, a compact bar carrying the title and the share
   affordance. The single most-missed thing on long-form.
2. **Section rail with scroll-spy.** Headings become an outline in the left
   margin that tracks the current section; collapses to a dropdown on mobile.
   Long posts become navigable instead of a scroll.
3. **Sidenotes.** Footnote references that render as true margin notes on wide
   screens and inline-expandable notes on narrow ones. This is the single most
   editorial thing on the list and the sanitizer already admits `sup`/`sub` with
   `class` and `id`.
4. **Editorial furniture as real nodes.** Pull quotes, callouts, full-bleed
   figures and captioned galleries with a lightbox — authored in the editor,
   rendered by the sanitizer, not hand-written HTML.
5. **Reader controls, persisted.** Type size, measure width and a sepia/dark
   reading theme, remembered per reader in `localStorage`. Pairs with D1: the
   author picks the face, the reader keeps control of comfort.

### Author

1. **Autosave with a revision timeline.** `blog_post_revisions` already exists
   but only ever records assistant edits. Periodic snapshots plus a timeline
   with diff and one-click restore.
2. **Slash-command insert menu.** `/` in the body opens an insert palette —
   figure, quote, callout, embed, gallery, divider — plus markdown input rules.
   The fastest single win in the editor.
3. **Media library.** Every image already uploaded to the post, reusable by
   click or drag, with alt-text coverage shown as a number.
4. **True split preview.** The right pane renders through `renderContent` at the
   real magazine width, so what the author sees is what publishes — including
   sanitiser stripping, which is invisible today until after save.
5. **Publish-readiness panel.** One gate that answers "can this go out": open
   checklist items, alt-text coverage, meta/OG completeness, link health,
   reading time, voice score. Publishing with open blockers is possible but
   deliberate.

### D8 — Where the two public write endpoints live

*Options:* (a) `/api/blog/comments` + `/api/blog/view`, registered in
`PUBLIC_API_PATHS`; (b) `/blog/[slug]/comments` + `/blog/[slug]/track`.

*Chosen:* **(b)**.

*Why:* `isPublicApiPath` matches **exactly**, so a parameterised API path can
never equal its own literal — `/api/blog/42/comments` would 401 in production
while the CI snapshot still listed the bracketed form as public. `/blog` is
already a `PUBLIC_PATHS` prefix, so both routes are anonymous with no
allow-list edit at all, and `/decks/[slug]/track` is the existing precedent for
exactly this. It also avoids touching `src/lib/auth.ts`, which is a protected
path that would raise the PR's risk tier.

### D9 — Rate limiting a public write

The hook's `RATE_LIMITS` table **cannot** see a public route: that block sits
inside `if (pathname.startsWith('/api/'))` and *after* the session check, so a
public path returns long before it. An entry there would be dead code that
reads like protection. Both routes limit themselves, using `clientIp` and
`hashIp` from `$lib/space-lander/guard` — generic HTTP guards that happen to
have been written first for the leaderboard. `clientIp` is not optional:
behind cloudflared every VPS request appears to come from `127.0.0.1`, so
`getClientAddress()` alone is not an identity. Imported rather than copied,
because the sensitive-data detector already taught this codebase what three
copies of one helper do. They would sit better in `$lib/server/`; moving them
is a separate change.

### D10 — Autopilot rewrites sentences, not documents

*Chosen:* per-sentence rewrites addressed by `[paragraphIdx.sentenceIdx]`.

*Why:* `segmentBody` strips every tag before the model sees anything. A
document-level rewrite generated from that view silently deletes every link,
image, code block and footnote in the post — and the result *reads* correctly,
which is what makes it dangerous. Sentence rewrites reuse the anchor mechanism
that already works, and paragraphs containing links or embedded media are
excluded from the pass entirely. `riskyParagraphs` has a test asserting its
paragraph indices match `segmentBody`'s, because a drift there would protect
the wrong paragraph while looking like it worked.

### D11 — The markdown lane stays legacy

Everything new lands in the rich-text editor. `MarkdownEditor` keeps its
existing behaviour and its one-way "Convert to Rich Text" button. Building a
twin of the slash menu, the media library and the editorial nodes for a format
with a documented exit route is work with no reader on the other end.

### D12 — The media library needs a table

Neither storage backend exposes a listing (`image-store` has `save` and `read`
only), and the filesystem root is a **shared** namespace — decks write to a
`deck-media` bucket through the same helper. A `readdir` gallery would work on
homeserv and either return nothing or show another feature's assets in
production, where Azure Blob is the backend. `blog_media` answers both
identically and is the only place alt text and dimensions can live.

### D13 — The publish gate is advisory

Open blockers are shown next to the Publish button and never disable it. A gate
that refuses gets worked around; one that says what is outstanding gets read.
Only the deterministic checks may raise a blocker — a model's opinion cannot
stop John publishing.

### D14 — Editorial furniture is schema nodes, not raw HTML

Pull quotes, callouts, disclosures and sidenotes are real TipTap nodes.
`insertContent('<aside …>')` against a schema that has never heard of `<aside>`
silently drops the element and keeps its text, so a slash-menu item would
appear to work and insert a bare paragraph. Each node has a round-trip test
asserting it survives **both** the editor and the sanitiser — either one alone
is a green test over a feature that does not work.

### D15 — Reading themes are scoped, not a site-wide dark mode

Sepia and night are set on `<html>` by the reader controls and removed on
unmount. The rest of the site is a single-register cream design whose
components assume it — `::selection`, the grain overlay, and every hard-coded
`rgba(26,16,8,…)` tint were chosen against cream. A global dark mode is a
redesign of the whole site; a reading preference on the one surface people
spend twenty minutes on is the part that pays. Only tokens are redefined, so a
theme cannot drift from the layout it colours.

### D16 — The slash menu is written natively

`@tiptap/suggestion` is not installed, and every `@tiptap/*` package must move
as one unit (a 3.x extension peers on an exact `@tiptap/core`), so adding it
would drag a coordinated bump of all six. The trigger, filtering and
positioning are all reachable from editor state and `coordsAtPos`.

## Defects found and fixed along the way

None of these were in the brief. All were found by reading the code the brief
pointed at, and each one loses the author's work or misreports reality.

| Defect | Consequence |
|---|---|
| `save()` mirrored every field into local state regardless of what the request actually **sent** | Callers suppress fields by passing `undefined`, which `JSON.stringify` omits. After a cover-image upload the page believed the body was saved: `dirty` went false, Save greyed out, and the server still held the previous body. **Silent loss of unsaved prose.** |
| `togglePublish` PUT `{status}` alone | Publishing with unsaved edits published the **previous** body. |
| `publishedAt` was re-stamped on every publish | Re-publishing after an edit rewrote the publication date and moved the post to the top of the index. |
| `coverImageAlt` was never destructured in the PUT handler | The column had existed since 2026-08-19 and was written by nothing, so alt-text coverage was quietly failing. |
| Ctrl+S was handled by two unguarded window listeners | Two PUTs for one keystroke. Both handlers now share exactly one boundary. |
| `<video>` was in `allowedTags` with **no** attribute entry | A published video was sanitised down to an empty `<video></video>`. The tag was allowed; everything that made it a video was not. |
| `img` `srcset`/`sizes` dropped | The `img` allow-list overrode sanitize-html's defaults without them, so every responsive source was silently discarded. |
| The drop handler ignored the drop position | Dropped images landed at the caret, often paragraphs away, and concurrent uploads inserted in completion order. |
| `URL_RE` in the comment spam heuristic (introduced here) was `/g` and used with `.test()` | `lastIndex` persists between `.test()` calls, so the same input answered differently on alternate calls. Caught by a test asserting repeat-call stability. |
| The same regex counted `https://www.x` as **two** links | One ordinary link tripped the two-or-more-links rule. Caught by a test. |
| The drop-cap selector matched the first `<p>` of **every** parent | Each new aside, callout and figure caption would have grown its own 4.25em orange initial. Now scoped to a direct child. |
| The preview route rendered without the `post-prose` class and at a different width | The author was reviewing a document that was not the one that would ship. Preview now renders through the identical path. |

## Implementation map

Filled in from the subsystem map; see the sections below.
