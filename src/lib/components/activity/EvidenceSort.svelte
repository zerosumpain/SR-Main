<script lang="ts">
  import type { activityEventSort } from '$lib/activity/contracts/query';
  let { ordering, preserve = {} }: {
    ordering: ReturnType<typeof activityEventSort>;
    preserve?: Record<string, string | null | undefined>;
  } = $props();
</script>

<form method="GET" class="evidence-sort" aria-label="Sort evidence" data-sveltekit-noscroll>
  {#each Object.entries(preserve) as [name, value] (name)}
    {#if value}<input type="hidden" {name} {value} />{/if}
  {/each}
  <label>Sort by
    <select name="sort" value={ordering.sort}>
      <option value="occurred">Date occurred</option>
      <option value="observed">Date observed</option>
    </select>
  </label>
  <label>Then by (ties)
    <select name="then" value={ordering.then ?? ''}>
      <option value="">No second date</option>
      <option value="occurred">Date occurred</option>
      <option value="observed">Date observed</option>
    </select>
  </label>
  <label>Order
    <select name="direction" value={ordering.direction}>
      <option value="desc">Newest first</option>
      <option value="asc">Oldest first</option>
    </select>
  </label>
  <button type="submit">Apply order</button>
  <p>Occurred: when it happened. Observed: when the source was seen by JKAI. Unknown dates sort last.</p>
</form>

<style>
  .evidence-sort { display: flex; flex-wrap: wrap; align-items: end; gap: 16px; margin: 16px 0 0; padding: 16px; background: var(--surface-rail); border-block: 1px solid var(--line-strong); }
  label { display: grid; gap: 6px; flex: 1 1 170px; color: var(--text-secondary); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: .06em; }
  select { width: 100%; min-height: 44px; padding: 8px; background: var(--bg); border: 1px solid var(--line-strong); border-radius: 0; color: var(--text-primary); font: inherit; font-size: var(--fs-body); letter-spacing: normal; }
  button { min-height: 44px; padding: 8px 16px; background: var(--accent); color: var(--bg); border: 1px solid var(--accent); font-family: var(--font-body); font-size: var(--fs-body); cursor: pointer; }
  button:hover { background: var(--accent-hover); }
  p { flex-basis: 100%; margin: 0; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; }
  :is(select, button):focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 3px; }
</style>
