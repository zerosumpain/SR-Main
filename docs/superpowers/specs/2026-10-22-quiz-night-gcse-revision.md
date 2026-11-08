# Quiz Night: better questions, and GCSE revision

John, 2026-10-22: "significantly improve the quiz generation capabilities … include GCSE curriculum inspired
quizzes that we can do as a family, with easy, medium and hard settings but based on past exams." One of the
children is in her GCSE year.

## What changed in generation (every quiz)

| Before | Now |
|---|---|
| One model call; whatever parsed and passed the block list was played | Two calls: the writer drafts 14, then a **checker** answers every question blind (answer key withheld, reasoning `low`) and any question it answers differently, or flags as ambiguous / wrong / dated, is dropped. Fewer than 6 left → the writer tries again. An unreadable or failed checker keeps the writer's set rather than failing the lobby. |
| Nothing stopped a family getting the same question twice | The last 80 prompts per host + subject/topic are remembered (in memory, like the rooms): the writer is shown 30 of them and any repeat is filtered out. A deploy forgets them. |
| Prompt asked only for four options and family-safe | Plausible same-kind distractors, no "which is NOT" unless capitalised, varied question types, easiest to hardest. |
| Answers vanished with the reveal | A finished room carries `review`: every question, the answer, the explanation, my pick, and how many of the table got it. The app keeps it on screen after the room closes. |

Cost: one extra call per quiz (the checker), on the same `games-quiz` workload.

## GCSE revision mode

`POST /api/native/games {game:'quiz-night', mode:'gcse', subject, board, topic?, difficulty, invite}`.

- **Subjects** (`src/lib/games/gcse.ts`): Maths, Biology, Chemistry, Physics, Combined Science, English
  Literature, English Language, History, Geography, Computer Science, Religious Studies, French, Spanish,
  German, Business — each with its spec headings as topic suggestions and spec codes per board where known.
  The app's list (`GcseSubject.all`) must match the ids; a test on each side pins them.
- **Board**: AQA, Edexcel, OCR, Eduqas or any. The writer is told e.g. `AQA GCSE Biology (8461)`.
- **Difficulty = grade band**: easy grades 1–3 (Foundation, opening questions), medium 4–5 (the crossover
  questions on both tiers), hard 6–9 (late Higher-tier questions). Untiered subjects get knowledge-level lines.
- **Clock grows with difficulty** (unlike a general quiz): working subjects 45/60/75 s, recall 25/30/35 s.
  The reveal stays up 9 s, long enough to read the working.
- **"Based on past exams"**: the writer is an examiner persona told to model each question on that board's
  2018–2025 past-paper questions (content, contexts, command words, demand), turn it into four options, never
  copy one verbatim, and make the wrong options the mistakes examiners' reports describe. It is NOT a bank of
  real past-paper items: those are the boards' copyright, and their open questions do not fit four buttons.
- Each question carries its spec `topic`, shown at the reveal (not before — it can give the answer away) and
  used by the app's "Revise next" list at the end.
- **Content check**: a GCSE quiz uses the family list, never the children's layer, and lifts only the stems its
  subject needs (`allows`: Biology `sexual*`, History `nazi*`/`genocid*`, Literature `suicid*`, RS `sexual*`).
- Invite line: `GCSE Chemistry · Edexcel · grades 6–9 — Rates and equilibrium`.

## Wire additions (all optional to older apps)

Room: `mode`, `gcse {subject, subjectLabel, board, boardLabel, band, tier}`, `timeMs` (now per room),
`review` (finished only). Question at reveal: `topic`.

## Not built

- A real past-paper question bank (licensing, and PDF ingestion) — the honest upgrade if the generated
  questions are not close enough to the papers.
- Per-player difficulty (a parent on hard, a younger child on easy, in one room).
- Persisted progress across quizzes ("weakest topics this month") — needs a table and its runtime GRANT.
