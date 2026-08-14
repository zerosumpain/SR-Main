<script lang="ts">
  // The credential form jkai opens when it needs a key it must never see.
  //
  // THIS COMPONENT IS THE ONLY PLACE THE VALUE EXISTS IN TRANSIT. It goes
  // straight from these inputs to POST /api/admin/apis/secrets — the route that
  // re-checks the owner session in-handler and deliberately refuses the homeserv
  // AUTH_BYPASS. Nothing here writes a value into the chat stream, the ack, or
  // any log. The ack carries { requestId, handle, stored } and the server
  // rejects any other key.
  //
  // Everything rendered above the fields is server-authored from
  // $lib/secrets/credential-requests. `reason` is the one model-authored string
  // and is rendered as QUOTED TEXT, never as instruction.

  import { onMount } from 'svelte';
  import { customCredentialSavePayload, parseCustomAllowedHosts } from '$lib/secrets/custom-credential';
  import type { SecretRequestEvent, SecretUpdateEvent } from '$lib/secrets/credential-requests';

  let {
    request,
    onDone,
  }: {
    request: SecretRequestEvent | SecretUpdateEvent;
    /** Reports the OUTCOME only — never a value. */
    onDone: (result: { stored: boolean; handle?: string }) => void;
  } = $props();

  let values = $state<Record<string, string>>({});
  /** Owner-reviewable custom binding; known providers keep their catalogue binding. */
  let customAllowedHosts = $state('');
  /** What the owner has typed to confirm each newly-reachable host. */
  let typedHosts = $state<Record<string, string>>({});
  let saving = $state(false);
  let error = $state<string | null>(null);
  let panel = $state<HTMLDivElement | null>(null);

  // Narrow the union ONCE, into plain values the template can read without
  // re-narrowing. `kind` is absent on the create event.
  const upd = $derived('kind' in request && request.kind === 'update' ? request : null);
  const mode = $derived(upd?.mode ?? 'create');
  const current = $derived(upd?.current ?? null);
  const proposed = $derived(upd?.proposed ?? null);
  const change = $derived(upd?.change ?? null);
  const mustType = $derived(upd?.requiresTypedHosts ?? []);
  const isCustomCreate = $derived(!upd && (request as SecretRequestEvent).provider === 'custom');
  const customHostError = $derived.by(() => {
    if (!isCustomCreate) return null;
    try {
      parseCustomAllowedHosts(customAllowedHosts);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Enter at least one allowed API hostname.';
    }
  });

  const normHost = (h: string) => h.trim().toLowerCase().replace(/\.+$/, '');

  /** Which required inputs are still empty — drives the disabled Save button. */
  const missing = $derived.by(() => {
    if (mode === 'rebind') {
      // Nothing is mandatory: a proposal whose new hosts go unconfirmed simply
      // lands as the part the owner did agree to. Save is blocked only when the
      // change would amount to nothing at all.
      const removals =
        (change?.removedHosts.length ?? 0) +
        (change?.removedMethods.length ?? 0) +
        (change?.addedMethods.length ?? 0) +
        (change?.addedPathPrefixes.length ?? 0) +
        (change?.removedPathPrefixes.length ?? 0);
      const confirmedAny = mustType.some((h) => normHost(typedHosts[h] ?? '') === normHost(h));
      return removals === 0 && !confirmedAny ? ['a confirmed change'] : [];
    }
    if (mode === 'amend') {
      // Every field is optional individually, but at least one must be filled —
      // otherwise the form would post a no-op.
      const any = request.fields.some((f) => String(values[f.key] ?? '').trim());
      return any ? [] : ['at least one field'];
    }
    const required = request.fields.filter((f) => f.required && !String(values[f.key] ?? '').trim()).map((f) => f.label);
    return isCustomCreate && customHostError ? [...required, 'a valid allowed host'] : required;
  });

  onMount(() => {
    if (isCustomCreate) customAllowedHosts = (request as SecretRequestEvent).destination.hosts.join(', ');
    panel?.querySelector<HTMLInputElement>('input, textarea')?.focus();
  });

  /** The request body. Note what is NOT in the update variants: no handle, no
   *  host list, no injection. The server reads those from the plan it parked
   *  under `requestId` before this form was shown. */
  function payload(): Record<string, unknown> {
    if (upd) {
      if (mode === 'rebind') {
        return {
          requestId: upd.requestId,
          confirmedHosts: mustType.filter((h) => normHost(typedHosts[h] ?? '') === normHost(h)),
        };
      }
      if (mode === 'amend') {
        // Only non-blank fields travel; the server merges them into the stored
        // credential set, so a blank box keeps whatever is already there.
        return {
          requestId: upd.requestId,
          fields: Object.fromEntries(
            request.fields
              .map((f) => [f.key, String(values[f.key] ?? '').trim()])
              .filter(([, v]) => v !== ''),
          ),
        };
      }
      return { requestId: upd.requestId, value: String(values[request.fields[0]?.key] ?? '').trim() };
    }

    // 'json' assembles the multi-field credential SET into one encrypted
    // value — the shape $lib/secrets/oauth-refresh reads back.
    const value =
      request.assemble === 'json'
        ? JSON.stringify(
            Object.fromEntries(
              request.fields
                .map((f) => [f.key, String(values[f.key] ?? '').trim()])
                .filter(([, v]) => v !== ''),
            ),
          )
        : String(values[request.fields[0]?.key] ?? '').trim();
    const create = request as SecretRequestEvent;
    if (create.provider === 'custom') {
      return customCredentialSavePayload({
        value,
        label: create.title,
        handle: create.destination.handle,
        allowedHosts: customAllowedHosts,
      });
    }
    return { provider: create.provider, value };
  }

  async function save() {
    if (saving || missing.length) return;
    saving = true;
    error = null;
    try {
      const res = await fetch('/api/admin/apis/secrets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        error =
          res.status === 403
            ? 'That needs a signed-in owner session. Sign in at /login in another tab and try again.'
            : (j.error ?? `Could not save (HTTP ${res.status}).`);
        saving = false;
        return;
      }
      // Deliberately discards the response body. It contains no value by type,
      // but nothing downstream needs it either.
      onDone({ stored: true, handle: upd ? upd.handle : (request as SecretRequestEvent).destination.handle });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not reach the server.';
      saving = false;
    }
  }

  function decline() {
    if (saving) return;
    onDone({ stored: false });
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') decline();
  }

  function trapTab(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>('input, textarea, button, a[href]'),
    ).filter((el) => !el.hasAttribute('disabled'));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Portal to <body> so the overlay escapes any stacking context (SR modal-token
  // guidance — the same local action FileViewerModal and ResearchSourceModal use).
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Backdrop click does NOT dismiss: a half-typed credential is easy to lose by
     a stray click, and the turn is blocked waiting on an explicit answer. -->
<div class="sr-backdrop" use:portal role="presentation">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="sr-modal"
    bind:this={panel}
    onkeydown={trapTab}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label="{request.title} — {mode === 'create'
      ? 'credential needed'
      : mode === 'rebind'
        ? 'binding change'
        : 'credential update'}"
  >
    <header class="sr-hdr">
      <span class="sr-title">{request.title}</span>
      <span class="sr-badge">
        {mode === 'create' ? 'credential needed' : mode === 'rebind' ? 'binding change' : 'credential update'}
      </span>
    </header>

    {#if request.reason}
      <p class="sr-reason">jkai says: <q>{request.reason}</q></p>
    {/if}

    {#if upd && current}
      <dl class="sr-dest">
        <dt>Updating</dt>
        <dd>
          <code>api_secrets</code> → <code>{upd.handle}</code>
          <span class="sr-note">encrypted at rest</span>
        </dd>
        {#if mode === 'rebind' && proposed && change}
          <dt>Hosts</dt>
          <dd>
            {#if change.addedHosts.length === 0 && change.removedHosts.length === 0}
              <span class="sr-note">unchanged — {current.hosts.join(', ') || '—'}</span>
            {:else}
              <span class="sr-was">{current.hosts.join(', ') || '—'}</span>
              <span class="sr-arrow">→</span>
              <span class="sr-now">{proposed.hosts.join(', ') || '—'}</span>
            {/if}
          </dd>
          <dt>Methods</dt>
          <dd>
            {#if change.addedMethods.length === 0 && change.removedMethods.length === 0}
              <span class="sr-note">unchanged — {current.methods.join('/')}</span>
            {:else}
              <span class="sr-was">{current.methods.join('/')}</span>
              <span class="sr-arrow">→</span>
              <span class="sr-now">{proposed.methods.join('/')}</span>
            {/if}
          </dd>
          <dt>Paths</dt>
          <dd>
            {#if change.addedPathPrefixes.length === 0 && change.removedPathPrefixes.length === 0}
              <span class="sr-note">unchanged — {current.pathPrefixes.join(', ') || 'any path'}</span>
            {:else}
              <span class="sr-was">{current.pathPrefixes.join(', ') || 'any path'}</span>
              <span class="sr-arrow">→</span>
              <span class="sr-now">{proposed.pathPrefixes.join(', ') || 'any path'}</span>
            {/if}
          </dd>
        {:else}
          <dt>Binding</dt>
          <dd>
            {#if current.storeOnly}
              <span class="sr-note">unchanged — store-only, never attached to any outbound request</span>
            {:else}
              <span class="sr-note">unchanged — {current.hosts.join(', ') || '—'}, {current.methods.join('/')} only</span>
            {/if}
          </dd>
        {/if}
      </dl>

      {#if change?.widens && !change.widensHosts}
        <p class="sr-warn">
          This widens what the credential may do on hosts it can already reach. Nothing here lets it reach a new host.
        </p>
      {/if}

      {#if mustType.length}
        <div class="sr-confirm">
          <p class="sr-warn">
            This would let <code>{upd.handle}</code> be sent somewhere it has never been sent. jkai suggested
            {mustType.length === 1 ? 'this host' : 'these hosts'} — type
            {mustType.length === 1 ? 'it' : 'each one'} to confirm you recognise
            {mustType.length === 1 ? 'it' : 'them'} as the vendor's. Leave a box blank to drop that host.
          </p>
          {#each mustType as h (h)}
            <label class="sr-field">
              <span class="sr-label">Type <code class="sr-target">{h}</code></span>
              <!-- No placeholder of the hostname itself: a pre-filled-looking
                   box invites a glance-and-accept, and typing it out is the
                   entire point of this step. -->
              <input
                type="text"
                bind:value={typedHosts[h]}
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
              />
              {#if normHost(typedHosts[h] ?? '') === normHost(h)}
                <span class="sr-help">confirmed — this host will be added</span>
              {:else if (typedHosts[h] ?? '').trim()}
                <span class="sr-error">doesn't match — this host will be dropped</span>
              {/if}
            </label>
          {/each}
        </div>
      {/if}
    {:else if !upd}
      <dl class="sr-dest">
        <dt>Stored in</dt>
        <dd>
          <code>{(request as SecretRequestEvent).destination.store}</code> →
          <code>{(request as SecretRequestEvent).destination.handle}</code>
          <span class="sr-note">encrypted at rest</span>
        </dd>
        <dt>Binding</dt>
        <dd>
          {#if (request as SecretRequestEvent).destination.storeOnly}
            <span class="sr-note">store-only — never attached to any outbound request</span>
          {:else}
            {(request as SecretRequestEvent).destination.hosts.join(', ') || '—'}
            <span class="sr-note">{(request as SecretRequestEvent).destination.methods.join('/')} only</span>
          {/if}
        </dd>
        {#each (request as SecretRequestEvent).companions as c (c.handle)}
          <dt>Also creates</dt>
          <dd>
            <code>{c.handle}</code> → {c.hosts.join(', ')}
            <span class="sr-note">{c.methods.join('/')} only</span>
          </dd>
        {/each}
      </dl>

      {#if (request as SecretRequestEvent).provider === 'custom'}
        <p class="sr-warn">
          jkai suggested this destination. Check the host matches the vendor — this is where your key will be sent.
        </p>
        <label class="sr-field">
          <span class="sr-label">Allowed hosts<span class="sr-req">*</span></span>
          <input
            class="nm-text-input"
            type="text"
            bind:value={customAllowedHosts}
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            aria-describedby="custom-host-help"
          />
          <span id="custom-host-help" class="sr-help">
            Required. Enter one or more bare API hostnames, separated by commas (for example, realtime.nationalrail.co.uk).
          </span>
          {#if customHostError}<span class="sr-error">{customHostError}</span>{/if}
        </label>
      {/if}
    {/if}

    <div class="sr-fields">
      {#each request.fields as f (f.key)}
        <label class="sr-field">
          <span class="sr-label">{f.label}{#if f.required}<span class="sr-req">*</span>{/if}</span>
          {#if f.type === 'textarea'}
            <textarea
              bind:value={values[f.key]}
              placeholder={f.placeholder ?? ''}
              autocomplete="off"
              spellcheck="false"
              rows="3"
            ></textarea>
          {:else}
            <input
              class="nm-text-input"
              type={f.type === 'password' ? 'password' : 'text'}
              bind:value={values[f.key]}
              placeholder={f.placeholder ?? ''}
              autocomplete="off"
              spellcheck="false"
            />
          {/if}
          {#if f.help}<span class="sr-help">{f.help}</span>{/if}
        </label>
      {/each}
    </div>

    {#if request.helpUrl}
      <p class="sr-help-link">
        Where do I find these? <a href={request.helpUrl} target="_blank" rel="noopener noreferrer">{request.helpUrl} ↗</a>
      </p>
    {/if}

    <p class="sr-assurance">
      {#if mode === 'rebind'}
        No credential is entered or revealed here — this only changes where the stored one may be sent.
      {:else if mode === 'amend'}
        jkai never sees these values and cannot read them back. Blank boxes keep what is already stored.
      {:else}
        jkai never sees these values and cannot read them back. Don't paste them into the chat box.
      {/if}
    </p>

    {#if error}<p class="sr-error">{error}</p>{/if}

    <footer class="sr-foot">
      <button type="button" class="sr-btn" onclick={decline} disabled={saving}>Not now</button>
      <button
        type="button"
        class="sr-btn sr-primary"
        onclick={save}
        disabled={saving || missing.length > 0}
        title={missing.length ? `Still needed: ${missing.join(', ')}` : ''}
      >
        {saving ? 'Saving…' : mode === 'rebind' ? 'Apply change' : 'Save & continue'}
      </button>
    </footer>
  </div>
</div>

<style>
  @import '../../../../design-system/tokens.css';

  .sr-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(8px, 3vw, 40px);
    background: color-mix(in srgb, var(--text-primary) 55%, transparent);
    backdrop-filter: blur(2px);
  }
  .sr-modal {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: min(520px, 100%);
    max-height: min(88vh, 100%);
    overflow-y: auto;
    padding: 16px;
    /* Opaque — a credential form must never show the chat through it. */
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-md, 4px);
  }
  .sr-hdr {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .sr-title {
    font-family: var(--font-display, inherit);
    font-size: var(--fs-h4);
    color: var(--text-primary);
  }
  .sr-badge {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink, var(--accent));
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .sr-reason {
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
  .sr-dest {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
    padding: 10px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    font-size: var(--fs-body-sm);
  }
  .sr-dest dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    text-transform: uppercase;
  }
  .sr-dest dd {
    margin: 0;
    color: var(--text-primary);
  }
  .sr-dest code {
    font-family: var(--font-mono);
  }
  .sr-note {
    color: var(--text-muted);
  }
  /* Before → after. The old value is muted and struck through so the direction
     of the change reads at a glance rather than needing to be compared. */
  .sr-was {
    color: var(--text-muted);
    text-decoration: line-through;
  }
  .sr-arrow {
    padding: 0 4px;
    color: var(--text-muted);
  }
  .sr-now {
    color: var(--text-primary);
  }
  .sr-confirm {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sr-target {
    font-family: var(--font-mono);
    text-transform: none;
    color: var(--text-primary);
  }
  .sr-warn {
    margin: 0;
    padding: 8px 10px;
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    background: var(--bg);
    border-left: 2px solid var(--status-error);
  }
  .sr-fields {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sr-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sr-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    text-transform: uppercase;
  }
  .sr-req {
    color: var(--status-error);
  }
  .sr-field input,
  .sr-field textarea {
    /* 16px floor — anything smaller triggers iOS zoom on focus. */
    font-size: 16px;
    font-family: var(--font-mono);
    padding: 8px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp, 2px);
  }
  .sr-field input:focus,
  .sr-field textarea:focus {
    outline: 2px solid var(--accent-tint-35, var(--accent));
    outline-offset: -1px;
  }
  .sr-help,
  .sr-help-link,
  .sr-assurance {
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
  .sr-error {
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--status-error);
  }
  .sr-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .sr-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-sm);
    padding: 8px 14px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp, 2px);
    cursor: pointer;
  }
  .sr-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .sr-primary {
    color: var(--bg);
    background: var(--accent-ink, var(--accent));
    border-color: var(--accent-ink, var(--accent));
  }
</style>
