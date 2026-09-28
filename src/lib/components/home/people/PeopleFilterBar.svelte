<script lang="ts">
  /**
   * The dashboard's one row of filters, sticky under the site bar: whose
   * movement and how much history. Links, not buttons — the load reads
   * `?person=` and `?days=`, so every view is a URL and the back button works.
   * Only people this viewer may open are offered (the load decided that).
   */
  let {
    people,
    person,
    days,
    windows,
    hrefFor,
    checkedAt,
  }: {
    people: Array<{ subject: string; label: string }>;
    person: string | null;
    days: number;
    windows: readonly number[];
    hrefFor: (next: { person?: string | null; days?: number }) => string;
    checkedAt: string | null;
  } = $props();
</script>

<div class="pf" role="toolbar" aria-label="Filter the dashboard">
  <nav class="pf-people" aria-label="Whose movement">
    <a href={hrefFor({ person: null })} aria-current={person == null ? 'page' : undefined} data-sveltekit-noscroll>Everyone</a>
    {#each people as p (p.subject)}
      <a href={hrefFor({ person: p.subject })} aria-current={person === p.subject ? 'page' : undefined} data-sveltekit-noscroll>{p.label}</a>
    {/each}
  </nav>
  <nav class="pf-days" aria-label="History">
    {#each windows as w (w)}
      <a href={hrefFor({ days: w })} aria-current={days === w ? 'page' : undefined} data-sveltekit-noscroll>{w}d</a>
    {/each}
  </nav>
  {#if checkedAt}<span class="pf-stamp">Checked {checkedAt} · London</span>{/if}
</div>

<style>
  .pf {
    position: sticky;
    top: calc(var(--site-nav-height, 0px) + env(safe-area-inset-top, 0px));
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 10px clamp(16px, 3vw, 44px);
    background: var(--surface-card);
    border-bottom: 1px solid var(--line-strong);
  }
  .pf-people,
  .pf-days {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pf-people a {
    font: 500 var(--fs-nav) var(--font-body);
    padding: 5px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 100px;
    color: var(--text-primary);
    text-decoration: none;
  }
  .pf-people a[aria-current] {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .pf-days {
    gap: 0;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
  }
  .pf-days a {
    font: 500 var(--fs-label) var(--font-mono);
    padding: 6px 10px;
    color: var(--text-primary);
    text-decoration: none;
  }
  .pf-days a[aria-current] {
    background: var(--accent);
    color: var(--bg);
  }
  a:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .pf-stamp {
    margin-left: auto;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
  }
  @media (max-width: 720px) {
    .pf-stamp {
      margin-left: 0;
      width: 100%;
    }
  }
</style>
