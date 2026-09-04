# Pinning `@asamuzakjp/css-color` — the CI build flake

**Status:** shipped 2026-09-04.
**Brief:** John — *"pin that css-color dep"*, after the Build job died twice in
one afternoon and passed on re-run both times.

## The failure

```
Error [ERR_INTERNAL_ASSERTION]: Cannot require() ES Module
  .../node_modules/lru-cache/dist/esm/index.min.js
  because it is not yet fully loaded. This may be caused by a race condition if
  the module is simultaneously dynamically import()-ed via Promise.all().
  (from .../node_modules/@asamuzakjp/css-color/dist/esm/js/cache.js)
This is caused by either a bug in Node.js or incorrect usage of Node.js internals.
```

Node 22.22.3, GitHub-hosted runner, mid `vite build`. Green on the re-run both
times, and green on porkserv on every one of six runs the same afternoon.

## Why it happens

```
jsdom 29.0.1          CommonJS   ─ requires ─▶
@asamuzakjp/css-color 5.0.1   pure ESM   ─ imports ─▶   lru-cache 11.2.7  ESM
```

`jsdom` is CommonJS and depends on `css-color` **directly** (no `cssstyle` in
between at v29). `css-color` is `"type": "module"` with an ESM-only `exports`
map — in **every** version of the `^5.0.1` range jsdom declares, and in 4.x, 6.x
and 7.x too. So Node has to use `require(esm)` to load it, and line 1 of the
file the error names was:

```js
import { LRUCache } from "lru-cache";
```

`lru-cache` is pulled by **seven** other places in this tree — jsdom itself,
`@asamuzakjp/dom-selector`, `baileys`, three copies of `path-scurry`,
`@babel/helper-compilation-targets`. When any of those is being `import()`-ed
concurrently, the `require()` above lands on a half-initialised module and
Node's loader asserts. That is the whole flake: same versions, same code,
different module-loading interleaving.

## Why "pin css-color" alone could not have worked

The obvious reading — hold the version steady — was already true.
`package-lock.json` pinned 5.0.1 and CI runs `npm ci`, so every build already
installed exactly that. **Version drift was never the cause.** And every version
in jsdom's range is pure ESM, so no choice of 5.x removes the `require(esm)`
hop.

What does remove it **on this path**: 5.1.11 dropped `lru-cache` in favour of
`@asamuzakjp/generational-cache`. That package has no dependencies and exactly
one consumer, so nothing else in the tree can be importing it concurrently —
the precondition for the assertion is gone on that edge rather than made less
likely. 5.1.11 satisfies jsdom's `^5.0.1`, so jsdom is untouched.

## What this does NOT close, and why nothing can

With the pin applied, the gate on porkserv failed the same way — and the
attribution had **moved**:

```
(from .../node_modules/@asamuzakjp/dom-selector/src/index.js)
```

`jsdom` has a second pure-ESM dependency by the same author, and it imports
`lru-cache` too. Measured:

| | verdict |
|---|---|
| `@asamuzakjp/dom-selector` 7.0.3 / 7.0.4 / 7.1.0 (all of jsdom's `^7.0.3`) | `type: module`, ships raw `src/*.js`, **keeps `lru-cache` in every version, including latest 9.0.4** |
| `@asamuzakjp/css-color` 4.x / 5.0.x / 6.x / 7.x | pure ESM throughout; **7.0.0 takes `lru-cache` back** |
| `jsdom` 30.0.1 (latest) | still `type: commonjs`, still depends on **both** ESM packages |
| Node | fired on **22.22.3** (CI) and **22.23.2** (porkserv) — a newer runtime is not the fix |

So the structural cause — a CommonJS `jsdom` requiring pure-ESM packages that
import the widely-shared `lru-cache`, under a Node `require(esm)` race — cannot
be removed by pinning. **This change halves the exposed surface; it does not
eliminate it.** It is worth having because css-color is the path that actually
fired in CI, both times.

Closing it properly means one of: dropping `jsdom` for the three server modules
that use it (`webframe/extract`, `jkai/extract/url`, `deepdive/extract-local`),
or a Node fix landing upstream. Neither is this change.

## What the probe showed

A plain `vite build` on porkserv, instrumented to log the first `require()` of
`jsdom`, `dom-selector`, `css-color` or `lru-cache`, loads **none of them
except `lru-cache` from `path-scurry`** — CommonJS to CommonJS, which is safe.
So the failing `require()` is not the app's module graph being evaluated; it
comes from somewhere else in the build process, and the initiator is still
unidentified. That is the missing piece if anyone picks this up again.

## The pin

```json
"overrides": { "@asamuzakjp/css-color": "^5.1.11" }
```

A floor, not an exact pin: patches inside 5.1.x are wanted, and the constraint
being expressed is "at or above the release that dropped lru-cache".

**Not 6.x or 7.x.** `7.0.0` takes `lru-cache` back (`"lru-cache": "^11.5.2"`),
so newest-is-best is wrong here and an unbounded range would eventually
reintroduce the bug.

## A footgun found on the way

npm parses **every** key inside `overrides` as a package spec. Adding a
`"//@asamuzakjp/css-color": "…why…"` comment entry — the convention this
repo's own `jkai` block uses — makes `npm install --package-lock-only`
resolve an **empty tree** and rewrite `package-lock.json` from 1,194 packages
to two, with no error and a cheerful "up to date, audited 1 package".

Comment keys are safe in a custom top-level block that npm ignores. They are
not safe in `overrides`, `dependencies`, or `devDependencies`. That is why the
explanation lives in this file instead.
