<script lang="ts">
  // OnTheSite — the routes on the real site that this page accounts for, from the route
  // ledger joined to the deployed build's manifest (facts.server.ts). A route the build stops
  // serving drops off this list on the next deploy; one the ledger hasn't placed fails the
  // drift test before it gets that far. Paths are shown, never linked: none of them are public.
  //
  // Set as a ledger, /health's tripwire table: the path and its methods, the plain sentence in
  // body type in its own column, and who may use it.
  import { WHO_LABEL, type Who } from '../lib/routes';

  interface RouteFact { path: string; kind: 'api' | 'page'; methods: string[]; who: Who; what: string }
  let { routes, title = 'Where this lives on the real site', compact = false }: { routes: RouteFact[]; title?: string; compact?: boolean } = $props();
</script>

{#if routes.length}
  <section class="ots" class:compact aria-label={title}>
    <h2 class="ots-h">{title} <span class="ots-n">{routes.length}</span></h2>
    {#if !compact}<p class="ots-sub">Every page and endpoint this chapter accounts for, as the deployed site serves them. None are public, so none are links.</p>{/if}
    <ul class="ots-list">
      {#each routes as r (r.path)}
        <li class="ots-row">
          <span class="ots-sig">
            {#if r.kind === 'api' && r.methods.length}<span class="ots-m">{r.methods.join(' · ')}</span>{:else}<span class="ots-m pg">PAGE</span>{/if}
            <code class="ots-path">{r.path}</code>
          </span>
          <span class="ots-what">{r.what}</span>
          <span class="ots-who" data-who={r.who}>{WHO_LABEL[r.who]}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .ots-h { font-family: var(--er-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--fg-2); margin: 0 0 6px; display: flex; align-items: center; gap: 10px; }
  .ots-n { display: inline-grid; place-items: center; min-width: 26px; height: 22px; padding: 0 6px; border-radius: var(--radius-pill); background: var(--fg); color: var(--ground); font-size: var(--fs-label-xs); }
  .ots-sub { margin: 0 0 16px; font-size: var(--fs-label); color: var(--fg-3); }
  .ots-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--rule-strong); }
  .ots-row { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(30ch, 1.6fr) 18ch; gap: 6px 22px; align-items: start;
    padding: 12px 0; border-bottom: 1px solid var(--rule); }
  .ots-sig { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .ots-m { font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; color: var(--tone-text); }
  .ots-m.pg { color: var(--fg-3); }
  .ots-path { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg); overflow-wrap: anywhere; }
  .ots-what { font-size: var(--fs-label); color: var(--fg-2); line-height: 1.5; }
  .ots-who { font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); text-align: right; }
  .ots-who[data-who='owner'] { color: var(--you); }
  .compact .ots-row { padding: 9px 0; }
  @media (max-width: 760px) {
    .ots-row { grid-template-columns: minmax(0, 1fr); }
    .ots-who { text-align: left; }
  }
</style>
