<script lang="ts">
  import type { PanelProps } from './registry';

  let { config, onChange }: PanelProps = $props();

  let codeDraft = $state('');
  let dirty = $state(false);

  $effect(() => {
    const incoming = (config?.code as string | undefined) ?? '';
    if (!dirty && incoming !== codeDraft) codeDraft = incoming;
  });

  function onInput(e: Event) {
    codeDraft = (e.target as HTMLTextAreaElement).value;
    dirty = true;
  }

  function onBlur() {
    if (!dirty) return;
    onChange({ ...config, code: codeDraft });
    dirty = false;
  }
</script>

<section class="panel-sec">
  <div class="panel-sec-hd">
    <span class="panel-label">CODE (JAVASCRIPT)</span>
    <span class="panel-meta">receives `input` · `return` the output · saved on blur</span>
  </div>
  <div class="panel-field">
    <textarea
      class="panel-textarea panel-textarea-code"
      rows="16"
      spellcheck="false"
      value={codeDraft}
      oninput={onInput}
      onblur={onBlur}
      placeholder={'// example\nreturn { items: input.items.filter(i => i.new) };'}
    ></textarea>
  </div>
  <p class="panel-hint">
    Sandbox: the code runs in a worker with <code>input</code> bound to the upstream payload.
    Return an object (or <code>undefined</code> to pass <code>input</code> through unchanged).
  </p>
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
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .panel-meta {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-ghost);
  }
  .panel-field {
    border: 1px solid var(--card-border);
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
    min-height: 220px;
  }
  .panel-textarea-code {
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    tab-size: 2;
  }
  .panel-hint {
    margin: 0;
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.4;
  }
  .panel-hint code {
    font-family: var(--font-mono);
    font-size: 10.5px;
    background: var(--bg-section);
    padding: 0 4px;
    border-radius: 3px;
  }
</style>
