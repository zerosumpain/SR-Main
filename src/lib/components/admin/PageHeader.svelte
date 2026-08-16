<script lang="ts">
  type Crumb = { label: string; href?: string };
  let {
    kicker,
    title,
    sub,
    crumbs,
    actions,
  }: {
    kicker?: string;
    title: string;
    sub?: string;
    crumbs?: Crumb[];
    actions?: import('svelte').Snippet;
  } = $props();
</script>

<header class="page-hdr">
  <div class="page-hdr-main">
    {#if crumbs && crumbs.length > 0}
      <nav class="crumbs" aria-label="Breadcrumb">
        {#each crumbs as c, i}
          {#if c.href}<a href={c.href} class="crumb">{c.label}</a>{:else}<span class="crumb">{c.label}</span>{/if}
          {#if i < crumbs.length - 1}<span class="crumb-sep">/</span>{/if}
        {/each}
      </nav>
    {/if}
    {#if kicker}<div class="kicker">{kicker}</div>{/if}
    <h1 class="title">{title}</h1>
    {#if sub}<p class="sub">{sub}</p>{/if}
  </div>
  {#if actions}
    <div class="page-hdr-actions">{@render actions()}</div>
  {/if}
</header>

<style>
  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.75rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .page-hdr-main { min-width: 0; }
  .crumbs {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--text-ghost);
    margin-bottom: 0.5rem;
  }
  .crumb { color: var(--text-muted); }
  a.crumb:hover { color: var(--accent); }
  .crumb-sep { color: var(--text-ghost); }
  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.4rem;
  }
  .title {
    margin: 0;
    font-family: var(--font-brand);
    font-size: 1.75rem;
    font-weight: 500;
    line-height: 1.1;
    color: var(--text-primary);
    text-transform: lowercase;
    letter-spacing: -0.01em;
    display: inline-flex;
    align-items: baseline;
    gap: 0.45ch;
  }
  .title::before {
    content: '>';
    color: var(--accent);
    opacity: 0.7;
    font-weight: 500;
  }
  .sub {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--text-secondary);
    max-width: 60ch;
  }
  .page-hdr-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    .page-hdr {
      flex-direction: column;
      align-items: flex-start;
    }
    .title { font-size: 1.4rem; }
  }
</style>
