<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // The merge executor (see src/lib/workflows/nodes/merge.ts) is intentionally
  // one-mode: it shallow-merges every upstream input into a single object and
  // does not read any config keys. Field-picking used to live behind a
  // `strategy: 'pick'` toggle but overlapped with `transform`; the canonical
  // way to subset fields now is a downstream `transform` node.
  //
  // We still expose:
  //   • An empty-state explainer so the user knows there's nothing to wire up.
  //   • The universal On-failure block (config._onError).
  //   • A raw-JSON disclosure for any unknown keys an orchestrator may have
  //     attached — we preserve them via the `...config` spread in `set`.

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // Surface any "unknown" config keys (anything other than _onError) so the
  // user knows the panel preserved them. Purely informational — the raw-JSON
  // disclosure below lets them edit.
  const unknownKeys = $derived(
    Object.keys(config ?? {}).filter((k) => k !== '_onError'),
  );

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header handles the "What this does" line.
  void definition;
</script>

<div class="mr">
  <!-- What it does -->
  <section class="mr-sec">
    <header class="mr-sec-hdr">
      <span class="sr-label-tight">Behaviour</span>
      <span class="mr-sec-meta">no config</span>
    </header>
    <p class="mr-explain">
      Combines the outputs of every upstream node into a single object via a
      shallow merge. Use after parallel branches converge.
    </p>
    <p class="mr-hint">
      Need a subset of fields? Follow this node with a <code>transform</code>
      and write <code>{`return { a: input.a, b: input.b };`}</code>.
    </p>
    <p class="mr-hint">
      Keys with the same name collide last-write-wins in upstream-edge order.
      Wrap each branch's payload under a distinct namespace upstream if you
      want to keep them separate.
    </p>
  </section>

  <!-- Preserved-but-unknown config keys (informational) -->
  {#if unknownKeys.length > 0}
    <section class="mr-sec">
      <header class="mr-sec-hdr">
        <span class="sr-label-tight">Other config keys</span>
        <span class="mr-sec-meta">{unknownKeys.length} preserved</span>
      </header>
      <p class="mr-hint">
        The executor ignores these, but they are kept on save. Edit them via
        the raw-JSON disclosure below.
      </p>
      <ul class="mr-keylist">
        {#each unknownKeys as k (k)}
          <li><code>{k}</code></li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="mr-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="mr-code"
      rows="8"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* invalid — keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .mr { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .mr-sec { display: flex; flex-direction: column; gap: 8px; }
  .mr-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .mr-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .mr-explain {
    margin: 0;
    font-size: var(--fs-nav);
    color: var(--text-primary);
    line-height: 1.4;
  }
  .mr-hint {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-ghost);
    line-height: 1.4;
  }
  .mr-hint code, .mr-explain code {
    font-family: var(--font-code);
    font-size: var(--fs-label);
    color: var(--text-muted);
  }

  .mr-keylist {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .mr-keylist li {
    padding: 2px 6px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .mr-keylist code { font: inherit; color: inherit; }

  .mr-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .mr-code:focus { border-color: var(--text-muted); }

  textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  textarea:focus { border-color: var(--text-muted); }

  .mr-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .mr-raw summary { cursor: pointer; }
</style>
