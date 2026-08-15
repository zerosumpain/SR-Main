<svelte:head><title>Model Routing — Admin</title></svelte:head>
<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type {
    ModelProfile,
    ModelAssignment,
    RoutingRun,
    RoutingConfig,
    RoutingOverrides,
  } from '$lib/routing/types';
  import type { ProfileModelStat } from '$lib/routing/success';

  let { data } = $props();

  const profiles = data.profiles as Array<{ id: ModelProfile; label: string; blurb: string }>;
  const schedule = data.schedule;
  const priceWeightCap = data.priceWeightCap as number;
  const siteDefaultModelId = data.siteDefaultModelId as string;

  let enabled = $state<boolean>(data.enabled);
  let running = $state<boolean>(data.running);
  let assignments = $state<Partial<Record<ModelProfile, ModelAssignment>>>(data.assignments);
  let overrides = $state<RoutingOverrides>(data.overrides as RoutingOverrides);
  let clearing = $state<string | null>(null);
  let runs = $state<RoutingRun[]>(data.runs as RoutingRun[]);
  let stats = $state<ProfileModelStat[]>(data.stats as ProfileModelStat[]);
  let decidedCount = $state<number>(data.decidedCount);
  let eventCount = $state<number>(data.eventCount);

  // Editable policy (deep-cloned so edits don't mutate the loaded snapshot).
  let cfg = $state<RoutingConfig>(structuredClone(data.config as RoutingConfig));

  let toggling = $state(false);
  let starting = $state(false);
  let savingCfg = $state(false);
  let runError = $state('');
  let cfgSaved = $state(false);

  const totalDecided = $derived(decidedCount);

  async function runNow() {
    starting = true;
    runError = '';
    try {
      const res = await fetch('/api/admin/models/routing/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.run) {
        assignments = body.run.assignments ?? assignments;
        runs = [body.run, ...runs].slice(0, 20);
      } else {
        runError = body.error ?? body.message ?? `Error ${res.status}`;
      }
    } catch {
      runError = 'Network error';
    } finally {
      starting = false;
    }
  }

  async function toggleEnabled() {
    const next = !enabled;
    toggling = true;
    try {
      const res = await fetch('/api/admin/models/routing/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) enabled = next;
    } catch {
      /* leave as-is */
    } finally {
      toggling = false;
    }
  }

  async function saveConfig() {
    savingCfg = true;
    cfgSaved = false;
    try {
      const res = await fetch('/api/admin/models/routing/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg }),
      });
      if (res.ok) {
        const b = await res.json();
        if (b.config) cfg = b.config;
        cfgSaved = true;
        setTimeout(() => (cfgSaved = false), 2500);
      }
    } catch {
      /* ignore */
    } finally {
      savingCfg = false;
    }
  }

  /** Hand a pinned profile back to the nightly auto-selection. Pins are set from
   *  the /jkai model picker; this is the only place to clear them from admin. */
  async function clearOverride(profile: ModelProfile) {
    clearing = profile;
    try {
      const res = await fetch('/api/jkai/routing/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: profile, modelId: null }),
      });
      if (res.ok) {
        const body = await res.json();
        const next: RoutingOverrides = {};
        for (const p of body.profiles ?? []) {
          if (p.overrideModelId) next[p.profile as ModelProfile] = { modelId: p.overrideModelId, pinnedAt: p.pinnedAt };
        }
        overrides = next;
      }
    } catch {
      /* leave the pin in place on failure */
    } finally {
      clearing = null;
    }
  }

  function statsFor(profile: ModelProfile): ProfileModelStat[] {
    return stats.filter((s) => s.profile === profile);
  }
  function pct(v: number | null): string {
    return v == null ? '—' : `${Math.round(v * 100)}%`;
  }
  function price(v: number | null): string {
    return v == null ? '—' : `$${v.toFixed(2)}`;
  }
  function tps(v: number | null): string {
    return v == null ? '—' : `${Math.round(v)} t/s`;
  }
  function shortId(id: string): string {
    return id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  }
  function when(iso?: string): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="AI"
    title="Model Routing"
    sub="Each /jkai query is classified into a profile and answered by the model chosen for it. Picks are re-selected overnight from the OpenRouter catalogue — quality-floored so cheap-but-weak models can't win — and biased by how often each model gets the query right first time."
  >
    {#snippet actions()}
      {#if running}<span class="mr-pill" data-state="running">running</span>{/if}
      <a class="nm-btn-ghost" href="/admin/ai/models">Model catalogue →</a>
    {/snippet}
  </PageHeader>

  <!-- Controls -->
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Routing</span></div>
    <div class="controls">
      <div class="ctl-block">
        <span class="ctl-label">Auto-routing</span>
        <button
          class="mr-toggle"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle query-adaptive model routing"
          data-on={enabled}
          onclick={toggleEnabled}
          disabled={toggling}
        ></button>
        <span class="ctl-state">{enabled ? 'On' : 'Off'}</span>
      </div>
      <div class="ctl-block">
        <span class="ctl-label">Nightly re-select</span>
        <span class="ctl-value mono">{schedule.display}</span>
      </div>
      <div class="ctl-block grow">
        <span class="ctl-label">Manual</span>
        <button class="nm-save-btn" onclick={runNow} disabled={starting || running}>
          {starting ? 'Selecting…' : 'Re-select now'}
        </button>
        {#if runError}<span class="result-bad">{runError}</span>{/if}
        <span class="ctl-hint">Refreshes the catalogue, re-scores every profile, sends a WhatsApp.</span>
      </div>
    </div>
  </section>

  <!-- Current picks -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Current picks</span>
      <span class="nm-sec-meta">site default · {shortId(siteDefaultModelId)}</span>
    </div>
    <div class="picks">
      {#each profiles as p (p.id)}
        {@const a = assignments[p.id]}
        {@const pin = overrides[p.id]}
        <div class="pick-card" class:is-pinned={!!pin}>
          <div class="pick-hd">
            <span class="pick-label">{p.label}</span>
            {#if pin}
              <span class="pick-pin" title={`Pinned ${when(pin.pinnedAt)} — overrides the nightly selection`}>pinned</span>
            {:else}
              <span class="pick-tag">{p.id}</span>
            {/if}
          </div>
          <p class="pick-blurb">{p.blurb}</p>
          {#if pin}
            <div class="pick-model" title={pin.modelId}>{shortId(pin.modelId)}</div>
            <div class="pick-why">
              Auto would pick {a ? shortId(a.modelId) : 'the site default'}
              <button
                class="pick-unpin"
                onclick={() => clearOverride(p.id)}
                disabled={clearing === p.id}
              >{clearing === p.id ? 'clearing…' : 'unpin'}</button>
            </div>
          {:else if a}
            <div class="pick-model" title={a.modelId}>{shortId(a.modelId)}{#if a.openWeights}<span class="pick-open">open</span>{/if}</div>
            <div class="pick-why">{a.reason}</div>
          {:else}
            <div class="pick-model pick-model--fallback">site default</div>
            <div class="pick-why">Not selected yet — falls back to the site default until the first run.</div>
          {/if}
        </div>
      {/each}
    </div>
    <p class="policy-note">Pin a profile from the model picker in /jkai — “apply to” → the profile, then tap a model. Pins survive the nightly re-selection.</p>
  </section>

  <!-- Accuracy -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">First-try accuracy</span>
      <span class="nm-sec-meta">{totalDecided} rated · {eventCount} routed</span>
    </div>
    {#if stats.length === 0}
      <div class="mr-empty">No accuracy signal yet. Give a 👍 / 👎 on the first reply of a routed chat and it shows here — the nightly selection biases toward models that get it right first time.</div>
    {:else}
      <div class="table-scroll">
        <table class="mr-table">
          <thead>
            <tr><th>Profile</th><th>Model</th><th class="ta-r">First-try</th><th class="ta-r">n</th><th class="ta-r">Bias (Wilson)</th></tr>
          </thead>
          <tbody>
            {#each profiles as p (p.id)}
              {#each statsFor(p.id) as s (s.modelId)}
                <tr>
                  <td>{p.label}</td>
                  <td class="mono" title={s.modelId}>{shortId(s.modelId)}</td>
                  <td class="ta-r">{pct(s.rate)}</td>
                  <td class="ta-r">{s.total}</td>
                  <td class="ta-r">{pct(s.wilson)}</td>
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- Policy -->
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Selection policy</span></div>
    <p class="policy-note">
      Cost leads <em>within a capability band</em>. The band is an absolute floor — a fraction of the
      best agentic index in the catalogue — so cheap-but-weak models never enter the contest, and
      price (capped at {priceWeightCap}) then decides among the models that qualify. Open-weight
      models carry a score bonus on top.
    </p>
    <div class="table-scroll">
      <table class="mr-table policy-table">
        <thead>
          <tr>
            <th>Profile</th>
            <th class="ta-r">Quality w</th>
            <th class="ta-r">Price w</th>
            <th class="ta-r">Speed w</th>
            <th class="ta-r">Band (× best)</th>
          </tr>
        </thead>
        <tbody>
          {#each profiles as p (p.id)}
            <tr>
              <td>{p.label}</td>
              <td class="ta-r"><input class="mr-num" type="number" step="0.05" min="0" max="1" bind:value={cfg.weights[p.id].quality} /></td>
              <td class="ta-r"><input class="mr-num" type="number" step="0.05" min="0" max={priceWeightCap} bind:value={cfg.weights[p.id].price} /></td>
              <td class="ta-r"><input class="mr-num" type="number" step="0.05" min="0" max="1" bind:value={cfg.weights[p.id].speed} /></td>
              <td class="ta-r"><input class="mr-num" type="number" step="0.05" min="0" max="0.95" bind:value={cfg.qualityFloorFrac[p.id]} /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="policy-globals">
      <label class="pg"><span>Price ceiling $/1M</span><input class="mr-num" type="number" step="1" min="1" bind:value={cfg.priceCeilingPerM} /></label>
      <label class="pg"><span>Min context</span><input class="mr-num wide" type="number" step="1000" min="0" bind:value={cfg.minContext} /></label>
      <label class="pg"><span>Success bias k</span><input class="mr-num" type="number" step="0.05" min="0" max="0.5" bind:value={cfg.successBiasK} /></label>
      <label class="pg"><span>Open-weight bonus</span><input class="mr-num" type="number" step="0.05" min="0" max="1" bind:value={cfg.openWeightBonus} /></label>
      <label class="pg pg-check">
        <span>Open weights only</span>
        <input type="checkbox" bind:checked={cfg.openWeightsOnly} />
      </label>
      <button class="nm-save-btn" onclick={saveConfig} disabled={savingCfg}>{savingCfg ? 'Saving…' : 'Save policy'}</button>
      {#if cfgSaved}<span class="result-ok">Saved — applies to the next selection.</span>{/if}
    </div>
  </section>

  <!-- Runs -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Selection history</span>
      <span class="nm-sec-meta">{runs.length}</span>
    </div>
    {#if runs.length === 0}
      <div class="mr-empty">No selection runs yet. Trigger one with “Re-select now”, or wait for the 04:00 schedule.</div>
    {:else}
      <div class="table-scroll">
        <table class="mr-table">
          <thead>
            <tr><th>When</th><th>Trigger</th><th>Status</th><th class="ta-r">Catalogue</th><th class="ta-r">WhatsApp</th><th>Picks</th></tr>
          </thead>
          <tbody>
            {#each runs as r (r.id)}
              <tr>
                <td class="mono">{when(r.finishedAt ?? r.startedAt)}</td>
                <td>{r.trigger}</td>
                <td><span class="mr-status" data-s={r.status}>{r.status}</span></td>
                <td class="ta-r">{r.catalogueSize}</td>
                <td class="ta-r">{r.whatsappSent ? 'sent' : '—'}</td>
                <td class="mono runs-picks">
                  {#each profiles as p (p.id)}
                    {#if r.assignments?.[p.id]}<span class="rp">{p.id}:{shortId(r.assignments[p.id]!.modelId)}</span>{/if}
                  {/each}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</PageWrap>

<style>
  .controls { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
  .ctl-block { display: flex; flex-direction: column; gap: 6px; }
  .ctl-block.grow { flex: 1; min-width: 220px; }
  .ctl-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-ghost); }
  .ctl-state, .ctl-value { font-size: var(--fs-label); color: var(--text-secondary); }
  .ctl-value.mono, .mono { font-family: var(--font-mono); }
  .ctl-hint { font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .result-bad { color: var(--error); font-size: var(--fs-label-xs); }
  .result-ok { color: var(--success); font-size: var(--fs-label-xs); }

  .mr-toggle {
    width: 40px; height: 22px; border-radius: var(--radius-pill);
    border: 1px solid var(--card-border); background: var(--surface-overlay);
    position: relative; cursor: pointer; transition: background 140ms;
  }
  .mr-toggle::after {
    content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
    border-radius: 50%; background: var(--text-ghost); transition: transform 140ms, background 140ms;
  }
  .mr-toggle[data-on='true'] { background: var(--accent); border-color: var(--accent); }
  .mr-toggle[data-on='true']::after { transform: translateX(18px); background: #fff; }

  .mr-pill {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em;
    padding: 3px 8px; border-radius: var(--radius-pill); border: 1px solid var(--accent); color: var(--accent);
  }

  .picks { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .pick-card { border: 1px solid var(--card-border); border-radius: var(--radius-4, 4px); padding: 12px 14px; background: var(--card-bg); }
  .pick-card.is-pinned { border-color: color-mix(in srgb, var(--accent) 50%, var(--card-border)); }
  .pick-pin {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em;
    padding: 2px 6px; border-radius: var(--radius-pill); color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .pick-open {
    margin-left: 6px; padding: 1px 5px; border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em;
    vertical-align: 2px;
  }
  .pick-unpin {
    margin-left: 8px; padding: 1px 6px; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.06em; border-radius: var(--radius-pill);
    border: 1px solid var(--card-border); background: var(--surface-overlay); color: var(--text-ghost);
    cursor: pointer;
  }
  .pick-unpin:hover:not(:disabled) { color: var(--error); border-color: var(--error); }
  .pick-unpin:disabled { opacity: 0.5; cursor: not-allowed; }
  .pg-check { flex-direction: row; align-items: center; gap: 8px; }
  .pick-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .pick-label { font-size: var(--fs-label); font-weight: 600; color: var(--text-primary); }
  .pick-tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-ghost); }
  .pick-blurb { margin: 6px 0 10px; font-size: var(--fs-label-xs); line-height: 1.4; color: var(--text-ghost); }
  .pick-model { font-family: var(--font-mono); font-size: var(--fs-nav); color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pick-model--fallback { color: var(--text-muted); }
  .pick-why { margin-top: 4px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary); }

  .policy-note, .mr-empty { font-size: var(--fs-label-xs); color: var(--text-ghost); line-height: 1.5; }
  .mr-empty { padding: 14px 0; }
  .policy-globals { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; margin-top: 14px; }
  .pg { display: flex; flex-direction: column; gap: 5px; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-ghost); }
  .mr-num {
    width: 72px; padding: 5px 7px; font-size: var(--fs-label-xs); font-family: var(--font-mono);
    background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: var(--radius-4, 4px); color: var(--text-primary);
  }
  .mr-num.wide { width: 100px; }

  .table-scroll { overflow-x: auto; }
  .mr-table { width: 100%; border-collapse: collapse; font-size: var(--fs-label-xs); }
  .mr-table th { text-align: left; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-ghost); padding: 6px 10px; border-bottom: 1px solid var(--divider); }
  .mr-table td { padding: 7px 10px; border-bottom: 1px solid var(--divider); color: var(--text-secondary); vertical-align: middle; }
  .ta-r { text-align: right; }
  .policy-table td { vertical-align: middle; }
  .mr-status { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; }
  .mr-status[data-s='complete'] { color: var(--success); }
  .mr-status[data-s='failed'] { color: var(--error); }
  .mr-status[data-s='running'] { color: var(--accent); }
  .runs-picks { display: flex; flex-wrap: wrap; gap: 6px; }
  .rp { font-size: var(--fs-label-xs); color: var(--text-ghost); }
</style>
