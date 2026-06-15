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

  // Client-only desk node. In v1 the only editable field is a display title;
  // the report preview + regenerate + export buttons live in the renderer (M8).
  const title = $derived(typeof config.title === 'string' ? config.title : '');
  const expanded = $derived(config.expanded === true);

  let showRawJson = $state(false);
  void definition;
</script>

<div class="rr">
  <section class="rr-sec">
    <label class="rr-field">
      <span class="rr-label">Title</span>
      <input
        type="text"
        placeholder="Research report"
        value={title}
        oninput={(e) => onChange({ ...config, title: (e.currentTarget as HTMLInputElement).value })}
      />
    </label>
    <label class="rr-check">
      <input
        type="checkbox"
        checked={expanded}
        onchange={(e) => onChange({ ...config, expanded: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span class="rr-label">Start expanded</span>
    </label>
    <p class="rr-readout">Previews this session's report; regenerate &amp; export wired in the node body.</p>
  </section>

  <details class="rr-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="rr-code"
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
  .rr { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .rr-sec { display: flex; flex-direction: column; gap: 8px; }
  .rr-field { display: flex; flex-direction: column; gap: 4px; }
  .rr-check { display: flex; align-items: center; gap: 8px; }
  .rr-check input { width: auto; }
  .rr-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
  }
  .rr-readout { margin: 0; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
  .rr-code {
    width: 100%; padding: 8px; background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border); font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box; outline: none; resize: vertical;
  }
  .rr-code:focus { border-color: var(--text-muted); }
  input[type='text'], textarea {
    width: 100%; padding: 6px 8px; background: var(--bg); color: var(--text-primary);
    border: 1px solid var(--card-border); font: inherit; box-sizing: border-box; outline: none;
  }
  input[type='text']:focus, textarea:focus { border-color: var(--text-muted); }
  .rr-raw { margin-top: 4px; border-top: 1px dashed var(--card-border); padding-top: 8px; }
  .rr-raw summary { cursor: pointer; }
</style>
