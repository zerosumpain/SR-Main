<script lang="ts">
  // The study's front matter (T0) and its first beat, rendered from study.ts.
  // Beat 01 has no slug of its own: the landing page IS the problem statement,
  // so a reader who arrives has already started.
  import T0FrontMatter from '$lib/fieldstudy/templates/T0FrontMatter.svelte';
  import Beat from '$lib/fieldstudy/Beat.svelte';
  import { app } from './lib/appState.svelte';
  import { study } from './study';

  const front = study.beats.find((b) => b.no === '00')!;
  const first = study.beats.find((b) => b.no === '01')!;
  const depth = $derived(app.narrative === 'eli5' ? 'plain' : 'research');
</script>

<svelte:head>
  <title>{study.title}</title>
  <meta name="description" content={study.thesis} />
</svelte:head>

<div class="fs-route">
  <T0FrontMatter {study} />

  <hr class="fs-front-rule" />

  <Beat {study} beat={first} {depth} />

  <!-- Every source, numbered as the citations reference them. The checklist
       asks that sources be reachable from the beat that cites them; the study
       is one document, so they live at its foot rather than on a page of their
       own that nobody opens. -->
  <section class="fs-sources" aria-label="Sources">
    <h2 class="fs-margin-label">Sources</h2>
    <ol>
      {#each study.sources as s (s.n)}
        <li>
          <span class="fs-src-n">[{s.n}]</span>
          <span>
            <b>{s.org}</b> — {s.what}
            <a href={s.url} target="_blank" rel="noopener">source ↗</a>
            <span class="fs-src-kind">{s.kind}{s.asOf ? ` · ${s.asOf}` : ''}</span>
            {#if s.caveat}<span class="fs-src-caveat">{s.caveat}</span>{/if}
          </span>
        </li>
      {/each}
    </ol>
  </section>
</div>

<style>
  .fs-front-rule {
    border: none;
    border-top: 1px solid var(--line);
    margin: 44px 0 36px;
  }
  .fs-sources {
    margin-top: 46px;
    padding-top: 18px;
    border-top: 2px solid var(--text-primary);
  }
  .fs-sources ol { list-style: none; margin: 14px 0 0; padding: 0; }
  .fs-sources li {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    gap: 10px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line-hair);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .fs-src-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  .fs-sources a { color: var(--accent-ink); }
  .fs-src-kind,
  .fs-src-caveat {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-top: 3px;
  }
  .fs-src-caveat { text-transform: none; letter-spacing: 0; font-family: var(--font-body); }
</style>
