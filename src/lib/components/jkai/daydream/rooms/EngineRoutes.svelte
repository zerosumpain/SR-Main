<script lang="ts">
  // Where each kind of thought is ALLOWED to go, as a grid you can set.
  //
  // `CategoryMatrix`'s look — a hairline grid of mono cells, families down the
  // side, three columns across — but its cells are counts and links, and these
  // are a choice, so this is its own grid of RADIOS. One row per family,
  // exceptions by kind underneath, and every row says where its answer came
  // from: your override, a default for the kind, a default for the family, or
  // the fallback. Without that line a grid of six identical selections cannot
  // tell you which one you actually made.
  //
  // Posting is `set_route` on `/api/daydream/thoughts`, the same contract the
  // engine's own reader uses; `route: null` clears the override rather than
  // writing the default in, so a later change to `DEFAULT_ROUTES` still moves.
  import {
    DEFAULT_FEED_KINDS,
    DEFAULT_ROUTES,
    ROUTE_OPTIONS,
    routeSource,
    type Route,
    type RouteOverrides,
  } from '$lib/daydream/routes';
  import { FAMILIES, FAMILY_MARK, FAMILY_ORDER, familyOf, kindLabel } from '$lib/daydream/thought-groups';
  import { postThought } from '$lib/daydream/feed-client';

  interface Props {
    routes: RouteOverrides;
    /** Every kind the engine knows about — the detector rows of this room. */
    kinds: string[];
    /** The page's `invalidateAll`; a route is server state, not local state. */
    onchanged: () => void;
  }

  let { routes, kinds, onchanged }: Props = $props();

  let busy = $state<string | null>(null);
  let routeError = $state<string | null>(null);
  /** The kind chosen in the "add an exception" select, before a route is picked. */
  let newKind = $state('');

  const FAMILY_IDS = new Set(Object.keys(FAMILIES));

  async function setRoute(key: string, route: Route | null) {
    busy = key;
    routeError = null;
    const r = await postThought({ action: 'set_route', key, route });
    if (!r.ok) routeError = r.error ?? 'that did not work';
    else onchanged();
    busy = null;
  }

  /** A family is a key in its own right, so it does not go through `routeFor`
   *  (which asks about a kind). Same precedence, one level shorter. */
  function familyRoute(fam: string): Route {
    return routes[fam] ?? DEFAULT_ROUTES[fam] ?? 'feed';
  }

  function familySourceWord(fam: string): string {
    if (routes[fam]) return 'your override';
    if (DEFAULT_ROUTES[fam]) return 'default';
    return 'the feed by default';
  }

  function kindSourceWord(kind: string): string {
    const src = routeSource(kind, routes);
    if (src === 'kind') return 'your override';
    if (src === 'family') return `your override on ${familyOf(kind).label.toLowerCase()}`;
    if (src === 'default-kind') return 'default';
    if (src === 'default-family') return 'family default';
    return 'the feed by default';
  }

  /** The effective route for a kind row. `routeFor` in one line, but written
   *  out so the row and the source word cannot disagree. */
  function kindRoute(kind: string): Route {
    const fam = familyOf(kind).id;
    return routes[kind] ?? routes[fam] ?? DEFAULT_ROUTES[kind] ?? DEFAULT_ROUTES[fam] ?? 'feed';
  }

  /** Kinds that earn a row: one you have set, or one the defaults name by kind
   *  (`mail_security`). Everything else is covered by its family. */
  const exceptionKinds = $derived.by(() => {
    const out = new Set<string>();
    for (const k of Object.keys(DEFAULT_ROUTES)) if (!FAMILY_IDS.has(k)) out.add(k);
    for (const k of Object.keys(routes)) if (!FAMILY_IDS.has(k)) out.add(k);
    return [...out].sort((a, b) => a.localeCompare(b));
  });

  /** Everything the engine could name that has no row yet. The detectors give
   *  the pattern and place kinds; the mail lanes only exist as defaults. */
  const addableKinds = $derived.by(() => {
    const listed = new Set(exceptionKinds);
    const out = new Set<string>();
    for (const k of [...kinds, ...DEFAULT_FEED_KINDS]) if (k && !listed.has(k) && !FAMILY_IDS.has(k)) out.add(k);
    return [...out].sort((a, b) => a.localeCompare(b));
  });
</script>

{#if routeError}<p class="err">{routeError}</p>{/if}

<div class="rt" role="group" aria-label="Routes by family">
  <div class="rt-head rt-corner">family</div>
  {#each ROUTE_OPTIONS as opt (opt)}
    <div class="rt-head">{opt}</div>
  {/each}
  <div class="rt-head rt-corner"></div>

  {#each FAMILY_ORDER as fam (fam)}
    {@const eff = familyRoute(fam)}
    <div class="rt-row">
      <span class="rt-mark">{FAMILY_MARK[fam] ?? ''}</span>
      <span class="rt-name">
        <span class="rt-label">{FAMILIES[fam].label}</span>
        <span class="rt-source">{familySourceWord(fam)}</span>
      </span>
    </div>
    {#each ROUTE_OPTIONS as opt (opt)}
      <label class="rt-cell" class:on={eff === opt}>
        <input
          class="rt-radio"
          type="radio"
          name="rt-fam-{fam}"
          value={opt}
          checked={eff === opt}
          disabled={busy === fam}
          onchange={() => setRoute(fam, opt)}
        />
        <span class="rt-box" aria-hidden="true"></span>
        <span class="rt-word">{opt}</span>
      </label>
    {/each}
    <div class="rt-reset">
      {#if routes[fam]}
        <button type="button" class="btn sm" disabled={busy === fam} onclick={() => setRoute(fam, null)}>
          reset
        </button>
      {/if}
    </div>
  {/each}
</div>

<p class="field-label rt-sub">Exceptions by kind</p>

<div class="rt" role="group" aria-label="Routes by kind">
  <div class="rt-head rt-corner">kind</div>
  {#each ROUTE_OPTIONS as opt (opt)}
    <div class="rt-head">{opt}</div>
  {/each}
  <div class="rt-head rt-corner"></div>

  {#each exceptionKinds as kind (kind)}
    {@const eff = kindRoute(kind)}
    <div class="rt-row">
      <span class="rt-mark">{FAMILY_MARK[familyOf(kind).id] ?? ''}</span>
      <span class="rt-name">
        <span class="rt-label">{kindLabel(kind)}</span>
        <span class="rt-source">{kindSourceWord(kind)}</span>
      </span>
    </div>
    {#each ROUTE_OPTIONS as opt (opt)}
      <label class="rt-cell" class:on={eff === opt}>
        <input
          class="rt-radio"
          type="radio"
          name="rt-kind-{kind}"
          value={opt}
          checked={eff === opt}
          disabled={busy === kind}
          onchange={() => setRoute(kind, opt)}
        />
        <span class="rt-box" aria-hidden="true"></span>
        <span class="rt-word">{opt}</span>
      </label>
    {/each}
    <div class="rt-reset">
      {#if routes[kind]}
        <button type="button" class="btn sm" disabled={busy === kind} onclick={() => setRoute(kind, null)}>
          reset
        </button>
      {/if}
    </div>
  {/each}

  <div class="rt-row rt-add">
    <select class="text-input select" aria-label="Add an exception" bind:value={newKind}>
      <option value="">add an exception…</option>
      {#each addableKinds as k (k)}
        <option value={k}>{kindLabel(k)}</option>
      {/each}
    </select>
  </div>
  {#each ROUTE_OPTIONS as opt (opt)}
    <label class="rt-cell" class:muted={!newKind}>
      <input
        class="rt-radio"
        type="radio"
        name="rt-new"
        value={opt}
        checked={false}
        disabled={!newKind || busy === newKind}
        onchange={() => {
          const k = newKind;
          newKind = '';
          void setRoute(k, opt);
        }}
      />
      <span class="rt-box" aria-hidden="true"></span>
      <span class="rt-word">{opt}</span>
    </label>
  {/each}
  <div class="rt-reset"></div>
</div>

<p class="note">
  A route is a ceiling, never a promise: whatsapp still needs a verified claim above the bar, a kind
  you have not rated down, and a free slot.
</p>

<style>
  .rt {
    display: grid;
    grid-template-columns: minmax(150px, 1.7fr) repeat(3, minmax(96px, 1fr)) minmax(58px, 0.5fr);
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
    overflow-x: auto;
    margin-top: 18px;
  }

  .rt-head,
  .rt-row,
  .rt-cell,
  .rt-reset {
    min-width: 0;
    background: var(--surface-card);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
  }

  .rt-head {
    background: var(--card-bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    justify-content: center;
  }
  .rt-corner {
    justify-content: flex-start;
    color: var(--text-ghost);
  }

  .rt-row {
    justify-content: flex-start;
  }
  .rt-mark {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    color: var(--accent-ink);
  }
  .rt-name {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .rt-label {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Where the answer came from. Muted mono, because it is the provenance of
     the selection and not a second selection. */
  .rt-source {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }

  .rt-cell {
    justify-content: center;
    position: relative;
    cursor: pointer;
    transition: background-color var(--t-fast) var(--ease-out);
  }
  .rt-cell:hover {
    background: var(--accent-tint-04);
  }
  .rt-cell.on {
    background: var(--accent-tint-08);
  }
  .rt-cell.muted {
    cursor: not-allowed;
    color: var(--text-ghost);
  }

  /* The native control stays in the tree — it is what makes this a radio group
     to a keyboard and a screen reader — and the square is what you see. */
  .rt-radio {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    margin: 0;
    pointer-events: none;
  }
  .rt-box {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    border: 1px solid var(--line-strong);
    background: var(--bg);
  }
  .rt-cell.on .rt-box {
    border-color: var(--accent);
    background: var(--accent);
  }
  .rt-radio:focus-visible + .rt-box {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .rt-word {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .rt-cell.on .rt-word {
    color: var(--text-primary);
  }

  .rt-reset {
    justify-content: flex-end;
  }

  .rt-add {
    padding: 10px 14px;
  }

  .rt-sub {
    margin: 22px 0 0;
  }

  /* On a phone the grid scrolls inside its own box rather than squeezing three
     route words into a 60px track; `.rt` is `overflow-x: auto`, so the page
     never scrolls sideways. */
  @media (max-width: 560px) {
    .rt {
      grid-template-columns: minmax(120px, 1.4fr) repeat(3, minmax(88px, 1fr)) minmax(52px, 0.5fr);
    }
    .rt-head,
    .rt-row,
    .rt-cell,
    .rt-reset {
      padding: 10px 8px;
    }
    .rt-word {
      display: none;
    }
  }
</style>
