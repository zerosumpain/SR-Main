<script lang="ts">
  /**
   * T0 · Front matter — declaring. Once per study, at the front.
   *
   * The findings are stated HERE, before beat 01. Never a teaser instead of
   * findings, never a hero image, never more than four. A study that withholds
   * its conclusions to build suspense reads as a tour of the author's notes.
   */
  import ConfidenceChip from '../ConfidenceChip.svelte';
  import { arcBeats, beatHref, type Study } from '../study';

  let { study }: { study: Study } = $props();
  const arc = $derived(arcBeats(study));
  const first = $derived(arc[0]);
</script>

<header class="fs-front">
  <div class="fs-front-head">
    <div>
      <p class="fs-kicker">Field study №{study.number} · Abstract</p>
      <h1 class="fs-h1 fs-h1--display fs-front-title">{study.title}</h1>
      <p class="fs-thesis">{study.thesis}</p>
    </div>

    <aside class="fs-status">
      <span class="fs-margin-label">Status</span>
      <b>{study.status.headline}</b>
      <p>{study.status.detail}</p>
      <ConfidenceChip level={study.status.confidence} />
    </aside>
  </div>

  <!-- The findings ledger. Three rows, above a 2px rule: what the study
       concluded, and how sure it is, before a word of argument. -->
  <section class="fs-findings" aria-label="What this study found">
    {#each study.findings as f, i (i)}
      <div class="fs-finding">
        <span class="fs-finding-n">{String(i + 1).padStart(2, '0')}</span>
        <p class="fs-finding-t">{@html f.text}</p>
        <ConfidenceChip level={f.confidence} />
      </div>
    {/each}
  </section>

  <div class="fs-front-split">
    <div class="fs-asks">
      <span class="fs-margin-label">What this answers</span>
      <ol>{#each study.asks as a, i (i)}<li>{a}</li>{/each}</ol>
    </div>
    <nav class="fs-contents" aria-label="Contents">
      <span class="fs-margin-label">The arc</span>
      <ol>
        {#each arc as b (b.no)}
          <li>
            <a href={beatHref(study, b)}>
              <span class="fs-c-no">{b.no}</span>
              <span class="fs-c-name">{b.name}</span>
              {#if b.minutes}<span class="fs-c-min">{b.minutes} min</span>{/if}
            </a>
          </li>
        {/each}
      </ol>
    </nav>
  </div>

  {#if study.instruments?.length}
    <div class="fs-instruments">
      <span class="fs-margin-label">Instruments</span>
      <div class="fs-instrument-row">
        {#each study.instruments as i, ix (ix)}
          <a class="fs-instrument" href={i.href}>{i.name}</a>
        {/each}
      </div>
    </div>
  {/if}

  {#if first}
    <a class="fs-next fs-start" href={beatHref(study, first)}>Start at beat {first.no} →</a>
  {/if}

  <p class="fs-disclaimer">
    Written in a personal capacity. Nothing here represents the position of any
    department, and it is built from published sources only.
  </p>
</header>

<style>
  .fs-front { display: block; }
  .fs-front-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 40px;
    align-items: start;
  }
  .fs-front-title { max-width: 100%; }
  .fs-thesis {
    font-family: var(--fs-serif);
    font-size: var(--fs-body-lg);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 100%;
    margin: 18px 0 0;
  }
  .fs-status {
    border: 1px solid var(--line-strong);
    padding: 15px 17px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .fs-status b { font-size: var(--fs-body-sm); }
  .fs-status p {
    margin: 0;
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
  }

  .fs-findings {
    margin-top: 34px;
    border-top: 2px solid var(--text-primary);
  }
  .fs-finding {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 14px;
    padding: 14px 0;
    border-bottom: 1px solid var(--line);
  }
  .fs-finding-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .fs-finding-t {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
  }

  /* Two columns, divided by a rule on the second — NOT a three-track grid with
     a 1px middle. There are two children, so a declared divider track collects
     the contents list and squeezes it to 1px: every chapter title wrapped one
     word per line with its minutes printed on top of it. */
  .fs-front-split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 34px;
    margin-top: 30px;
  }
  .fs-contents {
    padding-left: 34px;
    border-left: 1px solid var(--line);
  }
  .fs-asks ol, .fs-contents ol { margin: 10px 0 0; padding-left: 20px; }
  .fs-asks li {
    font-size: var(--fs-label);
    line-height: 1.6;
    color: var(--text-secondary);
    margin-bottom: 6px;
  }
  .fs-contents ol { list-style: none; padding-left: 0; }
  .fs-contents a {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: baseline;
    padding: 8px 0;
    border-bottom: 1px solid var(--line-hair);
    text-decoration: none;
    color: inherit;
  }
  .fs-contents a:hover .fs-c-name { color: var(--accent); }
  .fs-c-no {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-ghost);
  }
  .fs-c-name { font-size: var(--fs-label); transition: color 0.2s var(--ease-out); }
  .fs-c-min {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .fs-instruments { margin-top: 28px; }
  .fs-instrument-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
  .fs-instrument {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 9px 14px;
    border: 1px solid var(--accent-ink-tint-35);
    color: var(--accent-ink);
    text-decoration: none;
  }
  .fs-instrument:hover { background: var(--accent-ink-tint-06); }

  .fs-start { margin-top: 28px; }
  .fs-disclaimer {
    margin: 26px 0 0;
    text-align: right;
    font-size: var(--fs-label-xs);
    line-height: 1.55;
    color: var(--text-ghost);
  }

  @media (max-width: 900px) {
    .fs-front-head, .fs-front-split { grid-template-columns: minmax(0, 1fr); gap: 22px; }
    .fs-contents { padding-left: 0; border-left: none; padding-top: 18px; border-top: 1px solid var(--line); }
  }
</style>
