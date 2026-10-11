<svelte:options css="injected" />

<script lang="ts">
  // The ink band at the top of /projects read as a sentence: the masthead as
  // the home page sets it, the switch top-right, a line that beats once per
  // project, then the whole bench in one serif sentence. Each count in it is
  // coloured, carries a footnote numeral and goes to the first of its
  // entries; the footnotes underneath list every one of them by name, each a
  // link to its paragraph further down. The dateline and the count hang in a
  // margin column on a desktop and fold in above the sentence on a phone.
  import type { Snippet } from 'svelte';
  import { benchSentence, splitTitle } from './sentence';
  import { sayCount, type ProjectCounts, type ProjectEntry, type ProjectFamily } from '$lib/projects/views';
  import SpLine from './SpLine.svelte';

  let {
    hand,
    agent,
    counts,
    owner,
    dateline,
    switcher,
  }: {
    hand: ProjectEntry[];
    agent: ProjectEntry[];
    counts: ProjectCounts;
    owner: boolean;
    dateline: string;
    switcher: Snippet;
  } = $props();

  let all = $derived([...hand, ...agent]);
  let segs = $derived(benchSentence(counts));
  let notes = $derived(
    segs.flatMap((s) => (s.t === 'fig' ? [{ ...s, entries: all.filter((e) => e.family === s.id) }] : [])),
  );

  const LABEL: Record<ProjectFamily, string> = {
    study: 'Field studies',
    game: 'Games',
    tool: 'Tools',
    agent: 'By an agent',
  };
  const anchor = (e: ProjectEntry) => `#sp-${e.key}`;
  const first = (id: ProjectFamily) => all.find((e) => e.family === id);
</script>

<header class="sb">
  <div class="sb-in sb-top">
    <div class="sb-switch">{@render switcher()}</div>
    <h1 class="sb-title">Things I’ve built.<br /><span class="sb-out">Some of them work.</span></h1>
    <p class="sb-lede">Field studies, games and data tools, several of them digging into how government and education data fits together.</p>
  </div>

  <div class="sb-line"><SpLine sections={all.map((e) => e.section)} /></div>

  <div class="sb-in sb-body">
    <ul class="sb-margin" aria-label="On the bench">
      <li class="sb-date">{dateline}</li>
      <li>{counts.bench ? `${counts.bench} on the bench` : "nothing on the bench"}</li>
      {#if owner && counts.hidden > 0}<li>{counts.hidden} only I can see</li>{/if}
      {#if all.length}<li class="sb-cap">one beat on the line above for each, in order</li>{/if}
    </ul>

    <p class="sb-say">
      {#each segs as s, i (i)}{#if s.t === 'text'}{s.s}{:else if s.t === 'total'}<span class="sb-total">{s.word}</span
          >{:else}{@const to = first(s.id)}<span class="sb-nb"
            ><a class="sb-w" data-tone={s.id === 'agent' ? 'ink' : 'accent'} href={to ? anchor(to) : '#sp-agent'}>{s.word}</a
            >{s.end ?? ''}<sup aria-hidden="true">{s.n}</sup></span
          >{/if}{/each}
    </p>

    {#if notes.length}
      <ol class="sb-notes" aria-label="Footnotes">
        {#each notes as f (f.id)}
          <li class="sb-note" data-tone={f.id === 'agent' ? 'ink' : 'accent'}>
            <span class="sb-nn" aria-hidden="true">{f.n}</span>
            <span class="sb-nh">{LABEL[f.id]}<span class="vh">, {sayCount(f.entries.length)}</span></span>
            <span class="sb-nl">
              {#each f.entries as e, j (e.key)}<a href={anchor(e)}>{splitTitle(e.title).name}</a
                >{#if j < f.entries.length - 2}{', '}{:else if j === f.entries.length - 2}{' and '}{/if}{/each}.
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</header>

<style>
  .sb {
    --gut: clamp(16px, 4vw, 64px);
    --say: clamp(21px, 2.05vw, 30px);
    --say-lh: 1.32;
    background: var(--text-primary);
    color: var(--bg);
    padding-bottom: clamp(36px, 5vh, 56px);
  }
  .sb-in {
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut);
    box-sizing: border-box;
  }
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* The masthead: the switch top-right, then the two lines and the lede. */
  .sb-top {
    display: grid;
    padding-top: clamp(16px, 2.6vh, 28px);
  }
  .sb-switch {
    justify-self: end;
    margin-bottom: clamp(10px, 2vh, 22px);
  }
  .sb-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(var(--fs-display-sm), 5vw, var(--fs-display-md));
    line-height: 0.9;
    letter-spacing: -0.04em;
    text-transform: uppercase;
    text-wrap: balance;
  }
  /* The second line in outline, as the page has always set it: the joke is
     quieter than the claim. */
  .sb-out {
    color: transparent;
    -webkit-text-stroke: 1.5px var(--bg);
  }
  @supports not (-webkit-text-stroke: 1px black) {
    .sb-out {
      color: var(--on-ink-70);
    }
  }
  .sb-lede {
    max-width: 44em;
    margin: 16px 0 0;
    font-size: var(--fs-body-lg);
    line-height: 1.45;
    color: rgba(237, 228, 212, 0.82);
  }

  .sb-line {
    margin: clamp(14px, 2.4vh, 26px) 0 clamp(16px, 2.6vh, 28px);
  }

  /* The sentence, its margin and its footnotes. */
  .sb-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    row-gap: 16px;
  }
  .sb-margin {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--on-ink-70);
  }
  .sb-date {
    color: var(--accent-on-dark);
  }
  .sb-cap {
    display: none;
    letter-spacing: 0.06em;
    text-transform: none;
    color: var(--on-ink-55);
  }
  .sb-say {
    margin: 0;
    max-width: 34em;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-weight: 400;
    font-size: var(--say);
    line-height: var(--say-lh);
    letter-spacing: -0.012em;
    color: rgba(237, 228, 212, 0.9);
    text-wrap: pretty;
  }
  .sb-total {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: max(0.88em, var(--fs-label-xs));
    letter-spacing: -0.025em;
    color: var(--bg);
  }
  .sb-nb {
    white-space: nowrap;
  }
  .sb-w {
    --tone: var(--accent-on-dark);
    position: relative;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: max(0.88em, var(--fs-label-xs));
    letter-spacing: -0.025em;
    color: var(--tone);
    text-decoration: underline dotted;
    text-decoration-thickness: 0.06em;
    text-underline-offset: 0.18em;
    text-decoration-color: color-mix(in srgb, var(--tone) 55%, transparent);
  }
  .sb-w[data-tone='ink'] {
    --tone: var(--accent-ink-on-dark);
  }
  .sb-w:hover {
    text-decoration-style: solid;
    text-decoration-color: var(--tone);
  }
  .sb-w:focus-visible {
    outline: 2px solid var(--tone);
    outline-offset: 4px;
    border-radius: 2px;
  }
  /* A finger-sized target without opening up the line. */
  .sb-w::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: max(100% + 8px, 44px);
    height: calc(var(--say) * var(--say-lh) - 4px);
    transform: translate(-50%, -50%);
  }
  .sb-nb > sup {
    display: inline-block;
    margin-left: 0.12em;
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: var(--fs-label-xs);
    line-height: 1;
    vertical-align: calc(var(--say) * 0.42);
    color: var(--on-ink-55);
  }

  /* The footnotes: set small in the text face, as a book sets them, each led
     by its numeral in its figure's colour. */
  .sb-notes {
    display: grid;
    gap: 12px;
    margin: 12px 0 0;
    padding: 16px 0 0;
    border-top: 1px solid var(--on-ink-16);
    list-style: none;
  }
  /* One footnote a line, as a book sets them: the numeral and the kind in
     mono and the figure's colour, then every entry by name. */
  .sb-note {
    --tone: var(--accent-on-dark);
    display: grid;
    grid-template-columns: 1.6em minmax(0, 1fr);
    align-items: baseline;
    font-family: var(--fs-serif);
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--on-ink-70);
  }
  .sb-note[data-tone='ink'] {
    --tone: var(--accent-ink-on-dark);
  }
  .sb-nn,
  .sb-nh {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--tone);
  }
  .sb-nn {
    grid-row: span 2;
  }
  .sb-nh {
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  @media (min-width: 640px) {
    .sb-note {
      grid-template-columns: 1.6em 9em minmax(0, 1fr);
      column-gap: 4px;
    }
    .sb-nn {
      grid-row: auto;
    }
  }
  .sb-nl a {
    color: var(--on-ink-80);
    text-decoration: none;
    background-image: linear-gradient(var(--on-ink-16), var(--on-ink-16));
    background-size: 100% 1px;
    background-position: 0 100%;
    background-repeat: no-repeat;
  }
  .sb-nl a:hover {
    color: var(--bg);
    background-image: linear-gradient(var(--tone), var(--tone));
  }
  .sb-nl a:focus-visible {
    outline: 2px solid var(--tone);
    outline-offset: 2px;
    border-radius: 2px;
  }

  /* Desktop: the margin column beside the sentence, as on the home page. */
  @media (min-width: 900px) {
    .sb-body {
      --margin: clamp(176px, 15vw, 224px);
      grid-template-columns: var(--margin) minmax(0, 1fr);
      grid-template-areas: 'margin say' 'margin notes';
      align-items: start;
      column-gap: 32px;
    }
    .sb-margin {
      grid-area: margin;
      flex-direction: column;
      align-self: start;
      /* Level with the sentence's first line. */
      padding-top: calc((var(--say-lh) * var(--say) - 1.6 * 12px) / 2 + 2px);
    }
    .sb-cap {
      display: block;
      margin-top: 14px;
    }
    .sb-say {
      grid-area: say;
    }
    .sb-notes {
      grid-area: notes;
      margin-top: 18px;
    }
  }
  @media (max-width: 760px) {
    .sb-lede {
      font-size: var(--fs-body);
    }
    .sb {
      --say-lh: 1.4;
    }
  }

  @media print {
    .sb {
      background: none;
      color: #1a1008;
    }
    .sb-title,
    .sb-lede,
    .sb-say,
    .sb-total,
    .sb-margin,
    .sb-date,
    .sb-w,
    .sb-nb > sup,
    .sb-note,
    .sb-nn,
    .sb-nh,
    .sb-nl a {
      color: #1a1008;
      text-decoration-color: currentColor;
    }
    .sb-out {
      -webkit-text-stroke: 1px #1a1008;
    }
    .sb-notes {
      border-top-color: #1a1008;
    }
  }
</style>
