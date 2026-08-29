<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let q = $state(data.q);

  const EXAMPLES = [
    'file:src/lib/jkai/executor.ts | hops 1',
    'fingerprint:vitest:AssertionError | episodes limit=3',
    'topic:"ci-release allow-list rsync scripts" | lessons limit=3',
    'file:src/routes/api/* | lessons limit=5',
  ];
</script>

<svelte:head><title>Codegraph — ask</title></svelte:head>

<section class="wrap">
  <h1>Ask the graph</h1>
  <p class="lede">
    This runs the same loader the builder uses and renders the exact block a build would be
    handed — so what you tune here is what an iteration actually gets.
  </p>

  <form method="GET">
    <input name="q" bind:value={q} placeholder='file:src/lib/… | hops 1 | lessons | episodes' spellcheck="false" />
    <button type="submit">Run</button>
  </form>

  <ul class="examples">
    {#each EXAMPLES as ex (ex)}
      <li><a href="/jkai/codegraph/ask?q={encodeURIComponent(ex)}"><code>{ex}</code></a></li>
    {/each}
  </ul>

  {#if data.error}
    <p class="error">{data.error}</p>
  {:else if data.result}
    <p class="meta">
      <strong>{data.result.outcome}</strong> · {data.result.durationMs}ms ·
      {data.result.lessons.length} lessons · {data.result.episodes.length} episodes ·
      {data.block.length} chars
    </p>
    <pre>{data.block}</pre>
  {/if}
</section>

<style>
  .wrap { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  h1 { font-family: var(--font-display); font-size: var(--fs-display-sm); margin: 0 0 0.4rem; }
  .lede { color: var(--text-secondary); margin: 0 0 1.5rem; max-width: 62ch; }
  form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  input { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: 16px; padding: 0.6rem 0.7rem;
          border: 1px solid var(--card-border); background: var(--card-bg); color: var(--text-primary); }
  button { padding: 0.6rem 1.2rem; border: 1px solid var(--accent-ink); background: var(--accent-ink);
           color: var(--bg); font-family: var(--font-mono); font-size: 0.85rem; cursor: pointer; }
  .examples { list-style: none; padding: 0; margin: 0 0 1.5rem; display: grid; gap: 0.3rem; }
  .examples code { font-family: var(--font-code); font-size: 0.78rem; color: var(--accent-ink); }
  .meta { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary); }
  pre { border: 1px solid var(--card-border); background: var(--card-bg); padding: 1rem;
        overflow-x: auto; white-space: pre-wrap; font-family: var(--font-code); font-size: 0.8rem; line-height: 1.6; }
  .error { border: 1px solid var(--error-border); background: var(--error-bg); color: var(--error); padding: 0.8rem;
           font-family: var(--font-mono); font-size: 0.85rem; }
</style>
