<script lang="ts" module>
  /**
   * The definition stage's scope controls, as raw text fields.
   *
   * Kept as strings rather than arrays because these are textareas: splitting
   * on every keystroke fights the user mid-typing (a trailing comma becomes an
   * empty entry, backspacing across a newline drops a whole domain). The caller
   * splits once, on submit, and the server normalises properly in `coerceScope`.
   */
  export interface ScopeDraft {
    mode: 'open' | 'bounded' | 'exclusive';
    includeDomains: string;
    excludeDomains: string;
    seedUrls: string;
    recencyDays: string;
  }
</script>

<script lang="ts">
  let { scope = $bindable() }: { scope: ScopeDraft } = $props();

  const MODES: { value: ScopeDraft['mode']; label: string; hint: string }[] = [
    { value: 'open', label: 'Open', hint: 'Search anywhere on the web.' },
    {
      value: 'bounded',
      label: 'Prefer',
      hint: 'Rank these domains higher, but still allow others — a thin list cannot starve the run.',
    },
    {
      value: 'exclusive',
      label: 'Only',
      hint: 'Use these domains and nothing else. If nothing matches, the run says so rather than widening.',
    },
  ];

  const needsDomains = $derived(scope.mode !== 'open');
  const activeHint = $derived(MODES.find((m) => m.value === scope.mode)?.hint ?? '');
</script>

<div class="scope">
  <span class="fld-label">Where to look</span>
  <div class="modes" role="radiogroup" aria-label="Scope mode">
    {#each MODES as m (m.value)}
      <button
        type="button"
        class="mode"
        class:on={scope.mode === m.value}
        role="radio"
        aria-checked={scope.mode === m.value}
        onclick={() => (scope.mode = m.value)}
      >{m.label}</button>
    {/each}
  </div>
  <p class="hint">{activeHint}</p>

  {#if needsDomains}
    <label class="fld">
      <span class="fld-label">Domains — one per line</span>
      <textarea
        bind:value={scope.includeDomains}
        rows="2"
        placeholder="gov.uk&#10;ons.gov.uk"
      ></textarea>
    </label>
  {/if}

  <details class="more">
    <summary>More filters</summary>
    <label class="fld">
      <span class="fld-label">Never use these domains</span>
      <textarea bind:value={scope.excludeDomains} rows="2" placeholder="facebook.com"></textarea>
    </label>
    <label class="fld">
      <span class="fld-label">Start from these pages</span>
      <textarea
        bind:value={scope.seedUrls}
        rows="2"
        placeholder="https://example.gov.uk/report"
      ></textarea>
    </label>
    <label class="fld">
      <span class="fld-label">Only material from the last N days</span>
      <input type="number" min="1" bind:value={scope.recencyDays} placeholder="e.g. 30" />
    </label>
  </details>
</div>

<style>
  .scope { display: grid; gap: 0.5rem; }
  .fld-label { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-muted); margin-bottom: 0.3rem; }
  .modes { display: inline-flex; border: 1.5px solid rgba(26, 16, 8, 0.18); width: fit-content; }
  .mode {
    font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.1em;
    padding: 0.4rem 0.9rem; background: var(--bg); color: var(--text-muted); border: none; cursor: pointer;
  }
  .mode + .mode { border-left: 1.5px solid rgba(26, 16, 8, 0.18); }
  .mode.on { background: var(--accent); color: #fff; }
  .hint { margin: 0; font-size: 0.8rem; line-height: 1.4; color: var(--text-secondary); }
  .fld { display: block; }
  textarea, input[type='number'] {
    width: 100%; font-family: var(--font-body); font-size: 1rem; padding: 0.45rem 0.6rem;
    background: var(--bg); border: 1px solid rgba(26, 16, 8, 0.18); color: var(--text-primary); resize: vertical;
  }
  .more summary { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); cursor: pointer; padding: 0.3rem 0; }
  .more > .fld { margin-top: 0.5rem; }
</style>
