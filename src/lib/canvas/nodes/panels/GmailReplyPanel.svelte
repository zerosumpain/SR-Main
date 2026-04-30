<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ResourcePicker from './shared/ResourcePicker.svelte';
  import { fetchGmailAccountOptions } from './shared/gmailAccounts';
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
  // ResourcePicker works with string values; we round-trip via String/Number
  // because the executor expects accountId as a number. Templated values
  // (e.g. `{{input.accountId}}`) round-trip as strings.

  const accountId = $derived(Number(config.accountId ?? 0));
  const accountValue = $derived(
    typeof config.accountId === 'string' && config.accountId.includes('{{')
      ? config.accountId
      : accountId ? String(accountId) : '',
  );

  function setAccount(next: string) {
    if (!next) { set('accountId', 0); return; }
    if (next.includes('{{')) { set('accountId', next); return; }
    const n = Number(next);
    set('accountId', Number.isFinite(n) ? n : 0);
  }

  // ---------- Thread identification -------------------------------------
  // The reply executor identifies the target conversation via three keys:
  //   - threadId  : Gmail's internal thread id (required for proper threading).
  //   - inReplyTo : RFC 822 Message-ID of the message being replied to —
  //                 written into the In-Reply-To header so mail clients show
  //                 the message as a reply.
  //   - references: Optional References header value. Defaults to inReplyTo
  //                 when blank, so only set explicitly for long chains.

  const threadId = $derived(String(config.threadId ?? ''));
  const inReplyTo = $derived(String(config.inReplyTo ?? ''));
  const references = $derived(String(config.references ?? ''));

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

<div class="gr">
  <!-- Account picker -->
  <section class="gr-sec">
    <header class="gr-sec-hdr">
      <span class="sr-label-tight">Sending account</span>
      {#if !accountId}<span class="gr-warn">⚠ pick an account</span>{/if}
    </header>
    <ResourcePicker
      label="Account"
      value={accountValue}
      fetcher={fetchGmailAccountOptions}
      onChange={setAccount}
      placeholder="pick an account"
      emptyHint="No connected accounts — connect one at /admin/gmail."
    />
    <span class="gr-hint">
      Manage connected accounts at
      <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
    </span>
  </section>

  <!-- Thread / Message ID -->
  <section class="gr-sec">
    <header class="gr-sec-hdr">
      <span class="sr-label-tight">Thread / Message ID</span>
      {#if !threadId.trim()}<span class="gr-warn">⚠ threadId is required</span>{/if}
    </header>
    <label class="gr-field">
      <span class="gr-label">Thread ID</span>
      <input
        type="text"
        spellcheck="false"
        placeholder={`{{input.threadId}}`}
        value={threadId}
        oninput={(e) => set('threadId', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="gr-hint">
        Usually <code>{`{{input.threadId}}`}</code> from a <code>gmail-trigger</code>
        or <code>gmail-fetch</code> node upstream.
      </span>
    </label>
    <label class="gr-field">
      <span class="gr-label">In-Reply-To (RFC 822 Message-ID)</span>
      <input
        type="text"
        spellcheck="false"
        placeholder={`{{input.rfc822MessageId}}`}
        value={inReplyTo}
        oninput={(e) => set('inReplyTo', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="gr-hint">
        Sets the <code>In-Reply-To</code> header so mail clients render this as a
        reply. Typically <code>{`{{input.rfc822MessageId}}`}</code>.
      </span>
    </label>
    <details class="gr-adv">
      <summary><span class="sr-label-tight">References (advanced)</span></summary>
      <label class="gr-field">
        <span class="gr-label">References header</span>
        <input
          type="text"
          spellcheck="false"
          placeholder="defaults to In-Reply-To if empty"
          value={references}
          oninput={(e) => set('references', (e.currentTarget as HTMLInputElement).value)}
        />
        <span class="gr-hint">
          Optional — defaults to the In-Reply-To value. Set explicitly only for long
          reply chains where you want to preserve the full <code>References</code> list.
        </span>
      </label>
    </details>
  </section>

  <!-- To -->
  <section class="gr-sec">
    <header class="gr-sec-hdr">
      <span class="sr-label-tight">To</span>
      <div class="gr-mode-toggle" role="tablist" aria-label="To input mode">
        <button
          type="button"
          class="gr-mode-btn"
          class:gr-mode-btn-active={toMode === 'chips'}
          role="tab"
          aria-selected={toMode === 'chips'}
          onclick={() => (toMode = 'chips')}
        >Chips</button>
        <button
          type="button"
          class="gr-mode-btn"
          class:gr-mode-btn-active={toMode === 'template'}
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
      <span class="gr-hint">Usually <code>{`{{input.from}}`}</code> when replying to the original sender.</span>
    {:else}
      <textarea
        class="gr-code"
        rows="2"
        spellcheck="false"
        placeholder={`{{input.from}} or {{trigger.output.from}}`}
        value={toRaw}
        oninput={(e) => setRecipient('to', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="gr-hint">Templates supported: <code>{`{{input.field}}`}</code>. Comma-separate for multiple.</span>
    {/if}
  </section>

  <!-- Cc / Bcc (collapsed) -->
  <details class="gr-cc">
    <summary><span class="sr-label-tight">Cc / Bcc</span></summary>

    <section class="gr-sec">
      <header class="gr-sec-hdr">
        <span class="sr-label-tight">Cc</span>
        <div class="gr-mode-toggle" role="tablist" aria-label="Cc input mode">
          <button
            type="button"
            class="gr-mode-btn"
            class:gr-mode-btn-active={ccMode === 'chips'}
            role="tab"
            aria-selected={ccMode === 'chips'}
            onclick={() => (ccMode = 'chips')}
          >Chips</button>
          <button
            type="button"
            class="gr-mode-btn"
            class:gr-mode-btn-active={ccMode === 'template'}
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
          class="gr-code"
          rows="2"
          spellcheck="false"
          placeholder={`{{input.cc}}`}
          value={ccRaw}
          oninput={(e) => setRecipient('cc', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
      {/if}
    </section>

    <section class="gr-sec">
      <header class="gr-sec-hdr">
        <span class="sr-label-tight">Bcc</span>
        <div class="gr-mode-toggle" role="tablist" aria-label="Bcc input mode">
          <button
            type="button"
            class="gr-mode-btn"
            class:gr-mode-btn-active={bccMode === 'chips'}
            role="tab"
            aria-selected={bccMode === 'chips'}
            onclick={() => (bccMode = 'chips')}
          >Chips</button>
          <button
            type="button"
            class="gr-mode-btn"
            class:gr-mode-btn-active={bccMode === 'template'}
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
          class="gr-code"
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
  <section class="gr-sec">
    <header class="gr-sec-hdr"><span class="sr-label-tight">Subject</span></header>
    <label class="gr-field">
      <span class="gr-label">Subject line</span>
      <input
        type="text"
        spellcheck="false"
        placeholder={`{{input.subject}}`}
        value={String(config.subject ?? '')}
        oninput={(e) => set('subject', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="gr-hint">
        Mail clients add <code>Re:</code> automatically — usually just
        <code>{`{{input.subject}}`}</code>.
      </span>
    </label>
  </section>

  <!-- Body -->
  <section class="gr-sec">
    <header class="gr-sec-hdr">
      <span class="sr-label-tight">Body</span>
      <div class="gr-mode-toggle" role="tablist" aria-label="Body content type">
        <button
          type="button"
          class="gr-mode-btn"
          class:gr-mode-btn-active={bodyTab === 'text'}
          role="tab"
          aria-selected={bodyTab === 'text'}
          onclick={() => (bodyTab = 'text')}
        >Plain text</button>
        <button
          type="button"
          class="gr-mode-btn"
          class:gr-mode-btn-active={bodyTab === 'html'}
          role="tab"
          aria-selected={bodyTab === 'html'}
          onclick={() => (bodyTab = 'html')}
        >HTML</button>
        <button
          type="button"
          class="gr-mode-btn"
          class:gr-mode-btn-active={bodyTab === 'both'}
          role="tab"
          aria-selected={bodyTab === 'both'}
          onclick={() => (bodyTab = 'both')}
        >Both</button>
      </div>
    </header>

    {#if bodyTab === 'text' || bodyTab === 'both'}
      <label class="gr-field">
        <span class="gr-label">Plain-text body</span>
        <textarea
          class="gr-code"
          rows="6"
          spellcheck="false"
          placeholder={`Thanks for your email,\n\n{{input.summary}}`}
          value={String(config.bodyText ?? '')}
          oninput={(e) => set('bodyText', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="gr-hint">Templates: <code>{`{{input.field}}`}</code></span>
      </label>
    {/if}

    {#if bodyTab === 'html' || bodyTab === 'both'}
      <label class="gr-field">
        <span class="gr-label">HTML body</span>
        <textarea
          class="gr-code"
          rows="6"
          spellcheck="false"
          placeholder={`<p>{{input.summary}}</p>`}
          value={String(config.bodyHtml ?? '')}
          oninput={(e) => set('bodyHtml', (e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="gr-hint">Templates: <code>{`{{input.field}}`}</code>. With “Both”, executor sends <code>multipart/alternative</code>.</span>
      </label>
    {/if}
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="gr-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="gr-code"
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
  .gr { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .gr-sec { display: flex; flex-direction: column; gap: 8px; }
  .gr-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }

  .gr-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .gr-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .gr-hint { font-size: 11px; color: var(--text-ghost); }
  .gr-hint code, .gr-label code { font-size: 11px; color: var(--text-muted); }
  .gr-hint a { color: var(--accent); text-decoration: none; }
  .gr-hint a:hover { text-decoration: underline; }

  .gr-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }
  .gr-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
  }

  .gr-mode-toggle { display: inline-flex; gap: 0; border: 1px solid var(--card-border); }
  .gr-mode-btn {
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .gr-mode-btn + .gr-mode-btn { border-left: 1px solid var(--card-border); }
  .gr-mode-btn:hover { color: var(--text-primary); }
  .gr-mode-btn-active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-primary);
  }

  .gr-code {
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
  .gr-code:focus { border-color: var(--text-muted); }

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

  .gr-cc {
    border: 1px dashed var(--card-border);
    padding: 6px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .gr-cc[open] { padding-bottom: 10px; }
  .gr-cc summary { cursor: pointer; padding: 2px 0; }
  .gr-cc > .gr-sec { margin-top: 8px; }

  .gr-adv {
    border: 1px dashed var(--card-border);
    padding: 6px 10px;
  }
  .gr-adv summary { cursor: pointer; padding: 2px 0; }
  .gr-adv > .gr-field { margin-top: 8px; }

  .gr-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .gr-raw summary { cursor: pointer; }
</style>
