<script lang="ts">
  // Decks landing — public gallery of generated presentations (nav-bar
  // destination); the owner also sees private decks + edit links. SR site
  // register (page-hdr + card grid, modelled on /projects).
  import SiteNav from '$lib/components/SiteNav.svelte';

  let { data } = $props();

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
</script>

<svelte:head>
  <title>sr. decks — presentations</title>
  <meta name="description" content="Zoomable editorial slide decks — presentations generated with jkai on strangeramblings.com." />
</svelte:head>

<SiteNav variant="compact" />

<div class="wrap">
  <header class="page-hdr">
    <span class="kicker">PRESENTATIONS</span>
    <h1>sr. decks</h1>
    <p class="sub">
      Zoomable, editorial slide decks — built from a prompt in <a href="/jkai">jkai</a>, drawing on the site's
      studies and live interactives. ← → to move, Enter to dive into a slide's sub-deck.
    </p>
  </header>

  {#if data.decks.length === 0}
    <p class="empty">Nothing published yet.</p>
  {:else}
    <ul class="grid">
      {#each data.decks as deck (deck.id)}
        <li class="card" class:private={!deck.isPublic}>
          <a class="card-main" href="/decks/{deck.slug}">
            <span class="card-kicker">
              {deck.slideCount} SLIDES · {fmtDate(deck.updatedAt)}
              {#if !deck.isPublic}<span class="chip">PRIVATE</span>{/if}
            </span>
            <span class="card-title">{deck.title}</span>
            {#if deck.description}<span class="card-desc">{deck.description}</span>{/if}
            <span class="card-cta">▶ play</span>
          </a>
          {#if data.isOwner}
            <a class="card-edit" href="/decks/{deck.slug}/edit">edit</a>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wrap { max-width: 1060px; margin: 0 auto; padding: 34px 20px 90px; }
  .page-hdr { border-bottom: 2px solid var(--text-primary); padding-bottom: 20px; margin-bottom: 22px; }
  .kicker {
    display: block;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.22em;
    color: var(--accent);
  }
  h1 { font-family: var(--font-display); font-size: clamp(30px, 4.5vw, 42px); margin: 6px 0 10px; color: var(--text-primary); }
  .sub { font-family: var(--font-body); font-size: 14.5px; line-height: 1.6; color: var(--text-muted); margin: 0; max-width: 64ch; }
  .sub a { color: var(--accent-ink); }
  .empty { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); padding: 30px 2px; }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
  }
  .card {
    position: relative;
    border: 1px solid var(--card-border);
    background: var(--card-bg);
    transition: border-color var(--t-base) var(--ease-out), background var(--t-base) var(--ease-out);
  }
  .card:hover { border-color: var(--accent); background: var(--accent-tint-04); }
  .card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
    transform: scaleY(0);
    transform-origin: top;
    transition: transform var(--t-base) var(--ease-out);
  }
  .card:hover::before { transform: scaleY(1); }
  .card-main {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px 16px 14px;
    text-decoration: none;
    height: 100%;
    box-sizing: border-box;
  }
  .card-kicker {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: 8.5px;
    letter-spacing: 0.14em;
    color: var(--warn);
    border: 1px solid var(--warn);
    border-radius: 2px;
    padding: 1px 5px;
  }
  .card-title {
    font-family: var(--font-display);
    font-size: 19px;
    line-height: 1.2;
    color: var(--text-primary);
  }
  .card-desc {
    font-family: var(--font-body);
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-muted);
  }
  .card-cta {
    margin-top: auto;
    padding-top: 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .card-edit {
    position: absolute;
    top: 12px;
    right: 12px;
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-ink);
    text-decoration: none;
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 3px 8px;
  }
  .card-edit:hover { border-color: var(--accent-ink); }
</style>
