<script lang="ts">
  // "Describe it" on the canvas list: a sentence in, a canvas out. POST
  // /api/canvas { prompt } creates the canvas now and builds it in the
  // background (build-from-prompt.server — the iPhone's path too); we go
  // straight to it, where the building banner waits for the graph to land.
  import { goto } from '$app/navigation';

  let prompt = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const EXAMPLES = [
    'Every weekday at 7am, summarise the BBC headlines and WhatsApp them to me',
    'When an email from my bank arrives, pull out the amount and log it',
  ];

  async function submit(e?: Event) {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    busy = true;
    error = null;
    try {
      const res = await fetch('/api/canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      const body = (await res.json().catch(() => ({}))) as { slug?: string; error?: string };
      if (!res.ok || !body.slug) throw new Error(body.error || `HTTP ${res.status}`);
      prompt = '';
      await goto(`/jkai/canvas/${body.slug}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<form class="describe" onsubmit={submit}>
  <label class="describe-lbl" for="describe-workflow">
    <span class="sr-label-tight">Describe it</span>
    <span class="describe-note">jkai builds the workflow — you watch it land</span>
  </label>
  <textarea
    id="describe-workflow"
    class="describe-input"
    rows="3"
    bind:value={prompt}
    placeholder="Describe a workflow…"
    disabled={busy}
    onkeydown={(e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
    }}
  ></textarea>
  <div class="describe-examples">
    {#each EXAMPLES as ex (ex)}
      <button type="button" class="describe-example" disabled={busy} onclick={() => (prompt = ex)}>{ex}</button>
    {/each}
  </div>
  {#if error}
    <div class="describe-err" role="alert">⚠ {error}</div>
  {/if}
  <div class="describe-actions">
    <button type="submit" class="describe-btn" disabled={!prompt.trim() || busy}>
      {busy ? 'Starting…' : 'Build it'}
    </button>
    <span class="describe-hint">⌘/Ctrl + Enter</span>
  </div>
</form>

<style>
  .describe {
    display: grid;
    gap: 0.6rem;
    min-width: 0;
  }
  .describe-lbl {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .sr-label-tight {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
  }
  .describe-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .describe-input {
    width: 100%;
    min-height: 5.5rem;
    resize: vertical;
    font-family: var(--font-body);
    font-size: var(--fs-body-lg, 1.05rem);
    line-height: 1.45;
    color: var(--text-primary);
    background: var(--bg);
    border: 1.5px solid var(--text-primary);
    padding: 10px 12px;
    outline: none;
  }
  .describe-input:focus {
    border-color: var(--accent);
  }
  .describe-input::placeholder {
    color: var(--text-ghost);
  }
  .describe-input:disabled {
    opacity: 0.55;
  }
  .describe-examples {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .describe-example {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-muted);
    background: none;
    border: 1px dashed var(--line-strong);
    padding: 3px 8px;
    text-align: left;
    cursor: pointer;
  }
  .describe-example:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
  .describe-err {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--error);
    padding: 6px 8px;
    background: var(--error-bg);
    border-left: 2px solid var(--error);
  }
  .describe-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .describe-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 7px 16px;
    background: var(--accent);
    color: var(--bg);
    border: 1px solid var(--accent);
    cursor: pointer;
  }
  .describe-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .describe-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .describe-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
</style>
