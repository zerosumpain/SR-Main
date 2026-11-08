<script lang="ts">
  // The family backlog on a big screen. Everything the family shared from
  // their phones ("Share → SR"), as cards big enough to read across a room,
  // and one button that settles the evening's argument: Pick one for tonight.
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import type { BacklogWire } from '$lib/family/backlog';

  let { data }: { data: PageData } = $props();

  type Shelf = 'all' | 'watch' | 'read' | 'ideas' | 'done';
  let shelf = $state<Shelf>('all');
  let pickedId = $state<string | null>(null);

  const nameOf = (id: string | null) =>
    !id ? null : id === data.me.id ? 'You' : (data.people.find((p) => p.id === id)?.name ?? 'Someone');

  const watch = $derived(data.items.filter((i) => i.kind === 'video'));
  const read = $derived(data.items.filter((i) => i.kind === 'page'));
  const ideas = $derived(data.items.filter((i) => i.kind === 'idea'));
  const forMe = $derived(data.items.filter((i) => i.forId === data.me.id));

  const shown = $derived(
    shelf === 'watch' ? watch : shelf === 'read' ? read : shelf === 'ideas' ? ideas : shelf === 'done' ? data.finished : data.items,
  );
  const picked = $derived(data.items.find((i) => i.id === pickedId) ?? null);

  const tabs = $derived([
    { id: 'all', label: 'All', count: data.items.length },
    { id: 'watch', label: 'Watch', count: watch.length },
    { id: 'read', label: 'Read', count: read.length },
    { id: 'ideas', label: 'Ideas', count: ideas.length },
    { id: 'done', label: 'Done', count: data.finished.length },
  ]);

  const summary = $derived([
    { label: 'To watch', value: String(watch.length) },
    { label: 'To read', value: String(read.length) },
    { label: 'Ideas', value: String(ideas.length) },
    { label: 'For you', value: String(forMe.length) },
  ]);

  /** A different one each press while there is a choice: videos first, else anything on the list. */
  function pick() {
    const pool = watch.length ? watch : data.items;
    if (!pool.length) return;
    const others = pool.length > 1 ? pool.filter((i) => i.id !== pickedId) : pool;
    pickedId = others[Math.floor(Math.random() * others.length)].id;
  }

  function host(url: string | null): string | null {
    if (!url) return null;
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  const title = (i: BacklogWire) => i.title || host(i.url) || i.url || 'Untitled';

  const WHEN = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' });
  function ago(iso: string): string {
    const s = (Date.parse(data.loadedAt) - Date.parse(iso)) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
    if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
    if (s < 6 * 86_400) return `${Math.round(s / 86_400)}d ago`;
    return WHEN.format(new Date(iso));
  }

  function byline(i: BacklogWire): string {
    const parts = [`${nameOf(i.addedById)} · ${ago(i.createdAt)}`];
    if (i.forId) parts.push(i.forId === data.me.id ? 'for you' : `for ${nameOf(i.forId)}`);
    if (i.status !== 'new' && i.doneById) parts.push(i.status === 'dismissed' ? `${nameOf(i.doneById)} passed` : `${nameOf(i.doneById)} did it`);
    return parts.join(' · ');
  }

  const glyph = (i: BacklogWire) => (i.kind === 'idea' ? '✦' : i.kind === 'video' ? '▶' : '¶');
</script>

<svelte:head><title>Family backlog · Strange Ramblings</title></svelte:head>

<HomeFrame
  path="/home/backlog"
  kicker="Home · Backlog"
  title={['What the family', 'wants to watch']}
  standfirst="Videos, links and ideas shared from everyone's phones with Share → SR. Pick one for tonight, and tick it off when it's done."
  {summary}
  {tabs}
  active={shelf}
  ontab={(id) => (shelf = id as Shelf)}
  navBack={data.owner}
  footer={['strangeramblings.com/home/backlog', 'Shared from the SR app', 'The family only']}
>
  <div class="bl">
    <div class="bl-pick">
      <button type="button" class="bl-pick-btn" onclick={pick} disabled={!data.items.length}>
        {picked ? 'Pick another' : 'Pick one for tonight'}
      </button>
      {#if picked}
        <button type="button" class="bl-link" onclick={() => (pickedId = null)}>Clear</button>
      {/if}
    </div>

    {#if picked}
      <article class="bl-spot" aria-live="polite">
        {#if picked.thumbnailUrl}
          <img src={picked.thumbnailUrl} alt="" referrerpolicy="no-referrer" loading="lazy" />
        {:else}
          <div class="bl-glyph big" aria-hidden="true">{glyph(picked)}</div>
        {/if}
        <div class="bl-spot-copy">
          <p class="bl-eyebrow">Tonight</p>
          <h2>{title(picked)}</h2>
          {#if picked.note}<p class="bl-note">{picked.note}</p>{/if}
          <p class="bl-by">{byline(picked)}</p>
          <div class="bl-actions">
            {#if picked.url}
              <a class="bl-open" href={picked.url} target="_blank" rel="noopener noreferrer">Open</a>
            {/if}
            <form method="POST" action="?/done" use:enhance>
              <input type="hidden" name="id" value={picked.id} />
              <button type="submit" class="bl-link">{picked.kind === 'video' ? 'Watched' : 'Done'}</button>
            </form>
          </div>
        </div>
      </article>
    {/if}

    {#if shown.length === 0}
      <p class="bl-empty">
        {shelf === 'done'
          ? 'Nothing done in the last 30 days.'
          : 'Nothing here yet. On a phone with the SR app, share a link, a video or an idea to SR.'}
      </p>
    {:else}
      <ul class="bl-grid">
        {#each shown as item (item.id)}
          <li class="bl-card" class:mine={item.forId === data.me.id && item.status === 'new'} class:off={item.status !== 'new'}>
            <a class="bl-thumb" href={item.url ?? undefined} target="_blank" rel="noopener noreferrer" tabindex={item.url ? 0 : -1}>
              {#if item.thumbnailUrl}
                <img src={item.thumbnailUrl} alt="" referrerpolicy="no-referrer" loading="lazy" />
              {:else}
                <div class="bl-glyph" aria-hidden="true">{glyph(item)}</div>
              {/if}
            </a>
            <div class="bl-copy">
              <h3>
                {#if item.url}<a href={item.url} target="_blank" rel="noopener noreferrer">{title(item)}</a>{:else}{title(item)}{/if}
              </h3>
              {#if item.siteName || host(item.url)}<p class="bl-site">{item.siteName ?? host(item.url)}</p>{/if}
              {#if item.note}<p class="bl-note">{item.note}</p>{/if}
              <p class="bl-by">{byline(item)}</p>
              {#if item.reactions.length}
                <p class="bl-reacts">
                  {#each item.reactions as r (r.emoji)}
                    <span title={r.by.map(nameOf).join(', ')}>{r.emoji}{r.by.length > 1 ? ` ${r.by.length}` : ''}</span>
                  {/each}
                </p>
              {/if}
              <div class="bl-actions">
                {#if item.status === 'new'}
                  <form method="POST" action="?/done" use:enhance>
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" class="bl-link">{item.kind === 'video' ? 'Watched' : 'Done'}</button>
                  </form>
                  <form method="POST" action="?/dismiss" use:enhance>
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" class="bl-link quiet">Not for us</button>
                  </form>
                {:else}
                  <form method="POST" action="?/reopen" use:enhance>
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" class="bl-link">Back on the list</button>
                  </form>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</HomeFrame>

<style>
  /* The lede's own measure and gutters, so the cards line up under it. */
  .bl {
    display: grid;
    gap: 24px;
    width: min(1400px, 100%);
    margin: 0 auto;
    padding: 24px clamp(16px, 3vw, 44px) 40px;
    box-sizing: border-box;
  }
  .bl-pick {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .bl-pick-btn {
    font: inherit;
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    padding: 12px 24px;
    border: 0;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--bg);
    cursor: pointer;
  }
  .bl-pick-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .bl-spot {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 24px;
    padding: 16px;
    background: var(--surface-card);
    border: 1px solid var(--card-border);
    border-radius: 2px;
  }
  .bl-spot img,
  .bl-glyph.big {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
  }
  .bl-spot h2 {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    margin: 0 0 8px;
    color: var(--text-primary);
  }
  .bl-eyebrow {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 4px;
  }
  .bl-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }
  .bl-card {
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--surface-card);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    overflow: hidden;
  }
  .bl-card.mine {
    border-color: var(--accent);
  }
  .bl-card.off {
    opacity: 0.6;
  }
  .bl-thumb img,
  .bl-glyph {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
  }
  .bl-glyph {
    display: grid;
    place-items: center;
    font-size: var(--fs-display-xs);
    color: var(--text-muted);
    background: var(--surface-rail);
  }
  .bl-copy {
    padding: 12px 16px 16px;
    display: grid;
    gap: 6px;
    align-content: start;
  }
  .bl-copy h3 {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-body-lg);
    line-height: 1.3;
    color: var(--text-primary);
  }
  .bl-copy h3 a {
    color: inherit;
    text-decoration: none;
  }
  .bl-copy h3 a:hover {
    text-decoration: underline;
  }
  .bl-site,
  .bl-by {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .bl-note {
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    border-left: 2px solid var(--accent);
    padding-left: 8px;
  }
  .bl-reacts {
    margin: 0;
    display: flex;
    gap: 8px;
    font-size: var(--fs-body-sm);
  }
  .bl-actions {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 4px;
  }
  .bl-actions form {
    margin: 0;
  }
  .bl-open {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    padding: 6px 16px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--bg);
    text-decoration: none;
  }
  .bl-link {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
  .bl-link.quiet {
    color: var(--text-muted);
  }
  .bl-empty {
    font-size: var(--fs-body);
    color: var(--text-muted);
  }
  @media (max-width: 720px) {
    .bl-spot {
      grid-template-columns: 1fr;
    }
  }
</style>
