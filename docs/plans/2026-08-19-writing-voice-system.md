# Writing-voice system — implementation plan (2026-08-19)

John's hand-written blog posts become the source of truth for his prose voice, distilled
into a versioned **Voice Card** that steers every automated writing surface: the blog
assistant, jkai chat, the Engine Room / briefings / release notes, sr-docs, and the
Claude Code + builder prompt stacks.

## Findings that shape the design (measured, 2026-08-19)

**The corpus is small and unlabelled.** Prod `blog_posts` holds **13 rows**, 1 published.
Word counts below are measured with the same `plainTextFromHtml` + `countWords` the corpus
meter uses — a naive tag-strip in SQL overcounts by ~25%, so only one measure is quoted:

| id | slug | words | authorship |
|---|---|---|---|
| 9 | `ai-after-openclaw` | 1,420 | human |
| 12 | `the-great-eastern-railway…` | 933 | **generated** |
| 13 | `i-built-a-thing` | 920 | human (the published one) |
| 6 | `the-state-of-agentic-coding` | 408 | human |
| 10 | `hello-world` | 320 | **generated** |
| 11 | `reflecting-and-projecting` | 269 | human |
| 8 | `brave-new-world` | 181 | human |
| 3 | `so-here-it-is` | 45 | human, below the prose floor |
| 1, 2, 14, 5, 4 | stubs | 15, 15, 15, 5, 4 | human, below the floor |

**Usable corpus: 5 posts, 3,198 words.** Two posts are machine-written, not one:
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

Not fine-tuning — 3,200 words is two orders of magnitude short, costs per iteration, and
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
1. **Card v1.** ✅ **Delivered 2026-08-20 (PR #374).** `src/lib/voice/{types,measure,card}.ts`,
   `scripts/build-voice-card.ts`, `data/voice/voice-card.json` + six exemplars.
   Measured `public-prose` (5 posts, 3,198 words) and `chat` (1,106 turns, 16,074 words);
   `explanatory` and `terse` carry rules only, because no corpus isolates them and
   inventing one would produce figures with nothing behind them. Corpus export procedure
   in `docs/voice-corpus.md`; `corpus.json` is gitignored — it holds unpublished drafts
   and private chat turns.

   **Three measurements contradicted the stated rules, and the card records the
   disagreement rather than papering over it** (`tensions`):

   - *Sentence length.* The blog assistant prompt has long said "short sentences are
     fine". Measured: median **19** words, p90 **43**, only **13%** at five words or
     fewer. He writes long, comma-spliced sentences. A model told to write short ones
     produces something clipped that reads nothing like him. **This one was an error in
     the old prompt, and the card corrects it.**
   - *Exclamation marks.* The rule says none; the corpus has them at ~3 per 1,000 words.
     The rule stands as an *instruction for generated prose* — he earns one, a model
     reaching for one lands it as enthusiasm. Recorded as instruction, not observation.
   - *Colons.* Zero in 3,198 words. Nobody wrote that rule down; he simply never does it.

   Distinctiveness is scored against the two `generated` posts. Nothing clears z > 1.96
   (top term `my` at 1.81) and the list mixes style with subject matter, so the card
   labels it a ranking rather than a set of findings. The real signal in it is blunt:
   first-person pronouns dominate — he writes about what he did, the model writes about
   a subject.
2. **`$lib/voice` + swap the six.** `voiceBlock(register)`; edit the six hardcoded sites;
   fill `buildStyleCues()` from `blog_post_revisions` + resolutions.
3. **Scorer + stop-gate.** ✅ **Delivered 2026-08-20 (PR #377). THE STOP-GATE PASSES.**

   | text | score | verdict |
   |---|---|---|
   | `i-built-a-thing` (John, published) | **100** | in voice |
   | `the-great-eastern-railway…` (machine, florid) | **52** | not his voice |
   | `hello-world` (machine, chatty first-person) | **63** | drifting |

   Margins of **48** and **37** against a stated 25, with no overlap. All five of John's
   posts score 100. Phases 4–5 are unblocked.

   `src/lib/voice/score.ts` is pure (no filesystem) so it runs in the browser as he types;
   `score.server.ts` supplies the committed card for server callers. The Voice panel sits
   under the readability strip in both editors, with the card shipped via the page loader
   rather than a request per keystroke.

   **Features were derived from the corpus, not guessed.** A probe over all seven posts
   found what actually separates them, and it is not one thing: first-person density
   catches the florid control (0 per 1,000 against his 46) but sails straight past the
   chatty one (56). Em-dash rate, colon use, sentence median and readability catch the
   other. Two controls that fail differently is what forced a composite rather than a
   single test.

   **The probe also found a bug that would have poisoned everything.** `plainTextFromHtml`
   decoded named entities but not numeric ones, so TipTap's `&#39;` survived into the
   measurements: `I&#39;m` never matched as a contraction and the trailing semicolon
   counted as punctuation the author never typed. One post measured 0 contractions and 66
   semicolons per 1,000 words purely from this — a completely different writer from the one
   who wrote it. Fixed in `readability.ts`, which also corrects the editor's word counts.

   **The first scorer flagged John's own writing three times**, and every one was the
   scorer's fault: a `\w+i[sz]?ze` pattern matched "size"; "robust" was on the corporate
   blacklist though he uses it plainly; "when it comes to" was treated as throat-clearing
   though it is ordinary English. All three removed. A word he actually writes is not a
   defect.

   The verdict weighs **breadth as well as total penalty** — three contradicted habits is a
   different writer whatever the arithmetic says. Hard failures stay reserved for
   deterministic defects; statistical traits only ever warn, because five posts cannot
   support failing on a band.
4. **Fan-out.** ✅ **Delivered 2026-08-20 (PR #378).** `scripts/sync-voice.sh` renders the
   card through the *same* `renderVoiceBlock` the site uses and writes it to three stacks
   that cannot see `data/voice/`, plus `/admin/content/voice` and the retired memory file.
   `--check` writes nothing and exits non-zero when a destination is stale.

   **Hermes gets it in `jkai-general`, not a `jkai-voice` skill.** Hermes truncates every
   skill description to 60 characters and is told to load anything "even partially
   relevant", so a voice skill would either be routed past when it mattered or loaded for
   everything. Voice applies to every reply, so it belongs in the always-loaded router.
   jkai chat had **no voice instruction at all** before this. Inserted between markers so
   the other 42,000 characters are untouched; the script restarts `jkai-hermes`, without
   which a SKILL.md edit does nothing.

   **A design error caught in the act.** The `chat` register is measured from *John's own
   messages to jkai* — but the block is instructions for *jkai's replies*. The first sync
   handed the assistant "write as John, in the first person" and "about 24 uses of I/me/my
   per 1,000 words" as targets. jkai answers him; it does not impersonate him. Fixed with
   `bandsDescribeOutput` on the register: where the measurement describes the counterpart
   it renders as *"his messages run about 10 words — match that register; these are HIS
   numbers, not a target for yours"*, and `chat` no longer carries the persona. Card v3.

   **Deliberately no rsync line in `ci-release.sh`.** Every destination is a homeserv path;
   nothing here runs on the VPS. New `scripts/` files normally do need one, so the absence
   is recorded in the script header rather than left to look like an oversight.

   `feedback_public_prose_voice.md` is now a pointer that keeps only the two rules the
   measurements overturned.

5. **Learn loop.** ✅ **Delivered 2026-08-20 (PR #377).** `drift.ts` compares a fresh
   measurement against the committed card; `drift-engine.ts` runs it monthly (06:00 on the
   1st, London) behind the same prod-only hostname gate and settings kill switch as
   `selfimprove`, writes a datastore note when something moved, and **changes nothing
   else**. `scripts/voice-drift.ts` runs the same comparison by hand and exits non-zero on
   material drift. Surfaced on `/admin/content/voice`.

   Rebuilding the card stays a deliberate act with a commit behind it. The card is the one
   description of how everything writes, and an unattended overnight change to it would be
   untraceable — so the job's entire output is a note that says which numbers moved and
   which two commands to run.

   **Thresholds are generous on purpose**: 25% *and* an absolute floor per metric. On five
   posts a single new one moves every number, and a job that cried drift every month would
   train John to ignore it, which is worse than not having it. Colons going 0 → 0.4 per
   1,000 words is a 100% change and means nothing; the floor is what stops that being
   reported. A new post is material on its own, whatever the rates did.

   Immaterial reports are not stored. A row a month saying "nothing moved" is how a log
   becomes wallpaper.

   `data/voice/preferences.json` now exists, built from the resolutions phases 0 and 0.5
   started capturing — rejections and edited acceptances only, since tolerating a
   suggestion is not the same as wanting it. **It is empty, and correctly so:** nothing
   recorded resolutions until #370 and nothing fired them until #371, so the pairs
   accumulate one editing session at a time.
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
| 0 | Corpus meter on `/admin/content/blog` reads **5 posts, 3,198 words** after tagging; reject a proposal and confirm a `proposal_resolved` row lands |
| 1 | `npx tsx scripts/build-voice-card.ts --dry` — identical numbers on two consecutive runs |
| 2 | `grep -rn "British English\|plain British" src/lib \| grep -v lib/voice` returns nothing |
| 3 | ✅ `score.test.ts` — committed fixtures, no production dependency. John 100; controls 52 and 63; margins 48 and 37 against a stated 25 |
| 4 | ✅ Claude skill **appears in the index** (confirmed in a live session). Release-notes prompt asserted to contain the terse block by `wiring.test.ts`, reading the real prompt string. `sync-voice.sh --check` is clean and idempotent. **Not verified: a live jkai turn** — skill bodies load at runtime and never reach `state.db`, so the file being right and Hermes restarting is as far as it goes without driving a real chat turn |
| 5 | ✅ `drift.test.ts` — detects a moved metric and a new post, ignores a large percentage move on a tiny base, and asserts the summary never proposes applying anything itself. `scripts/voice-drift.ts` run against the live corpus: no drift, exit 0 |

## Deployment snag found the hard way: schema.ts must be self-contained

Phase 0 merged green and deployed, and the `authorship` column **did not reach
production**. `ci-release.sh` rsyncs `src/lib/db/schema.ts` to the VPS *on its own*
(plus `drizzle.config.ts`) and runs `drizzle-kit push` against it there. Nothing sets up
SvelteKit's `$lib` alias in that context, so schema.ts re-exporting the authorship
vocabulary from `$lib/blog/authorship` died with `Cannot find module '$lib/blog/authorship'`.

The part that makes this dangerous: **the release does not fail when the push fails.** It
logs the error, finishes the deploy and reports success. Production ran code expecting a
column the database did not have, with a green tick on the commit.

Fixed two ways: the re-export is gone (it had no callers — everything already imports from
`$lib/blog/authorship`), and `scripts/check-schema-imports.mjs` now fails the Lint gates
step if schema.ts ever grows a `$lib` or relative import again.

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

**Why phase 0 did not restore it.** The restoration is not a revert — the page was
consolidated and restructured after the deletion — and an LLM-driven UI carries its own
verification burden, so it was scoped as phase 0.5 rather than folded in uninvited.

**Correction, found while doing 0.5:** the loader was *not* stripped. Both `data.history`
and `data.stats` are still returned by `admin/content/blog/[id]/+page.server.ts`; only the
page markup lost the mount, which made the restoration considerably smaller than estimated.
`BlogStatsCard` is a separate case — it was deliberately retired in `861d3269` (*"retire
provably unreachable code"*) precisely because the deleted mount had made it unreachable,
so it stays retired. `data.stats` is consequently computed on every editor page load —
four Umami round-trips — and rendered by nothing. Worth deleting from the loader; out of
scope here.

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

**Delivered 2026-08-19** (PR #371). Every resolution path now routes through
`/resolve-proposal`: prose accept and reject are recorded in RichEditor's callbacks — one
place, so no path is missed and none records twice — meta rejects record directly, and a
*regenerate* records as a rejection carrying John's own note as the `reason`, which is the
most explicit statement of taste the editor can produce.

## Open decision

The corpus answer selected "Blog posts only" alongside two additions. This plan reads that
as **blog posts as the core, plus editor pairs, plus jkai chat turns, with Claude Code
messages excluded**. If the strict reading was intended, drop the `chat` register's source
and phase 0's rejection-capture work stands regardless.
