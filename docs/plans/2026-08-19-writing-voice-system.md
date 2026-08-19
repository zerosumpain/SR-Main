# Writing-voice system — implementation plan (2026-08-19)

John's hand-written blog posts become the source of truth for his prose voice, distilled
into a versioned **Voice Card** that steers every automated writing surface: the blog
assistant, jkai chat, the Engine Room / briefings / release notes, sr-docs, and the
Claude Code + builder prompt stacks.

## Findings that shape the design (measured, 2026-08-19)

**The corpus is small and unlabelled.** Prod `blog_posts` holds **13 rows**, 1 published.
Word counts, measured rather than estimated:

| id | slug | words | authorship |
|---|---|---|---|
| 9 | `ai-after-openclaw` | 1,834 | human |
| 13 | `i-built-a-thing` | 1,221 | human (the published one) |
| 12 | `the-great-eastern-railway…` | 1,203 | **generated** |
| 6 | `the-state-of-agentic-coding` | 487 | human |
| 10 | `hello-world` | 434 | **generated** |
| 11 | `reflecting-and-projecting` | 330 | human |
| 8 | `brave-new-world` | 230 | human |
| 3 | `so-here-it-is` | 67 | human, below the prose floor |
| 1, 2, 14, 4, 5 | stubs | 21, 20, 18, 7, 3 | human, below the floor |

**Usable corpus: 5 posts, 4,102 words.** Two posts are machine-written, not one:
`id=12` is textbook model prose (*"Its story is one of ambition, near-collapse, …"*), and
`id=10` is written in JKAI's first person (*"Hi. I'm JKAI… a bloke called John"*) — it is
copy *about* John, not *by* him, and would poison a "write as John" corpus outright.
Both make good negative controls for the phase-3 discriminator.

There was no `authorship` column, so nothing distinguished John's writing from the
model's. Phase 0 adds one.

**The style loop exists and has never run.** `src/lib/blog/assistant/prompt.ts:69`
(`buildStyleCues`) reads `proposal_resolved` history and returns accept/reject counts.
Prod has **37 proposals and 0 resolutions** — so the function has only ever returned its
"no prior decisions yet" fallback. Worse, `apply-proposal/+server.ts:73` writes a
resolution **only on accept**; a rejected suggestion leaves no trace anywhere. The single
strongest available signal — what John *refuses*, and what he replaces it with — is being
discarded at the point of generation. `blog_post_revisions` has 19 rows and captures the
previous value of applied changes only.

**Voice is hardcoded in six places and already disagrees with itself:**
`blog/assistant/prompt.ts:24` + `:34`, `jkai/intel/brief.ts:183`,
`health/narrative-service.ts:62`, `releases/summarise.ts:51`,
`workflowdoctor/classify.ts:522`, `deepdive/ask-questions.ts:67`. A seventh copy lives in
`~/.claude/.../feedback_public_prose_voice.md`, visible only to Claude Code.

**Most prompts must NOT get the voice.** There are 55 `role: 'system'` sites in `src/`;
roughly 40 are extraction, classification and routing. Global injection would degrade them.

**Other corpus volumes:** `orchestrator_chats` role=`user` joined to `jkai_conversations`
— **1,106 turns / 90,712 chars** from `source='web'` (~15,000 words, chat register), plus
2 WhatsApp-sourced turns (excluded: privacy, and the number must never enter code).

## Architecture (decided)

Not fine-tuning — 4,100 words is two orders of magnitude short, costs per iteration, and
the stack is OpenRouter-only. Not naive RAG — semantic retrieval returns *topically*
similar passages when what's wanted is *stylistically* representative ones.

Instead: **a versioned Voice Card, served to opted-in surfaces, enforced by a deterministic
scorer, fed by a corpus that grows.** The repo file is canonical; the admin UI is read-only.

### Corpus and registers

Three registers, three source sets, never mixed:

| Register | Sources | Used by |
|---|---|---|
| `public-prose` | Blog posts where `authorship='human'` **only** | Blog assistant, project pages, landing copy |
| `explanatory` | `public-prose` invariants + hand-written rules | Engine Room, sr-docs, briefings, health narrative |
| `chat` | `orchestrator_chats` role=`user`, `source='web'` | jkai chat, Hermes, Claude Code |
| `terse` | Derived rules only, no exemplars | Release notes, changelogs, alerts, doctor findings |

Exemplars are drawn from blog posts **only**. Chat turns never leak into `public-prose` —
conflating them is how a blog post ends up sounding like a Slack message.

The preference pairs (rejected suggestion → John's replacement) are **not prose** and go
into a separate `preferences.json`, consumed as rules rather than as style to imitate.

### The Voice Card — three layers

**Measured** — computed, so it cannot be hallucinated. Reuses `$lib/blog/readability`
(Flesch RE + FK grade) unchanged, and adds: sentence-length *distribution* (median + p90 —
a mean hides "short sentences with the occasional long one"), paragraph length, contraction
rate, first-person density per 100 words, British-spelling and Americanism counts,
em-dash / semicolon / colon / exclamation rates, sentence-fragment rate, and distinctive
vocabulary by **log-odds against a generic English baseline** (raw frequency just returns
"the, and, of").

**Stated** — the qualitative spec, promoted from `feedback_public_prose_voice.md` into a
first-class repo artefact: headlines carry the wit, body stays low-key and factual, every
line links to value, one quip per passage at most, humour around the numbers and never
inside them, plain English as the default register, no Americanisms, no exclamation marks.

**Shown** — 3–6 verbatim excerpts of 80–150 words, one per file, covering distinct moves:
an opening, a technical explanation, a self-deprecating aside, a close. These do most of
the work; models imitate demonstrated text far better than described rules. **Keep the
imperfections.** The published post opens *"I built a thing and I wanted to share it. In
fact - it's this thing. you're on it, reading this post."* — lowercase, loose, a typo
further down. Sanding that off is precisely what makes prose read as machine-written.

### Storage layout

```
data/voice/
  voice-card.json        measured + stated, per register
  preferences.json       rejected → replaced pairs, as rules
  exemplars/*.md         verbatim excerpts, one per file, with provenance frontmatter
```

Generated by `scripts/build-voice-card.ts`, committed, read at runtime like `data/prompts/`.
Git history, PR review and CI deployment come free, and there is no "prompt edited in prod,
nobody knows why the output changed" failure mode. `/admin/content/voice` renders the card
read-only with a **Regenerate** button that opens a PR.

### Fan-out

One helper — `voiceBlock(register)` from `$lib/voice` — replaces the six hardcoded tone
blocks. **Opt-in per surface**: only human-facing prose subscribes; the ~40 extraction and
classification prompts get nothing.

The other three prompt stacks do not share a filesystem, so `scripts/sync-voice.sh` writes
to all of them from the one source: `~/.hermes-jkai/prompts/voice.md` (chat),
`~/.claude/skills/john-voice/SKILL.md` (Claude Code + builder), and the sr-docs content tree.

### The scorer

`scoreVoice(text, register)` — pure function, no LLM, cheap.

- **Hard fails:** Americanisms, exclamation marks, `-ize` spellings, banned constructions.
- **Soft flags:** readability outside band, median sentence length outside band, first-person
  density too low (models drift impersonal), "It's not just X — it's Y", rule-of-three lists.

Rendered beside the readability readout that already exists at `RichEditor.svelte:612` and
`MarkdownEditor.svelte:451`. In generation loops: generate → score → **one** rewrite pass
quoting the failures → publish or flag. One retry, never a loop — unbounded rewrite loops
are the documented builder-thrash failure.

**Style rules are bands, not targets.** A model told "he uses fragments" writes nothing but
fragments, at five times his real rate.

## The stop-gate

Before any fan-out: `scoreVoice` must separate `i-built-a-thing` (id 13, John) from
**both** machine-written controls — `the-great-eastern-railway…` (id 12, generic model
prose) and `hello-world` (id 10, first-person copy written as JKAI) — by a stated margin,
as a committed test. Two controls rather than one because they fail differently: id 12 is
florid and impersonal, id 10 is chatty and first-person, and a scorer that only measures
formality would wave the second one straight through.

If it cannot tell them apart, the card carries no signal and everything downstream is
theatre. **Phase 3 gates phases 4–5.**

## Build phases

0. **Provenance + capture the discarded signal.** `authorship` column on `blogPosts`
   (`human | assisted | generated | unknown`); tagging control in the admin blog list;
   fix `apply-proposal/+server.ts` to persist rejections, and add the reject path that
   records John's replacement text. Without this, phase 5 has nothing to learn from.
1. **Card v1.** `src/lib/voice/{measure,card}.ts`; `scripts/build-voice-card.ts`;
   `data/voice/*` committed. Stated layer ported from the memory file; exemplars chosen
   by John.
2. **`$lib/voice` + swap the six.** `voiceBlock(register)`; edit the six hardcoded sites;
   fill `buildStyleCues()` from `blog_post_revisions` + resolutions.
3. **Scorer + stop-gate.** `src/lib/voice/score.ts`; the discriminator test; Voice panel in
   both editors.
4. **Fan-out (all four stacks, per John 2026-08-19).** `scripts/sync-voice.sh`;
   Hermes fragment; `john-voice` Claude skill; sr-docs page; `/admin/content/voice`;
   retire `feedback_public_prose_voice.md` to a pointer.
5. **Learn loop.** Recompute on each new `human` post; monthly drift job that *proposes*,
   never auto-applies.

## Files to touch (~20)

**Core (10):** `src/lib/db/schema.ts` · `src/lib/voice/{measure,card,score,index}.ts` (new) ·
`scripts/build-voice-card.ts` (new) · `data/voice/*` (new) ·
`src/routes/api/admin/blog/[id]/apply-proposal/+server.ts` · `src/lib/blog/assistant/prompt.ts`
(both the tone block and `buildStyleCues`) · `src/lib/components/RichEditor.svelte` ·
`src/lib/components/MarkdownEditor.svelte` · `src/routes/admin/content/blog/+page.svelte`

**Tone swaps (5):** `jkai/intel/brief.ts` · `health/narrative-service.ts` ·
`releases/summarise.ts` · `workflowdoctor/classify.ts` · `deepdive/ask-questions.ts`

**Fan-out (5):** `scripts/sync-voice.sh` (new) · `src/routes/admin/content/voice/` (new) ·
`~/.hermes-jkai/prompts/voice.md` (separate repo — commit there) ·
`~/.claude/skills/john-voice/SKILL.md` (new) · sr-docs content page + that repo's CLAUDE.md

## Verification

| Phase | Command / check |
|---|---|
| 0 | Corpus meter on `/admin/content/blog` reads **5 posts, 4,102 words** after tagging; reject a proposal and confirm a `proposal_resolved` row lands |
| 1 | `npx tsx scripts/build-voice-card.ts --dry` — identical numbers on two consecutive runs |
| 2 | `grep -rn "British English\|plain British" src/lib \| grep -v lib/voice` returns nothing |
| 3 | Committed test: `scoreVoice(post 13) > scoreVoice(post 12)` by the stated margin |
| 4 | A live jkai turn and a generated release summary both come back in register; Claude skill appears in the index |
| 5 | Drift job opens a note, changes nothing on its own |

## Deployment snags (known in advance)

- **ci-deploy is an allow-list.** Both new `scripts/` files need their own rsync lines, or
  they silently never reach the VPS.
- **Hermes restarts** after any `SKILL.md` edit and after any deploy — so every card
  regeneration implies a Hermes restart in `sync-voice.sh`.
- The Hermes skill index is **60 chars**; the `john-voice` description must fit.

## Risks and non-goals

- **n=6 describes those posts, not a person.** Report the measured layer as provisional and
  do not let the scorer hard-fail on statistical traits until the corpus grows. (Cf. the
  <150-sample noise floor already established elsewhere.)
- **Model collapse in miniature.** Never feed generated text back into the corpus. Three
  generated posts would outweigh six real ones inside a month — which is why the
  `authorship` column is load-bearing, not administrative.
- **Token cost.** Cap each register's block at ~400 tokens; exemplars are the expensive
  part — 2 per call, rotated.
- **Over-application.** Plain English is the default register site-wide; a runbook should be
  clear, not characterful. Registers plus opt-in are the control.

## Blocker discovered during phase 0: the blog assistant is not mounted

Phase 0 set out to stop discarding the accept/reject signal. While wiring it, the reason
prod holds **37 proposals and 0 resolutions** turned out to be more fundamental than a
missing write path: **the blog assistant UI is not mounted on any page.**

`BlogAssistantWidget.svelte`, `BlogAssistantMarginCallouts.svelte` and
`BlogAssistantSuggestionChip.svelte` all exist and are complete. Nothing imports them.
`RichEditor.svelte` still declares `onProposalAccepted` / `onProposalRejected` props
(lines 30–31) and fires them (lines 323, 333) — no caller passes either.

**Root cause:** commit `708ab5a9` (2026-05-07, *"chore(blog): resolve stash-pop conflict —
keep stashed changes"*) removed 221 lines from `src/routes/admin/blog/[id]/+page.svelte`,
including the widget mount, the margin callouts, the proposal store wiring, the rollback
handler and `BlogStatsCard`. The message claims it kept "the more recent blog-assistant
work"; the resolution in fact dropped the integration wholesale. The later admin
consolidation (`33e2e599`) then moved the page to `admin/content/blog/[id]/` with the
assistant already absent, which is why the loss is invisible in that diff.

So the assistant has been dead in production since **2026-05-07** — three and a half months.

**Why phase 0 did not restore it.** The restoration is not a revert: the page has since
been consolidated and restructured, and the deleted block also expects `data.history` and
`data.stats` from a loader that no longer provides them. It is its own piece of work with
its own verification burden (an LLM-driven UI needs a real browser pass), and expanding
phase 0 to absorb it would have been scaling the task up uninvited.

**What phase 0 delivered instead:** the capture layer is complete, tested against a real
Postgres, and inert only because nothing calls it yet. The moment the UI is mounted, every
rejection and every edited acceptance is recorded with no further work.

**Restoration recipe (proposed phase 0.5):**

1. `git show 708ab5a9^:'src/routes/admin/blog/[id]/+page.svelte'` — the last good version.
2. Re-add to `src/routes/admin/content/blog/[id]/+page.svelte`: the widget mount, the
   `BlogAssistantMarginCallouts` block inside an `.editor-host` wrapper, `createProposalStore`,
   the auto-review scheduler, and the meta accept/reject handlers.
3. Restore `data.history` (and `data.stats` if `BlogStatsCard` is wanted back) in that
   route's `+page.server.ts`.
4. Point `acceptProse` / `rejectProse` / `onProposalRejected` at
   `POST /api/admin/blog/:id/resolve-proposal`, passing `original`, `suggested`, `final`
   and `reason` — that is what turns the UI back on *and* starts the corpus growing.
5. Verify: reject one suggestion in the editor, then
   `select content from blog_assistant_messages where role='proposal_resolved'` returns it.

## Open decision

The corpus answer selected "Blog posts only" alongside two additions. This plan reads that
as **blog posts as the core, plus editor pairs, plus jkai chat turns, with Claude Code
messages excluded**. If the strict reading was intended, drop the `chat` register's source
and phase 0's rejection-capture work stands regardless.
