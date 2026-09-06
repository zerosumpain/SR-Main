<script lang="ts">
  // Decks landing — public gallery of generated presentations (nav-bar
  // destination); the owner also sees private decks + edit links.
  //
  // Wears the /health editorial system, the same way /research, /news and
  // /drive do: `HealthShell` with `unifiedNav` (the shared site bar above
  // health's grain and ink footer), an ink cover band carrying the count
  // deck, then one paper section opened by `SectionHead`.
  //
  // The old page was `.page-hdr` + a card grid modelled on /projects. That
  // register survives inside the section — the cards are the same square,
  // shadowless, hairline-framed objects — but the page now opens with a
  // masthead rather than a heading, and the counts are stated rather than
  // left to be inferred from the length of the grid.
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  import SectionHead from '$lib/components/health/hub/SectionHead.svelte';

  let { data } = $props();

  const fmtDate = (d: Date) =>
    new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const slideTotal = $derived(data.decks.reduce((n, d) => n + Number(d.slideCount ?? 0), 0));
  const latest = $derived(data.decks[0]?.updatedAt ? fmtDate(data.decks[0].updatedAt) : '—');
  // Stated on the cover only when there is something to state — an owner
  // looking at a shelf of published decks should not read "0 PRIVATE".
  const privateCount = $derived(data.decks.filter((d) => !d.isPublic).length);
</script>

<svelte:head>
  <title>sr. decks — presentations</title>
  <meta name="description" content="Zoomable editorial slide decks — presentations generated with jkai on strangeramblings.com." />
</svelte:head>

<HealthShell
  path="/decks"
  unifiedNav
  footer={[
    'strangeramblings.com/decks · presentations',
    `${data.decks.length} ${data.decks.length === 1 ? 'deck' : 'decks'} · ${slideTotal} slides`,
    'built from a prompt in jkai',
  ]}
>
  <section class="lede">
    <div class="lede-inner">
      <div class="lede-copy">
        <p class="eyebrow">Presentations · zoomable decks</p>
        <h1>SLIDES,<br /><span>WITHOUT THE MEETING.</span></h1>
        <p class="standfirst">
          Zoomable, editorial slide decks — built from a prompt in <a href="/jkai">jkai</a>, drawing
          on the site's studies and live interactives. ← → to move, Enter to dive into a slide's
          sub-deck.
        </p>
      </div>

      <dl class="shelf-summary" aria-label="Deck shelf summary">
        <div>
          <dt>On the shelf</dt>
          <dd>{String(data.decks.length).padStart(2, '0')}</dd>
          <small>{privateCount ? `${privateCount} private` : 'All published'}</small>
        </div>
        <div>
          <dt>Slides</dt>
          <dd>{String(slideTotal).padStart(2, '0')}</dd>
          <small>Across every deck</small>
        </div>
        <div>
          <dt>Latest</dt>
          <dd class="date">{latest}</dd>
          <small>Most recently rebuilt</small>
        </div>
      </dl>
    </div>
  </section>

  <section class="shelf">
    <div class="shelf-inner">
      <SectionHead
        kicker="01 / The shelf"
        title={['EVERY DECK', 'ON THE SHELF']}
        strap="Newest first. The one wearing the accent edge is the most recently rebuilt."
      />

      {#if data.decks.length === 0}
        <p class="empty">Nothing published yet.</p>
      {:else}
        <ul class="grid">
          {#each data.decks as deck, i (deck.id)}
            <!-- The newest deck wears the accent edge permanently. The old
                 scaleY-on-hover border said "you are pointing at this", which
                 every card could say; only one can be the latest. -->
            <li class="card" class:private={!deck.isPublic} class:newest={i === 0} class:owner={data.isOwner}>
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
  </section>
</HealthShell>

<style>
  /* --- Cover: the ink band, lit the way every band in this system is --- */
  .lede {
    padding: clamp(28px, 3.5vw, 48px) clamp(20px, 3vw, 44px);
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
  }
  .lede-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(420px, 0.85fr);
    align-items: end;
    gap: clamp(32px, 5vw, 72px);
    width: min(1400px, 100%);
    margin: 0 auto;
  }
  .lede-copy {
    min-width: 0;
  }
  .eyebrow {
    margin: 0 0 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    /* Paper accent is ink on this ground — the lifted partner, every time. */
    color: var(--accent-on-dark);
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.7rem, 4.8vw, 4.5rem);
    font-weight: 900;
    line-height: 0.88;
    letter-spacing: -0.04em;
    color: var(--bg);
    text-wrap: balance;
  }
  h1 span {
    color: transparent;
    -webkit-text-stroke: 1.5px var(--bg);
  }
  .standfirst {
    max-width: 56ch;
    margin: 18px 0 0;
    font-size: var(--fs-body);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.7);
  }
  .standfirst a {
    color: var(--accent-on-dark);
  }

  .shelf-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
    margin: 0;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
    border-left: 1px solid rgba(237, 228, 212, 0.16);
  }
  .shelf-summary > div {
    min-width: 0;
    padding: 14px;
    border-right: 1px solid rgba(237, 228, 212, 0.16);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
    background: rgba(237, 228, 212, 0.04);
  }
  .shelf-summary dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
  }
  .shelf-summary dd {
    margin: 8px 0 5px;
    font-family: var(--font-display);
    font-size: clamp(1.65rem, 2.4vw, 2.4rem);
    font-weight: 900;
    line-height: 0.9;
    letter-spacing: -0.03em;
    color: var(--bg);
    font-variant-numeric: tabular-nums;
  }
  /* A date is not a figure — it does not get the 38px numeral treatment, or it
     wraps to three lines in the 1fr track it shares with two counts. */
  .shelf-summary dd.date {
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    font-weight: 500;
    letter-spacing: 0.02em;
    line-height: 1.25;
    padding-bottom: 4px;
  }
  .shelf-summary small {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }

  /* --- The paper section: the band rhythm every /health section keeps --- */
  .shelf {
    padding: clamp(44px, 5vw, 76px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid rgba(26, 16, 8, 0.12);
  }
  /* The band rule separates one section from the NEXT. The last one is
     followed by the ink footer, which separates itself — left in, it draws a
     stray rule across the empty space a short page leaves above the foot. */
  section:last-of-type {
    border-bottom: none;
  }
  .shelf-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .empty {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    padding: 30px 2px;
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: clamp(12px, 1.4vw, 18px);
  }
  /* Editorial register, so the card is raised off the page ground rather than
     tinted into it — but still square, and still without a shadow. */
  .card {
    position: relative;
    min-height: 168px;
    border: 1px solid var(--card-border);
    background: var(--surface-card);
    transition: border-color var(--t-base) var(--ease-out);
  }
  .card:hover {
    border-color: var(--text-primary);
  }
  .card.newest {
    border-left: 2px solid var(--accent);
  }
  .card-main {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 18px 18px 16px;
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
    border-radius: 0;
    padding: 1px 5px;
  }
  .card-title {
    font-family: var(--font-display);
    font-size: 20px;
    line-height: 1.1;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    color: var(--text-primary);
  }
  .card-desc {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
  }
  /* Pinned to the bottom edge of the card, so every card in a row ends on the
     same line whatever the description does above it. */
  .card-cta {
    margin-top: auto;
    padding-top: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent);
  }
  /* Only the owner has an `edit` chip in that corner, so only the owner's
     kicker has to get out of its way — reserving the gutter for everyone
     wrapped the date onto a second line on a public visit. */
  .card.owner .card-kicker {
    padding-right: 52px;
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
    border-radius: 0;
    padding: 3px 8px;
    background: var(--surface-card);
  }
  .card-edit:hover {
    border-color: var(--accent-ink);
  }

  @media (max-width: 900px) {
    .lede-inner {
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
    }
  }
  @media (max-width: 520px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .shelf-summary {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
