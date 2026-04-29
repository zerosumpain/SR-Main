<script lang="ts" module>
  // Module-scoped cache so re-mounting the panel doesn't re-fetch the
  // accounts list on every open of the config drawer.
  type GmailAccount = {
    id: number;
    email: string;
    status?: string | null;
  };
  let accountsPromise: Promise<GmailAccount[]> | null = null;

  function loadAccounts(): Promise<GmailAccount[]> {
    if (!accountsPromise) {
      accountsPromise = fetch('/api/gmail/accounts')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((rows): GmailAccount[] => {
          if (!Array.isArray(rows)) return [];
          return rows
            .filter((r) => r && typeof r === 'object')
            .map((r) => ({
              id: Number((r as Record<string, unknown>).id ?? 0),
              email: String((r as Record<string, unknown>).email ?? ''),
              status: (r as Record<string, unknown>).status as string | null | undefined,
            }))
            .filter((r) => r.id > 0);
        })
        .catch((err) => {
          // Reset so a later mount can retry, but resolve to [] for the UI
          // (the panel renders a number-input fallback when the list is empty).
          accountsPromise = null;
          console.warn('[GmailSendPanel] failed to load /api/gmail/accounts', err);
          return [];
        });
    }
    return accountsPromise;
  }
</script>

<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ChipInputField from './widgets/ChipInputField.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  // ---------- Helpers ----------------------------------------------------

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // The orchestrator may serialise to/cc/bcc as either a comma-separated
  // string or an array of strings. We accept both shapes when reading;
  // we always write back as a single string (the executor expects a string
  // and runs template interpolation on it).
  function readRecipientRaw(raw: unknown): string {
    if (Array.isArray(raw)) {
      return raw.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
    }
    return String(raw ?? '');
  }

  function rawToChips(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function chipsToRaw(chips: string[]): string {
    return chips.join(', ');
  }

  function detectMode(raw: string): 'chips' | 'template' {
    return raw.includes('{{') ? 'template' : 'chips';
  }

  // ---------- Recipient state -------------------------------------------

  const initialTo = readRecipientRaw(config.to);
  const initialCc = readRecipientRaw(config.cc);
  const initialBcc = readRecipientRaw(config.bcc);

  let toMode = $state<'chips' | 'template'>(detectMode(initialTo));
  let ccMode = $state<'chips' | 'template'>(detectMode(initialCc));
  let bccMode = $state<'chips' | 'template'>(detectMode(initialBcc));

  const toRaw = $derived(readRecipientRaw(config.to));
  const ccRaw = $derived(readRecipientRaw(config.cc));
  const bccRaw = $derived(readRecipientRaw(config.bcc));

  const toChips = $derived(rawToChips(toRaw));
  const ccChips = $derived(rawToChips(ccRaw));
  const bccChips = $derived(rawToChips(bccRaw));

  function setRecipient(key: 'to' | 'cc' | 'bcc', raw: string) {
    set(key, raw);
  }

  // ---------- Account picker --------------------------------------------

  const accountId = $derived(Number(config.accountId ?? 0));
  let accounts = $state<GmailAccount[]>([]);
  let accountsLoaded = $state(false);
  let accountsError = $state(false);

  $effect(() => {
    let cancelled = false;
    loadAccounts().then((rows) => {
      if (cancelled) return;
      accounts = rows;
      accountsLoaded = true;
      accountsError = rows.length === 0;
    });
    return () => {
      cancelled = true;
    };
  });

  // ---------- Body tabs --------------------------------------------------
  // Defaults from existing config:
  //   - both bodyText and bodyHtml populated → 'both'
  //   - bodyHtml only                       → 'html'
  //   - else (bodyText only / both empty)   → 'text'
  // Switching tabs does NOT erase the inactive value, so a user can flip
  // back without losing work.

  function detectBodyTab(c: Record<string, unknown>): 'text' | 'html' | 'both' {
    const t = String(c.bodyText ?? '').trim();
    const h = String(c.bodyHtml ?? '').trim();
    if (t && h) return 'both';
    if (h && !t) return 'html';
    return 'text';
  }
  let bodyTab = $state<'text' | 'html' | 'both'>(detectBodyTab(config));

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does"
  // line so we don't duplicate it inside the panel.
  void definition;
</script>

<div class="gs">
  <!-- Account picker -->
  <section class="gs-sec">
    <header class="gs-sec-hdr">
      <span class="sr-label-tight">Sending account</span>
      {#if !accountId}<span class="gs-warn">⚠ pick an account</span>{/if}
    </header>
    {#if !accountsLoaded}
      <p class="gs-empty">Loading accounts…</p>
    {:else if accountsError || accounts.length === 0}
      <label class="gs-field">
        <span class="gs-label">Account ID</span>
        <input
          type="number"
          min="0"
          step="1"
          value={accountId || ''}
          placeholder="e.g. 1"
          oninput={(e) =>
            set('accountId', Number((e.currentTarget as HTMLInputElement).value) || 0)}
        />
        <span class="gs-hint">
          Couldn’t load the accounts list. Connect or inspect accounts at
          <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
        </span>
      </label>
    {:else}
      <label class="gs-field">
        <span class="gs-label">Account</span>
        <select
          value={String(accountId || 0)}
          onchange={(e) =>
            set('accountId', Number((e.currentTarget as HTMLSelectElement).value) || 0)}
        >
          <option value="0">— pick an account —</option>
          {#each accounts as a (a.id)}
            <option value={String(a.id)}>{a.email} (#{a.id})</option>
          {/each}
        </select>
        <span class="gs-hint">
          Manage connected accounts at
          <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
        </span>
      </label>
    {/if}
  </section>

  <!-- To -->
  <section class="gs-sec">
    <header class="gs-sec-hdr">
      <span class="sr-label-tight">To</span>
      <div class="gs-mode-toggle" role="tablist" aria-label="To input mode">
        <button
          type="button"
          class="gs-mode-btn"
          class:gs-mode-btn-active={toMode === 'chips'}
          role="tab"
          aria-selected={toMode === 'chips'}
          onclick={() => (toMode = 'chips')}
        >Chips</button>
        <button
          type="button"
          class="gs-mode-btn"
          class:gs-mode-btn-active={toMode === 'template'}
          role="tab"
          aria-selected={toMode === 'template'}
          onclick={() => (toMode = 'template')}
        >Template</button>
      </div>
    </header>
    {#if toMode === 'chips'}
      <ChipInputField
        value={toChips}
        placeholder="alice@example.com — Enter or , to add"
        onChange={(v) => setRecipient('to', chipsToRaw(v))}
      />
      <span class="gs-hint">One or more recipients. Use Template mode for <code>{`{{input.x}}`}</code> values.</span>
    {:else}
      <textarea
        class="gs-code"
        rows="2"
        spellcheck="false"
        placeholder={`{{input.recipient}} or {{trigger.output.from}}`}
        value={toRaw}
        oninput={(e) => setRecipient('to', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="gs-hint">Templates supported: <code>{`{{input.field}}`}</code>. Comma-separate for multiple.</span>
    {/if}
  </section>

  <!-- Cc / Bcc (collapsed) -->
  <details class="gs-cc">
    <summary><span class="sr-label-tight">Cc / Bcc</span></summary>

    <section class="gs-sec">
      <header class="gs-sec-hdr">
        <span class="sr-label-tight">Cc</span>
        <div class="gs-mode-toggle" role="tablist" aria-label="Cc input mode">
          <button
            type="button"
            class="gs-mode-btn"
            class:gs-mode-btn-active={ccMode === 'chips'}
            role="tab"
            aria-selected={ccMode === 'chips'}
            onclick={() => (ccMode = 'chips')}
          >Chips</button>
          <button
            type="button"
            class="gs-mode-btn"
            class:gs-mode-btn-active={ccMode === 'template'}
            role="tab"
            aria-selected={ccMode === 'template'}
            onclick={() => (ccMode = 'template')}
          >Template</button>
        </div>
      </header>
      {#if ccMode === 'chips'}
        <ChipInputField
          value={ccChips}
          placeholder="cc@example.com"
          onChange={(v) => setRecipient('cc', chipsToRaw(v))}
        />
      {:else}
        <textarea
          class="gs-code"
          rows="2"
          spellcheck="false"
          placeholder={`{{input.cc}}`}
          value={ccRaw}
          oninput={(e) => setRecipient('cc', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
      {/if}
    </section>

    <section class="gs-sec">
      <header class="gs-sec-hdr">
        <span class="sr-label-tight">Bcc</span>
        <div class="gs-mode-toggle" role="tablist" aria-label="Bcc input mode">
          <button
            type="button"
            class="gs-mode-btn"
            class:gs-mode-btn-active={bccMode === 'chips'}
            role="tab"
            aria-selected={bccMode === 'chips'}
            onclick={() => (bccMode = 'chips')}
          >Chips</button>
          <button
            type="button"
            class="gs-mode-btn"
            class:gs-mode-btn-active={bccMode === 'template'}
            role="tab"
            aria-selected={bccMode === 'template'}
            onclick={() => (bccMode = 'template')}
          >Template</button>
        </div>
      </header>
      {#if bccMode === 'chips'}
        <ChipInputField
          value={bccChips}
          placeholder="bcc@example.com"
          onChange={(v) => setRecipient('bcc', chipsToRaw(v))}
        />
      {:else}
        <textarea
          class="gs-code"
          rows="2"
          spellcheck="false"
          placeholder={`{{input.bcc}}`}
          value={bccRaw}
          oninput={(e) => setRecipient('bcc', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
      {/if}
    </section>
  </details>

  <!-- Subject -->
  <section class="gs-sec">
    <header class="gs-sec-hdr"><span class="sr-label-tight">Subject</span></header>
    <label class="gs-field">
      <span class="gs-label">Subject line</span>
      <input
        type="text"
        spellcheck="false"
        placeholder="Daily digest for {`{{input.date}}`}"
        value={String(config.subject ?? '')}
        oninput={(e) => set('subject', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="gs-hint">Templates supported: <code>{`{{input.field}}`}</code></span>
    </label>
  </section>

  <!-- Body -->
  <section class="gs-sec">
    <header class="gs-sec-hdr">
      <span class="sr-label-tight">Body</span>
      <div class="gs-mode-toggle" role="tablist" aria-label="Body content type">
        <button
          type="button"
          class="gs-mode-btn"
          class:gs-mode-btn-active={bodyTab === 'text'}
          role="tab"
          aria-selected={bodyTab === 'text'}
          onclick={() => (bodyTab = 'text')}
        >Plain text</button>
        <button
          type="button"
          class="gs-mode-btn"
          class:gs-mode-btn-active={bodyTab === 'html'}
          role="tab"
          aria-selected={bodyTab === 'html'}
          onclick={() => (bodyTab = 'html')}
        >HTML</button>
        <button
          type="button"
          class="gs-mode-btn"
          class:gs-mode-btn-active={bodyTab === 'both'}
          role="tab"
          aria-selected={bodyTab === 'both'}
          onclick={() => (bodyTab = 'both')}
        >Both</button>
      </div>
    </header>

    {#if bodyTab === 'text' || bodyTab === 'both'}
      <label class="gs-field">
        <span class="gs-label">Plain-text body</span>
        <textarea
          class="gs-code"
          rows="6"
          spellcheck="false"
          placeholder={`Hello,\n\n{{input.summary}}`}
          value={String(config.bodyText ?? '')}
          oninput={(e) => set('bodyText', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="gs-hint">Templates: <code>{`{{input.field}}`}</code></span>
      </label>
    {/if}

    {#if bodyTab === 'html' || bodyTab === 'both'}
      <label class="gs-field">
        <span class="gs-label">HTML body</span>
        <textarea
          class="gs-code"
          rows="6"
          spellcheck="false"
          placeholder={`<p>{{input.summary}}</p>`}
          value={String(config.bodyHtml ?? '')}
          oninput={(e) => set('bodyHtml', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="gs-hint">Templates: <code>{`{{input.field}}`}</code>. With “Both”, executor sends <code>multipart/alternative</code>.</span>
      </label>
    {/if}
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="gs-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="gs-code"
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
  .gs { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .gs-sec { display: flex; flex-direction: column; gap: 8px; }
  .gs-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .gs-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .gs-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .gs-hint { font-size: 11px; color: var(--text-ghost); }
  .gs-hint code, .gs-label code { font-size: 11px; color: var(--text-muted); }
  .gs-hint a { color: var(--accent); text-decoration: none; }
  .gs-hint a:hover { text-decoration: underline; }

  .gs-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }
  .gs-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
  }

  .gs-mode-toggle { display: inline-flex; gap: 0; border: 1px solid var(--card-border); }
  .gs-mode-btn {
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .gs-mode-btn + .gs-mode-btn { border-left: 1px solid var(--card-border); }
  .gs-mode-btn:hover { color: var(--text-primary); }
  .gs-mode-btn-active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-primary);
  }

  .gs-code {
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
  .gs-code:focus { border-color: var(--text-muted); }

  input[type='text'], input[type='number'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, input[type='number']:focus, select:focus, textarea:focus {
    border-color: var(--text-muted);
  }

  .gs-cc {
    border: 1px dashed var(--card-border);
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .gs-cc[open] { padding-bottom: 10px; }
  .gs-cc summary { cursor: pointer; padding: 2px 0; }
  .gs-cc > .gs-sec { margin-top: 8px; }

  .gs-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .gs-raw summary { cursor: pointer; }
</style>
