<script lang="ts">
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import type { PromptStack, PromptVersion, StackId } from '$lib/jkai/prompts/workbench';

  type LoadedStack = PromptStack & { approxTokens: number };

  let { data }: { data: { stacks: LoadedStack[] } } = $props();

  // Open on the first file of the chat stack — the one that actually shapes
  // replies — falling back to whatever stack has files.
  const initialStack = data.stacks.find((s) => s.files.length) ?? data.stacks[0];
  const initialFile = initialStack?.files[0] ?? null;

  let stacks = $state<LoadedStack[]>(data.stacks);
  let selectedStack = $state<StackId>(initialStack?.id ?? 'chat');
  let selectedFile = $state<string | null>(initialFile?.name ?? null);

  let editContent = $state(initialFile?.content ?? '');
  let savedContent = $state(initialFile?.content ?? '');
  let saving = $state(false);
  let status = $state<{ kind: 'idle' | 'ok' | 'error'; text: string }>({ kind: 'idle', text: '' });
  let tab = $state<'edit' | 'resolved' | 'history'>('edit');

  let resolved = $state<{ text: string; approxTokens: number; caveat: string } | null>(null);
  let versions = $state<PromptVersion[]>([]);
  let loadingPanel = $state(false);

  const stack = $derived(stacks.find((s) => s.id === selectedStack) ?? stacks[0]);
  const file = $derived(stack?.files.find((f) => f.name === selectedFile) ?? null);
  const dirty = $derived(editContent !== savedContent);
  const editTokens = $derived(Math.ceil(editContent.length / 4));

  function approx(text: string): number {
    return Math.ceil((text ?? '').length / 4);
  }

  function pick(stackId: StackId, fileName: string) {
    if (dirty && !confirm('You have unsaved changes. Discard and switch?')) return;
    selectedStack = stackId;
    selectedFile = fileName;
    const f = stacks.find((s) => s.id === stackId)?.files.find((x) => x.name === fileName);
    editContent = f?.content ?? '';
    savedContent = f?.content ?? '';
    status = { kind: 'idle', text: '' };
    if (tab !== 'edit') void loadPanel();
  }

  async function save() {
    if (!stack || !selectedFile || saving || !dirty) return;
    const fileBeingSaved = selectedFile;
    const contentBeingSaved = editContent;
    saving = true;
    status = { kind: 'idle', text: 'Saving…' };
    try {
      const res = await fetch('/api/jkai/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stack: selectedStack, file: fileBeingSaved, content: contentBeingSaved }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        status = { kind: 'error', text: body?.message || body?.error || `Save failed (${res.status})` };
        return;
      }
      // Don't clobber the textarea — the user may have kept typing.
      if (selectedFile === fileBeingSaved) savedContent = contentBeingSaved;
      if (body.stacks) stacks = body.stacks;
      status = {
        kind: 'ok',
        text: `Saved at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
      };
      resolved = null;
    } catch (e) {
      status = { kind: 'error', text: e instanceof Error ? e.message : 'Network error' };
    } finally {
      saving = false;
    }
  }

  async function loadPanel() {
    if (!stack) return;
    loadingPanel = true;
    try {
      if (tab === 'resolved') {
        const res = await fetch(`/api/jkai/prompts?resolve=${selectedStack}`);
        resolved = res.ok ? await res.json() : null;
      } else if (tab === 'history' && selectedFile) {
        const res = await fetch(`/api/jkai/prompts?versions=${selectedStack}&file=${encodeURIComponent(selectedFile)}`);
        versions = res.ok ? (await res.json()).versions ?? [] : [];
      }
    } finally {
      loadingPanel = false;
    }
  }

  function switchTab(next: 'edit' | 'resolved' | 'history') {
    tab = next;
    if (next !== 'edit') void loadPanel();
  }

  function restore(v: PromptVersion) {
    if (!confirm(`Load the version saved ${fmt(v.savedAt)} into the editor? Nothing is written until you press Save.`)) return;
    editContent = v.content;
    tab = 'edit';
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void save();
    }
  }

  function fmt(iso: string): string {
    if (!iso || iso.startsWith('1970')) return 'never';
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

</script>

<svelte:head><title>Prompts · JKAI</title></svelte:head>

<JkaiPageTitle title="PROMPTS" />

<div class="pw">
  <p class="pw-intro">
    Every prompt that actually runs, grouped by what executes it. Chat replies and workflow generation
    are driven by <strong>different</strong> stacks — editing one does not change the other.
  </p>

  <div class="pw-body">
    <!-- Stack + file rail -->
    <aside class="pw-rail">
      {#each stacks as s (s.id)}
        <div class="pw-stack">
          <div class="pw-stack-hd">
            <span class="pw-stack-label">{s.label}</span>
            <span class="pw-chip" class:on={s.live}>{s.live ? 'live' : 'inactive'}</span>
          </div>
          <div class="pw-stack-runtime">{s.runtime}</div>
          <div class="pw-surfaces">
            {#each s.surfaces as surface (surface)}<span class="pw-surface">{surface}</span>{/each}
          </div>
          {#if s.error}
            <p class="pw-stack-err">⚠ {s.error}</p>
          {/if}
          <div class="pw-files">
            {#each s.files as f (f.name)}
              <button
                class="pw-file"
                class:sel={selectedStack === s.id && selectedFile === f.name}
                onclick={() => pick(s.id, f.name)}
              >
                <span class="pw-file-name">{f.name}</span>
                <span class="pw-file-meta">≈{approx(f.content).toLocaleString()} tok · {fmt(f.lastModified)}</span>
              </button>
            {/each}
            {#if s.files.length === 0 && !s.error}
              <p class="pw-stack-err">No prompt files found.</p>
            {/if}
          </div>
          <div class="pw-stack-total">≈{s.approxTokens.toLocaleString()} tokens total</div>
        </div>
      {/each}
    </aside>

    <!-- Editor / analysis -->
    <section class="pw-main">
      {#if stack}
        <p class="pw-note" class:pw-note-live={stack.live}>{stack.note}</p>
      {/if}

      <div class="pw-tabs">
        <button class="pw-tab" class:on={tab === 'edit'} onclick={() => switchTab('edit')}>Edit</button>
        <button class="pw-tab" class:on={tab === 'resolved'} onclick={() => switchTab('resolved')}>Assembled prompt</button>
        <button class="pw-tab" class:on={tab === 'history'} onclick={() => switchTab('history')}>History</button>
        <div class="pw-tab-spacer"></div>
        {#if status.text}
          <span class="pw-status pw-status-{status.kind}">{status.text}</span>
        {/if}
        {#if tab === 'edit' && file}
          <span class="pw-tokens">≈{editTokens.toLocaleString()} tok</span>
          <button
            class="pw-save"
            onclick={save}
            disabled={saving || !dirty || !stack?.editable}
            title={stack?.editable ? 'Save (Ctrl/Cmd+S)' : (stack?.error ?? 'Not editable from this host')}
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        {/if}
      </div>

      {#if tab === 'edit'}
        {#if file}
          <textarea
            bind:value={editContent}
            onkeydown={handleKeydown}
            class="pw-editor"
            spellcheck="false"
            readonly={!stack?.editable}
          ></textarea>
        {:else}
          <p class="pw-empty">Select a prompt file.</p>
        {/if}
      {:else if tab === 'resolved'}
        {#if loadingPanel}
          <p class="pw-empty">Assembling…</p>
        {:else if resolved}
          <p class="pw-caveat">{resolved.caveat}</p>
          <p class="pw-resolved-meta">≈{resolved.approxTokens.toLocaleString()} tokens · {resolved.text.length.toLocaleString()} chars</p>
          <pre class="pw-resolved">{resolved.text}</pre>
        {:else}
          <p class="pw-empty">Could not assemble this stack.</p>
        {/if}
      {:else if loadingPanel}
        <p class="pw-empty">Loading history…</p>
      {:else if versions.length === 0}
        <p class="pw-empty">No previous versions recorded for this file. History starts at your next save.</p>
      {:else}
        <ul class="pw-versions">
          {#each versions as v (v.savedAt)}
            <li class="pw-version">
              <div class="pw-version-hd">
                <span class="pw-version-when">{fmt(v.savedAt)}</span>
                <span class="pw-version-delta">
                  ≈{v.approxTokens.toLocaleString()} tok
                  {#if file}
                    <span class="pw-version-diff">
                      ({v.approxTokens > editTokens ? '−' : '+'}{Math.abs(editTokens - v.approxTokens).toLocaleString()} vs now)
                    </span>
                  {/if}
                </span>
                <button class="pw-restore" onclick={() => restore(v)}>Load into editor</button>
              </div>
              <pre class="pw-version-body">{v.content.slice(0, 600)}{v.content.length > 600 ? '…' : ''}</pre>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</div>

<style>
  .pw { max-width: 1200px; margin: 0 auto; padding: 20px 20px 60px; color: var(--text-primary); }
  .pw-intro { margin: 0 0 18px; font-size: var(--fs-nav); color: var(--text-muted); max-width: 70ch; }
  .pw-intro strong { color: var(--text-primary); }

  .pw-body { display: flex; gap: 20px; align-items: flex-start; }
  @media (max-width: 860px) { .pw-body { flex-direction: column; } }

  .pw-rail { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; gap: 16px; }
  @media (max-width: 860px) { .pw-rail { width: 100%; } }
  .pw-stack { border: 1px solid var(--line-strong); padding: 10px; }
  .pw-stack-hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pw-stack-label { font-size: var(--fs-nav); color: var(--text-primary); }
  .pw-chip { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; padding: 1px 5px; border: 1px solid var(--line-strong); color: var(--text-ghost); }
  .pw-chip.on { color: var(--success, #2d7a3a); border-color: currentColor; }
  .pw-stack-runtime { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); margin-top: 3px; }
  .pw-surfaces { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .pw-surface { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); border: 1px solid var(--divider, var(--card-border)); padding: 1px 4px; }
  .pw-stack-err { font-size: var(--fs-label); color: var(--warn, #b0892a); margin: 8px 0 0; }
  .pw-files { display: flex; flex-direction: column; gap: 2px; margin-top: 10px; }
  .pw-file { display: flex; flex-direction: column; gap: 2px; text-align: left; background: transparent; border: 1px solid transparent; padding: 5px 6px; cursor: pointer; }
  .pw-file:hover { border-color: var(--line-strong); }
  .pw-file.sel { border-color: var(--accent-ink, var(--accent)); background: color-mix(in srgb, var(--accent-ink, var(--accent)) 10%, transparent); }
  .pw-file-name { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary); }
  .pw-file-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .pw-stack-total { margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--line-strong); font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .pw-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .pw-note { margin: 0 0 12px; font-size: var(--fs-label); line-height: 1.5; color: var(--text-muted); border-left: 2px solid var(--line-strong); padding-left: 10px; }
  .pw-note-live { border-left-color: var(--success, #2d7a3a); }

  .pw-tabs { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
  .pw-tab-spacer { flex: 1; }
  .pw-tab { font-family: var(--font-mono); font-size: var(--fs-label); padding: 5px 10px; background: transparent; border: 1px solid var(--line-strong); color: var(--text-muted); cursor: pointer; }
  .pw-tab.on { color: var(--text-primary); border-color: var(--text-muted); background: color-mix(in srgb, var(--card-border) 18%, transparent); }
  .pw-tokens { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .pw-status { font-size: var(--fs-label); }
  .pw-status-ok { color: var(--success, #2d7a3a); }
  .pw-status-error { color: var(--status-error, #c0392b); }
  .pw-save { font-family: var(--font-mono); font-size: var(--fs-label); padding: 5px 14px; background: var(--accent-ink, var(--accent, #c4570a)); color: var(--bg, #fff); border: none; cursor: pointer; }
  .pw-save:disabled { opacity: 0.45; cursor: default; }

  .pw-editor { width: 100%; min-height: 62vh; padding: 12px; background: var(--card-bg); border: 1px solid var(--line-strong); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--fs-body); line-height: 1.6; resize: vertical; outline: none; box-sizing: border-box; }
  .pw-editor:focus { border-color: var(--text-muted); }
  .pw-editor[readonly] { opacity: 0.75; }

  .pw-caveat { margin: 0 0 6px; font-size: var(--fs-label); color: var(--text-muted); }
  .pw-resolved-meta { margin: 0 0 8px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .pw-resolved { margin: 0; padding: 12px; max-height: 62vh; overflow: auto; background: var(--card-bg); border: 1px solid var(--line-strong); font-family: var(--font-mono); font-size: var(--fs-label); line-height: 1.6; white-space: pre-wrap; word-break: break-word; }

  .pw-empty { font-size: var(--fs-nav); color: var(--text-ghost); }
  .pw-versions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .pw-version { border: 1px solid var(--line-strong); padding: 10px; }
  .pw-version-hd { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .pw-version-when { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary); }
  .pw-version-delta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); flex: 1; }
  .pw-version-diff { color: var(--text-muted); }
  .pw-restore { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; padding: 3px 8px; background: transparent; border: 1px solid var(--line-strong); color: var(--text-muted); cursor: pointer; }
  .pw-restore:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .pw-version-body { margin: 8px 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-muted); white-space: pre-wrap; word-break: break-word; max-height: 140px; overflow: hidden; }
</style>
