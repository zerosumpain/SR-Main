<script lang="ts">
  // Decks landing — public gallery of generated presentations (nav-bar
  // destination); the owner also sees private decks + edit links. SR site
  // register (page-hdr + card grid, modelled on /projects).
  import SiteHeader from '$lib/components/SiteHeader.svelte';
  import { page } from '$app/state';

  let { data } = $props();

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
</script>

<svelte:head>
  <title>sr. decks — presentations</title>
  <meta name="description" content="Zoomable editorial slide decks — presentations generated with jkai on strangeramblings.com." />
</svelte:head>

<SiteHeader isOwner={page.data?.isOwner !== false} />

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
      {#each data.decks as deck, i (deck.id)}
        <!-- The newest deck wears the accent edge permanently. The old
             scaleY-on-hover border said "you are pointing at this", which every
             card could say; only one can be the latest. -->
        <li class="card" class:private={!deck.isPublic} class:newest={i === 0}>
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
  .page-hdr { border-bottom: 2px solid var(--line-title); padding-bottom: 20px; margin-bottom: 22px; }
  .kicker {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--accent);
  }
  h1 {
    font-family: var(--font-display);
    font-size: clamp(30px, 4.5vw, 42px);
    letter-spacing: -0.03em;
    margin: 8px 0 10px;
    color: var(--text-primary);
  }
  .sub {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.6;
    color: var(--text-muted);
    margin: 0;
    max-width: 64ch;
  }
  .sub a { color: var(--accent-ink); }
  .empty {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    padding: 30px 2px;
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
  }
  /* Editorial register, so the card is raised off the page ground rather than
     tinted into it — but still square, and still without a shadow. */
  .card {
    position: relative;
    min-height: 168px;
    border: 1px solid var(--line-strong);
    background: var(--surface-card);
    transition: border-color var(--t-base) var(--ease-out);
  }
  .card:hover { border-color: var(--accent-tint-35); }
  .card.newest {
    border-left: 2px solid var(--accent);
  }
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
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  /* Private is a fact about the deck, not a warning — accent, like every other
     "this one is different" mark on the site. --warn amber was a third status
     colour nothing else here used. */
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sharp);
    padding: 1px 5px;
  }
  .card-title {
    font-family: var(--font-display);
    font-size: 20px;
    line-height: 1.15;
    letter-spacing: -0.02em;
    color: var(--text-primary);
  }
  .card-desc {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
  }
  /* Pinned to the bottom edge of the card, so every card in a row ends on the
     same line whatever the description does above it. */
  .card-cta {
    margin-top: auto;
    padding-top: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent);
  }
  .card-edit {
    position: absolute;
    top: 12px;
    right: 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent-ink);
    text-decoration: none;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    padding: 3px 8px;
    background: var(--surface-card);
  }
  .card-edit:hover { border-color: var(--accent-ink); }

  @media (max-width: 520px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
  }
</style>
