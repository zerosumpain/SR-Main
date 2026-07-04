# sr. pulse — live status board (autonomous build test)

**Date:** 2026-07-04 · **Mode:** Full-grade autonomous (per `autonomous-build` skill) · **Brief:** "test it on a real task, build something small autonomously"

## What

A single-file static bundle at `data/jkai-projects/pulse/index.html`, served at `https://strangeramblings.com/projects/pulse/`. A phone-friendly, instant-load status board showing live vitals from three already-public same-origin APIs:

- `/api/biome/state` — heart rate, recovery, strain, day phase, weather (+town), staleness
- `/api/landing/vitals` — jkai active jobs, builder stage/shipped, canvas workflow count/last run, walk state
- `/api/live-walk` — walk activity (merged into the walk tile)

Tiles: HEART · RECOVERY · STRAIN · WEATHER · WALK · WORKFLOWS · BUILDER. Auto-refresh every 30s (paused while tab hidden); per-endpoint failure isolation; stale/error shown as labeled badges (never color alone). SR design tokens throughout (cream `#ede4d4`, ink `#1a1008`, accent `#c4570a`, petrol `#0e5b66`; Archivo Black / DM Sans / JetBrains Mono / DM Mono; radii 0/2/4; no shadows).

## Why this (Decision Log)

| # | Fork | Options | Chosen | Why / reversibility |
|---|---|---|---|---|
| D1 | What to build | (a) live status board bundle; (b) generic calculator; (c) publish an existing local tool | (a) | Real live data, genuinely useful (instant site+vitals check on phone), exercises bundle-deploy/sr-design/dataviz skills end to end; fully reversible (delete one dir) |
| D2 | Delivery mechanism | static bundle via `data/jkai-projects/` vs new SvelteKit route | bundle | No svelte rebuild/deploy risk; scope stays 1 file; page is reachable by URL (not on /projects index — adding an index card is a documented follow-up, not required for the test) |
| D3 | Sparklines/history | client-side history accumulation vs point-in-time tiles | tiles only | No public history endpoint; session-only history is YAGNI for a status glance; dataviz skill: stat tiles are a legitimate non-chart form |
| D4 | Where source lives | own repo vs directly in `data/jkai-projects/pulse/` | direct | Matches existing bundle convention; single file; covered by restic backup; spec committed to SR-Main for provenance |

## Verification gate

Local render via the always-on service (`http://localhost:5173/projects/pulse/`) + Playwright screenshot; palette validator on accents vs cream surface; live-verify after rsync deploy (curl unique string + prod screenshot).
