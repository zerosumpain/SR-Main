<script lang="ts">
  // OnTheSite — the routes on the real site that this page accounts for, from the route
  // ledger joined to the deployed build's manifest (facts.server.ts). A route the build stops
  // serving drops off this list on the next deploy; one the ledger hasn't placed fails the
  // drift test before it gets that far. Paths are shown, never linked: none of them are public.
  import { WHO_LABEL, type Who } from '../lib/routes';

  interface RouteFact { path: string; kind: 'api' | 'page'; methods: string[]; who: Who; what: string }
  let { routes, title = 'On the site' }: { routes: RouteFact[]; title?: string } = $props();
</script>

{#if routes.length}
  <section class="ots" aria-label={title}>
    <h2 class="ots-h">{title}</h2>
    <ul class="ots-list">
      {#each routes as r (r.path)}
        <li class="ots-row">
          <code class="ots-path">{r.kind === 'api' && r.methods.length ? `${r.methods.join(' ')} ` : ''}{r.path}</code>
          <span class="ots-what">{r.what}</span>
          <span class="ots-who">{WHO_LABEL[r.who]}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .ots { margin: 26px 0 0; }
  .ots-h { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: 0.12em;
    text-transform: uppercase; color: rgba(28,22,17,0.6); margin: 0 0 8px; }
  .ots-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid rgba(28,22,17,0.12); }
  .ots-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) auto; gap: 4px 14px; align-items: baseline;
    padding: 7px 0; border-bottom: 1px solid rgba(28,22,17,0.08); }
  .ots-path { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-primary); overflow-wrap: anywhere; }
  .ots-what { font-size: var(--fs-label); color: rgba(28,22,17,0.8); line-height: 1.4; }
  .ots-who { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); white-space: nowrap; }
  @media (max-width: 640px) {
    .ots-row { grid-template-columns: minmax(0, 1fr); }
    .ots-who { white-space: normal; }
  }
</style>
