<script lang="ts">
  // WHERE YOUR DOCUMENT GOES — the page's answer to the only question a reader
  // asks before uploading something that is not theirs to leak.
  //
  // The content is `handling.ts` and nothing here decides anything: this draws
  // it twice, as a picture and as a list, and the list is NOT a fallback. It is
  // what a screen reader gets, what the printer gets, and what the Word export
  // gets, and it carries the same six stops in the same order. The interplay map
  // already works this way for the same reasons.
  //
  // THE PICTURE EXISTS FOR ONE ARROW. Five of the six stops are on a machine we
  // control and can be destroyed on demand; the model that reads the paper runs
  // on somebody else's computer, and a copy stays there. A diagram that drew a
  // tidy closed loop would be prettier and would be a lie, so the model sits off
  // the spine with an arrow leaving it that does not come back.
  import { beyond, destroyed, headline, journey, kept, PLACE_LABEL, type Stop } from '$lib/policy-analysis/handling';

  let { sealed = false }: { sealed?: boolean } = $props();

  const stops = $derived(journey(sealed));
  const spine = $derived(stops.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => s.place !== 'away'));
  const away = $derived(stops.map((s, i) => ({ ...s, n: i + 1 })).find((s) => s.place === 'away')!);

  // REAL UNITS IN THE viewBox, not a 0–100 box. SVG text scales with the viewBox,
  // so a genuine 12px token inside a 100-unit box would render at a twelfth of
  // its size — and the font-size gate would rightly refuse the hand-tuned
  // sub-pixel literal that hides it.
  const W = 980;
  const H = 352;
  const BOX_W = 168;
  const BOX_H = 98;
  const GAP = (W - 32 - 5 * BOX_W) / 4;
  const x = (i: number) => 16 + i * (BOX_W + GAP);
  // MOVED DOWN WITH THE BOXES. `ELBOW_Y` hangs off the away box's bottom edge, so
  // growing the boxes for the detail line pushed the elbow to 184 — exactly where
  // the spine's edge labels sit at `SPINE_Y - 12`. The two would have printed on
  // top of each other, which is the second time this diagram has taught that
  // lesson, so the clearance is now stated rather than inferred.
  const SPINE_Y = 230;
  const AWAY_X = x(1) + BOX_W / 2 + 20;
  const AWAY_Y = 40;
  /** Where both arrows turn, below the box and above the spine, clear of every label. */
  const ELBOW_Y = AWAY_Y + BOX_H + 46;
</script>

<div class="hp">
  <p class="hp-headline">{headline(sealed)}</p>

  <figure class="hp-fig">
    <svg viewBox="0 0 {W} {H}" role="img" aria-label="Where a policy document goes: five steps on this site, and one step on the model provider's computers which this site cannot reach.">
      <defs>
        <marker id="hp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" class="hp-head" />
        </marker>
        <marker id="hp-arrow-away" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" class="hp-head-away" />
        </marker>
      </defs>

      <!-- The spine: everything on this site, plus the copy you take away. -->
      {#each spine as stop, i (stop.n)}
        {#if i > 0}
          <line
            class="hp-link"
            x1={x(i - 1) + BOX_W}
            y1={SPINE_Y + BOX_H / 2}
            x2={x(i) - 4}
            y2={SPINE_Y + BOX_H / 2}
            marker-end="url(#hp-arrow)"
          />
        {/if}
        <rect
          class="hp-box"
          class:hp-you={stop.place === 'you'}
          x={x(i)}
          y={SPINE_Y}
          width={BOX_W}
          height={BOX_H}
          rx="2"
        />
        <text class="hp-n" x={x(i) + 12} y={SPINE_Y + 22}>{String(stop.n).padStart(2, '0')}</text>
        <text class="hp-name" x={x(i) + 12} y={SPINE_Y + 46}>{stop.short}</text>
        <text class="hp-where" x={x(i) + 12} y={SPINE_Y + 64}>
          {stop.place === 'you' ? 'with you' : 'this site'}
        </text>
        <line class="hp-rule" x1={x(i) + 12} y1={SPINE_Y + 74} x2={x(i) + BOX_W - 12} y2={SPINE_Y + 74} />
        <text class="hp-detail" x={x(i) + 12} y={SPINE_Y + 89}>{stop.detail}</text>
      {/each}

      <!-- The model. Off the spine, because it is not on this machine. -->
      <rect class="hp-box hp-away" x={AWAY_X} y={AWAY_Y} width={BOX_W + 40} height={BOX_H} rx="2" />
      <text class="hp-n hp-n-away" x={AWAY_X + 12} y={AWAY_Y + 22}>{String(away.n).padStart(2, '0')}</text>
      <text class="hp-name hp-name-away" x={AWAY_X + 12} y={AWAY_Y + 46}>{away.short}</text>
      <text class="hp-where hp-where-away" x={AWAY_X + 12} y={AWAY_Y + 64}>somebody else’s computer</text>
      <line class="hp-rule hp-rule-away" x1={AWAY_X + 12} y1={AWAY_Y + 74} x2={AWAY_X + BOX_W + 28} y2={AWAY_Y + 74} />
      <text class="hp-detail hp-detail-away" x={AWAY_X + 12} y={AWAY_Y + 89}>{away.detail}</text>

      <!--
        Up: the paper goes. Down: the assessment comes back. BOTH MEET THE BOX AT
        ITS BOTTOM EDGE — entering the left edge at mid-height drew the arrow
        straight through the box's own label, which reads as a rendering fault
        rather than as a route.
      -->
      <path
        class="hp-link hp-link-away"
        d="M {x(0) + BOX_W / 2} {SPINE_Y} V {ELBOW_Y} H {AWAY_X + 40} V {AWAY_Y + BOX_H + 5}"
        marker-end="url(#hp-arrow-away)"
      />
      <path
        class="hp-link hp-link-away"
        d="M {AWAY_X + BOX_W} {AWAY_Y + BOX_H + 5} V {ELBOW_Y} H {x(1) + BOX_W / 2} V {SPINE_Y - 5}"
        marker-end="url(#hp-arrow-away)"
      />
      <!--
        EACH LABEL SITS ON THE RISER IT DESCRIBES, at the spine end where the
        reader's eye already is. Stacked near the box they overlapped each other
        and then sat nowhere near their own line — "the assessment comes back" is
        27 monospace characters and the two risers up there are 128 units apart.
        Down here they are 190 apart and the labels clear each other by 75, and
        the arrow character leads so it sits beside the line it belongs to.
      -->
      <text class="hp-edge" x={x(0) + BOX_W / 2 + 8} y={SPINE_Y - 12}>↑ the paper goes</text>
      <text class="hp-edge" x={x(1) + BOX_W / 2 + 8} y={SPINE_Y - 12}>↓ the assessment comes back</text>

      <!-- And the arrow that does not come back. This is the point of the picture. -->
      <line
        class="hp-link hp-link-gone"
        x1={AWAY_X + BOX_W + 40}
        y1={AWAY_Y + 18}
        x2={W - 16}
        y2={AWAY_Y + 18}
        marker-end="url(#hp-arrow-away)"
      />
      <!--
        WAS "we cannot delete it", which went out with no source behind it and was
        too strong. OpenAI keeps it for up to 30 days and then deletes it, and it
        can be removed from that account sooner. What is true, and what a reader
        needs, is that this site cannot reach it.
      -->
      <text class="hp-gone" x={W - 16} y={AWAY_Y + 6} text-anchor="end">a copy stays there — not ours to delete</text>
    </svg>
    <figcaption>
      Five of the six steps happen on one machine, and {sealed ? 'destroying the key ends all of them at once' : 'a purge removes all of them'}.
      Step {away.n} does not, and no promise on this page covers it.
    </figcaption>
  </figure>

  <!-- The same journey as words. Not a fallback: this is what a screen reader,
       a printer and the exported document all read. -->
  <ol class="hp-stops">
    {#each stops as stop, i (stop.title)}
      <li class:away={stop.place === 'away'}>
        <span class="hp-stop-n">{String(i + 1).padStart(2, '0')}</span>
        <div>
          <p class="hp-stop-h">
            {stop.title}
            <span class="hp-tag" class:away={stop.place === 'away'}>{PLACE_LABEL[stop.place]}</span>
            <span class="hp-detail-chip">{stop.detail}</span>
          </p>
          <p class="hp-stop-w">{stop.what}</p>
          {#if stop.emphasis}<p class="hp-stop-w hp-stop-key"><strong>{stop.emphasis}</strong></p>{/if}
        </div>
      </li>
    {/each}
  </ol>

  <div class="hp-lists">
    <section>
      <p class="hp-list-h">While it exists, this site holds</p>
      <ul>{#each kept(sealed) as line (line)}<li>{line}</li>{/each}</ul>
    </section>
    <section>
      <p class="hp-list-h">A purge destroys</p>
      <ul>{#each destroyed(sealed) as line (line)}<li>{line}</li>{/each}</ul>
    </section>
    <section class="hp-beyond">
      <p class="hp-list-h">Nobody here can reach</p>
      <ul>{#each beyond(sealed) as line (line)}<li>{line}</li>{/each}</ul>
    </section>
  </div>
</div>


<style>
  .hp { display: grid; gap: 1.5rem; }
  .hp-headline {
    margin: 0;
    font-size: var(--fs-body-lg);
    line-height: 1.5;
    max-width: 70ch;
  }

  .hp-fig { margin: 0; }
  /* The diagram is wide by nature; it scrolls in its own wrapper rather than
     making the page scroll sideways. */
  .hp-fig svg {
    display: block;
    width: 100%;
    min-width: 720px;
    height: auto;
  }
  .hp-fig { overflow-x: auto; }
  figcaption {
    margin-top: .6rem;
    font-size: var(--fs-label);
    color: var(--text-muted);
    max-width: 70ch;
  }

  .hp-box { fill: var(--surface-elevated); stroke: var(--line-strong); stroke-width: 1; }
  .hp-you { stroke: var(--accent-ink); stroke-width: 2; }
  .hp-away { fill: var(--bg); stroke: var(--accent); stroke-width: 2; }
  .hp-n { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: var(--text-ghost); }
  .hp-n-away { fill: var(--accent); }
  .hp-name { font-family: var(--font-body); font-size: var(--fs-body-sm); font-weight: 600; fill: var(--text-primary); }
  .hp-name-away { fill: var(--accent); }
  .hp-where {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    fill: var(--text-muted);
    letter-spacing: .04em;
    text-transform: uppercase;
  }
  .hp-where-away { fill: var(--accent); }
  /* A hairline, not a second border: the detail is part of the box, below a rule
     that separates "what this step is" from "what is true here". */
  .hp-rule { stroke: var(--divider); stroke-width: 1; }
  .hp-rule-away { stroke: var(--accent); opacity: .35; }
  .hp-detail {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    fill: var(--text-secondary);
    letter-spacing: .02em;
  }
  .hp-detail-away { fill: var(--accent); }
  .hp-link { stroke: var(--line-strong); stroke-width: 1.5; fill: none; }
  .hp-link-away { stroke: var(--accent); }
  .hp-link-gone { stroke: var(--accent); stroke-dasharray: 5 4; }
  .hp-head { fill: var(--line-strong); }
  .hp-head-away { fill: var(--accent); }
  .hp-edge, .hp-gone {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    fill: var(--text-muted);
    letter-spacing: .04em;
  }
  .hp-gone { fill: var(--accent); }

  .hp-stops { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; border-top: 1px solid var(--line-strong); }
  .hp-stops li {
    display: grid;
    grid-template-columns: 3.2rem minmax(0, 1fr);
    gap: .5rem;
    padding: .85rem 0;
    border-bottom: 1px solid var(--divider);
  }
  /* The one step that leaves gets a rule, not a fill: it is a caveat, not a
     category, and nothing on this page is signalled by colour alone. */
  .hp-stops li.away { border-left: 3px solid var(--accent); padding-left: .75rem; }
  .hp-stop-n { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); }
  .hp-stop-h { margin: 0 0 .25rem; font-weight: 600; }
  .hp-stop-w { margin: 0; font-size: var(--fs-label); line-height: 1.6; color: var(--text-secondary); max-width: 78ch; }
  .hp-stop-key { margin-top: .4rem; color: var(--text-primary); }
  .hp-tag {
    display: inline-block;
    margin-left: .5rem;
    padding: 1px 6px;
    border: 1px solid var(--line-strong);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--text-muted);
    vertical-align: 2px;
  }
  .hp-tag.away { border-color: var(--accent); color: var(--accent); }
  /* The diagram's own line, repeated where the words are — so a reader who never
     looks at the picture still gets what each box was carrying. */
  .hp-detail-chip {
    margin-left: .4rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: .02em;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .hp-lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.25rem; }
  .hp-list-h {
    margin: 0 0 .5rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .hp-lists ul { margin: 0; padding-left: 1.1rem; display: grid; gap: .4rem; }
  .hp-lists li { font-size: var(--fs-label); line-height: 1.55; }
  .hp-beyond { border-left: 3px solid var(--accent); padding-left: .9rem; }

  @media print {
    .hp-fig { overflow: visible; }
    .hp-fig svg { min-width: 0; }
    .hp-stops li { break-inside: avoid; }
  }
</style>
