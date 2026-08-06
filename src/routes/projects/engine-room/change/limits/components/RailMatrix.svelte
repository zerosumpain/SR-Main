<script lang="ts">
  // RailMatrix — eighteen guardrails placed on two axes.
  //
  // Across: does it hold regardless of intent (a boundary) or does it ask (a request).
  // Down: does a documented incident stand behind it, or not.
  //
  // The old version of this page was eighteen cards, each carrying a paragraph — 2,478 words
  // rendered at once, and the ratio the whole section is about was invisible inside them.
  // Here the eighteen are a shape you can read in a second, and exactly one detail is on
  // screen at a time, on demand.
  //
  // The three text maps below are the constants' own `detail` and `scar` fields compressed to
  // a third of their length. No fact is added, changed or specified any further: this page is
  // public, so every guardrail is described by shape only.
  import { RAILS, type Kind, type Rail } from '../../../lib/guardrails';

  type Filter = 'all' | 'boundary' | 'request' | 'scar';
  interface Props {
    /** Owned by the page so the filter buttons can live in the instrument frame. */
    filter?: Filter;
    tone?: string;
  }
  let { filter = 'all', tone = '#8a2d3a' }: Props = $props();

  /** Each rail's own `rail` line, cut to three or four words. The full line is in the panel. */
  const TAG: Record<string, string> = {
    secrets: 'Use, never read',
    newcred: 'Create ≠ rotate',
    destructive: 'Confirm before deleting',
    ssrf: 'No internal addresses',
    rebind: 'Pin the address',
    apisurface: 'No parameter for it',
    argscan: 'Scan the arguments',
    redact: 'Redact the URL too',
    sandbox: 'Runs in a container',
    scan: 'Deny-list before compiling',
    merge: 'Cannot widen itself',
    visibility: 'Private means not found',
    surface: 'Public surface locked',
    login: 'Deny by default',
    traversal: 'Paths stay under root',
    rate: 'Per-client buckets',
    escape: 'Escape before formatting',
    sensitive: 'Heuristic detector'
  };

  const DETAIL: Record<string, string> = {
    secrets:
      'A registry holds the credential; the value is attached at the last moment and never enters a prompt, so it cannot be repeated back.',
    newcred:
      'Asking for a missing one opens a prompt for a human; the agent never writes the registry. Creating and rotating stay separate — conflating them destroys a working secret.',
    destructive:
      'Gated where every route to a tool must pass, not inside any one caller. With nobody present to confirm, it refuses.',
    ssrf:
      'A tool that fetches a URL will fetch an internal one if a poisoned page asks nicely enough. Private ranges are refused before the request is made.',
    rebind:
      'Checking a hostname then fetching it resolves twice, and the two answers need not agree. The guard returns the address it approved; the connection is pinned to it.',
    apisurface:
      'The tool has no field for the host binding — nothing in the call can re-point it. Widening reach is a separate operation, typed by the owner.',
    argscan:
      'Arguments reach the live event stream before the handler runs, so a key in a free-text field has already leaked. Those tools refuse, rather than sanitise.',
    redact:
      'The credential becomes part of the URL, so the scrubber runs over the composed URL and every error quoting it — and over its encoded form.',
    sandbox:
      'Everything the builder writes executes inside a sandbox container. The isolation is the container, not an instruction.',
    scan:
      'Forbidden constructs, matched against raw text before anything is compiled. Deny beats allow: an unknown construct is refused rather than permitted.',
    merge:
      'The sandbox, the confirmation gate and the tool deny-list are all protected paths. A change touching them can never be auto-merged, only proposed.',
    visibility:
      'Every project page runs the same guard, returning a not-found to anonymous visitors of a private one. Going private also purges the cached copies at the edge.',
    surface:
      'The set of routes reachable without a session is recorded in the repository. Any change to it fails the gate with a diff, and has to be acknowledged deliberately.',
    login:
      'Sign-in succeeds only for addresses on a list. The default for an unknown one is refusal, not access.',
    traversal:
      'Files for a published project are read from disk at request time, so the resolved path is verified to sit under the intended directory first.',
    rate: 'Public endpoints that reach a model — including this study’s own Ask dock — are limited per client, keyed on the real client address rather than the tunnel’s.',
    escape:
      'Anything a model wrote is escaped before any formatting is applied, and only a small explicit subset is re-enabled. Escaping after formatting is not escaping.',
    sensitive:
      'Content bound for a public surface is checked for what should not leave. Heuristic, wrong in both directions — the real control is a human reading it first.'
  };

  const SCAR: Record<string, string> = {
    destructive:
      'It sat in a legacy handler the live path no longer went through, and looked healthy for weeks. A guardrail in the wrong layer is indistinguishable from none.',
    ssrf: 'The first version checked the form a human types, not the form every caller passes. Validate the string your callers actually produce.',
    rebind:
      'This is what makes most hand-rolled outbound filters decorative: right about everything they check, and in control of nothing after they finish.',
    apisurface:
      'A policy became a type signature — the model cannot express the dangerous thing. That survives the model getting cleverer; a validation rule may not.',
    argscan:
      'The difference between a control that is theoretically right and one that has been probed. The exemption is documented with the string that broke it.',
    redact:
      'Most redaction helpers scrub the response body and miss the two places the value actually appears.',
    surface:
      'Two allow-lists exist for historical reasons and only one matches by prefix — the symptom being a login page where something was meant to be open.',
    sensitive:
      'Copies of a detector drift apart. The one that matters is on the path that actually publishes — not always the first you find.'
  };

  const quad = (kind: Kind, scarred: boolean) =>
    RAILS.filter((r) => r.kind === kind && !!r.scar === scarred);

  const CELL = {
    bScar: quad('boundary', true),
    bClean: quad('boundary', false),
    rScar: quad('request', true),
    rClean: quad('request', false)
  };

  const nBoundary = CELL.bScar.length + CELL.bClean.length;
  const nRequest = CELL.rScar.length + CELL.rClean.length;
  const nScar = CELL.bScar.length + CELL.rScar.length;
  const nClean = CELL.bClean.length + CELL.rClean.length;

  const matches = (r: Rail) =>
    filter === 'all' || (filter === 'scar' ? !!r.scar : r.kind === filter);
  const live = (...groups: Rail[][]) =>
    groups.reduce((n, g) => n + g.filter(matches).length, 0);

  // Selection is by id, but the panel reads through the filter: a rail that has been filtered
  // out cannot be the one on show. Derived, never an effect — no state written while reading.
  let picked = $state<string | null>(null);
  const chosen = $derived(RAILS.find((r) => r.id === picked && matches(r)) ?? null);
</script>

{#snippet chip(r: Rail)}
  <button
    class="chip"
    class:on={chosen?.id === r.id}
    class:scarred={!!r.scar}
    class:dim={!matches(r)}
    disabled={!matches(r)}
    aria-pressed={chosen?.id === r.id}
    title={r.risk}
    aria-label="{TAG[r.id] ?? r.rail} — {r.kind}{r.scar ? ', written by an incident' : ''}"
    onclick={() => (picked = picked === r.id ? null : r.id)}>{TAG[r.id] ?? r.rail}</button>
{/snippet}

<div class="mx" style="--tone:{tone}">
  <div
    class="grid"
    role="group"
    aria-label="{RAILS.length} guardrails plotted by kind and by origin: {nBoundary} boundaries and {nRequest} request; {nScar} were written by an incident, {nClean} have no incident recorded.">
    <span class="corner" aria-hidden="true"></span>

    <div class="ch cb">
      <b>Boundary</b><em>holds regardless of intent</em>
      <span class="n">{live(CELL.bScar, CELL.bClean)}</span>
    </div>
    <div class="ch cr">
      <b>Request</b><em>asks the model nicely</em>
      <span class="n">{live(CELL.rScar, CELL.rClean)}</span>
    </div>

    <div class="rh r1">
      <b>Written by an incident</b><span class="n">{live(CELL.bScar, CELL.rScar)}</span>
    </div>
    <div class="q qb1 hot">{#each CELL.bScar as r (r.id)}{@render chip(r)}{/each}</div>
    <div class="q qr1 hot">{#each CELL.rScar as r (r.id)}{@render chip(r)}{/each}</div>

    <!-- The complement of a scar is "nothing documented", not "designed perfectly": the
         label says only what the constants support. -->
    <div class="rh r2">
      <b>No incident recorded</b><span class="n">{live(CELL.bClean, CELL.rClean)}</span>
    </div>
    <div class="q qb2">{#each CELL.bClean as r (r.id)}{@render chip(r)}{/each}</div>
    <div class="q qr2">
      {#each CELL.rClean as r (r.id)}{@render chip(r)}{/each}
      {#if !CELL.rClean.length}<span class="none" aria-hidden="true">–</span>{/if}
    </div>
  </div>

  <div class="det" class:open={!!chosen} aria-live="polite">
    {#if chosen}
      <div class="d-tags">
        <span class="d-kind" data-kind={chosen.kind}>{chosen.kind}</span>
        {#if chosen.scar}<span class="d-scarmark">written by an incident</span>{/if}
      </div>
      <p class="d-risk"><span class="lab">Risk</span>{chosen.risk}</p>
      <p class="d-rail">{chosen.rail}</p>
      <p class="d-body">{DETAIL[chosen.id] ?? chosen.detail}</p>
      <!-- The detail panel is the page's word budget: one rail on screen, never eighteen. -->
      {#if chosen.scar}
        <p class="d-scar"><span class="lab">Scar</span>{SCAR[chosen.id] ?? chosen.scar}</p>
      {/if}
    {:else}
      <p class="d-idle">Pick any square.</p>
    {/if}
  </div>
</div>

<style>
  .mx { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

  .grid { display: grid; grid-template-columns: minmax(0, 11ch) minmax(0, 1fr) minmax(96px, 0.17fr);
    gap: 6px 8px; align-items: stretch; min-width: 0; }

  .corner { grid-column: 1; grid-row: 1; }
  .cb { grid-column: 2; grid-row: 1; }
  .cr { grid-column: 3; grid-row: 1; }
  .r1 { grid-column: 1; grid-row: 2; }
  .qb1 { grid-column: 2; grid-row: 2; }
  .qr1 { grid-column: 3; grid-row: 2; }
  .r2 { grid-column: 1; grid-row: 3; }
  .qb2 { grid-column: 2; grid-row: 3; }
  .qr2 { grid-column: 3; grid-row: 3; }

  .ch { display: flex; flex-direction: column; gap: 1px; padding: 0 0 5px 2px;
    border-bottom: 1px solid rgba(28,22,17,0.18); position: relative; }
  .ch b { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--tone); }
  .ch em { font-style: normal; font-size: 11px; line-height: 1.35; color: rgba(28,22,17,0.55); }
  .ch .n { position: absolute; right: 2px; top: -2px; font-family: 'JetBrains Mono', monospace;
    font-size: 15px; font-weight: 600; color: var(--text-primary); }

  .rh { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 4px 6px 4px 0;
    border-right: 1px solid rgba(28,22,17,0.18); text-align: right; }
  .rh b { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.6); line-height: 1.45; }
  .rh .n { font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 600; color: var(--text-primary); }

  .q { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 5px; min-width: 0;
    min-height: 46px; padding: 7px; border: 1px solid rgba(28,22,17,0.12);
    border-radius: var(--radius-round); background: rgba(255,255,255,0.4); }
  .q.hot { background: color-mix(in srgb, var(--tone) 7%, rgba(255,255,255,0.4));
    border-color: color-mix(in srgb, var(--tone) 32%, transparent); }
  .none { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: rgba(28,22,17,0.3); margin: auto; }

  .chip { font-family: 'DM Sans', sans-serif; font-size: 12px; line-height: 1.25; text-align: left;
    color: var(--text-primary); background: rgba(255,255,255,0.75);
    border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-pill);
    padding: 5px 11px; cursor: pointer; min-width: 0; max-width: 100%; overflow-wrap: anywhere;
    transition: background 0.12s, border-color 0.12s, opacity 0.14s; }
  .chip.scarred { border-left: 3px solid var(--tone); }
  .chip:not(:disabled):hover { background: #fff; border-color: rgba(28,22,17,0.42); }
  .chip:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
  .chip.on { background: var(--tone); border-color: var(--tone); color: #fff; }
  .chip.dim { opacity: 0.22; cursor: default; }

  .det { border: 1px dashed rgba(28,22,17,0.2); border-radius: var(--radius-round);
    padding: 11px 13px; min-height: 132px; min-width: 0; }
  .det.open { border-style: solid; border-left: 3px solid var(--tone); background: rgba(255,255,255,0.6); }
  .d-idle { margin: 0; font-size: 12.5px; color: rgba(28,22,17,0.5); }

  .d-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
  .d-kind, .d-scarmark { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; padding: 3px 8px; border-radius: var(--radius-pill); }
  .d-kind { background: color-mix(in srgb, var(--tone) 16%, transparent); color: var(--tone); }
  .d-kind[data-kind='request'] { background: rgba(28,22,17,0.09); color: rgba(28,22,17,0.62); }
  .d-scarmark { border: 1px solid color-mix(in srgb, var(--tone) 40%, transparent); color: var(--tone); }

  .d-risk, .d-rail, .d-body, .d-scar { margin: 0 0 6px; min-width: 0; max-width: 84ch; }
  .d-risk { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.62); }
  .d-rail { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; line-height: 1.3;
    color: var(--text-primary); }
  .d-body { font-size: 13px; line-height: 1.58; color: rgba(28,22,17,0.78); }
  .d-scar { font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.72);
    padding-top: 7px; border-top: 1px dashed rgba(28,22,17,0.18); margin-bottom: 0; }
  .lab { display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--tone); margin-right: 7px; }

  @media (max-width: 620px) {
    .grid { grid-template-columns: minmax(0, 1fr) minmax(94px, 0.34fr); }
    .corner { display: none; }
    .cb { grid-column: 1; grid-row: 1; }
    .cr { grid-column: 2; grid-row: 1; }
    .rh { grid-column: 1 / -1; text-align: left; border-right: none;
      border-left: 3px solid color-mix(in srgb, var(--tone) 45%, transparent);
      padding: 2px 0 2px 8px; flex-direction: row; align-items: baseline; gap: 8px; }
    .r1 { grid-row: 2; }
    .qb1 { grid-column: 1; grid-row: 3; }
    .qr1 { grid-column: 2; grid-row: 3; }
    .r2 { grid-row: 4; }
    .qb2 { grid-column: 1; grid-row: 5; }
    .qr2 { grid-column: 2; grid-row: 5; }
    .chip { font-size: 11.5px; padding: 4px 9px; }
  }
</style>
