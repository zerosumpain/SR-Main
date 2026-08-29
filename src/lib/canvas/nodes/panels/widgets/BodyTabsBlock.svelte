<script lang="ts">
  // Plain-text / HTML / Both body editor with tab toggle. Switching tabs
  // does NOT erase the inactive value, so a user can flip back without
  // losing work — the underlying text/html config stays intact even when
  // hidden.
  //
  // Auto-detects the initial tab from the populated config:
  //   - both populated → 'both'
  //   - html only      → 'html'
  //   - else           → 'text'

  let {
    text,
    html,
    onChangeText,
    onChangeHtml,
    label = 'Body',
    textPlaceholder = '',
    htmlPlaceholder = '',
    rows = 6,
  }: {
    text: string;
    html: string;
    onChangeText: (v: string) => void;
    onChangeHtml: (v: string) => void;
    label?: string;
    textPlaceholder?: string;
    htmlPlaceholder?: string;
    rows?: number;
  } = $props();

  function detectTab(t: string, h: string): 'text' | 'html' | 'both' {
    const tt = t.trim();
    const hh = h.trim();
    if (tt && hh) return 'both';
    if (hh && !tt) return 'html';
    return 'text';
  }

  let tab = $state<'text' | 'html' | 'both'>(detectTab(text, html));
</script>

<section class="bt-sec">
  <header class="bt-sec-hdr">
    <span class="sr-label-tight">{label}</span>
    <div class="bt-mode-toggle" role="tablist" aria-label="{label} content type">
      <button
        type="button"
        class="bt-mode-btn"
        class:bt-mode-btn-active={tab === 'text'}
        role="tab"
        aria-selected={tab === 'text'}
        onclick={() => (tab = 'text')}
      >Plain text</button>
      <button
        type="button"
        class="bt-mode-btn"
        class:bt-mode-btn-active={tab === 'html'}
        role="tab"
        aria-selected={tab === 'html'}
        onclick={() => (tab = 'html')}
      >HTML</button>
      <button
        type="button"
        class="bt-mode-btn"
        class:bt-mode-btn-active={tab === 'both'}
        role="tab"
        aria-selected={tab === 'both'}
        onclick={() => (tab = 'both')}
      >Both</button>
    </div>
  </header>

  {#if tab === 'text' || tab === 'both'}
    <label class="bt-field">
      <span class="bt-label">Plain-text body</span>
      <textarea
        class="bt-code"
        {rows}
        spellcheck="false"
        placeholder={textPlaceholder}
        value={text}
        oninput={(e) => onChangeText((e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="bt-hint">Templates: <code>{`{{input.field}}`}</code></span>
    </label>
  {/if}

  {#if tab === 'html' || tab === 'both'}
    <label class="bt-field">
      <span class="bt-label">HTML body</span>
      <textarea
        class="bt-code"
        {rows}
        spellcheck="false"
        placeholder={htmlPlaceholder}
        value={html}
        oninput={(e) => onChangeHtml((e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="bt-hint">Templates: <code>{`{{input.field}}`}</code>. With "Both", executor sends <code>multipart/alternative</code>.</span>
    </label>
  {/if}
</section>

<style>
  .bt-sec { display: flex; flex-direction: column; gap: 8px; }
  .bt-sec-hdr {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
  }
  .bt-mode-toggle {
    display: inline-flex; gap: 0; border: 1px solid var(--card-border);
  }
  .bt-mode-btn {
    padding: 2px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .bt-mode-btn + .bt-mode-btn { border-left: 1px solid var(--card-border); }
  .bt-mode-btn:hover { color: var(--text-primary); }
  .bt-mode-btn-active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-primary);
  }
  .bt-field { display: flex; flex-direction: column; gap: 4px; }
  .bt-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .bt-code {
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
  .bt-code:focus { border-color: var(--text-muted); }
  .bt-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .bt-hint code { font-size: var(--fs-label); color: var(--text-muted); font-family: var(--font-code); }
</style>
