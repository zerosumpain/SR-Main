<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import GmailAccountPicker from './widgets/GmailAccountPicker.svelte';
  import RecipientListBlock from './widgets/RecipientListBlock.svelte';
  import BodyTabsBlock from './widgets/BodyTabsBlock.svelte';

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

  // ---------- Raw JSON --------------------------------------------------
  // `definition` is referenced only for typings; the canvas-level preview
  // header (in /jkai/canvas/[slug]/+page.svelte) handles the "What this does"
  // line so we don't duplicate it inside the panel.
  void definition;
</script>

<div class="gr">
  <GmailAccountPicker
    value={config.accountId as number | string | null | undefined}
    onChange={(next) => set('accountId', next)}
    title="Sending account"
  />

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

  <RecipientListBlock
    label="To"
    value={config.to}
    onChange={(raw) => set('to', raw)}
    placeholder="alice@example.com — Enter or , to add"
    templatePlaceholder={`{{input.from}} or {{trigger.output.from}}`}
    chipsHint={`Usually <code>{{input.from}}</code> when replying to the original sender.`}
    templateHint={`Templates supported: <code>{{input.field}}</code>. Comma-separate for multiple.`}
  />

  <details class="gr-cc">
    <summary><span class="sr-label-tight">Cc / Bcc</span></summary>
    <RecipientListBlock
      label="Cc"
      value={config.cc}
      onChange={(raw) => set('cc', raw)}
      placeholder="cc@example.com"
      templatePlaceholder={`{{input.cc}}`}
    />
    <RecipientListBlock
      label="Bcc"
      value={config.bcc}
      onChange={(raw) => set('bcc', raw)}
      placeholder="bcc@example.com"
      templatePlaceholder={`{{input.bcc}}`}
    />
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

  <BodyTabsBlock
    text={String(config.bodyText ?? '')}
    html={String(config.bodyHtml ?? '')}
    onChangeText={(v) => set('bodyText', v)}
    onChangeHtml={(v) => set('bodyHtml', v)}
    textPlaceholder={`Thanks for your email,\n\n{{input.summary}}`}
    htmlPlaceholder={`<p>{{input.summary}}</p>`}
  />

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <RawConfigEditor {config} {onChange} />
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
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .gr-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .gr-hint code, .gr-label code { font-size: var(--fs-label); color: var(--text-muted); }
  .gr-hint a { color: var(--accent); text-decoration: none; }
  .gr-hint a:hover { text-decoration: underline; }

  .gr-empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }
  .gr-warn {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    color: var(--status-error, #c0392b);
  }

  .gr-mode-toggle { display: inline-flex; gap: 0; border: 1px solid var(--card-border); }
  .gr-mode-btn {
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text-muted);
    border: none;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
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
    font-family: var(--font-code); font-size: var(--fs-label);
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
</style>
