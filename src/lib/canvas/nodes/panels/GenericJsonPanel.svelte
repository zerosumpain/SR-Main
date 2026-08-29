<script lang="ts">
  import type { PanelProps } from './registry';

  let { config, onChange }: PanelProps = $props();

  let raw = $state('');
  let jsonError = $state<string | null>(null);

  function onInput(e: Event) {
    raw = (e.target as HTMLTextAreaElement).value;
    jsonError = null;
  }

  function onBlur() {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        onChange(parsed as Record<string, unknown>);
        jsonError = null;
      } else {
        jsonError = 'Must be a JSON object';
      }
    } catch (err) {
      jsonError = err instanceof Error ? err.message : 'Invalid JSON';
    }
  }

  // Sync raw text when config is replaced from outside (e.g. revert).
  // Equality-guarded — without this, typing into the textarea triggers
  // onBlur → onChange → config prop change → this effect writes raw
  // back to (typically) the same string, and on deep configs that
  // cascade adds up to effect_update_depth_exceeded.
  $effect(() => {
    const next = JSON.stringify(config, null, 2);
    if (next !== raw) raw = next;
  });
</script>

<section class="panel-sec">
  <div class="panel-sec-hd">
    <span class="panel-label">CONFIG (JSON)</span>
    <span class="panel-meta">edit any field · saved on blur</span>
  </div>
  <div class="panel-field" class:has-error={!!jsonError}>
    <textarea
      class="panel-textarea panel-textarea-code"
      rows="14"
      spellcheck="false"
      value={raw}
      oninput={onInput}
      onblur={onBlur}
    ></textarea>
  </div>
  {#if jsonError}
    <div class="panel-error">{jsonError}</div>
  {/if}
</section>

<style>
  .panel-sec {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .panel-sec-hd {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .panel-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .panel-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .panel-field {
    border: 1px solid var(--card-border);
  }
  .panel-field.has-error {
    border-color: #c44;
  }
  .panel-textarea {
    width: 100%;
    background: var(--bg);
    color: var(--text-primary);
    border: none;
    padding: 8px;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
  }
  .panel-textarea-code {
    font-family: var(--font-code);
    font-size: var(--fs-label);
    line-height: 1.5;
  }
  .panel-error {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: #c44;
    padding: 2px 0;
  }
</style>
