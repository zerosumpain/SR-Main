<script lang="ts">
  let {
    config,
    onChange,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
  } = $props();

  function update(event: Event) {
    try {
      const next = JSON.parse((event.currentTarget as HTMLTextAreaElement).value);
      if (next && typeof next === 'object') {
        onChange(next as Record<string, unknown>);
      }
    } catch {
      // Keep the draft in the textarea until it becomes valid JSON.
    }
  }
</script>

<details class="raw-config">
  <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
  <textarea
    rows="10"
    spellcheck="false"
    value={JSON.stringify(config, null, 2)}
    oninput={update}
  ></textarea>
</details>

<style>
  .raw-config {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }

  summary { cursor: pointer; }

  textarea {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-code);
    font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }

  textarea:focus { border-color: var(--text-muted); }
</style>
