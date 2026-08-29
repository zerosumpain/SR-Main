<script lang="ts">
  type FieldDef = {
    name: string;
    type: string;
    label: string;
    defaultValue?: string;
  };

  type Interaction = {
    id: number;
    runId: string;
    nodeId: string;
    mode: 'vnc' | 'confirm' | 'both';
    prompt: string;
    configSnapshot: { url?: string; fields?: FieldDef[]; profile?: string };
    wsPort: number | null;
    vncUrl: string | null;
  };

  type Props = {
    interaction: Interaction;
    onComplete: () => void;
    onClose: () => void;
  };

  let { interaction, onComplete, onClose }: Props = $props();

  // Build form values state from fields defaultValues
  let formValues = $state<Record<string, string>>(
    Object.fromEntries(
      (interaction.configSnapshot.fields ?? []).map((f) => [f.name, f.defaultValue ?? '']),
    ),
  );

  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let vncWindow = $state<Window | null>(null);

  const showVnc = interaction.mode === 'vnc' || interaction.mode === 'both';
  const showForm = interaction.mode === 'confirm' || interaction.mode === 'both';
  const fields = interaction.configSnapshot.fields ?? [];

  function vncTabUrl(): string {
    if (interaction.vncUrl) return interaction.vncUrl;
    if (!interaction.wsPort) return '';
    return `https://vnc.strangeramblings.com/${interaction.wsPort}/vnc.html?autoconnect=1&resize=scale`;
  }

  function openVncTab() {
    const url = vncTabUrl();
    if (!url) return;
    // Reuse the already-open tab if the user still has it, otherwise spawn a
    // new one. Named target ('scraper-vnc') + per-interaction suffix so two
    // in-flight interactions each get their own tab.
    const target = `scraper-vnc-${interaction.id}`;
    vncWindow = window.open(url, target, 'noopener');
  }

  // Auto-open the VNC tab when the modal first mounts for a vnc/both
  // interaction. User solves there; comes back here to click Complete.
  $effect(() => {
    if (showVnc && vncTabUrl() && !vncWindow) openVncTab();
  });

  async function handleComplete() {
    submitting = true;
    submitError = null;
    try {
      const res = await fetch(
        `/api/workflows/runs/${interaction.runId}/interactions/${interaction.nodeId}/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ formValues }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as Record<string, unknown>).error as string || `HTTP ${res.status}`);
      }
      onComplete();
    } catch (err) {
      submitError = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="ism-overlay"
  role="dialog"
  aria-modal="true"
  onkeydown={onKeydown}
>
  <div class="ism-panel">
    <!-- Header -->
    <div class="ism-header">
      <span class="ism-prompt">{interaction.prompt}</span>
      <button
        class="ism-btn ism-btn-complete"
        onclick={handleComplete}
        disabled={submitting}
      >{submitting ? '…' : 'Complete'}</button>
      <button class="ism-btn" onclick={onClose}>Close</button>
    </div>

    {#if submitError}
      <div class="ism-error">{submitError}</div>
    {/if}

    <!-- Body -->
    <div class="ism-body">
      {#if showVnc}
        <div class="ism-vnc-instructions">
          {#if vncTabUrl()}
            <p class="ism-vnc-hint">
              A browser tab has opened showing the CAPTCHA / login page.
              Solve it there, then click <b>Complete</b> above to resume the scrape.
              Cookies are saved to the "<code>{interaction.configSnapshot.profile ?? 'default'}</code>" profile so subsequent runs stay headless.
            </p>
            <button class="ism-btn ism-btn-wide" onclick={openVncTab}>
              ↗ Re-open browser tab
            </button>
          {:else}
            <div class="ism-vnc-expired">
              VNC session expired — please retry the run.
            </div>
          {/if}
        </div>
      {/if}

      {#if showForm && fields.length > 0}
        <div class="ism-form">
          {#each fields as field (field.name)}
            <div class="ism-field">
              <label class="ism-label" for="ism-{field.name}">{field.label}</label>
              {#if field.type === 'textarea'}
                <textarea
                  id="ism-{field.name}"
                  class="ism-input ism-textarea"
                  value={formValues[field.name] ?? ''}
                  oninput={(e) => { formValues = { ...formValues, [field.name]: (e.currentTarget as HTMLTextAreaElement).value }; }}
                ></textarea>
              {:else if field.type === 'boolean'}
                <label class="ism-checkbox-label">
                  <input
                    id="ism-{field.name}"
                    type="checkbox"
                    class="ism-checkbox"
                    checked={formValues[field.name] === 'true'}
                    onchange={(e) => { formValues = { ...formValues, [field.name]: String((e.currentTarget as HTMLInputElement).checked) }; }}
                  />
                  <span class="ism-checkbox-text">{field.label}</span>
                </label>
              {:else}
                <input
                  id="ism-{field.name}"
                  type={field.type === 'number' ? 'number' : 'text'}
                  class="ism-input"
                  value={formValues[field.name] ?? ''}
                  oninput={(e) => { formValues = { ...formValues, [field.name]: (e.currentTarget as HTMLInputElement).value }; }}
                />
              {/if}
            </div>
          {/each}
        </div>
      {:else if showForm}
        <div class="ism-no-fields">No fields configured — click Complete to proceed.</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .ism-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(2px);
  }

  .ism-panel {
    display: flex;
    flex-direction: column;
    background: var(--card-bg, #1a1a1a);
    border: 1px solid var(--card-border, #333);
    border-radius: var(--radius-round);
    overflow: hidden;
    width: min(calc(100vw - 2rem), 520px);
    max-height: calc(100vh - 3rem);
  }

  .ism-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--divider, #2a2a2a);
    flex-shrink: 0;
    background: var(--bg-section, #111);
  }

  .ism-prompt {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ism-header-actions {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-shrink: 0;
  }

  .ism-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.15em;
    padding: 3px 8px;
    border-radius: 3px;
    border: 1px solid var(--card-border, #333);
    color: var(--text-secondary, #888);
    background: transparent;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }

  .ism-btn:hover:not(:disabled) {
    border-color: var(--text-muted, #666);
    color: var(--text-primary);
  }

  .ism-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ism-btn-complete {
    color: var(--accent, #c4570a);
    border-color: var(--accent, #c4570a);
  }

  .ism-btn-complete:hover:not(:disabled) {
    background: var(--accent, #c4570a);
    color: var(--bg, #0d0d0d);
  }

  .ism-error {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: #c44;
    padding: 6px 16px;
    background: rgba(204, 68, 68, 0.08);
    border-bottom: 1px solid rgba(204, 68, 68, 0.2);
    flex-shrink: 0;
  }

  .ism-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .ism-vnc-instructions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
  }

  .ism-vnc-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-primary);
    margin: 0;
  }
  .ism-vnc-hint code {
    font-size: var(--fs-label-xs);
    background: var(--bg-section, #111);
    padding: 1px 4px;
    border-radius: 2px;
    color: var(--accent, #c4570a);
  }

  .ism-btn-wide {
    align-self: stretch;
    justify-content: center;
    padding: 8px 12px;
    font-size: var(--fs-label-xs);
  }

  .ism-vnc-expired {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
    padding: 32px;
  }

  .ism-form {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    flex-shrink: 0;
    border-top: 1px solid var(--divider, #2a2a2a);
  }

  .ism-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ism-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }

  .ism-input {
    font-family: var(--font-code);
    font-size: var(--fs-body);
    padding: 6px 8px;
    background: var(--bg, #0d0d0d);
    border: 1px solid var(--card-border, #333);
    color: var(--text-primary);
    outline: none;
    border-radius: 2px;
  }

  .ism-input:focus {
    border-color: var(--accent, #c4570a);
  }

  .ism-textarea {
    resize: vertical;
    min-height: 72px;
  }

  .ism-checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .ism-checkbox {
    width: 14px;
    height: 14px;
    accent-color: var(--accent, #c4570a);
  }

  .ism-checkbox-text {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }

  .ism-no-fields {
    padding: 16px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
</style>
