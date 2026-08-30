<script lang="ts">
  import { getContext, untrack } from 'svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');

  type Row = PageData['comments'][number];
  type Status = Row['status'];
  type Filter = Status | 'all';

  /** Deleted has no tab of its own — it is reachable through All, which is
   *  where an accidental delete gets undone by publishing the row again. */
  const TABS: { key: Filter; label: string }[] = [
    { key: 'held', label: 'Held' },
    { key: 'published', label: 'Published' },
    { key: 'spam', label: 'Spam' },
    { key: 'all', label: 'All' },
  ];

  const EMPTY: Record<Filter, string> = {
    held: 'Nothing waiting.',
    published: 'Nothing published yet.',
    spam: 'No spam caught.',
    deleted: 'Nothing deleted.',
    all: 'No responses yet.',
  };

  // The list and the counts are owned by the client from mount onwards: a tab
  // switch refetches from the API rather than re-running the loader, so
  // `invalidateAll()` is never called here and there is no prop->state sync
  // effect to loop.
  //
  // `untrack` around the three seeds says that out loud. Reading a prop while
  // initialising $state otherwise raises state_referenced_locally, which reads
  // as an oversight — here taking only the first value is the design, and the
  // warning would bury the one place it might genuinely matter later.
  // Copied, not aliased: $state proxies the array it is handed, so seeding
  // straight from `data.comments` would route every splice below into the
  // loader's own payload.
  let rows = $state<Row[]>(untrack(() => [...data.comments]));
  // Spread, not the prop object itself: assigning into `counts` later must not
  // reach back and mutate `data`.
  let counts = $state<Record<Status, number>>(untrack(() => ({ ...data.counts })));
  let active = $state<Filter>(untrack(() => data.status));
  let loading = $state(false);
  let error = $state<string | null>(null);
  // Per-row in-flight flag, keyed by id so two rows can be moderated at once
  // without one disabling the other.
  let busy = $state<Record<number, boolean>>({});

  // There is deliberately NO $effect in this component. Every state write below
  // happens on a click, so the read-then-write pattern in `refresh` and
  // `moderate` cannot re-enter itself.

  let total = $derived(
    counts.held + counts.published + counts.spam + counts.deleted,
  );

  function tabCount(key: Filter): number {
    return key === 'all' ? total : counts[key];
  }

  async function refresh(status: Filter) {
    loading = true;
    error = null;
    try {
      const res = await fetch(
        `/api/admin/blog/comments?status=${status}&token=${adminToken}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      rows = payload.comments;
      counts = payload.counts;
    } catch {
      error = 'Could not load that queue.';
    } finally {
      loading = false;
    }
  }

  function selectTab(key: Filter) {
    if (key === active) return;
    active = key;
    void refresh(key);
  }

  async function moderate(row: Row, next: Status) {
    if (busy[row.id] || row.status === next) return;
    const index = rows.findIndex((r) => r.id === row.id);
    if (index === -1) return;

    const previous = row.status;
    // Snapshot before touching anything: a $state row is a proxy, so this has
    // to be a plain copy taken up front, not a reference held across the await.
    const snapshot = { ...row } as Row;
    const previousCounts = { ...counts };

    busy[row.id] = true;
    error = null;
    if (active === 'all') {
      // On All nothing leaves the list; only the pill changes, which is what
      // makes All the place a delete is visibly reversible.
      rows[index] = { ...snapshot, status: next };
    } else {
      rows = rows.filter((r) => r.id !== row.id);
    }
    counts = {
      ...counts,
      [previous]: Math.max(0, counts[previous] - 1),
      [next]: counts[next] + 1,
    };

    try {
      const res = await fetch(`/api/admin/blog/comments?token=${adminToken}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, status: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Put the row back where it was rather than refetching: a refetch would
      // silently reorder a queue the owner is halfway down.
      const restored = rows.filter((r) => r.id !== snapshot.id);
      restored.splice(Math.min(index, restored.length), 0, snapshot);
      rows = restored;
      counts = previousCounts;
      error = 'That did not save. Nothing was moved.';
    } finally {
      // Deleted rather than set false: a moderated row usually leaves the list,
      // and a flag map that only ever grows is a leak across a long session.
      delete busy[row.id];
    }
  }

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  /**
   * Relative for anything recent, an absolute date past a fortnight.
   *
   * Not `formatRelative` from $lib/canvas/stats: that one renders "412d ago",
   * which is a number nobody can read as a date. A moderation queue holds
   * comments for as long as they go unread, so the old end of it is the normal
   * case here, not the edge.
   */
  function when(iso: string): string {
    const at = new Date(iso).getTime();
    if (!Number.isFinite(at)) return '—';
    const diff = Date.now() - at;
    if (diff < MINUTE) return 'just now';
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
    if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
    if (diff < 14 * DAY) return `${Math.floor(diff / DAY)}d ago`;
    return new Date(at).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
</script>

<svelte:head><title>Responses — Admin</title></svelte:head>

<PageWrap>
  <PageHeader
    kicker="Content"
    title="Responses"
    sub="Reader comments. Nothing a stranger writes reaches the site until it is published from here."
  />

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Queue</span>
      <span class="nm-sec-meta">
        {rows.length} shown{loading ? ' · loading' : ''}
      </span>
    </div>

    <div class="nm-tabs">
      {#each TABS as tab (tab.key)}
        <button
          class="nm-tab"
          class:active={active === tab.key}
          onclick={() => selectTab(tab.key)}
        >
          {tab.label} <span class="nm-tab-count">{tabCount(tab.key)}</span>
        </button>
      {/each}
    </div>

    {#if error}
      <div class="banner banner-error">{error}</div>
    {/if}

    {#if rows.length === 0}
      <div class="nm-empty">{EMPTY[active]}</div>
    {:else}
      <div class="c-list">
        {#each rows as comment (comment.id)}
          <article class="c-row">
            <div class="c-meta">
              <span class="c-author">{comment.authorName}</span>
              <span class="c-dot">·</span>
              <!-- New tab on purpose: reading the post should not cost the
                   owner their place in a queue they are working down. -->
              <a
                class="c-post"
                href={`/blog/${comment.postSlug}`}
                target="_blank"
                rel="noreferrer"
              >{comment.postTitle}</a>
              <span class="c-dot">·</span>
              <time class="c-when" datetime={comment.createdAt}>{when(comment.createdAt)}</time>
              {#if comment.parentId !== null}
                <span class="c-reply">reply</span>
              {/if}
              {#if active === 'all'}
                <span class="nm-pill" data-state={comment.status}>{comment.status}</span>
              {/if}
            </div>

            <!-- THE BODY IS UNTRUSTED TEXT WRITTEN BY STRANGERS.
                 It is interpolated as text and must stay that way. Rendering it
                 with the @html directive here would be stored XSS: anyone on
                 the internet can put a payload in the public comment box on
                 /blog/[slug], the most-linked page on the site, and it would
                 execute in an owner session on an admin page that sits behind
                 the auth gate and holds the admin token in its own URL. There
                 is no markup to preserve either — comments.ts stores plain text
                 with no markdown, no HTML and no auto-linking — so pre-wrap is
                 all the formatting this ever needs. -->
            <p class="c-body">{comment.body}</p>

            <div class="c-actions">
              {#if comment.status !== 'published'}
                <button
                  class="row-link"
                  disabled={busy[comment.id]}
                  onclick={() => moderate(comment, 'published')}
                >Publish</button>
              {/if}
              {#if comment.status !== 'spam'}
                <button
                  class="row-link"
                  disabled={busy[comment.id]}
                  onclick={() => moderate(comment, 'spam')}
                >Spam</button>
              {/if}
              {#if comment.status !== 'deleted'}
                <button
                  class="row-link danger"
                  disabled={busy[comment.id]}
                  onclick={() => moderate(comment, 'deleted')}
                >Delete</button>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</PageWrap>

<style>
  .c-list {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line-hair);
  }
  .c-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.85rem 0.25rem;
    border-bottom: 1px solid var(--line-hair);
  }
  .c-row:last-child { border-bottom: none; }

  .c-meta {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.45rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .c-author {
    color: var(--text-primary);
    font-weight: 500;
  }
  .c-post {
    color: var(--accent);
    text-decoration: none;
  }
  .c-post:hover { text-decoration: underline; }
  .c-dot { color: var(--text-ghost); }
  .c-when { color: var(--text-ghost); }
  .c-reply {
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
    border: 1px solid var(--line-hair);
    padding: 1px 6px;
  }
  /* The shared sheet colours 'published' and leaves the rest neutral. Spam is
     the one other state worth reading off the All tab at a glance. */
  .nm-pill[data-state='spam'] {
    border-color: var(--warn-border);
    color: var(--warn);
    background: var(--warn-bg);
  }

  .c-body {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
    /* Paragraphing without markup: the stored text keeps its newlines. */
    white-space: pre-wrap;
    /* A stranger can post 4,000 characters with no space in them. Without this
       one unbroken token takes the whole admin page sideways. */
    overflow-wrap: anywhere;
  }

  .c-actions {
    display: flex;
    gap: 0.9rem;
    align-items: center;
  }
  /* Matches /jkai/canvas: a discreet mono action that reads as a link, not a
     button, so three of them on every row stay quiet. */
  .row-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: none;
  }
  .row-link:hover { color: var(--accent-hover); text-decoration: underline; }
  .row-link:disabled { opacity: 0.5; cursor: not-allowed; text-decoration: none; }
  .row-link.danger { color: var(--error); }
  .row-link.danger:hover { color: var(--error-hover); }
</style>
