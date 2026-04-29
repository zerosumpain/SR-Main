<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  // Editor for the `blog-get` node.
  // Executor reads `config.postId` (string, may be a numeric ID or a slug
  // — the underlying site tool currently expects a numeric ID, but we
  // accept either input shape and let the executor decide).

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  const postId = $derived(String(config.postId ?? ''));
  const idLooksLikeSlug = $derived(/[a-zA-Z-]/.test(postId) && !/^\s*\{\{/.test(postId));

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  let showRawJson = $state(false);
  void definition;
</script>

<div class="bo">
  <!-- Lookup -->
  <section class="bo-sec">
    <header class="bo-sec-hdr"><span class="sr-label-tight">Lookup</span></header>
    <label class="bo-field">
      <span class="bo-label">Post ID or slug</span>
      <input
        type="text"
        spellcheck="false"
        placeholder={'42  or  {{input.id}}'}
        value={postId}
        oninput={(e) => set('postId', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="bo-hint">
        Templates supported: <code>{`{{input.id}}`}</code>.
        {#if idLooksLikeSlug}
          <span class="bo-warn">Looks like a slug — the site tool currently resolves by numeric ID.</span>
        {/if}
      </span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="bo-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced &mdash; raw JSON config</span></summary>
    <textarea
      class="bo-code"
      rows="10"
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
  .bo { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .bo-sec { display: flex; flex-direction: column; gap: 8px; }
  .bo-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .bo-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .bo-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .bo-hint { font-size: 11px; color: var(--text-ghost); }
  .bo-hint code { color: var(--text-muted); }
  .bo-warn { color: var(--status-error, #c0392b); margin-left: 4px; }

  input[type='text'], textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, textarea:focus { border-color: var(--text-muted); }

  .bo-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .bo-code:focus { border-color: var(--text-muted); }

  .bo-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .bo-raw summary { cursor: pointer; }
</style>
