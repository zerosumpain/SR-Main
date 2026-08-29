<script lang="ts">
  // Recipient field with chips-vs-template mode toggle. The orchestrator
  // may serialise the underlying config value as either a comma-separated
  // string OR an array of strings — this widget normalises both into a
  // single string before writing back, since the executors expect a string
  // (and run template interpolation on it).
  //
  // Two modes:
  //   - chips    → ChipInputField, one address per chip, comma-joined on save.
  //   - template → raw textarea, lets the user type {{input.x}} style refs.
  // Switching modes preserves the underlying value.

  import ChipInputField from './ChipInputField.svelte';

  let {
    label,
    value,
    onChange,
    placeholder,
    templatePlaceholder,
    chipsHint,
    templateHint,
    rows = 2,
  }: {
    label: string;
    /** Current config value. May be a string OR string[] (orchestrator-normalised). */
    value: unknown;
    /** Called with the new comma-joined string. */
    onChange: (raw: string) => void;
    placeholder?: string;
    templatePlaceholder?: string;
    chipsHint?: string;
    templateHint?: string;
    rows?: number;
  } = $props();

  function readRaw(raw: unknown): string {
    if (Array.isArray(raw)) {
      return raw.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
    }
    return String(raw ?? '');
  }

  function rawToChips(raw: string): string[] {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  function chipsToRaw(chips: string[]): string {
    return chips.join(', ');
  }

  function detectMode(raw: string): 'chips' | 'template' {
    return raw.includes('{{') ? 'template' : 'chips';
  }

  const raw = $derived(readRaw(value));
  const chips = $derived(rawToChips(raw));
  let mode = $state<'chips' | 'template'>(detectMode(raw));
</script>

<section class="rl-sec">
  <header class="rl-sec-hdr">
    <span class="sr-label-tight">{label}</span>
    <div class="rl-mode-toggle" role="tablist" aria-label="{label} input mode">
      <button
        type="button"
        class="rl-mode-btn"
        class:rl-mode-btn-active={mode === 'chips'}
        role="tab"
        aria-selected={mode === 'chips'}
        onclick={() => (mode = 'chips')}
      >Chips</button>
      <button
        type="button"
        class="rl-mode-btn"
        class:rl-mode-btn-active={mode === 'template'}
        role="tab"
        aria-selected={mode === 'template'}
        onclick={() => (mode = 'template')}
      >Template</button>
    </div>
  </header>
  {#if mode === 'chips'}
    <ChipInputField
      value={chips}
      {placeholder}
      onChange={(v) => onChange(chipsToRaw(v))}
    />
    {#if chipsHint}<span class="rl-hint">{@html chipsHint}</span>{/if}
  {:else}
    <textarea
      class="rl-code"
      {rows}
      spellcheck="false"
      placeholder={templatePlaceholder ?? placeholder ?? ''}
      value={raw}
      oninput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value)}
    ></textarea>
    {#if templateHint}<span class="rl-hint">{@html templateHint}</span>{/if}
  {/if}
</section>

<style>
  .rl-sec {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .rl-sec-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .rl-mode-toggle {
    display: inline-flex;
    border: 1px solid var(--card-border);
  }
  .rl-mode-btn {
    padding: 2px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .rl-mode-btn-active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-primary);
  }
  .rl-code {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .rl-code:focus { border-color: var(--text-muted); }
  .rl-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .rl-hint :global(code) {
    font-family: var(--font-code);
    background: var(--bg);
    padding: 1px 4px;
  }
</style>
