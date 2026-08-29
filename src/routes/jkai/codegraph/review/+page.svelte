<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // Which row has its retire box open. Plain $state of an id, not of a handle.
  let openId = $state<string | null>(null);

  const shortDate = (d: string | Date | null) =>
    d ? new Date(d).toISOString().slice(0, 10) : '—';
</script>

<svelte:head><title>Codegraph — review</title></svelte:head>

<section class="wrap">
  <h1>Review and forget</h1>
  <p class="lede">
    Ordered by how often each has actually been served, because the thing the builder reads
    is the thing worth checking is still true. Retiring is a tombstone with a reason, not a
    delete — it stops being served and stays readable.
  </p>

  <nav class="tabs">
    <a class:on={data.tab === 'lessons'} href="/jkai/codegraph/review?tab=lessons">Lessons</a>
    <a class:on={data.tab === 'episodes'} href="/jkai/codegraph/review?tab=episodes">Episodes</a>
    <a class:on={data.showRetired} href="/jkai/codegraph/review?tab={data.tab}&retired=1">Retired</a>
    <form method="POST" action="?/refreshStale" use:enhance>
      <button type="submit" class="ghost">Recheck staleness</button>
    </form>
  </nav>

  {#if form && 'message' in form && form.message}
    <p class="error">{form.message}</p>
  {/if}

  {#if data.tab === 'lessons'}
    {#if !data.lessons.length}
      <p class="empty">Nothing here.</p>
    {/if}
    {#each data.lessons as l (l.id)}
      <article class:stale={!!l.staleAt} class:retired={!!l.retiredAt}>
        <header>
          <h2>{l.title}</h2>
          <span class="tags">
            <span class="tag">{l.origin}</span>
            {#if l.servedCount > 0}<span class="tag served">served {l.servedCount}×</span>{/if}
            {#if l.staleAt}<span class="tag warn">stale — every file it names is gone</span>{/if}
            {#if l.retiredAt}<span class="tag off">retired {shortDate(l.retiredAt)}</span>{/if}
          </span>
        </header>
        {#if (l.citedPaths as string[])?.length}
          <p class="paths">{(l.citedPaths as string[]).slice(0, 6).join(' · ')}</p>
        {/if}
        <p class="body">{l.body.slice(0, 420)}{l.body.length > 420 ? '…' : ''}</p>
        {#if l.retiredAt}
          <p class="reason">Retired because: {l.retiredReason}</p>
          <form method="POST" action="?/restore" use:enhance>
            <input type="hidden" name="id" value={l.id} />
            <input type="hidden" name="kind" value="lesson" />
            <button type="submit" class="ghost">Restore</button>
          </form>
        {:else if openId === l.id}
          <form method="POST" action="?/retire" use:enhance={() => async ({ update }) => { openId = null; await update(); }}>
            <input type="hidden" name="id" value={l.id} />
            <input type="hidden" name="kind" value="lesson" />
            <input name="reason" placeholder="Why does this no longer apply?" required />
            <button type="submit">Retire</button>
            <button type="button" class="ghost" onclick={() => (openId = null)}>Cancel</button>
          </form>
        {:else}
          <button type="button" class="ghost" onclick={() => (openId = l.id)}>Forget this…</button>
        {/if}
      </article>
    {/each}
  {:else}
    {#if !data.episodes.length}
      <p class="empty">Nothing here.</p>
    {/if}
    {#each data.episodes as e (e.id)}
      <article class:retired={!!e.retiredAt}>
        <header>
          <h2>{e.title ?? e.fingerprint ?? 'Change'}</h2>
          <span class="tags">
            <span class="tag v-{e.verdict}">{e.verdict}</span>
            {#if e.gate}<span class="tag">{e.gate}</span>{/if}
            {#if e.prNumber}<span class="tag">PR #{e.prNumber}</span>{/if}
            <span class="tag">{shortDate(e.occurredAt)}</span>
          </span>
        </header>
        {#if e.resolution}<p class="body">{e.resolution}</p>{/if}
        {#if e.verification}<p class="paths">verified by <code>{e.verification.slice(0, 140)}</code></p>{/if}
        {#if e.retiredAt}
          <p class="reason">Retired because: {e.retiredReason}</p>
          <form method="POST" action="?/restore" use:enhance>
            <input type="hidden" name="id" value={e.id} />
            <input type="hidden" name="kind" value="episode" />
            <button type="submit" class="ghost">Restore</button>
          </form>
        {:else if openId === e.id}
          <form method="POST" action="?/retire" use:enhance={() => async ({ update }) => { openId = null; await update(); }}>
            <input type="hidden" name="id" value={e.id} />
            <input type="hidden" name="kind" value="episode" />
            <input name="reason" placeholder="Why does this no longer apply?" required />
            <button type="submit">Retire</button>
            <button type="button" class="ghost" onclick={() => (openId = null)}>Cancel</button>
          </form>
        {:else}
          <button type="button" class="ghost" onclick={() => (openId = e.id)}>Forget this…</button>
        {/if}
      </article>
    {/each}
  {/if}
</section>

<style>
  .wrap { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  h1 { font-family: var(--font-display); font-size: var(--fs-display-sm); margin: 0 0 0.4rem; }
  .lede { color: var(--text-secondary); margin: 0 0 1.25rem; max-width: 66ch; }
  .tabs { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; }
  .tabs a { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary);
            border-bottom: 2px solid transparent; padding-bottom: 2px; }
  .tabs a.on { color: var(--accent-ink); border-bottom-color: var(--accent-ink); }
  article { border: 1px solid var(--card-border); background: var(--card-bg); padding: 1rem; margin-bottom: 0.75rem; }
  article.stale { border-left: 3px solid var(--accent); }
  article.retired { opacity: 0.62; }
  header { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; flex-wrap: wrap; }
  h2 { font-size: 0.95rem; margin: 0 0 0.4rem; }
  .tags { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase;
         border: 1px solid var(--divider); padding: 0.1rem 0.4rem; color: var(--text-secondary); }
  .tag.warn { border-color: var(--accent); color: var(--accent); }
  .tag.served { border-color: var(--accent-ink); color: var(--accent-ink); }
  .tag.v-verified { border-color: var(--accent-ink); color: var(--accent-ink); }
  .tag.v-repaired, .tag.v-abandoned { border-color: var(--error-border); color: var(--error); }
  .paths { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary); word-break: break-all; margin: 0.2rem 0; }
  .body { font-size: 0.88rem; line-height: 1.55; white-space: pre-wrap; margin: 0.4rem 0 0.6rem; }
  .reason { font-size: 0.82rem; color: var(--accent); margin: 0.3rem 0; }
  form { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  input[name='reason'] { flex: 1; min-width: 220px; font-size: 16px; padding: 0.4rem 0.5rem;
                         border: 1px solid var(--card-border); background: var(--bg); color: var(--text-primary); }
  button { font-family: var(--font-mono); font-size: 0.75rem; padding: 0.35rem 0.8rem; cursor: pointer;
           border: 1px solid var(--accent-ink); background: var(--accent-ink); color: var(--bg); }
  button.ghost { background: transparent; color: var(--text-secondary); border-color: var(--divider); }
  .error { border: 1px solid var(--error-border); background: var(--error-bg); color: var(--error); padding: 0.7rem; font-size: 0.85rem; }
  .empty { color: var(--text-secondary); }
  code { font-family: var(--font-code); }
</style>
