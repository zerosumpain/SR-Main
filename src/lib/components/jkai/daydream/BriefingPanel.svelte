<script lang="ts">
  // The briefing room's panel: the latest day, and the source configuration.
  //
  // Two views. `profile` is the configuration surface — which signals may be
  // used, the editorial priorities, the memory window — and is unchanged.
  // `briefing` was a bespoke magazine layout of its own (a headline block, an
  // evidence `<details>` drawer, an accordion of every earlier day) and is now
  // built from the hub's primitives: a `StatDeck` of the run, a `RollupGrid` of
  // the fact sections, and links out to `/jkai/daydreams/briefing/[day]`, which
  // carries the full fact sheet the drawer used to hold. One page per day
  // replaces the accordion — the WhatsApp message links there too.
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import SectionHead from './hub/SectionHead.svelte';
  import StatDeck from './hub/StatDeck.svelte';
  import RollupGrid from './hub/RollupGrid.svelte';
  import type { DeckTile } from './hub/types';
  import {
    briefingFactSections,
    briefingRollupCells,
    briefingSourceTone,
    sourceTally,
  } from './briefing-sections';
  import type { BriefingData } from '$lib/briefing/types';
  import type {
    BriefingProfile,
    BriefingSourceDefinition,
    BriefingSourceKey,
  } from '$lib/constants/briefing';

  type SourceConnection = 'native' | 'connected' | 'available' | 'missing';
  type SourceOption = BriefingSourceDefinition & {
    preference: BriefingProfile['sources'][BriefingSourceKey];
    connection: SourceConnection;
  };
  type View = 'briefing' | 'profile';

  let { data, embedded = false }: {
    data: {
      briefings: BriefingData[];
      enabled: boolean;
      topics: string[];
      profile: BriefingProfile;
      sourceCatalog: SourceOption[];
      workflowId: string | null;
      schedule: { display: string; expr: string | null };
    };
    embedded?: boolean;
  } = $props();

  const briefings = $derived(data.briefings ?? []);
  const latest = $derived(briefings[0] ?? null);
  const detail = $derived(latest?.detail ?? null);
  const dayHref = $derived(latest ? `/jkai/daydreams/briefing/${latest.id}` : '');
  /** The strip: the ten newest days, each its own page. */
  const dayStrip = $derived(briefings.slice(0, 10));

  const memoryFacts = $derived((detail?.facts ?? []).filter((fact) => fact.section === 'New memories'));
  const learnedMemories = $derived.by(() => {
    if (detail?.memories?.length) return detail.memories;
    return memoryFacts.map((memory) => ({
      id: memory.source,
      category: memory.label,
      content: memory.value,
      confidence: '',
      createdAt: '',
    }));
  });

  const tally = $derived(sourceTally(detail));
  const gapCount = $derived(detail?.gaps?.length ?? 0);
  const factCount = $derived(detail?.facts?.length ?? 0);
  const sectionCount = $derived(briefingFactSections(detail).length);

  // The rollup the day page opens on, with every cell pointed at that page's
  // matching section rather than at an anchor on this one.
  const rollup = $derived(latest ? briefingRollupCells(latest, dayHref) : []);

  const deckTiles = $derived<DeckTile[]>([
    {
      key: 'when',
      label: 'Briefed',
      value: clock(latest?.startedAt),
      sub: `${detail?.dateLabel ?? latest?.title ?? ''} · ${latest?.status ?? ''}`.trim(),
      tone: latest?.status === 'complete' ? 'steady' : 'watch',
      lit: true,
    },
    {
      key: 'sources',
      label: 'Sources reporting',
      value: String(tally.ok),
      suffix: `/${tally.total}`,
      tone: briefingSourceTone(tally.ok, tally.total),
      sub: tally.total - tally.ok
        ? `${tally.total - tally.ok} did not report and was excluded`
        : 'every configured source answered',
    },
    {
      key: 'gaps',
      label: 'Gaps',
      value: String(gapCount),
      tone: gapCount ? 'watch' : 'good',
      sub: gapCount
        ? (detail?.gaps ?? []).map((gap) => gap.section).join(', ')
        : 'nothing was left out of the message',
    },
    {
      key: 'facts',
      label: 'Facts used',
      value: String(factCount),
      tone: 'steady',
      sub: `${sectionCount} section${sectionCount === 1 ? '' : 's'} the composer could quote`,
    },
  ]);

  let profile = $state<BriefingProfile>(structuredClone(untrack(() => data.profile)));
  let enabled = $state(untrack(() => data.enabled));
  let topicsText = $state(untrack(() => (data.topics ?? []).join(', ')));
  let view = $state<View>(untrack(() => briefings.length ? 'briefing' : 'profile'));
  let running = $state(false);
  let saving = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  let voted = $state<'up' | 'down' | null>(null);
  let voteWhat = $state('');

  const sourceGroups = $derived(
    (['Now', 'Personal', 'Knowledge', 'Daydreaming'] as const).map((group) => ({
      group,
      sources: data.sourceCatalog.filter((source) => source.group === group),
    })),
  );
  const activeSourceCount = $derived(
    Object.values(profile.sources).filter((source) => source.enabled).length,
  );
  const readySourceCount = $derived(
    data.sourceCatalog.filter(
      (source) => profile.sources[source.key].enabled
        && (source.connection === 'native' || source.connection === 'connected'),
    ).length,
  );
  const addableSourceCount = $derived(
    data.sourceCatalog.filter(
      (source) => profile.sources[source.key].enabled && source.connection === 'available',
    ).length,
  );

  const CONNECTION_LABEL: Record<SourceConnection, string> = {
    native: 'built in',
    connected: 'connected',
    available: 'available',
    missing: 'not connected',
  };

  async function runNow() {
    if (running || !data.workflowId) return;
    running = true;
    message = null;
    error = null;
    try {
      const response = await fetch(`/api/workflows/${data.workflowId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      message = 'Briefing started. New results will appear here when the run finishes.';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The briefing could not be started.';
    } finally {
      running = false;
    }
  }

  async function saveProfile() {
    saving = true;
    message = null;
    error = null;
    const topics = topicsText.split(',').map((topic) => topic.trim()).filter(Boolean);
    try {
      const response = await fetch('/api/admin/briefing/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, topics, profile }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      message = 'Briefing profile saved.';
      await invalidateAll();
      if (latest) view = 'briefing';
    } catch {
      error = 'The briefing profile could not be saved.';
    } finally {
      saving = false;
    }
  }

  async function vote(voteValue: 'up' | 'down') {
    if (!latest) return;
    voted = voteValue;
    try {
      await fetch('/api/admin/briefing/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefingId: latest.id, vote: voteValue, what: voteWhat.trim() }),
      });
    } catch {
      voted = null;
    }
  }

  function fmt(iso?: string): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function clock(iso?: string): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }
</script>

<svelte:head><title>{embedded ? 'Daydreams · JKAI' : 'Briefing · JKAI'}</title></svelte:head>

{#if !embedded}<JkaiPageTitle title="BRIEFING" />{/if}

<main class="briefing" class:embedded>
  <header class="command-bar">
    <div class="system-state">
      <span class:paused={!enabled} class="state-dot" aria-hidden="true"></span>
      <div>
        <span class="eyebrow">Briefing system</span>
        <strong>{enabled ? data.schedule.display : 'Paused'}</strong>
      </div>
    </div>
    <div class="command-actions">
      <button class="button primary" type="button" onclick={runNow} disabled={running || !data.workflowId}>
        {running ? 'Starting…' : 'Run now'}
      </button>
      <button
        class="button secondary"
        class:active={view === 'profile'}
        type="button"
        onclick={() => (view = view === 'profile' && latest ? 'briefing' : 'profile')}
      >
        {view === 'profile' && latest ? 'Back to briefing' : 'Edit briefing'}
      </button>
    </div>
  </header>

  {#if message || error}
    <div class:error class="flash" role="status">{error ?? message}</div>
  {/if}

  {#if view === 'profile'}
    <section class="profile-view" aria-labelledby="profile-title">
      <header class="profile-head">
        <div>
          <span class="eyebrow">Briefing profile</span>
          <h2 id="profile-title">Decide what earns attention</h2>
          <p>Select the signals JKAI can use, set the editorial priorities, and choose how much recent memory should be carried into each briefing.</p>
        </div>
        <label class="master-switch">
          <input type="checkbox" bind:checked={enabled} />
          <span><b>{enabled ? 'Running' : 'Paused'}</b>{data.schedule.display}</span>
        </label>
      </header>

      <div class="profile-priorities">
        <label class="field topics-field">
          <span class="eyebrow">Editorial priorities</span>
          <span class="field-help">Comma-separated themes that should influence selection and emphasis.</span>
          <input class="input" bind:value={topicsText} placeholder="Current projects, home security, LLM costs" />
        </label>
        <div class="memory-controls">
          <label class="field">
            <span class="eyebrow">Memory window</span>
            <span class="number-input"><input class="input" type="number" min="1" max="168" bind:value={profile.memoryLookbackHours} /><span>hours</span></span>
          </label>
          <label class="field">
            <span class="eyebrow">Memory limit</span>
            <span class="number-input"><input class="input" type="number" min="1" max="20" bind:value={profile.memoryLimit} /><span>items</span></span>
          </label>
        </div>
      </div>

      <div class="source-intro">
        <div>
          <span class="eyebrow">Sources</span>
          <p><strong>{activeSourceCount} selected</strong> · {readySourceCount} ready now{#if addableSourceCount} · {addableSourceCount} available to connect{/if}</p>
        </div>
        {#if data.workflowId}<a href="/jkai/canvas/morning-briefing">Open source workflow →</a>{/if}
      </div>

      <div class="source-groups">
        {#each sourceGroups as group (group.group)}
          <section class="source-group" aria-labelledby="source-group-{group.group}">
            <h3 id="source-group-{group.group}">{group.group}</h3>
            <div class="source-grid">
              {#each group.sources as source (source.key)}
                <article class:disabled={!profile.sources[source.key].enabled} class="source-card">
                  <div class="source-card-head">
                    <label class="source-toggle">
                      <input type="checkbox" bind:checked={profile.sources[source.key].enabled} />
                      <span>{source.label}</span>
                    </label>
                    <span class="connection connection-{source.connection}">{CONNECTION_LABEL[source.connection]}</span>
                  </div>
                  <p>{source.description}</p>
                  <label
                    class:unavailable={source.connection === 'available' || source.connection === 'missing' || !profile.sources[source.key].enabled}
                    class="required-toggle"
                  >
                    <input
                      type="checkbox"
                      bind:checked={profile.sources[source.key].required}
                      disabled={source.connection === 'available' || source.connection === 'missing' || !profile.sources[source.key].enabled}
                    />
                    Required for a complete briefing
                  </label>
                </article>
              {/each}
            </div>
          </section>
        {/each}
      </div>

      <aside class="capability-note">
        <strong>Designed to grow.</strong>
        Any canvas capability that emits <code>briefingSources</code> can join the same selection, evidence, and composition flow.
      </aside>

      <footer class="profile-actions">
        <button class="button primary save" type="button" onclick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
        {#if latest}<button class="button quiet" type="button" onclick={() => (view = 'briefing')}>Cancel</button>{/if}
        <span>Changes apply to the next manual or scheduled run.</span>
      </footer>
    </section>
  {:else if latest}
    <div class="briefing-view">
      <SectionHead
        kicker="B / {detail?.dateLabel ?? latest.title}"
        title={[detail?.headline ?? 'Your latest briefing']}
        strap="The run behind this morning's message. Every figure below opens the day it summarises, where the fact sheet the composer was allowed to quote is kept in full."
      >
        {#snippet aside()}
          <a class="btn sm" href={dayHref}>Open the full day →</a>
        {/snippet}
      </SectionHead>

      <StatDeck tiles={deckTiles} min={210} />
      <p class="note">
        {latest.llmCalls} model call{latest.llmCalls === 1 ? '' : 's'} · ${(latest.costUsd ?? 0).toFixed(3)} · run {fmt(latest.startedAt)}
      </p>

      <div class="section-gap">
        <p class="field-label">What it was composed from</p>
        <RollupGrid cells={rollup} min={190} />
      </div>

      <div class="section-gap">
        <SectionHead
          kicker="C / Shared back from daydreaming"
          title={['New memories']}
          strap="Durable facts learned inside the {profile.memoryLookbackHours}-hour window and carried into this briefing."
        >
          {#snippet aside()}
            <a class="btn sm" href="/jkai/daydreams/memory">Open shared memory →</a>
          {/snippet}
        </SectionHead>
        {#if learnedMemories.length}
          <div class="grid">
            {#each learnedMemories as memory (memory.id)}
              <div class="card t-steady">
                <p class="card-kicker">{memory.category}{#if memory.confidence} · {memory.confidence} confidence{/if}</p>
                <p class="card-body lead">{memory.content}</p>
                {#if memory.createdAt}
                  <p class="card-meta"><span class="meta-item stamp">{fmt(memory.createdAt)}</span></p>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="note">
            No new durable memories landed inside this briefing’s window. Nothing has been padded or repeated.
          </p>
        {/if}
      </div>

      <div class="section-gap">
        <SectionHead
          kicker="D / As sent"
          title={['The message', 'that went out']}
          strap="The summary exactly as WhatsApp carried it. It may only quote the fact sheet, so anything here that is not in the rollup above is a fault worth reporting."
        />
        {#if latest.markdown}
          <div class="sent"><ChatMarkdown content={latest.markdown} /></div>
        {:else}
          <p class="note warn">This briefing completed without a written summary.</p>
        {/if}
        {#if detail?.daydreamsText}
          <p class="field-label sent-heading">💭 Daydreams</p>
          <pre class="sent-block">{detail.daydreamsText}</pre>
        {/if}

        <div class="controls">
          {#if voted}
            <p class="note good">Noted — {voted === 'up' ? 'more like this' : 'less of this'}.</p>
          {:else}
            <label class="field-label" for="briefing-feedback">Tune the next briefing</label>
            <div class="actions">
              <input class="text-input" id="briefing-feedback" placeholder="Optional topic" bind:value={voteWhat} />
              <button class="btn" type="button" onclick={() => vote('up')}>More like this</button>
              <button class="btn danger" type="button" onclick={() => vote('down')}>Less like this</button>
            </div>
          {/if}
        </div>
      </div>

      {#if dayStrip.length}
        <div class="section-gap">
          <SectionHead
            kicker="E / The archive"
            title={['Earlier days']}
            strap="Every briefing is its own page — the same address the morning message links to."
          >
            {#snippet aside()}
              <span class="dim">{briefings.length} kept</span>
            {/snippet}
          </SectionHead>
          <div class="strip">
            {#each dayStrip as day (day.id)}
              <a
                class="tag"
                class:t-action={day.id === latest.id}
                class:t-urgent={day.status === 'failed'}
                href="/jkai/daydreams/briefing/{day.id}">{day.id}</a
              >
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <section class="first-run">
      <span class="eyebrow">No briefing yet</span>
      <h2>Build the first one</h2>
      <p>Choose the sources that matter, save the profile, then run the workflow once.</p>
      <button class="button primary" type="button" onclick={() => (view = 'profile')}>Configure briefing</button>
    </section>
  {/if}
</main>

<style>
  /* Only what the shared `.ds-vocab` vocabulary in the daydream layout does not
     already carry. The briefing view's old magazine CSS — the headline block,
     the evidence drawer, the fact ledger, the source ledger, the history
     accordion — went with the markup it styled; the day page holds that detail
     now. What is left below is the command bar and the source-configuration
     view, which is unchanged. */
  .briefing { max-width: 1120px; margin: 0 auto; padding: 24px 20px 80px; color: var(--text-primary); }
  .briefing.embedded { max-width: none; padding: 0; }
  .eyebrow { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.35; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-muted); }
  .command-bar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 0; margin-bottom: clamp(22px, 3vw, 38px); border-top: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .system-state { display: flex; align-items: center; gap: 11px; }
  .system-state strong { display: block; margin-top: 2px; font-size: var(--fs-nav); font-weight: 600; }
  .state-dot { width: 9px; height: 9px; background: var(--success, #2d7a3a); border-radius: 50%; }
  .state-dot.paused { background: var(--warn, #b0892a); }
  .command-actions { display: flex; gap: 8px; }
  .button { border: 1px solid transparent; padding: 9px 14px; font-family: var(--font-mono); font-size: var(--fs-label); cursor: pointer; }
  .button:disabled { cursor: default; opacity: 0.5; }
  .button.primary { background: var(--accent-ink, var(--accent)); color: var(--bg); }
  .button.secondary { border-color: var(--line-strong); background: transparent; color: var(--text-primary); }
  .button.secondary:hover, .button.secondary.active { border-color: var(--accent); color: var(--accent-ink, var(--accent)); }
  .button.quiet { border-color: transparent; background: transparent; color: var(--text-muted); }
  .flash { margin: -20px 0 24px; padding: 9px 12px; border-left: 3px solid var(--success, #2d7a3a); background: color-mix(in srgb, var(--success, #2d7a3a) 7%, transparent); font-size: var(--fs-label); }
  .flash.error { border-color: var(--error, #c44); color: var(--error, #c44); }

  /* ——— the briefing view ——— */
  .briefing-view { display: flex; flex-direction: column; gap: clamp(20px, 3vw, 32px); }
  /* A measure for the composed summary: without it the markdown is the widest
     descendant of the jkai shell's horizontal scroll container. */
  .sent { max-width: 78ch; }
  .sent-heading { margin-top: clamp(20px, 2.5vw, 32px); }
  /* The WhatsApp block as the phone received it. It MUST wrap — an unwrapped
     `pre` stretches the whole room inside that same scroll container. */
  .sent-block { font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.7; color: var(--text-primary); background: var(--surface-card); border: 1px solid var(--card-border); border-left: 3px solid var(--accent); padding: 14px 16px; margin: 0; max-width: 78ch; white-space: pre-wrap; overflow-wrap: anywhere; }
  .strip { display: flex; flex-wrap: wrap; gap: 6px; }

  /* ——— the source-configuration view (unchanged) ——— */
  .profile-view { display: flex; flex-direction: column; gap: clamp(24px, 3.5vw, 40px); padding: clamp(20px, 3.5vw, 38px); border: 1px solid var(--line-strong); background: color-mix(in srgb, var(--surface-elevated) 55%, transparent); }
  .profile-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 30px; padding-bottom: 24px; border-bottom: 1px solid var(--line-strong); }
  .profile-head h2 { margin: 7px 0 10px; font-family: var(--font-display); font-size: clamp(30px, 4vw, 52px); line-height: 0.98; text-transform: uppercase; }
  .profile-head p { max-width: 68ch; margin: 0; color: var(--text-muted); line-height: 1.5; }
  .master-switch { display: flex; align-items: center; gap: 10px; min-width: 180px; padding: 11px 13px; border: 1px solid var(--line-strong); cursor: pointer; }
  .master-switch input, .source-toggle input, .required-toggle input { width: auto; accent-color: var(--accent); }
  .master-switch span { display: flex; flex-direction: column; gap: 2px; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .master-switch b { color: var(--text-primary); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.09em; }
  .profile-priorities { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 20px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field-help { color: var(--text-ghost); font-size: var(--fs-label); }
  .input { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid var(--line-strong); background: var(--bg); color: var(--text-primary); outline: none; }
  .input:focus { border-color: var(--accent); }
  .memory-controls { display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 10px; }
  .number-input { display: flex; align-items: center; border: 1px solid var(--line-strong); background: var(--bg); }
  .number-input .input { width: 72px; border: 0; }
  .number-input > span { padding-right: 10px; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .source-intro { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }
  .source-intro > a { color: var(--accent-ink, var(--accent)); font-family: var(--font-mono); font-size: var(--fs-label); text-decoration: none; }
  .source-intro p { margin: 5px 0 0; color: var(--text-muted); font-size: var(--fs-label); }
  .source-intro strong { color: var(--text-primary); }
  .source-groups { display: flex; flex-direction: column; gap: 26px; }
  .source-group > h3 { margin: 0 0 9px; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.14em; }
  .source-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 9px; }
  .source-card { display: flex; flex-direction: column; min-width: 0; padding: 14px; border: 1px solid var(--line-strong); background: var(--bg); }
  .source-card.disabled { opacity: 0.55; }
  .source-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .source-toggle { display: flex; align-items: center; gap: 8px; min-width: 0; font-weight: 600; cursor: pointer; }
  .connection { flex: none; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; }
  .connection-native, .connection-connected { color: var(--success, #2d7a3a); }
  .connection-available { color: var(--accent-ink, var(--accent)); }
  .source-card > p { min-height: 2.7em; margin: 10px 0 14px; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.4; }
  .required-toggle { display: flex; align-items: center; gap: 7px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--line-hair); color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; }
  .required-toggle.unavailable { color: var(--text-ghost); cursor: default; }
  .capability-note { padding: 14px 16px; border-left: 3px solid var(--accent); background: var(--accent-tint-04); color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; }
  .capability-note strong { display: block; color: var(--text-primary); }
  .capability-note code { color: var(--accent-ink, var(--accent)); font-family: var(--font-mono); }
  .profile-actions { display: flex; align-items: center; gap: 10px; padding-top: 22px; border-top: 1px solid var(--line-strong); }
  .profile-actions > span { color: var(--text-ghost); font-size: var(--fs-label); }
  .first-run { max-width: 720px; padding: clamp(24px, 4vw, 48px); border: 1px solid var(--line-strong); }
  .first-run h2 { margin: 8px 0; font-family: var(--font-display); font-size: 42px; text-transform: uppercase; }
  .first-run p { margin: 0 0 20px; color: var(--text-muted); }

  @media (max-width: 720px) {
    .command-bar, .profile-head, .source-intro { align-items: stretch; flex-direction: column; }
    .command-actions { width: 100%; }
    .command-actions .button { flex: 1; }
    .profile-priorities { grid-template-columns: 1fr; }
    .master-switch { min-width: 0; }
    .profile-actions { align-items: flex-start; flex-wrap: wrap; }
    .profile-actions > span { width: 100%; }
  }
  @media (max-width: 480px) {
    .briefing { padding-inline: 14px; }
    .command-actions { align-items: stretch; flex-direction: column; }
    .command-actions .button { width: 100%; max-width: none; }
    .profile-view { padding: 18px; }
    .memory-controls, .source-grid { grid-template-columns: 1fr; }
  }
</style>
