# Exporting the voice corpus

`scripts/build-voice-card.ts` needs the corpus that lives in production. homeserv has no
direct route to that database, so the usual path is to export it and pass `--corpus`.

Everything here is read-only.

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 \
  'docker exec strange-rambling-app-db-1 sh -lc "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tAc \
   \"select json_build_object(
      '\''posts'\'', (select json_agg(json_build_object(
                       '\''id'\'', id, '\''slug'\'', slug,
                       '\''authorship'\'', authorship, '\''content'\'', content))
                   from blog_posts),
      '\''chat'\'',  (select json_agg(o.content)
                   from orchestrator_chats o
                   join jkai_conversations c on c.id = o.conversation_id
                   where o.role = '\''user'\'' and c.source = '\''web'\''),
      '\''resolutions'\'', (select json_agg(content order by created_at)
                   from blog_assistant_messages
                   where role = '\''proposal_resolved'\''))\""' \
  > corpus.json

npx tsx scripts/build-voice-card.ts --corpus corpus.json          # dry run
npx tsx scripts/build-voice-card.ts --corpus corpus.json --write  # commit the result
```

`DATABASE_URL=… npx tsx scripts/build-voice-card.ts` does the same queries directly, for
whenever the script is run somewhere that can reach the database.

## What the export contains, and what it deliberately does not

`posts` is every row of `blog_posts` — the script does the filtering itself, so the export
stays a faithful copy rather than a pre-judged one. Only rows tagged `authorship='human'`
that clear `MIN_CORPUS_WORDS` feed the `public-prose` register; rows tagged `generated`
become the contrast corpus for distinctiveness; everything else is ignored.

`chat` is John's own typed turns, and only from web conversations.
**WhatsApp-sourced threads are excluded in the query itself**, not filtered later — that
content is private and should not reach a JSON file on disk in the first place.

Assistant turns are excluded for the obvious reason: they are not him, and feeding model
output back into a model's picture of his voice is how a corpus this small collapses.

## Do not commit the export

`corpus.json` is a copy of unpublished drafts and private chat turns. Write it to a
scratch directory, not the repo. The card built from it is what gets committed, and that
holds only measurements plus the six chosen exemplars.

## Preference pairs

`resolutions` is what John did with the assistant's suggestions. `build-voice-card.ts`
keeps only the ones that carry a signal — rejections, and acceptances he rewrote before
applying — and writes them to `data/voice/preferences.json`. A rejection says more than an
acceptance, because tolerating a suggestion is not the same as wanting it.

Expect this to be empty for a while. Nothing recorded resolutions until PR #370, and
nothing fired them until the assistant UI was remounted in #371, so the pairs accumulate
one editing session at a time.

## Refreshing after new posts

Everything above happens on its own now. `scripts/refresh-voice-card.sh` runs on homeserv
at 07:00 on the 1st — an hour after the in-app drift job, so the datastore note lands
first — and does the export, the rebuild and the comparison in one go. When the card moves
it opens a PR; when it doesn't it writes a log line and stops.

Cron calls `~/bin/voice-card-refresh.sh`, which reads this script out of `origin/master`
and pipes it to bash, because the checkout is usually parked on somebody's branch where
this file is a different version or missing entirely.

```bash
scripts/refresh-voice-card.sh --dry-run                 # export, rebuild, print, change nothing
scripts/refresh-voice-card.sh --corpus corpus.json      # reuse an export instead of hitting prod
scripts/refresh-voice-card.sh                           # the real thing
```

**It proposes; it never commits to master.** Same rule the drift job follows, for the same
reason: the card is the only description of how every automated writer sounds, so a
rebuild nobody read would be untraceable, and the first sign of a bad one would be
everything quietly writing wrong.

Three things it deliberately does not do:

- **It does not pick exemplars.** A rebuild re-measures the numbers and re-ranks the
  distinctive terms. Which six passages represent a writer is a judgement, and selection
  is pinned so the prompt prefix keeps hitting the OpenRouter cache. The PR lists the
  posts that were measured so the choice is at least in front of you; swapping one is a
  separate commit in `data/voice/exemplars/`.
- **It does not touch the prohibitions or the persona lines.** Those are hand-written.
- **It does not tag anything.** A new post arrives as `authorship='unknown'` and is
  invisible to the corpus until it is set to `human` on `/admin/content/blog`. Nothing
  automates that, and nothing should — deciding a post is genuinely yours is the one
  judgement the whole system rests on.

The run before the rebuild is `scripts/voice-drift.ts`, whose table speaks for
`public-prose` alone. It can honestly report "nothing moved" over a real diff, because the
chat corpus and the generated-post contrast set grow on their own; the PR body reports
what changed in the file separately, derived from the two versions rather than from that
table.

It also carries the merge through. Hermes, the `john-voice` Claude skill and sr-docs read
their own copies of the card, so merging a PR changes nothing about how anything writes
until `scripts/sync-voice.sh` runs — the next scheduled run notices master is ahead and
syncs before it does anything else.

The build stamp is derived from the corpus rather than the clock, so a rebuild over
unchanged data is byte-identical and there is nothing to propose. Run it by hand after
tagging a post rather than waiting for the 1st.
