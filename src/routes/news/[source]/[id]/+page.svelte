<svelte:head>
  <title>{data.article.story.title} — News</title>
  <meta name="description" content="Read and act on a story from {data.article.story.sourceLabel}." />
</svelte:head>

<script lang="ts">
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let busy = $state<string | null>(null);
  let favourite = $state(data.isFavourite);
  let notice = $state<{ text: string; href?: string; link?: string; error?: boolean } | null>(null);
  const story = $derived(data.article.story);
  const paragraphs = $derived(
    data.article.content
      .split(/\n\s*\n|(?<=\.)\s+(?=[A-Z][^\n]{40,})/)
      .map((part) => part.trim())
      .filter(Boolean),
  );

  function calendarDate(iso: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  }

  function askHref(): string {
    const q = `Read this news story and help me think through what matters, what is uncertain, and what I should do with it: ${story.title} — ${story.url}`;
    return `/jkai?new=1&send=1&q=${encodeURIComponent(q)}`;
  }

  async function runAction(action: 'graph' | 'note' | 'research' | 'favourite') {
    busy = action;
    notice = null;
    try {
      const response = await fetch('/api/news/actions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, source: story.source, id: story.id }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        href?: string;
        existing?: boolean;
        favourited?: boolean;
      };
      if (!response.ok || result.error) throw new Error(result.error ?? `Action failed (${response.status})`);
      if (action === 'favourite') {
        favourite = result.favourited === true;
        notice = favourite
          ? { text: 'Added to favourites.', href: result.href, link: 'View favourites →' }
          : { text: 'Removed from favourites.' };
      } else if (action === 'graph') {
        notice = {
          text: result.existing ? 'Already present in the knowledge graph.' : 'Added to the graph. Entity extraction is running.',
          href: result.href,
          link: 'View in Intel →',
        };
      } else if (result.href) {
        window.location.href = result.href;
      }
    } catch (err) {
      notice = { text: err instanceof Error ? err.message : String(err), error: true };
    } finally {
      busy = null;
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(story.url);
      notice = { text: 'Article link copied.' };
    } catch {
      notice = { text: 'Could not copy the link on this device.', error: true };
    }
  }
</script>

<HealthShell
  path="/news/reader"
  kicker={`${story.sourceLabel} · ${story.domain}`}
  back={{ href: '/news', label: '← Back to the wire' }}
  nav={[
    { href: '/news?view=top', label: 'Top' },
    { href: '/news?view=new', label: 'New' },
    { href: '/news?view=best', label: 'Best' },
  ]}
  live={story.sourceLabel}
  meta={[`${story.score} points`, `${story.commentCount} comments`]}
  footer={[
    'strangeramblings.com/news · reading copy',
    `${story.sourceLabel} · ${story.domain}`,
    'Nothing is retained until you choose it',
  ]}
>
<div class="reader-page">

  <header class="article-head">
    <div class="source-lockup">
      <span class="source-code">{story.source === 'hacker-news' ? 'HN' : 'L'}</span>
      <span>{story.sourceLabel} · {story.domain}</span>
    </div>
    <h1>{story.title}</h1>
    <p class="article-meta">
      <time datetime={story.publishedAt}>{calendarDate(story.publishedAt)}</time>
      {#if story.author}<span>Submitted by {story.author}</span>{/if}
      <span>{story.score} points</span>
      <a href={story.discussionUrl} target="_blank" rel="noopener">{story.commentCount} comments ↗</a>
    </p>
  </header>

  {#if data.article.summary}
    <section class="article-summary" aria-labelledby="summary-title">
      <p class="rail-label">In brief</p>
      <p id="summary-title">{data.article.summary}</p>
    </section>
  {/if}

  <div class="reader-grid">
    <aside class="reading-rail">
      <p class="rail-label">Reading copy</p>
      <dl>
        <div><dt>Mode</dt><dd>{data.article.mode}</dd></div>
        <div><dt>Source</dt><dd>{story.domain}</dd></div>
        <div><dt>Length</dt><dd>{data.article.content ? `${Math.max(1, Math.ceil(data.article.content.split(/\s+/).length / 220))} min` : 'external'}</dd></div>
      </dl>
      <nav class="reading-links" aria-label="Story links">
        {#if story.url !== story.discussionUrl}
          <a href={story.url} target="_blank" rel="noopener">Open original ↗</a>
        {/if}
        <a href={story.discussionUrl} target="_blank" rel="noopener">
          {story.commentCount} comments on {story.sourceLabel} ↗
        </a>
      </nav>
    </aside>

    <article class="reading-copy">
      {#if data.article.message}
        <div class="reader-note">{data.article.message}</div>
      {/if}
      {#if paragraphs.length}
        {#each paragraphs as paragraph}
          <p>{paragraph}</p>
        {/each}
      {:else}
        <div class="external-only">
          <p>This story cannot be reproduced in the reading view.</p>
          <a href={story.url} target="_blank" rel="noopener">Read it at {story.domain} →</a>
        </div>
      {/if}
    </article>

    <aside class="action-rail" aria-labelledby="action-title">
      <div class="action-head">
        <p class="rail-label">02 / After reading</p>
        <h2 id="action-title">WHAT SHOULD LAST?</h2>
        <p>Nothing is kept until you choose it.</p>
      </div>
      <button class="action primary" type="button" disabled={busy !== null} onclick={() => runAction('graph')}>
        <span class="action-code">KG</span>
        <span><strong>{busy === 'graph' ? 'Keeping…' : 'Keep in knowledge graph'}</strong><small>Store the source and extract entities</small></span>
        <span aria-hidden="true">→</span>
      </button>
      <button
        class="action favourite"
        class:selected={favourite}
        type="button"
        aria-pressed={favourite}
        disabled={busy !== null}
        onclick={() => runAction('favourite')}
      >
        <span class="action-code">★</span>
        <span>
          <strong>
            {busy === 'favourite'
              ? favourite
                ? 'Removing…'
                : 'Saving…'
              : favourite
                ? 'Remove from favourites'
                : 'Add to favourites'}
          </strong>
          <small>{favourite ? 'Saved in your News reading list' : 'Keep it in your News reading list'}</small>
        </span>
        <span aria-hidden="true">→</span>
      </button>
      <button class="action" type="button" disabled={busy !== null} onclick={() => runAction('research')}>
        <span class="action-code">RS</span>
        <span><strong>{busy === 'research' ? 'Commissioning…' : 'Commission research'}</strong><small>Start a sourced brief from this story</small></span>
        <span aria-hidden="true">→</span>
      </button>
      <button class="action" type="button" disabled={busy !== null} onclick={() => runAction('note')}>
        <span class="action-code">NT</span>
        <span><strong>{busy === 'note' ? 'Linking…' : 'Link in a note'}</strong><small>Open a new News notebook entry</small></span>
        <span aria-hidden="true">→</span>
      </button>
      <a class="action" href={askHref()}>
        <span class="action-code">AI</span>
        <span><strong>Ask JKAI</strong><small>Carry it into a fresh conversation</small></span>
        <span aria-hidden="true">→</span>
      </a>
      <button class="action quiet" type="button" onclick={copyLink}>
        <span class="action-code">↗</span>
        <span><strong>Copy article link</strong><small>Use it anywhere else on the site</small></span>
        <span aria-hidden="true">+</span>
      </button>
      {#if notice}
        <div class="notice" class:error={notice.error} aria-live="polite">
          {notice.text}
          {#if notice.href}<a href={notice.href}>{notice.link}</a>{/if}
        </div>
      {/if}
    </aside>
  </div>
</div>
</HealthShell>

<style>
  .reader-page { min-height: calc(100vh - var(--site-nav-height)); padding: 30px clamp(20px, 4vw, 58px) 80px; }
  .article-head { max-width: 1120px; margin: 0 auto; padding: 0 0 34px; border-bottom: 2px solid var(--text-primary); }
  .source-lockup { display: flex; align-items: center; gap: 11px; margin-bottom: 22px; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); }
  .source-code { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--accent); color: var(--accent); font-weight: 700; }
  h1 { max-width: 18ch; margin: 0; font-family: var(--font-display); font-size: clamp(2.8rem, 6vw, 6rem); line-height: 0.94; letter-spacing: -0.035em; text-wrap: balance; }
  .article-meta { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 25px 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .article-meta a { color: var(--accent-ink); }
  .article-summary { display: grid; grid-template-columns: 150px minmax(0, 700px); gap: clamp(26px, 4vw, 58px); max-width: 1120px; margin: 0 auto; padding: 24px 0; border-bottom: 1px solid var(--line-strong); }
  .article-summary .rail-label { margin: 4px 0 0; }
  .article-summary > p:last-child { margin: 0; font-family: var(--font-read); font-size: var(--fs-body-lg); font-weight: 600; line-height: 1.55; color: var(--text-secondary); text-wrap: balance; }
  .reader-grid { display: grid; grid-template-columns: 150px minmax(0, 700px) minmax(260px, 320px); gap: clamp(26px, 4vw, 58px); max-width: 1120px; margin: 0 auto; padding-top: 36px; align-items: start; }
  .reading-rail, .action-rail { position: sticky; top: calc(var(--site-nav-height) + 24px); }
  .rail-label { margin: 0 0 14px; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--accent); }
  .reading-rail dl { margin: 0 0 18px; border-top: 1px solid var(--line-strong); }
  .reading-rail dl div { display: grid; gap: 3px; padding: 10px 0; border-bottom: 1px solid var(--line-hair); }
  .reading-rail dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--text-ghost); }
  .reading-rail dd { margin: 0; font-size: var(--fs-nav); color: var(--text-secondary); overflow-wrap: anywhere; }
  .reading-links { display: grid; gap: 12px; }
  .reading-links a { font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.4; color: var(--accent-ink); }
  .reading-copy { min-width: 0; font-family: var(--font-read); font-size: clamp(1.05rem, 1.4vw, 1.18rem); line-height: 1.72; color: var(--text-primary); }
  .reading-copy p { margin: 0 0 1.45em; }
  .reading-copy p:first-of-type::first-letter { float: left; margin: 0.08em 0.1em 0 0; font-family: var(--font-display); font-size: 4.4em; line-height: 0.72; color: var(--accent); }
  .reader-note { margin-bottom: 24px; padding: 12px 14px; border-left: 3px solid var(--accent-ink); background: var(--accent-ink-tint-06); font-family: var(--font-mono); font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary); }
  .external-only { padding: 28px; border: 1px solid var(--line-strong); background: var(--surface-sunken); }
  .external-only p { margin-top: 0; }
  .external-only a { color: var(--accent); font-family: var(--font-mono); font-size: var(--fs-label); }
  .action-rail { border: 1px solid var(--line-strong); background: var(--surface-card); }
  .action-head { padding: 18px; border-bottom: 1px solid var(--line-strong); }
  .action-head .rail-label { margin-bottom: 9px; }
  .action-head h2 { margin: 0; font-family: var(--font-display); font-size: 1.45rem; line-height: 1; }
  .action-head > p:last-child { margin: 10px 0 0; font-size: var(--fs-nav); line-height: 1.4; color: var(--text-muted); }
  .action { display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 10px; width: 100%; padding: 14px 13px; border: 0; border-bottom: 1px solid var(--line-hair); background: transparent; color: var(--text-primary); text-align: left; text-decoration: none; cursor: pointer; }
  .action:hover:not(:disabled) { background: var(--accent-tint-08); }
  .action.primary { background: var(--text-primary); color: var(--bg); }
  .action.primary:hover:not(:disabled) { background: var(--accent); }
  .action.favourite.selected { background: var(--accent-tint-08); color: var(--accent-ink); }
  .action.quiet { border-bottom: 0; }
  .action:disabled { opacity: 0.55; cursor: wait; }
  .action-code { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid currentColor; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; }
  .action > span:nth-child(2) { display: grid; gap: 3px; }
  .action strong { font-size: var(--fs-nav); font-weight: 600; }
  .action small { font-size: var(--fs-label-xs); line-height: 1.3; opacity: 0.68; }
  .notice { display: grid; gap: 7px; padding: 12px 14px; border-top: 1px solid var(--success-border); background: var(--success-bg); font-size: var(--fs-label); line-height: 1.4; color: var(--success); }
  .notice.error { border-color: var(--error-border); background: var(--error-bg); color: var(--error); }
  .notice a { color: inherit; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  @media (max-width: 980px) {
    .article-summary { grid-template-columns: 1fr; gap: 8px; }
    .reader-grid { grid-template-columns: minmax(0, 1fr) 290px; }
    .reading-rail { display: none; }
  }
  @media (max-width: 700px) {
    .reader-page { padding-top: 22px; }
    .back { margin-bottom: 24px; }
    .reader-grid { grid-template-columns: 1fr; }
    .action-rail { position: static; grid-row: 1; }
    .reading-copy { grid-row: 2; }
  }
</style>
