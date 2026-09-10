# Liveness: stop the platform killing its own long-running work

Date: 2026-09-10
Branch: `fix/policy-liveness`
Backlog items: 10, 11, 13

## The problem, measured

The first full production policy assessment — Post-16 Education and Skills, 72 pages —
ran 5h36m on 2026-09-10 and came within **one interruption** of being destroyed
outright. Nothing in the assessment failed.

Two independent faults, both in the platform rather than the feature:

**1. A synchronous stage blocked the liveness probe.** `Targeted research` assembles its
context synchronously and, at 2,079 artefacts, that took **17–20 seconds per call**
against the probe's 5,000ms threshold. The watchdog read every one of those as a wedged
process and restarted the web service, which is where the policy worker lives. Measured
from the journal:

```
17:31:12  blocked ~18619ms      17:39:00  blocked ~18917ms
17:33:15  blocked ~17018ms      17:40:26  blocked ~19079ms
17:35:18  blocked ~20561ms      17:42:18  blocked ~18376ms
17:37:16  blocked ~18513ms      17:44:18  blocked ~17686ms
```

Eleven executions burned in twenty minutes, against a ceiling of twelve. The run was
saved only by stopping the watchdog timer by hand.

**2. `daydream-places` restarts the whole site, hourly.** A whole-window recompute of the
trail — 93,218 GPS fixes into 2,133 clusters — entirely synchronous, 8.1s to 15.8s per
run, tracked against watchdog restarts at **8 out of 8** on 10 September. Roughly twenty
site restarts that day. The fix count grows ~150/hour, so the block lengthens on its own.

## Changes

### Item 10 — register a policy stage as a batch (`worker.ts`)

`beginBatch()` in `engine-runtime.ts` already exists for exactly this, and the health
probe already honours it: a stall is excused only while a registered batch is still
*beating*, and a batch that goes stale (120s) excuses nothing. The nightly intel sweep
uses it. The policy worker never did.

The beat rides the existing 2-second lease-check interval rather than a timer of its own.
That is the load-bearing detail: **a blocked event loop cannot fire a timer callback**, so
the beat stops precisely when the process really is wedged, and the restart becomes correct
again. `fanOut` also reports real progress (`"42 of 352"`) through a new
`PipelineDeps.onProgress`, which the worker turns into a beat with a phase.

`loadArtefacts` was moved *above* the registration. Nothing between `beginBatch()` and the
`try` may throw: a batch leaked on the way in would claim the process is busy for the life
of the process and permanently suppress the restart it exists to defer.

### Item 11 — make the clustering yield, and stop it doing pointless work (`cluster.ts`)

Two changes, both output-identical:

- **An exact latitude guard.** Great-circle distance is never less than north-south
  separation, so a latitude difference alone rules a cluster out before paying for a
  haversine. The divisor (`110_000` m/degree) is deliberately *under*-stated — below both
  the spherical constant (~111,195) and the WGS84 equatorial minimum (~110,574) — so the
  guard is always wider than strictly needed. A guard that was too tight would silently
  change the clustering; one that is too wide only costs a few extra distance checks.
- **`clusterPointsYielding`**, which yields to the loop every 500 points. The synchronous
  `clusterPoints` is retained as the reference implementation the yielding one is asserted
  equal to.

Both drivers call one shared `assignPoint`, so they cannot drift apart.

### Item 13 — the execution ceiling becomes a rate (`worker.ts`)

`EXECUTION_CEILING = 12` was a lifetime count and could not tell a two-minute restart loop
from a long run interrupted a few times an hour apart. It is now counted inside a
one-hour window. Twelve in an hour is a loop and still stops the stage; twelve across six
hours is a Thursday and costs nothing. The failure message now names the rate.

## Verification

Production-scale benchmark, 93,218 points over ~2,000 places:

| | |
|---|---|
| Unguarded, synchronous | **11.49s** — reproduces the observed 8–16s |
| Guarded, synchronous | 1.19s (**9.7× faster**) |
| Guarded + yielding | worst uninterrupted chunk **11ms** vs a 5,000ms threshold |
| Clustering identical across all three | **yes** |

Tests: the latitude guard is asserted equal to a brute-force unguarded scan across five
seeds and four radii; `clusterPointsYielding` is asserted equal to `clusterPoints` and
proven to actually yield (a 1ms interval must fire during it).

## Decision Log

**Yield only, or also rewrite the clustering with a spatial index?**
Considered a grid index (exact, would take it well under a second on its own). Chose the
latitude guard plus yielding. The guard is a two-line, provably exact filter testable
against a brute-force reference; a grid index has to re-bucket centroids as they drift and
carries real correctness risk for an unattended reliability fix. The measured 9.7× makes
the index unnecessary for now. **Reversible** — the index can be added later behind the
same tests. Logged as a follow-up.

**Beat on a timer of its own, or on the existing lease check?**
Chose the existing 2-second lease check. A dedicated timer would be equivalent, but reusing
the one that already exists keeps the liveness signal and the abort signal on the same
clock, and adds no new timer to leak. **Reversible.**

**Rate window of one hour.**
Twelve per hour trips at one restart every five minutes. A slower loop — say one every six
minutes — would no longer trip, and is bounded instead by `stageBudgetMs` (up to 6h) and
the three-attempt limit on genuine failures. Accepted: killing healthy long runs is the
worse failure, and it is the one that actually happened. **Reversible** — the window is one
constant.

**Keep the synchronous `clusterPoints` even though production no longer calls it.**
It is the reference implementation the yielding driver is asserted against, which is the
whole basis for claiming the output is unchanged. Not dead code.

**Did not touch the probe threshold.** Raising 5,000ms would have masked both faults
rather than fixing them, and would have left a genuinely wedged process running longer.

## Not done here

- The context assembly is still ~18s per call; `fitToBudget` runs per call over identical
  input (backlog item 8). The batch registration makes that survivable, not fast.
- `daydream-detect` is on the same trajectory — 600s cadence, 8.9–10.8s per run, already
  blocking 2–3s.
- The policy worker still runs inside the web process (backlog item 12).
