<script lang="ts">
  // The Intel workbench nav.
  //
  // Nine surfaces used to be reachable only as six unlabelled text links on the
  // landing page, which is why nobody could say when to use the timeline rather
  // than a dossier, or Quality rather than Triage. The fix is not more links —
  // it is saying, on every page, what QUESTION each surface answers and where
  // the one you are on sits in the loop.
  //
  // The loop, and it is a loop:
  //   capture → triage → repair → explore → collect → act
  //
  // Counts come from the intel layout load (`intelCounts`), which is nine COUNT
  // queries and nothing else — a nav badge must never cost an analytics run.

  import { page } from '$app/state';
  import { SURFACES, type IntelCounts } from './workbench';

  let { counts }: { counts: IntelCounts } = $props();

  const path = $derived(page.url.pathname);

  /** Longest matching href wins, so /intel/notes/new stays on Notes. */
  const active = $derived.by(() => {
    let best: (typeof SURFACES)[number] | null = null;
    for (const s of SURFACES) {
      const matches = s.href === '/jkai/intel' ? path === s.href : path.startsWith(s.href);
      if (matches && (!best || s.href.length > best.href.length)) best = s;
    }
    return best;
  });

  function badge(key: keyof IntelCounts | undefined): number | null {
    if (!key) return null;
    const value = counts?.[key];
    return typeof value === 'number' ? value : null;
  }
</script>

<nav class="wb" aria-label="Intel surfaces">
  <div class="wb-row">
    {#each SURFACES as surface (surface.href)}
      {@const n = badge(surface.count)}
      <a
        class="wb-tab"
        class:on={active?.href === surface.href}
        class:alert={!!surface.warnAbove && n !== null && n > surface.warnAbove}
        href={surface.href}
        title={surface.question}
      >
        <span class="wb-stage">{surface.stage}</span>
        <span class="wb-label">{surface.label}</span>
        {#if n !== null}<span class="wb-n">{n}</span>{/if}
      </a>
    {/each}
  </div>
  {#if active}
    <p class="wb-why"><span class="wb-why-k">{active.stage}</span>{active.question}</p>
  {/if}
</nav>

<style>
  .wb {
    flex: none;
    padding: 8px 20px 9px;
    border-bottom: 1px solid var(--divider);
  }
  .wb-row {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .wb-tab {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 5px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    text-decoration: none;
    color: var(--text-muted);
    transition: color var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out);
  }
  .wb-tab:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
  .wb-tab.on {
    color: var(--text-primary);
    border-color: var(--card-border);
    background: var(--card-bg);
  }

  /* The stage marker is what turns nine links into one sequence. */
  .wb-stage {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .wb-tab.on .wb-stage {
    color: var(--accent);
  }
  .wb-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .wb-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .wb-tab.alert .wb-n {
    color: var(--warn);
  }

  .wb-why {
    margin: 6px 0 0;
    font-size: var(--fs-label);
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .wb-why-k {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    margin-right: 8px;
  }

  @media (max-width: 799px) {
    .wb {
      padding: 8px 16px;
    }
    .wb-why {
      display: none;
    }
  }
</style>
