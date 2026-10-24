# Hometowns scripts: the Lab, the bench and the engine's tooling

Everything here runs the real engine in `src/lib/games/hometowns/engine/`
headlessly. Nothing in this folder is part of the engine, but some of it is
part of the PR gate (see "Gate-critical files" below).

## The balance Lab (spec §11)

`lab.ts` plays bot counties across many seeds and judges them against the
§11.4 gates. It runs a `worker_threads` pool (bundled with esbuild, so the
engine runs as production runs it) and writes a scorecard and an HTML report
to `reports/<stamp>-<profile>/`, with `latest.html` and `latest.json` beside
them. Reports are git-ignored.

```bash
npm run hometowns:lab -- --quick                 # the tuning loop: 12 seeds × 20 days (about 1–2 minutes)
npm run hometowns:lab -- --full                  # the gate run: 200 seeds × 60 days × 6-bot counties
npm run hometowns:lab -- --smoke                 # §12.1's 12 seeds × 20 days × 4 towns
npm run hometowns:lab -- --full --check          # exit 1 on a gate failure or a baseline regression
npm run hometowns:lab -- --quick --baseline write    # set this profile's baseline (baselines/)
npm run hometowns:lab -- --quick --ab change.json    # paired A/B of a params change on the same seeds
npm run hometowns:lab -- --sweep targets         # ±20% on §11.3's first targets (or --sweep all)
npm run hometowns:lab -- --offrule               # off-rule identity runs
```

Options: `--seeds N`, `--days N`, `--workers N` (0 runs in this thread),
`--no-report`. G12's timed counties run one at a time after the pool has
drained, so contention from the other jobs is not measured as engine time.

`lab/` holds the pieces: `experiments.ts` (profiles, lineups, jobs),
`run.ts` (one county with bot sessions), `observe.ts` (notes taken around the
real steps without touching state), `gates.ts` (G1–G13), `baseline.ts`,
`runner.ts`, `pool.ts`, `worker.ts`, `report.ts` and `summary.ts`. The bots
themselves live in `src/lib/games/hometowns/engine/bots/`, shared with the
tests and the page's harness mode.

## The report server

`serve-reports.mjs` is a read-only static server over `reports/` (GET and
HEAD only, confined to the folder, no dotfiles). The local preview's
`hometowns-lab` container runs it. Outside a container `--host` is required:
the machine also serves public production, so it never defaults to every
interface there.

```bash
node scripts/hometowns/serve-reports.mjs --host 127.0.0.1 --port 8080 [--root <dir>]
```

Its test is `src/lib/games/hometowns/lab/serve-reports.test.ts`.

## CPU budgets (spec §10.15)

```bash
npm run hometowns:bench                          # tick, month step, Regional Day and 96-unit chunks, as a table
npm run hometowns:bench -- --check               # exit 1 if a p95 is over 2× its budget
node scripts/hometowns/bench-space.mjs           # WP2a's share of the month step (M2–M4) alone
```

Both bundle the engine and time it in a plain Node child. They measure wall
clock time, so run them on a quiet machine; the PR gate keeps only a guard
against gross regressions (`engine/space.bench.test.ts`).

## The engine hash

```bash
node scripts/hometowns/engine-hash.mjs           # rewrite engine/engine-hash.generated.ts
node scripts/hometowns/engine-hash.mjs --check   # exit 1 if it is stale
```

`engine/banned.test.ts` fails when the hash is stale, so rerun it after any
engine or params change.

## Gate-critical files

- `fixture.ts`: the golden fixture states (a Hamlet, a Town and a
  Metropolis, hand-built so they do not change when a package lands), plus
  `newCounty` and `foundAndSprint`. Engine tests import it, so a change here
  is a change to the gate. Fixtures are built, never copied from a real room.
- The scenario kits used by the package tests: `civic-kit.ts` (WP2d),
  `people-kit.ts` (WP2b), `market-kit.ts` (WP2c), `develop-kit.ts` (Bramble's
  founding steps, WP2e and G13), `space-kit.ts` (WP2a) and `space-bench.ts`.
- `baselines/`: the Lab's regression baselines, one per profile.
