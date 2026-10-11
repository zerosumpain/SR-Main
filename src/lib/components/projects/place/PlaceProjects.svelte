<svelte:options css="injected" />

<script lang="ts">
  // /projects read as a place: the index as a town, in the home page's
  // daylight. The title hangs in a pale sky over a street where every
  // project on the page is one building, its quarter its kind: civic
  // buildings for the field studies, a funfair for the games, the works for
  // the tools and new glass towers for what an agent built
  // ($lib/projects/place). Three readings hang over the roofs they count. A
  // dark pavement under the street names the quarters on a fingerpost, and
  // below it each quarter's plots stand under the city's deep blue, a
  // building and its particulars apiece.
  //
  // Pure props to markup: nothing is fetched or measured, nothing moves on
  // its own. Pointing at a building raises its name; that is all.
  import type { ProjectsViewProps } from '$lib/projects/views';
  import { plural } from '$lib/projects/views';
  import { facade, quarters, street, QUARTERS, type Facade } from './place';
  import PpBuilding from './PpBuilding.svelte';
  import PpQuarter from './PpQuarter.svelte';
  import PpStreet from './PpStreet.svelte';

  let { hand, agent, showAgent, counts, owner, dateline, controls, switcher }: ProjectsViewProps = $props();

  let qs = $derived(quarters(hand, agent, showAgent));
  let wide = $derived(street(hand, agent, showAgent, counts, owner, 'wide'));
  let narrow = $derived(street(hand, agent, showAgent, counts, owner, 'narrow'));
  let anyAgent = $derived(showAgent && agent.length > 0);
  let anyProduct = $derived([...hand, ...agent].some((e) => e.product));

  // The key: one small building per quarter on the street, and the two marks that are not shapes.
  const KEY_ART: Record<string, Facade> = {
    study: facade({ key: 'key-study', family: 'study' }, 'pediment', 34, 30),
    game: facade({ key: 'key-game', family: 'game' }, 'wheel', 32, 32),
    tool: facade({ key: 'key-tool', family: 'tool' }, 'sawtooth', 40, 22),
    agent: facade({ key: 'key-agent', family: 'agent' }, 'slab', 18, 34),
    product: facade({ key: 'key-product', family: 'agent', product: true }, 'setback', 20, 34),
  };
  const KEY_WORD: Record<string, string> = {
    study: 'a field study',
    game: 'a game',
    tool: 'a tool',
    agent: 'built by an agent',
  };
</script>

<div class="pp">
  <section class="pp-sky" aria-labelledby="pp-h">
    <div class="pp-in">
      <div class="pp-top">
        <p class="pp-eye">Field studies · games · tools</p>
        <div class="pp-switch">{@render switcher()}</div>
        <h1 id="pp-h">THINGS I'VE BUILT.<br /><span>SOME OF THEM WORK.</span></h1>
        <div class="pp-lede">
          <p class="pp-stand">
            Interactive field studies, strategy games and data tools, several of them digging into how government and
            education data fits together.
            {#if anyAgent}
              Some made by hand, some built by an agent from a single prompt; those stand in the New Town.
            {:else}
              These were made by hand.
            {/if}
          </p>
          <div class="pp-date">
            <p class="pp-dl">The workbench · {dateline} · {plural(counts.bench, 'project')}</p>
            <p class="pp-say">One building to a project, one quarter to a kind. Every door opens its project.</p>
          </div>
        </div>
        <dl class="pp-key" aria-label="The key">
          {#each qs as q (q.quarter.id)}
            <div>
              <dt><span class="pp-key-art" aria-hidden="true"><PpBuilding f={KEY_ART[q.quarter.id]} fit="keep" /></span>{q.quarter.building}</dt>
              <dd>{KEY_WORD[q.quarter.id]}</dd>
            </div>
          {/each}
          {#if anyProduct}
            <div>
              <dt><span class="pp-key-art" aria-hidden="true"><PpBuilding f={KEY_ART.product} fit="keep" /></span>Petrol</dt>
              <dd>a finished product</dd>
            </div>
          {/if}
          {#if owner && counts.hidden > 0}
            <div>
              <dt><span class="pp-key-art" aria-hidden="true"><i class="pp-key-dash"></i></span>Dashed</dt>
              <dd>not public, for your eyes</dd>
            </div>
          {/if}
        </dl>
      </div>

      {#if wide.lots.length || wide.vacant}
        <div class="pp-world">
          <PpStreet s={wide} {owner} />
          <PpStreet s={narrow} {owner} />
        </div>
      {:else}
        <p class="pp-none">Nothing is built here yet.</p>
      {/if}
    </div>
  </section>

  <!-- The pavement: the quarters' numbers stand on it, under the street; the fingerpost points down the page to each. -->
  <nav class="pp-ground" aria-label="The quarters">
    <div class="pp-in">
      <ul class="pp-post">
        {#each qs as q, i (q.quarter.id)}
          <li>
            <a href="#{q.quarter.anchor}" data-q={q.quarter.id}>
              <span class="pp-nm"><span class="pp-no">{String(i + 1).padStart(2, '0')}</span> {q.quarter.name}</span>
              <span class="pp-ct">{q.entries.length ? plural(q.entries.length, 'building') : 'an empty plot'}</span>
              <svg class="pp-go" viewBox="0 0 16 12" aria-hidden="true" focusable="false"><path d="M1,6 H14 M9,1 L14,6 L9,11" /></svg>
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </nav>

  {#each qs as q, i (q.quarter.id)}
    <PpQuarter quarter={QUARTERS[q.quarter.id]} entries={q.entries} no={i + 1} {controls} />
  {/each}
</div>

<style>
  .pp {
    --gut: clamp(16px, 4vw, 64px);
    --ink: 26, 16, 8;
    --ground: #131a23;
    position: relative;
    background: #1b3b6a;
  }
  .pp-in {
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut);
    box-sizing: border-box;
  }

  /* ------------------------------------------------------------- the sky */

  /* The home page's daytime sky (sky.ts at a high sun): pale blue, paler
     toward the street, a haze along the skyline. The band clips sideways
     only, so nothing in the picture can widen the page, and the quarters'
     numbers can still stand on the pavement below it. */
  .pp-sky {
    position: relative;
    z-index: 1;
    overflow-x: clip;
    color: rgb(var(--ink));
    background: linear-gradient(180deg, #87b9e6 0%, #aed0ee 48%, #d3e6f4 100%);
    /* The switch, in ink on the sky (ViewSwitch). */
    --pvs-dim: rgba(26, 16, 8, 0.72);
    --pvs-ink: rgba(26, 16, 8, 0.86);
    --pvs-on: #6e2c06;
  }
  .pp-top {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 300px);
    grid-template-areas:
      'eye eye'
      'h1 key'
      'lede key';
    gap: 0 48px;
    padding-top: clamp(20px, 3.5vh, 36px);
  }
  .pp-eye {
    grid-area: eye;
    align-self: end;
    margin: 0 0 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #6e2c06;
  }
  .pp-switch {
    position: absolute;
    top: clamp(20px, 3.5vh, 36px);
    right: 0;
    white-space: nowrap;
  }
  h1 {
    grid-area: h1;
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(var(--fs-display-sm), 5.4vw, var(--fs-display-md));
    line-height: 0.92;
    letter-spacing: -0.04em;
    text-transform: uppercase;
  }
  h1 span {
    color: #164651;
  }
  .pp-lede {
    grid-area: lede;
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: 16px 32px;
    align-items: start;
    margin-top: 18px;
  }
  .pp-stand {
    margin: 0;
    font-size: var(--fs-body-lg);
    line-height: 1.45;
    color: rgba(var(--ink), 0.84);
  }
  .pp-date {
    padding-left: 16px;
    border-left: 1px solid rgba(var(--ink), 0.3);
  }
  .pp-dl {
    margin: 0 0 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #6e2c06;
  }
  .pp-say {
    margin: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: var(--fs-body-lg);
    line-height: 1.4;
    color: rgba(var(--ink), 0.86);
  }

  /* The key, like a map's: a small building and what it stands for. */
  .pp-key {
    grid-area: key;
    align-self: start;
    display: grid;
    gap: 6px;
    margin: 12px 0 0;
    padding: 4px 0 4px 16px;
    border-left: 1px solid rgba(var(--ink), 0.3);
  }
  .pp-key > div {
    position: relative;
    min-height: 36px;
    padding-left: 50px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .pp-key dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgb(var(--ink));
  }
  .pp-key dd {
    margin: 0;
    font-size: var(--fs-label);
    line-height: 1.3;
    color: rgba(var(--ink), 0.78);
  }
  .pp-key-art {
    position: absolute;
    left: 0;
    top: 50%;
    width: 40px;
    height: 34px;
    margin-top: -17px;
  }
  .pp-key-dash {
    display: block;
    width: 34px;
    height: 24px;
    margin: 5px 3px;
    box-sizing: border-box;
    border: 1px dashed rgba(var(--ink), 0.7);
    background: rgba(239, 232, 218, 0.55);
  }

  /* -------------------------------------------------------- the street */

  .pp-world {
    position: relative;
    /* Room over the roofs for the readings at their two heights. */
    padding-top: 128px;
  }
  .pp-world > :global(.ps[data-fit='narrow']) {
    display: none;
  }
  .pp-none {
    margin: 48px 0 0;
    padding-bottom: 48px;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: var(--fs-body-lg);
  }

  /* -------------------------------------------- the pavement and the post */

  .pp-ground {
    position: relative;
    padding: 40px 0 22px;
    background: var(--ground);
    border-top: 1px solid rgba(var(--ink), 0.3);
    color: #ede4d4;
  }
  /* The kerb between the street and the pavement. */
  .pp-ground::before {
    content: '';
    position: absolute;
    inset: 0 0 auto 0;
    height: 6px;
    background: rgba(237, 228, 212, 0.06);
    border-bottom: 1px solid rgba(237, 228, 212, 0.12);
  }
  .pp-post {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 196px), 1fr));
    gap: 10px 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pp-post a {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    height: 100%;
    min-height: 44px;
    box-sizing: border-box;
    padding: 10px 42px 10px 14px;
    background: #1c2633;
    border: 1px solid rgba(237, 228, 212, 0.3);
    border-left: 3px solid #e8863a;
    color: #ede4d4;
    text-decoration: none;
  }
  .pp-post a[data-q='agent'] {
    border-left-color: #7fb8c0;
  }
  .pp-post a:hover {
    background: #25303f;
  }
  .pp-post a:hover .pp-nm {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .pp-post a:focus-visible {
    outline: 2px solid #e8863a;
    outline-offset: 3px;
  }
  .pp-no {
    margin-right: 4px;
    font-weight: 400;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: rgba(237, 228, 212, 0.72);
  }
  .pp-nm {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: var(--fs-body);
    letter-spacing: -0.01em;
  }
  .pp-ct {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: #f4b270;
  }
  .pp-go {
    position: absolute;
    top: 50%;
    right: 14px;
    width: 16px;
    height: 12px;
    margin-top: -6px;
    fill: none;
    stroke: #e8863a;
    stroke-width: 1.6;
    transform: rotate(90deg);
  }

  /* ----------------------------------------------------------- narrower */

  @media (max-width: 1099px) {
    .pp-top {
      grid-template-columns: minmax(0, 1fr) minmax(0, 260px);
      gap: 0 32px;
    }
    .pp-lede {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 759px) {
    .pp-top {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas:
        'switch'
        'eye'
        'h1'
        'lede'
        'key';
    }
    .pp-switch {
      position: static;
      justify-self: end;
      margin: 0 0 12px;
    }
    .pp-key {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 4px 12px;
      margin-top: 20px;
      padding: 0;
      border: 0;
    }
    .pp-stand {
      font-size: var(--fs-body);
    }
  }
  @media (max-width: 639px) {
    .pp-world {
      padding-top: 132px;
    }
    .pp-world > :global(.ps[data-fit='wide']) {
      display: none;
    }
    .pp-world > :global(.ps[data-fit='narrow']) {
      display: block;
    }
    .pp-post {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .pp-post a {
      height: 100%;
      padding: 8px 30px 8px 10px;
    }
    .pp-nm {
      font-size: var(--fs-body-sm);
      line-height: 1.25;
    }
    .pp-go {
      right: 8px;
    }
  }

  @media print {
    .pp,
    .pp-sky,
    .pp-ground {
      background: none;
      color: #1a1008;
    }
    .pp-world,
    .pp-ground,
    .pp-key {
      display: none;
    }
    h1 span,
    .pp-eye,
    .pp-dl {
      color: #1a1008;
    }
  }
</style>
