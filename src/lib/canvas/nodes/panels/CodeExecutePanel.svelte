<script lang="ts">
  import type { PanelProps } from './registry';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  let { config, onChange }: PanelProps = $props();

  // The node executor supports JavaScript, Python, and Bash (code-execute.def.ts),
  // but this panel previously hardcoded JavaScript and never wrote `language` —
  // so the Python/Bash capability was invisible unless you edited raw config.
  const language = $derived(((config?.language as string) || 'javascript'));
  function setLanguage(v: string) { onChange({ ...config, language: v }); }
  const codePlaceholder = $derived(
    language === 'python'
      ? '# the upstream payload is available as `input`\nprint(json.dumps({ "ok": True }))'
      : language === 'bash'
        ? "# the upstream payload is available as `input` (JSON)\necho '{ \"ok\": true }'"
        : '// example\nreturn { items: input.items.filter(i => i.new) };',
  );

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
    <span class="panel-label">CODE ({language.toUpperCase()})</span>
    <label class="panel-langsel">
      <span class="panel-meta">interpreter</span>
      <select value={language} onchange={(e) => setLanguage((e.currentTarget as HTMLSelectElement).value)}>
        <option value="javascript">JavaScript (Node.js)</option>
        <option value="python">Python 3</option>
        <option value="bash">Bash</option>
      </select>
    </label>
  </div>
  <div class="panel-field">
    <textarea
      class="panel-textarea panel-textarea-code"
      rows="16"
      spellcheck="false"
      value={codeDraft}
      oninput={onInput}
      onblur={onBlur}
      placeholder={codePlaceholder}
    ></textarea>
  </div>
  <p class="panel-hint">
    Runs in a sandbox with <code>input</code> bound to the upstream payload.
    JavaScript: <code>return</code> an object (or <code>undefined</code> to pass <code>input</code> through).
    Python / Bash: print JSON to stdout to pass data downstream.
  </p>
</section>

<OnErrorBlock
  value={config._onError as Record<string, unknown> | undefined}
  onChange={(v) => onChange({ ...config, _onError: v })}
/>

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
  .panel-langsel {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .panel-langsel select {
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    font-size: var(--fs-label);
    padding: 2px 6px;
    outline: none;
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
    font-size: var(--fs-label);
    line-height: 1.5;
    tab-size: 2;
  }
  .panel-hint {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-muted);
    line-height: 1.4;
  }
  .panel-hint code {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: var(--bg-section);
    padding: 0 4px;
    border-radius: 3px;
  }
</style>
