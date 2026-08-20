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

The build stamp is derived from the corpus, not the clock, so re-running over unchanged
data is a no-op diff. Re-export and rebuild whenever a post is written or an authorship
tag changes; the dry run will tell you whether anything actually moved.
