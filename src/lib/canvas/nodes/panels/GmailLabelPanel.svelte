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

  // The executor reads `add` / `remove` as arrays of label ids. We accept
  // either an array (canonical) or a comma-separated string (legacy/raw
  // JSON edits) when reading; we always write back arrays so the executor
  // gets the shape it expects.
  function readLabelArray(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return raw.map((v) => String(v ?? '').trim()).filter(Boolean);
    }
    if (typeof raw === 'string' && raw.trim()) {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
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

  // ---------- Action enum (add / remove / both) -------------------------
  // The executor accepts both `add` and `remove` arrays in a single call,
  // but the most common patterns are "add only" or "remove only" (e.g.
  // archive = remove ["INBOX"], star = add ["STARRED"]). The action enum
  // is a UI-only convenience that controls which list is editable; the
  // underlying config still uses `add` / `remove` arrays so the executor
  // and existing configs are unaffected.

  function detectAction(c: Record<string, unknown>): 'add' | 'remove' | 'both' {
    const add = readLabelArray(c.add);
    const remove = readLabelArray(c.remove);
    if (add.length > 0 && remove.length > 0) return 'both';
    if (add.length > 0) return 'add';
    if (remove.length > 0) return 'remove';
    return 'add';
  }
  let action = $state<'add' | 'remove' | 'both'>(detectAction(config));

  const addLabels = $derived(readLabelArray(config.add));
  const removeLabels = $derived(readLabelArray(config.remove));

  // ---------- Message id -------------------------------------------------

  const messageId = $derived(String(config.messageId ?? ''));

  // ---------- Raw JSON --------------------------------------------------

  let showRawJson = $state(false);

  // `definition` is referenced only for typings; the canvas-level preview
  // header (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does"
  // line so we don't duplicate it inside the panel.
  void definition;
</script>

<div class="gl">
  <!-- Account picker -->
  <section class="gl-sec">
    <header class="gl-sec-hdr">
      <span class="sr-label-tight">Gmail account</span>
      {#if !accountId}<span class="gl-warn">⚠ pick an account</span>{/if}
    </header>
    <ResourcePicker
      label="Account"
      value={accountValue}
      fetcher={fetchGmailAccountOptions}
      onChange={setAccount}
      placeholder="pick an account"
      emptyHint="No connected accounts — connect one at /admin/gmail."
    />
    <span class="gl-hint">
      Manage connected accounts at
      <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.
    </span>
  </section>

  <!-- Message id (the thing being labelled). The executor uses this
       single field; threadId isn't a separate config key in the executor,
       but a thread id here works because Gmail message ids and thread ids
       share the same modify endpoint shape — users typically pipe in
       {{trigger.output.messageId}} or {{input.messageId}}. -->
  <section class="gl-sec">
    <header class="gl-sec-hdr"><span class="sr-label-tight">Target message</span></header>
    <label class="gl-field">
      <span class="gl-label">Message ID (or thread ID)</span>
      <input
        type="text"
        spellcheck="false"
        placeholder={`{{trigger.output.messageId}}`}
        value={messageId}
        oninput={(e) => set('messageId', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="gl-hint">Templates supported: <code>{`{{input.field}}`}</code>. Typically piped from a trigger or search output.</span>
    </label>
  </section>

  <!-- Action enum -->
  <section class="gl-sec">
    <header class="gl-sec-hdr">
      <span class="sr-label-tight">Action</span>
      <div class="gl-mode-toggle" role="tablist" aria-label="Label action">
        <button
          type="button"
          class="gl-mode-btn"
          class:gl-mode-btn-active={action === 'add'}
          role="tab"
          aria-selected={action === 'add'}
          onclick={() => (action = 'add')}
        >Add</button>
        <button
          type="button"
          class="gl-mode-btn"
          class:gl-mode-btn-active={action === 'remove'}
          role="tab"
          aria-selected={action === 'remove'}
          onclick={() => (action = 'remove')}
        >Remove</button>
        <button
          type="button"
          class="gl-mode-btn"
          class:gl-mode-btn-active={action === 'both'}
          role="tab"
          aria-selected={action === 'both'}
          onclick={() => (action = 'both')}
        >Both</button>
      </div>
    </header>
    <p class="gl-hint">
      Common patterns: archive = <em>Remove</em> <code>INBOX</code>; mark read = <em>Remove</em> <code>UNREAD</code>; star = <em>Add</em> <code>STARRED</code>.
    </p>
  </section>

  {#if action === 'add' || action === 'both'}
    <section class="gl-sec">
      <header class="gl-sec-hdr">
        <span class="sr-label-tight">Labels to add</span>
        <span class="gl-sec-meta">{addLabels.length} {addLabels.length === 1 ? 'label' : 'labels'}</span>
      </header>
      <ChipInputField
        value={addLabels}
        placeholder="STARRED, IMPORTANT, Label_12345 — Enter or , to add"
        onChange={(v) => set('add', v)}
      />
      <span class="gl-hint">System labels: <code>STARRED</code>, <code>IMPORTANT</code>. Custom label ids look like <code>Label_12345</code> — find them at <a href="/admin/gmail" target="_blank" rel="noreferrer"><code>/admin/gmail</code></a>.</span>
    </section>
  {/if}

  {#if action === 'remove' || action === 'both'}
    <section class="gl-sec">
      <header class="gl-sec-hdr">
        <span class="sr-label-tight">Labels to remove</span>
        <span class="gl-sec-meta">{removeLabels.length} {removeLabels.length === 1 ? 'label' : 'labels'}</span>
      </header>
      <ChipInputField
        value={removeLabels}
        placeholder="INBOX, UNREAD — Enter or , to add"
        onChange={(v) => set('remove', v)}
      />
      <span class="gl-hint"><code>INBOX</code> archives the message; <code>UNREAD</code> marks it read.</span>
    </section>
  {/if}

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="gl-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="gl-code"
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
  .gl { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }

  .gl-sec { display: flex; flex-direction: column; gap: 8px; }
  .gl-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .gl-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .gl-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .gl-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .gl-hint { font-size: 11px; color: var(--text-ghost); }
  .gl-hint code, .gl-label code { font-size: 11px; color: var(--text-muted); }
  .gl-hint a { color: var(--accent); text-decoration: none; }
  .gl-hint a:hover { text-decoration: underline; }
  .gl-hint em { font-style: normal; color: var(--text-primary); }

  .gl-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }
  .gl-warn {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--status-error, #c0392b);
  }

  .gl-mode-toggle { display: inline-flex; gap: 0; border: 1px solid var(--card-border); }
  .gl-mode-btn {
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.06em;
    cursor: pointer;
  }
  .gl-mode-btn + .gl-mode-btn { border-left: 1px solid var(--card-border); }
  .gl-mode-btn:hover { color: var(--text-primary); }
  .gl-mode-btn-active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text-primary);
  }

  .gl-code {
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
  .gl-code:focus { border-color: var(--text-muted); }

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

  .gl-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .gl-raw summary { cursor: pointer; }
</style>
