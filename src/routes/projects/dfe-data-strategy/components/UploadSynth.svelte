<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { MATURITY_BY_ID } from '$lib/dfe-data-strategy/maturity';
  import { PRESSURES_BY_ID } from '$lib/dfe-data-strategy/pressures';
  import { POSTURE_BY_ID } from '../lib/postures';
  import { CAPABILITY_BY_ID } from '../lib/capabilities';

  let busy = $state(false);
  let err = $state('');
  let dragOver = $state(false);

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length || busy) return;
    err = '';
    busy = true;
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/projects/dfe-data-strategy/synth', { method: 'POST', body: fd });
        if (!res.ok) {
          err = (await res.text().catch(() => '')) || `Upload failed (HTTP ${res.status}).`;
          continue;
        }
        const data = await res.json();
        app.addUpload({ ...data, id: `u${Date.now()}-${Math.round(Math.random() * 1e4)}`, filename: file.name, at: Date.now() });
      }
    } catch (e: any) {
      err = e?.message ?? 'Synthesis failed.';
    } finally {
      busy = false;
    }
  }
  const nudgeLabel = (n: { kind: string; id: string; value: number }) =>
    n.kind === 'posture'
      ? `${POSTURE_BY_ID[n.id]?.[n.value < 0 ? 'leftLabel' : 'rightLabel'] ?? n.id} (${Math.round(Math.abs(n.value) * 100)}%)`
      : `${CAPABILITY_BY_ID[n.id]?.short ?? n.id} → ${n.value}`;
</script>

<div class="us">
  <div
    class="drop"
    class:over={dragOver}
    role="button"
    tabindex="0"
    ondragover={(e) => { e.preventDefault(); dragOver = true; }}
    ondragleave={() => (dragOver = false)}
    ondrop={(e) => { e.preventDefault(); dragOver = false; handleFiles(e.dataTransfer?.files ?? null); }}
  >
    <input id="us-file" type="file" multiple accept=".docx,.doc,.xlsx,.xls,.csv,.pdf,.md,.txt" onchange={(e) => handleFiles(e.currentTarget.files)} hidden />
    <label for="us-file" class="drop-in">
      <span class="drop-ico">⇪</span>
      <span class="drop-t">{busy ? 'Synthesising…' : 'Drop an artefact, or choose a file'}</span>
      <span class="drop-sub">.docx · .xlsx · .pdf · .csv · .md — an existing strategy, audit, data map or maturity assessment</span>
    </label>
  </div>
  {#if err}<p class="us-err">{err}</p>{/if}
  <p class="us-priv">Processed in your private workbench session. Synthesis runs through the site’s LLM gateway; nothing is added to the public corpus.</p>

  {#each app.uploads as u (u.id)}
    <div class="card">
      <div class="c-head">
        <span class="c-file">{u.filename}</span>
        <span class="c-kind">{u.kind}</span>
        <button class="c-x" onclick={() => app.removeUpload(u.id)} aria-label="Remove">✕</button>
      </div>
      <p class="c-sum">{u.summary}</p>

      {#if u.maturitySignals?.length}
        <div class="c-sec">
          <span class="c-lab">Maturity signals detected</span>
          {#each u.maturitySignals as s}
            <div class="sig"><b>{MATURITY_BY_ID[s.dimension]?.name ?? s.dimension}</b> — level {s.level}: {s.note}</div>
          {/each}
        </div>
      {/if}

      {#if u.addressedPressures?.length}
        <div class="c-sec">
          <span class="c-lab">Pressures this document already speaks to</span>
          <div class="chips">{#each u.addressedPressures as pid}<span class="chip">{PRESSURES_BY_ID[pid]?.title ?? pid}</span>{/each}</div>
        </div>
      {/if}

      {#if u.nudges?.length}
        <div class="c-sec">
          <span class="c-lab">Suggested adjustments</span>
          <div class="chips">{#each u.nudges as n}<span class="chip nudge" title={n.rationale}>{nudgeLabel(n)}</span>{/each}</div>
          <button class="apply" onclick={() => app.applyNudges(u)}>Apply these to the levers →</button>
        </div>
      {/if}

      {#if u.warnings?.length}<p class="c-warn">⚠ {u.warnings.join('; ')}</p>{/if}
    </div>
  {/each}
</div>

<style>
  .us { display: flex; flex-direction: column; gap: 10px; }
  .drop { border: 2px dashed rgba(28,22,17,0.25); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.4); transition: background 0.15s, border-color 0.15s; }
  .drop.over { border-color: var(--accent-ink); background: var(--accent-ink-tint-12); }
  .drop-in { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 24px 16px; cursor: pointer; text-align: center; }
  .drop-ico { font-size: 26px; color: var(--accent-ink); }
  .drop-t { font-family: var(--fs-serif); font-size: var(--fs-body); font-weight: 600; color: var(--ink); }
  .drop-sub { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); max-width: 46ch; }
  .us-err { margin: 0; font-size: var(--fs-label-xs); color: var(--error); }
  .us-priv { margin: 0; font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.5); }
  .card { border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 11px 13px; }
  .c-head { display: flex; align-items: center; gap: 8px; }
  .c-file { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--ink); }
  .c-kind { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: rgba(28,22,17,0.5); background: rgba(28,22,17,0.06); padding: 2px 6px; border-radius: var(--radius-sharp); }
  .c-x { margin-left: auto; background: none; border: none; color: rgba(28,22,17,0.45); cursor: pointer; font-size: var(--fs-label-xs); }
  .c-sum { margin: 7px 0; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.78); }
  .c-sec { margin-top: 8px; }
  .c-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); display: block; margin-bottom: 4px; }
  .sig { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.72); margin-bottom: 2px; }
  .sig b { color: var(--ink); }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { font-size: var(--fs-label-xs); background: rgba(28,22,17,0.06); border-radius: var(--radius-sharp); padding: 3px 7px; color: rgba(28,22,17,0.7); }
  .chip.nudge { background: var(--accent-ink-tint-12); color: var(--accent-ink); cursor: help; }
  .apply { margin-top: 7px; font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 6px 11px; border: 1px solid var(--accent-ink); color: #fff; background: var(--accent-ink); border-radius: var(--radius-sharp); cursor: pointer; }
  .apply:hover { background: var(--accent-ink-hover); }
  .c-warn { margin: 8px 0 0; font-size: var(--fs-label-xs); color: #b4632e; }
</style>
