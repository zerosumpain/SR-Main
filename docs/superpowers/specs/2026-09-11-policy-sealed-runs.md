# Sealed policy runs — erasure you can state as a fact

**Branch** `feat/policy-sealed-runs` · **Kick-off** John, 2026-09-11: *"I need to be
able to delete every trace of a policy run thoroughly; log files, database traces
etc. If I'm ever running a policy through it that is not for public release I need
to be 100% assured no trace persists in the database after it's been extracted."*
Autonomous (Full grade).

## The problem with `remove()`

`store.ts:remove()` is good as far as it goes — it cancels the queue envelope
first so a worker cannot resurrect rows, then cascades documents, stages,
executions, model calls, artefacts, provenance, observations and shares. **Five
things survive it**, four verified in the code:

1. **`workflow_runs`** rows are set to `cancelled`, never deleted.
   `policy_stages.runId` has no cascade, so they orphan.
2. **`policy_personas`** — kept deliberately. The `dossier` traits and `summary`
   are sentences derived from the deleted paper; only `sightings` falls.
3. **`cross_policy` artefacts on the owner's OTHER assessments.** The contract
   carries `otherAnalysisTitle`, `interaction`, `consequence` — prose about the
   deleted policy, stored elsewhere, and `store.ts:101` reads it back.
4. **Other analyses' stored prompts.** `neighbourSummaries` feeds up to 6 × 60 of
   A's artefacts (label + 600 chars of statement) into B's calls, and
   `policy_model_calls.input` stores those prompts verbatim.
5. **Backups.** `~/bin/backup-vps-db.sh` takes a nightly full `pg_dump` into
   `~/backups/vps-pg` (14 kept); restic's primary repo backs up `/home/john/backups`
   to porkserv. Anything alive at 02:30 is in up to fourteen dumps plus snapshots.

Plus the irreducible: the model provider received the document, the search
provider received the queries, and Postgres keeps deleted tuples in heap pages
and WAL until vacuum and checkpoint.

**No `DELETE` reaches items 3–5.** So the guarantee cannot be built on deletion.

## The design: crypto-shredding

A **Sealed** checkbox at submission. A sealed run:

1. **Mints a per-run 32-byte key** at `<POLICY_SEAL_KEY_DIR>/<id>.key`, mode 0600,
   defaulting to `data/policy-keys/` — outside the database (so in no `pg_dump`
   and no restic snapshot: the DB dump is the only thing pulled from the VPS) and
   inside `data/`, which ci-deploy rsyncs **without** `--delete`, so it survives a
   release. Cipher is the site's existing AES-256-GCM (`$lib/secrets/crypto`)
   with an explicit key rather than the shared one.
2. **Encrypts every free-text column at the store seam.** `policy_documents`
   (content, extracted text, metadata, filename), `policy_artefacts` (label,
   statement, source quote, section, data), `policy_stages` (output, warnings,
   error), `policy_executions.error`, `policy_analyses` (title, context,
   jurisdiction, policy area, error). Ids, ordinals, statuses, offsets, confidence
   and relations stay clear so the queue, the checks and every index keep working.
3. **Stores no prompts at all.** `policy_model_calls.input` and `.output` are
   null on a sealed run; `callKey`, `inputHash`, `status`, `provider`, `model`,
   `usage` and the timings remain, so the run log and the cost figure still read.
   The replay diagnostic is unavailable on a sealed run and the page says so.
4. **Never leaves its own blast radius.** Excluded from `neighbourSummaries` in
   both directions, skips the persona stage entirely (no writes, no priors),
   research off, and no share links.
5. **Purge = shred the key, THEN delete.** That order matters: a failed delete
   leaves unreadable rows and can be retried, whereas deleting first and failing
   to shred would leave ciphertext in fourteen backups with a live key beside it.
   The delete also now reaches the orphaned `workflow_runs` and any `cross_policy`
   artefact on another analysis that names this one.
6. **Issues a purge receipt.** A census over every place that can hold a
   reference — eleven probes, listed in `census.ts` — returning counts that must
   all be zero, plus what it cannot reach and why. Downloaded, never stored: a
   receipt in the database would be a new trace of the thing it certifies.

## Decision log

| # | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|
| 1 | Key in a DB table / a file outside the DB / an owner passphrase | **File** | A table is in the same dump, so it buys nothing. A passphrase is strongest but a run takes 1–5 h and resumes across restarts, so every deploy would stall it on a prompt — unusable, not merely inconvenient. | Yes — `POLICY_SEAL_KEY_DIR` moves it. |
| 2 | Encrypt at the store seam / everywhere it is read | **Store seam** | `loadArtefacts`, `loadWithMeta`, `persistArtefacts`, `detail`, `ownedAnalysis`, `listAnalyses` become the only code that knows. Everything above them sees exactly what it sees today. | Yes. |
| 3 | Encrypt prompts / do not store them | **Do not store** (John's call) | Costs the replay diagnostic on sealed runs — the one tool that finds stage bugs — on precisely the runs that cannot be re-run. Stated in the UI rather than hidden. | Yes — one branch in `provider.ts`. |
| 4 | Shred then delete / delete then shred | **Shred first** | The failure modes are not symmetric. See 5 above. | n/a |
| 5 | Receipt stored / downloaded only | **Downloaded** | Storing a record of the purge in the database it just emptied re-creates a trace of the run's existence, its title and its dates. | Yes. |
| 6 | Sealed runs may share / may not | **May not** | A share link is a capability against a row whose whole point is that it will cease to exist. | Yes. |

## What this does NOT claim

Stated at submission, not at deletion, because that is when it can still be acted
on: **the model provider has seen the document**, and if research is enabled the
search provider has seen queries derived from it. Neither is reachable from here.
The two controls that help are an account with zero data retention and leaving
research off, and the form says so.

## Verification

- `seal.test.ts` — the cipher round-trips, a wrong key fails closed, a shredded
  key leaves ciphertext unreadable, and the field map covers every free-text
  column named above.
- `sealed.integration.test.ts` (opt-in, `POLICY_LOCAL_TESTS=1`) — a sealed run
  end to end against Postgres: the stored rows hold no plaintext of the document,
  the dashboard reads it back correctly, the purge census returns eleven zeros,
  and a second run cannot see it as a neighbour.
- `census.test.ts` — the probe list is complete against the schema: a new table
  carrying `analysis_id` fails the test until it is listed.
- The gate on porkserv, the structural gates after `git add`, CI, deploy, live.
