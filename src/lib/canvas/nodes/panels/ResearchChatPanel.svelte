<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // Client-only desk node. The only editable field in v1 is a display title;
  // the chat thread + retrieval live in the in-graph renderer (M7).
  const title = $derived(typeof config.title === 'string' ? config.title : '');

  let showRawJson = $state(false);
  void definition;
</script>

<div class="rc">
  <section class="rc-sec">
    <label class="rc-field">
      <span class="rc-label">Title</span>
      <input
        type="text"
        placeholder="Research chat"
        value={title}
        oninput={(e) => onChange({ ...config, title: (e.currentTarget as HTMLInputElement).value })}
      />
    </label>
    <p class="rc-readout">Answers are grounded in this session's facts &amp; sources, with <code>[n]</code> citations.</p>
  </section>

  <details class="rc-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="rc-code"
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
  .rc { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .rc-sec { display: flex; flex-direction: column; gap: 8px; }
  .rc-field { display: flex; flex-direction: column; gap: 4px; }
  .rc-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }
  .rc-readout { margin: 0; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-muted); }
  .rc-readout code { color: var(--accent); }
  .rc-code {
    width: 100%; padding: 8px; background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border); font-family: var(--font-code); font-size: var(--fs-label);
    box-sizing: border-box; outline: none; resize: vertical;
  }
  .rc-code:focus { border-color: var(--text-muted); }
  input[type='text'], textarea {
    width: 100%; padding: 6px 8px; background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border); font: inherit; box-sizing: border-box; outline: none;
  }
  input[type='text']:focus, textarea:focus { border-color: var(--text-muted); }
  .rc-raw { margin-top: 4px; border-top: 1px dashed var(--card-border); padding-top: 8px; }
  .rc-raw summary { cursor: pointer; }
</style>
