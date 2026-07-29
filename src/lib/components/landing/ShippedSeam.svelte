<script lang="ts">
  import { onMount } from 'svelte';
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { dur } from '$lib/motion';
  import {
    buildSeamField,
    columnAtFraction,
    envelopePoints,
    shortDate,
    HORIZON,
    VIEW_H,
    VIEW_W,
  } from '$lib/releases/seam';
  import type { ShowcasePayload } from '$lib/releases/public';

  let { data }: { data: ShowcasePayload } = $props();

  const field = buildSeamField(data.cadence);
  const envelope = envelopePoints(field);

  let mounted = $state(false);
  // `armed` is what hides the section ahead of its entrance, and it is only ever
  // set from JS. Without JS — or for a crawler — the section stays fully
  // visible, which is the entire reason it is server-rendered rather than
  // streamed. It is also skipped when the section is already on screen at load,
  // so a deep link or a mid-page refresh never flashes.
  let armed = $state(false);
  let visible = $state(false);
  let sectionEl: HTMLElement;

  // Scrubbing. -1 means "not scrubbing" — the readout then shows the newest
  // day, so the panel is never empty and never shifts height.
  let hover = $state(-1);
  let fieldEl: HTMLElement;

  const active = $derived(hover >= 0 ? hover : field.days - 1);
  const activeCol = $derived(field.columns[active]);

  // The items shipped on the scrubbed day, newest first. Falls back to the most
  // recent items so a quiet day still shows what the site can do.
  const activeItems = $derived.by(() => {
    if (!activeCol) return data.items.slice(0, 3);
    const onDay = data.items.filter((i) => i.deployedAt.slice(0, 10) === activeCol.date);
    return onDay.length ? onDay.slice(0, 3) : [];
  });

  // Headline numerals roll up once, on reveal. Rendered as the final value
  // before mount so the SSR HTML carries the real figure — a crawler and a
  // no-JS visitor must see "418", never "0".
  const releasesT = new Tween(0, { duration: dur(900), easing: cubicOut });
  const shippedT = new Tween(0, { duration: dur(900), easing: cubicOut });
  const linesT = new Tween(0, { duration: dur(1100), easing: cubicOut });

  $effect(() => {
    if (!visible) return;
    releasesT.target = data.totals.releases;
    shippedT.target = data.totals.shipped;
    linesT.target = data.totals.insertions;
  });

  function fmt(n: number): string {
    return Math.round(n).toLocaleString('en-GB');
  }

  const releasesN = $derived(mounted && visible ? fmt(releasesT.current) : fmt(data.totals.releases));
  const shippedN = $derived(mounted && visible ? fmt(shippedT.current) : fmt(data.totals.shipped));
  const linesN = $derived(mounted && visible ? fmt(linesT.current) : fmt(data.totals.insertions));

  const perDay = $derived(
    data.totals.days > 0 ? (data.totals.releases / data.totals.days).toFixed(1) : '0',
  );

  function trackPointer(e: PointerEvent) {
    if (!fieldEl) return;
    const r = fieldEl.getBoundingClientRect();
    if (r.width === 0) return;
    hover = columnAtFraction(field, (e.clientX - r.left) / r.width);
  }

  function onKey(e: KeyboardEvent) {
    const last = field.days - 1;
    if (last < 0) return;
    const from = hover >= 0 ? hover : last;
    let next = from;
    if (e.key === 'ArrowLeft') next = Math.max(0, from - 1);
    else if (e.key === 'ArrowRight') next = Math.min(last, from + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (e.key === 'Escape') next = -1;
    else return;
    e.preventDefault();
    hover = next;
  }

  onMount(() => {
    mounted = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      visible = true;
      return;
    }
    // Already on screen? Leave it alone rather than hiding painted content.
    const box = sectionEl.getBoundingClientRect();
    if (box.top < window.innerHeight * 0.9) {
      visible = true;
      return;
    }
    armed = true;
    // threshold 0 fires on the first intersecting pixel. A ratio-based
    // threshold is unsafe here: the section is taller than a short viewport,
    // in which case it can never reach a 10% ratio and would stay hidden.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            visible = true;
            io.disconnect();
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0 },
    );
    io.observe(sectionEl);
    return () => io.disconnect();
  });
</script>

<section bind:this={sectionEl} class="seam-sec" class:armed class:visible>
  <header class="seam-hd">
    <span class="seam-eyebrow">Shipped</span>
    <span class="seam-rule"></span>
    <span class="seam-meta">Every deploy since 19 Mar 2026</span>
  </header>

  <!-- LEDE — the 8-second read: three declarative numerals, then the sentence
       that tells you what they are evidence of. -->
  <div class="seam-lede">
    <div class="seam-figures">
      <div class="fig">
        <span class="fig-n">{releasesN}</span>
        <span class="fig-l">releases</span>
      </div>
      <div class="fig">
        <span class="fig-n">{shippedN}</span>
        <span class="fig-l">things shipped</span>
      </div>
      <div class="fig">
        <span class="fig-n">{linesN}</span>
        <span class="fig-l">lines written</span>
      </div>
    </div>
    <div class="seam-copy">
      <p class="seam-strap">
        {data.totals.days} days of continuous deployment, by one person, in the evenings.
        Everything below is derived from the deployed commit range — not a word of it was
        written by hand.
      </p>
      <p class="seam-figs">
        {fmt(data.totals.commits)} COMMITS <span class="sep">/</span>
        {fmt(data.totals.files)} FILES TOUCHED <span class="sep">/</span>
        {perDay} DEPLOYS A DAY
      </p>
    </div>
  </div>

  <!-- THE FIELD — deploys above the horizon, the capabilities they carried
       below it. One mark, read as effort against result. -->
  <div class="seam-field">
    <div class="seam-ruler" aria-hidden="true">
      {#each field.ticks as t (t.i)}
        <span class="seam-tick" style="left: {(t.cx / VIEW_W) * 100}%">{t.label}</span>
      {/each}
    </div>

    <div
      bind:this={fieldEl}
      class="seam-plot"
      role="slider"
      tabindex="0"
      aria-label="Deploy history — arrow keys to scrub by day"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, field.days - 1)}
      aria-valuenow={active}
      aria-valuetext={activeCol
        ? `${shortDate(activeCol.date)}: ${activeCol.deploys} deploys, ${activeCol.shipped} shipped`
        : 'no data'}
      onpointermove={trackPointer}
      onpointerleave={() => (hover = -1)}
      onkeydown={onKey}
    >
      <svg
        class="seam-svg"
        viewBox="0 0 {VIEW_W} {VIEW_H}"
        preserveAspectRatio="none"
        role="img"
        aria-label="A comb of {field.days} days. Bars above the centre line are deploys that day; bars below are the capabilities they shipped."
      >
        <!-- Month graticule -->
        {#each field.ticks as t (t.i)}
          <line
            x1={t.cx} x2={t.cx} y1="6" y2={VIEW_H - 6}
            stroke="var(--text-primary)" stroke-opacity="0.09" stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        {/each}

        <!-- Deploys, above the horizon. Opacity carries how much of that day's
             work is publicly describable, so the field is never flat. -->
        <g class="seam-up">
          {#each field.columns as c (c.i)}
            {#if c.deploys > 0}
              <rect
                x={c.cx - c.w / 2} y={c.upY} width={c.w} height={HORIZON - c.upY}
                fill="var(--accent)" fill-opacity={0.3 + 0.55 * c.yield}
              />
            {/if}
          {/each}
        </g>

        <!-- One continuous signal through the peaks — this is what makes 133
             separate bars read as an organism rather than a bar chart. -->
        {#if envelope}
          <polyline
            class="seam-envelope"
            points={envelope}
            fill="none" stroke="var(--accent)" stroke-width="1" stroke-opacity="0.18"
            stroke-linejoin="round" vector-effect="non-scaling-stroke"
          />
        {/if}

        <!-- Capabilities, below the horizon. --accent-ink is the sanctioned
             second series; it separates result from effort without inventing a hue. -->
        <g class="seam-down">
          {#each field.columns as c (c.i)}
            {#if c.shipped > 0}
              <rect
                x={c.cx - c.w / 2} y={HORIZON} width={c.w} height={c.downY - HORIZON}
                fill="var(--accent-ink)" fill-opacity="0.5"
              />
            {/if}
          {/each}
        </g>

        <!-- The seam itself: the house 2px accent rail, laid flat. -->
        <line
          x1="0" x2={VIEW_W} y1={HORIZON} y2={HORIZON}
          stroke="var(--text-primary)" stroke-opacity="0.18" stroke-width="2"
          vector-effect="non-scaling-stroke"
        />

        {#if activeCol}
          <line
            class="seam-scrub"
            x1={activeCol.cx} x2={activeCol.cx} y1="6" y2={VIEW_H - 6}
            stroke="var(--accent)" stroke-opacity={hover >= 0 ? 0.9 : 0.45} stroke-width="2"
            vector-effect="non-scaling-stroke"
          />
        {/if}
      </svg>
    </div>

    <!-- READOUT — real titles, so the chart is evidence rather than decoration. -->
    <div class="seam-readout">
      <div class="ro-head">
        <span class="ro-date">{activeCol ? shortDate(activeCol.date) : '—'}</span>
        <span class="ro-stat">
          {activeCol?.deploys ?? 0} deploy{(activeCol?.deploys ?? 0) === 1 ? '' : 's'}
        </span>
        <span class="ro-hint">{hover >= 0 ? 'scrubbing' : 'latest'}</span>
      </div>
      {#if activeItems.length}
        <ul class="ro-list">
          {#each activeItems as item (item.title)}
            <li>
              <span class="ro-kind" data-kind={item.kind}>{item.kind}</span>
              <span class="ro-title">{item.title}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="ro-empty">Infrastructure and internal work — nothing user-facing that day.</p>
      {/if}
    </div>

    <footer class="seam-foot">
      <p class="seam-note">
        403 of these releases were reconstructed from git history, so their timestamps are
        approximate. Entries describing internal or private work are not listed.
      </p>
      <a class="seam-cta" href="/releases">
        <span>Browse the full record</span>
        <span class="cta-arrow" aria-hidden="true">→</span>
      </a>
    </footer>
  </div>
</section>

<style>
  /* Matches FeatureIndex's .index-sec box exactly — the two sections read as
     one column down the page. */
  .seam-sec {
    max-width: 1120px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
    padding: 64px 24px 24px;
    content-visibility: auto;
    contain-intrinsic-size: auto 720px;
  }
  @media (min-width: 640px) {
    .seam-sec {
      padding-left: 40px;
      padding-right: 40px;
    }
  }
  @media (min-width: 768px) {
    .seam-sec {
      padding-left: 64px;
      padding-right: 64px;
    }
  }

  .seam-hd {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 26px;
  }
  .seam-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--accent);
  }
  .seam-rule {
    flex: 1;
    height: 1px;
    background: var(--divider);
  }
  .seam-meta {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }

  .seam-lede {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr);
    gap: clamp(24px, 4vw, 56px);
    align-items: end;
  }
  @media (max-width: 860px) {
    .seam-lede {
      grid-template-columns: 1fr;
      gap: 26px;
    }
  }

  .seam-figures {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .fig {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  /* Deliberately below the hero's clamp(36px, 9vw, 132px) ceiling — the hero
     must stay the loudest voice on the page. */
  .fig-n {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(34px, 6vw, 62px);
    line-height: 0.88;
    letter-spacing: -0.03em;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .fig-l {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }

  .seam-strap {
    font-family: var(--font-body);
    font-size: 15px;
    line-height: 1.5;
    color: var(--text-secondary);
    border-left: 3px solid var(--accent);
    padding-left: 14px;
    margin: 0;
    max-width: 56ch;
  }
  .seam-figs {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    color: var(--accent);
    margin: 16px 0 0;
    font-variant-numeric: tabular-nums;
  }
  .seam-figs .sep {
    color: var(--text-ghost);
  }

  .seam-field {
    margin-top: clamp(28px, 4vw, 44px);
    border-top: 1px solid var(--divider);
    padding-top: 20px;
  }

  .seam-ruler {
    position: relative;
    height: 13px;
    margin-bottom: 6px;
  }
  .seam-tick {
    position: absolute;
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }

  .seam-plot {
    cursor: crosshair;
    touch-action: pan-y;
  }
  .seam-plot:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }
  .seam-svg {
    display: block;
    width: 100%;
    height: clamp(150px, 22vw, 260px);
    overflow: visible;
  }

  /* Reveal: ONE composited clip-path sweep for the whole field, not 133
     staggered element transitions — the landing page already runs a full-bleed
     ECG canvas and cannot afford a second per-element animation budget.
     Gated on .armed so the field is drawn in full when JS is absent. */
  .seam-sec.armed .seam-svg {
    clip-path: inset(0 100% 0 0);
  }
  .seam-sec.armed.visible .seam-svg {
    clip-path: inset(0 0 0 0);
    transition: clip-path 1100ms var(--ease-out);
  }
  .seam-scrub {
    transition: none;
  }

  .seam-readout {
    margin-top: 16px;
    border: 1px solid var(--card-border);
    background: var(--card-bg);
    padding: 12px 14px;
    /* Three rows plus the header, so scrubbing never reflows the page. */
    min-height: 118px;
  }
  .ro-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 8px;
  }
  .ro-date {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .ro-stat {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .ro-hint {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }

  .ro-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .ro-list li {
    display: grid;
    grid-template-columns: 5.6rem 1fr;
    gap: 10px;
    align-items: baseline;
  }
  .ro-kind {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  /* Kind is carried by weight, not hue — --success/--warn are status tokens
     meaning pass/fail and must not become categorical chart colours. */
  .ro-kind[data-kind='feature'] {
    color: var(--accent);
  }
  .ro-title {
    font-family: var(--font-body);
    font-size: 13px;
    line-height: 1.35;
    color: var(--text-primary);
  }
  .ro-empty {
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--text-muted);
    margin: 0;
  }

  .seam-foot {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 20px;
    margin-top: 14px;
    flex-wrap: wrap;
  }
  .seam-note {
    font-family: var(--font-mono);
    font-size: 9.5px;
    line-height: 1.5;
    letter-spacing: 0.02em;
    color: var(--text-ghost);
    margin: 0;
    max-width: 62ch;
  }
  .seam-cta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
    padding: 6px 0;
    white-space: nowrap;
    border-bottom: 1px solid transparent;
    transition: border-color var(--t-base) var(--ease-out);
  }
  .seam-cta:hover {
    border-bottom-color: var(--accent);
  }
  .cta-arrow {
    transition: transform var(--t-base) var(--ease-out);
  }
  .seam-cta:hover .cta-arrow {
    transform: translateX(4px);
  }

  /* Entrance for the copy, mirroring FeatureIndex's fade-up. Also gated on
     .armed — no JS means no hiding. */
  .seam-sec.armed .seam-hd,
  .seam-sec.armed .seam-lede,
  .seam-sec.armed .seam-readout,
  .seam-sec.armed .seam-foot {
    opacity: 0;
    transform: translateY(12px);
    transition:
      opacity 0.45s var(--ease-out),
      transform 0.45s var(--ease-out);
  }
  .seam-sec.armed .seam-lede {
    transition-delay: 60ms;
  }
  .seam-sec.armed .seam-readout {
    transition-delay: 120ms;
  }
  .seam-sec.armed .seam-foot {
    transition-delay: 160ms;
  }
  .seam-sec.armed.visible .seam-hd,
  .seam-sec.armed.visible .seam-lede,
  .seam-sec.armed.visible .seam-readout,
  .seam-sec.armed.visible .seam-foot {
    opacity: 1;
    transform: translateY(0);
  }

  @media (max-width: 560px) {
    .seam-sec {
      padding-top: 44px;
    }
    .ro-list li {
      grid-template-columns: 1fr;
      gap: 1px;
    }
    .seam-tick:nth-child(even) {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .seam-sec .seam-hd,
    .seam-sec .seam-lede,
    .seam-sec .seam-readout,
    .seam-sec .seam-foot,
    .seam-sec .seam-svg {
      opacity: 1;
      transform: none;
      transition: none;
      clip-path: none;
    }
    .cta-arrow {
      transition: none;
    }
  }
</style>
