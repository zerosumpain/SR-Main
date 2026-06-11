<script lang="ts">
  // ThemeRail — a thin "this study sits on these cross-cutting threads" rail for a study
  // masthead. Surfaces the themes (from themes.ts) that run through the current route and
  // links into the Themes synthesis. Keeps the second spine visible without a parallel nav.
  // Self-contained.
  import { themesForRoute, type Theme } from '../lib/themes.ts';

  interface Props { route: string; }
  let { route }: Props = $props();
  const themes = $derived<Theme[]>(themesForRoute(route));
  const noteFor = (t: Theme) => t.recurs.find((s) => s.route.replace(/\/$/, '') === route.replace(/\/$/, ''))?.note ?? t.tagline;
</script>

{#if themes.length}
  <div class="trail">
    <span class="tr-lab">Threads through this study</span>
    <div class="tr-items">
      {#each themes as t (t.id)}
        <a class="tr-item" href={`/projects/policy-engine/themes#${t.id}`} style="--c:{t.color}" title={noteFor(t)}>
          <span class="tr-dot"></span>{t.title}
        </a>
      {/each}
    </div>
  </div>
{/if}

<style>
  .trail { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 8px 0 0; }
  .tr-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.45); }
  .tr-items { display: flex; flex-wrap: wrap; gap: 6px; }
  .tr-item {
    display: inline-flex; align-items: center; gap: 5px; text-decoration: none;
    font-family: 'DM Sans', system-ui, sans-serif; font-size: 11px; color: var(--ink, #1c1611);
    background: color-mix(in srgb, var(--c) 9%, transparent); border: 1px solid color-mix(in srgb, var(--c) 35%, transparent);
    border-radius: 20px; padding: 2px 9px; transition: background 0.12s;
  }
  .tr-item:hover { background: color-mix(in srgb, var(--c) 18%, transparent); }
  .tr-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--c); }
</style>
