<script lang="ts">
  // Owner index of decks — SR admin register (kicker / display h1 / row links).
  let { data } = $props();

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
</script>

<svelte:head>
  <title>sr. decks</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap">
  <header class="page-hdr">
    <a class="back-link" href="/">← home</a>
    <span class="kicker">PRESENTATIONS</span>
    <h1>sr. decks</h1>
    <p class="sub">Zoomable editorial slide decks. Private by default — share by link, or build one from a /jkai prompt.</p>
  </header>

  {#if data.decks.length === 0}
    <p class="empty">No decks yet. Ask jkai to build one.</p>
  {:else}
    <ul class="deck-list">
      {#each data.decks as deck (deck.id)}
        <li>
          <a class="row-link" href="/decks/{deck.slug}">
            <span class="dl-title">{deck.title}</span>
            <span class="dl-meta">
              <span class="chip" class:public={deck.isPublic}>{deck.isPublic ? 'PUBLIC' : 'PRIVATE'}</span>
              <span class="dl-count">{deck.slideCount} slides</span>
              <span class="dl-date">{fmtDate(deck.updatedAt)}</span>
              <span class="dl-edit" role="link" tabindex="0" onclick={(e) => { e.preventDefault(); location.href = `/decks/${deck.slug}/edit`; }} onkeydown={(e) => { if (e.key === 'Enter') location.href = `/decks/${deck.slug}/edit`; }}>edit</span>
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wrap { max-width: 860px; margin: 0 auto; padding: 40px 20px 80px; }
  .page-hdr { border-bottom: 2px solid var(--text-primary); padding-bottom: 18px; margin-bottom: 8px; }
  .back-link {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-decoration: none;
  }
  .back-link:hover { color: var(--text-primary); }
  .kicker {
    display: block;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    color: var(--accent);
    margin-top: 14px;
  }
  h1 { font-family: var(--font-display); font-size: 34px; margin: 6px 0 8px; color: var(--text-primary); }
  .sub { font-family: var(--font-body); font-size: 14px; color: var(--text-muted); margin: 0; max-width: 60ch; }
  .empty { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); padding: 26px 2px; }

  .deck-list { list-style: none; margin: 0; padding: 0; }
  .row-link {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 2px;
    border-bottom: 1px solid var(--card-border);
    text-decoration: none;
    transition: background var(--t-base) var(--ease-out);
  }
  .row-link:hover { background: var(--accent-tint-04); }
  .dl-title { font-family: var(--font-body); font-weight: 500; font-size: 15px; color: var(--text-primary); }
  .dl-meta { display: flex; align-items: baseline; gap: 14px; flex-shrink: 0; }
  .chip {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 2px 6px;
  }
  .chip.public { color: var(--success); border-color: var(--success); }
  .dl-count,
  .dl-date { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-muted); }
  .dl-edit {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    cursor: pointer;
  }
  .dl-edit:hover { text-decoration: underline; }
</style>
