<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { CAPABILITY_AREAS } from '../lib/capabilities';
  import { pct } from '../lib/format';
  import type { Origin } from '../lib/types';

  const a = $derived(app.align);
  const b = $derived(app.alignB);

  const ORIGINS: { id: Origin; label: string }[] = [
    { id: 'cross-government', label: 'Cross-government' },
    { id: 'dfe-policy', label: 'DfE policy' },
    { id: 'partners', label: 'Partners' },
  ];
  const C = 2 * Math.PI * 52;
</script>

<div class="av">
  <div class="av-gauge">
    <svg viewBox="0 0 130 130" width="128" height="128" aria-hidden="true">
      <circle cx="65" cy="65" r="52" fill="none" stroke="rgba(28,22,17,0.1)" stroke-width="12" />
      <circle cx="65" cy="65" r="52" fill="none" stroke="#2f7d4f" stroke-width="12" stroke-linecap="round"
        stroke-dasharray={`${a.overallCoverage * C} ${C}`} transform="rotate(-90 65 65)" style="transition: stroke-dasharray 0.25s ease" />
      {#if b}
        <circle cx="65" cy="65" r="40" fill="none" stroke="#3a5fa8" stroke-width="4" stroke-linecap="round" opacity="0.6"
          stroke-dasharray={`${b.overallCoverage * 2 * Math.PI * 40} ${2 * Math.PI * 40}`} transform="rotate(-90 65 65)" />
      {/if}
    </svg>
    <div class="av-gauge-c">
      <span class="g-val">{pct(a.overallCoverage)}</span>
      <span class="g-lab">pressures<br />covered</span>
      {#if b}<span class="g-b">B {pct(b.overallCoverage)}</span>{/if}
    </div>
  </div>

  <div class="av-cols">
    <div class="av-block">
      <h4 class="av-h">Coverage by origin</h4>
      {#each ORIGINS as o}
        <div class="bar-row">
          <span class="br-lab">{o.label}</span>
          <div class="br-track">
            <span class="br-fill" style="width:{a.coverageByOrigin[o.id] * 100}%; background:{o.id === 'dfe-policy' ? '#8a2d3a' : o.id === 'partners' ? '#2f6f97' : '#2f6155'}"></span>
            {#if b}<span class="br-ghost" style="left:{b.coverageByOrigin[o.id] * 100}%"></span>{/if}
          </div>
          <span class="br-val">{pct(a.coverageByOrigin[o.id])}</span>
        </div>
      {/each}
    </div>

    <div class="av-block">
      <h4 class="av-h">Capability strength</h4>
      {#each CAPABILITY_AREAS as c}
        <div class="bar-row">
          <button class="br-lab linklike" onclick={() => app.focusArea(c.id)} title={`${c.description}\n\nClick to adjust in the levers`}>{c.short}</button>
          <div class="br-track">
            <span class="br-fill cap" style="width:{(a.capability[c.id] ?? 0) * 100}%"></span>
            {#if b}<span class="br-ghost" style="left:{(b.capability[c.id] ?? 0) * 100}%"></span>{/if}
          </div>
          <span class="br-val">{pct(a.capability[c.id] ?? 0)}</span>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .av { display: grid; grid-template-columns: auto 1fr; gap: 18px 28px; align-items: center; }
  .av-gauge { position: relative; width: 128px; height: 128px; }
  .av-gauge-c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .g-val { font-family: 'Fraunces', serif; font-weight: 600; font-size: 30px; line-height: 1; color: var(--ink); }
  .g-lab { font-family: 'JetBrains Mono', monospace; font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.55); text-align: center; margin-top: 3px; }
  .g-b { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent-ink); margin-top: 2px; }
  .av-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px; min-width: 0; }
  .av-h { margin: 0 0 6px; font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.55); }
  .bar-row { display: grid; grid-template-columns: 78px 1fr 38px; align-items: center; gap: 7px; margin-bottom: 4px; }
  .br-lab { font-size: 11px; color: rgba(28,22,17,0.74); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .br-lab.linklike { background: none; border: none; text-align: left; padding: 0; cursor: pointer; }
  .br-lab.linklike:hover { color: var(--accent-ink); text-decoration: underline; }
  .br-track { position: relative; height: 9px; border-radius: var(--radius-round); background: rgba(28,22,17,0.1); overflow: visible; }
  .br-fill { position: absolute; left: 0; top: 0; height: 100%; border-radius: var(--radius-round); background: var(--accent-ink); transition: width 0.2s ease; }
  .br-fill.cap { background: linear-gradient(90deg, #b4632e, var(--success)); }
  .br-ghost { position: absolute; top: -2px; width: 2px; height: 13px; background: var(--accent-ink); border-radius: var(--radius-sharp); }
  .br-val { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.6); text-align: right; }
  @media (max-width: 720px) { .av { grid-template-columns: 1fr; } .av-cols { grid-template-columns: 1fr; } }
</style>
