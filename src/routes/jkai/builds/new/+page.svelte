<script lang="ts">
  import { goto } from '$app/navigation';
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import ModelPicker from '$lib/components/jkai/ModelPicker.svelte';
  // The jkai copy of /health's masthead — mono kicker, display headline broken
  // where the design wants it broken, standfirst pushed right. It lives under
  // daydream/ because that is where it was first needed; it is not
  // daydream-specific and every jkai hub surface is meant to open with it.
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import type { ModelContext } from '$lib/server/models/types';

  let { data } = $props();

  let prompt = $state('');
  // Matches DEFAULT_BUILD_BUDGET. At 15 the form silently imposed a ~45-minute
  // cooldown after the first iteration of every hand-started build.
  let activeMinutesPerHour = $state(45);
  let maxTokensPerHour = $state<number | null>(null);
  let maxIterations = $state<number | null>(null);
  let maxTotalMinutes = $state<number | null>(null);
  let submitting = $state(false);
  let error = $state('');
  let builderModel = $state<ModelContext>({ ...data.defaultBuilderModel });
  // Defaults: prefer the fast path. enforceDesignSystem only matters for
  // SR-internal Svelte projects (the linter skips non-Svelte workspaces
  // anyway as of the host-mode cutover), so leaving it on does no harm
  // for static builds. planFirst, on the other hand, gates a 90-second
  // proposer/critic/revision debate before iteration 1 even starts —
  // unhelpful for 'build me a calculator' shape prompts. Off by default;
  // user can opt in via the checkbox for genuinely complex builds.
  let enforceDesignSystem = $state(true);
  let planFirst = $state(false);
  let thinkingLevel = $state<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'>('medium');
  let researchMode = $state<'reuse' | 'extend' | 'fresh'>('extend');

  /**
   * THE LANE — one exclusive choice, because it always was one.
   *
   * This used to be two independent controls: a `studioMode` checkbox near the
   * top and a `gitTarget` select buried in Strategy at the bottom. Nothing
   * stopped you setting both, and the combination is not a thing that exists —
   * `submit()` posts studio builds to a different endpoint entirely and never
   * looks at `gitTarget`. So "Studio + SR-Main repo" silently discarded the
   * repo half, and the page's most consequential decision was the one it made
   * hardest to see. Build dd2dcc57 spent five iterations and 2.8M tokens
   * writing a standalone imitation of a site page because the app lane was the
   * default and the form never said so.
   *
   * Now it is three rows in the /health ranked-moves grammar: a numeral, a
   * column saying what the lane IS, then what it buys and what it costs. The
   * two derived values below are what the rest of the form and `submit()` read,
   * so the exclusivity is structural rather than a rule someone has to keep.
   */
  type Lane = 'app' | 'repo' | 'studio';
  let lane = $state<Lane>('app');
  const studioMode = $derived(lane === 'studio');
  const gitTarget = $derived(lane === 'repo' ? 'sr-main' : '');

  const LANES: Array<{
    id: Lane;
    rank: string;
    name: string;
    rationale: string;
    buys: string;
    costs: string;
  }> = [
    {
      id: 'app',
      rank: '01',
      name: 'Sandbox app',
      rationale: 'A self-contained app built in its own workspace, published to /projects.',
      buys: 'Fastest lane. No repo to clone, no gate to pass, nothing that can touch the site.',
      costs: 'Cannot produce site code. A prompt asking to change the site gets a standalone imitation of it.',
    },
    {
      id: 'repo',
      rank: '02',
      name: 'SR-Main repo',
      rationale: 'Clones the site repo, branches, and opens a pull request.',
      buys: 'Real site code. Runs the full gate every iteration, so what it opens is code that builds.',
      costs: 'Slowest lane, and it can reach any file including the builder’s own. Nothing auto-merges; auth, schema, deploy and safety-rail changes are flagged tier=high.',
    },
    {
      id: 'studio',
      rank: '03',
      name: 'Studio explainer',
      rationale: 'Researches a subject, plans a 6–10 chapter spine, then builds one chapter per iteration.',
      buys: 'A sourced, multi-chapter interactive explainer. Every claim traces back to a fact with a URL.',
      costs: 'Researches before it plans, and stops if the evidence is too thin. Replaces the budget, model and strategy settings with the Studio defaults.',
    },
  ];

  const EVIDENCE: Array<{ id: 'reuse' | 'extend' | 'fresh'; name: string; note: string }> = [
    {
      id: 'extend',
      name: 'Extend',
      note: 'Searches existing research first; only starts a Deep Dive if it falls short, seeded with what was found.',
    },
    {
      id: 'reuse',
      name: 'Reuse only',
      note: 'Existing research, no new session — seconds, and free. Fails fast if the corpus does not already hold enough sourced facts on this topic.',
    },
    {
      id: 'fresh',
      name: 'Fresh',
      note: 'Always starts a new Deep Dive, even if this topic is already covered. 30–90 minutes.',
    },
  ];

  const THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

  async function submit() {
    if (!prompt.trim()) return;
    submitting = true;
    error = '';

    if (studioMode) {
      try {
        const res = await fetch('/api/jkai/studio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ challenge: prompt.trim(), researchMode }),
        });
        const data = await res.json();
        if (!res.ok || !data.buildId) {
          error = data.error ?? 'Studio build failed to start';
          return;
        }
        goto(`/jkai/builds/${data.buildId}`);
      } catch (err: any) {
        error = err.message;
      } finally {
        submitting = false;
      }
      return;
    }

    const budgetConfig: Record<string, number> = {};
    if (activeMinutesPerHour) budgetConfig.activeMinutesPerHour = activeMinutesPerHour;
    if (maxTokensPerHour) budgetConfig.maxTokensPerHour = maxTokensPerHour;
    if (maxIterations) budgetConfig.maxIterations = maxIterations;
    if (maxTotalMinutes) budgetConfig.maxTotalMinutes = maxTotalMinutes;

    try {
      const res = await fetch('/api/jkai/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          budgetConfig,
          modelProvider: builderModel.provider,
          modelId: builderModel.modelId,
          enforceDesignSystem,
          planFirst,
          thinkingLevel,
          // Omitted entirely for the app lane — the API only writes
          // git_target_config when a lane was actually chosen.
          gitTarget: gitTarget || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        error = data.error || 'Failed to create build';
        return;
      }

      const build = await res.json();
      goto(`/jkai/builds/${build.id}`);
    } catch (err: any) {
      error = err.message;
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>New Build — JKAI</title>
</svelte:head>

<JkaiPageTitle title="NEW BUILD" titleHref="/jkai/builds" />

<form class="nb" onsubmit={(e) => { e.preventDefault(); submit(); }}>
  <div class="nb-inner">
    <SectionHead
      kicker="A / Lane · choose one"
      title={['Three lanes,', 'one decision']}
      strap="What the builder is allowed to touch is settled here and nowhere else. The rest of this form only adjusts how the lane you pick behaves."
    />

    <!-- Ranked-moves grammar: a numeral, a column saying what the thing IS,
         then what it buys and what it costs. One hairline between rows, drawn
         as the container's own ground showing through a 1px gap. -->
    <div class="lanes" role="radiogroup" aria-label="Build lane">
      {#each LANES as l (l.id)}
        <label class="lane" class:on={lane === l.id}>
          <input class="lane-input" type="radio" name="lane" value={l.id} bind:group={lane} />
          <span class="lane-rank">{l.rank}</span>
          <span class="lane-cell">
            <span class="lane-name">{l.name}</span>
            <span class="lane-rationale">{l.rationale}</span>
          </span>
          <span class="lane-cell">
            <span class="lane-label">Buys</span>
            <span class="lane-text">{l.buys}</span>
          </span>
          <span class="lane-cell">
            <span class="lane-label">Costs / risks</span>
            <span class="lane-text">{l.costs}</span>
          </span>
        </label>
      {/each}
    </div>

    <div class="nb-sec">
      <SectionHead
        kicker="B / {studioMode ? 'Challenge statement' : 'Objective'}"
        title={studioMode ? ['What should the', 'reader understand?'] : ['What should it', 'build?']}
        strap={studioMode
          ? 'Name a subject and the counter-intuitive thing about it. The research stage runs against this sentence before a single chapter is planned.'
          : 'One paragraph. The planner and every iteration after it read this, so say what done looks like rather than how to get there.'}
      />
      <textarea
        id="prompt"
        class="nb-textarea"
        bind:value={prompt}
        rows={5}
        placeholder={studioMode
          ? 'e.g. "Explain how the National Funding Formula decides what a school receives, and why two schools of the same size get different budgets."'
          : 'Describe what you want to build...'}
      ></textarea>
    </div>

    {#if studioMode}
      <div class="nb-sec">
        <SectionHead
          kicker="C / Evidence · where the facts come from"
          title={['Sourced first,', 'planned second']}
          strap="Studio will not plan a spine it cannot source. If the brief comes back with too few facts, or all of them from one or two pages, the build stops there rather than writing a confident explainer with nothing under it."
        />
        <!-- Tripwire-ledger grammar: a two-line signal cell, and the explaining
             sentence in body font in its OWN column at a readable measure. -->
        <div class="ledger" role="radiogroup" aria-label="Evidence mode">
          {#each EVIDENCE as e (e.id)}
            <label class="lrow" class:on={researchMode === e.id}>
              <input class="lane-input" type="radio" name="evidence" value={e.id} bind:group={researchMode} />
              <span class="lrow-sig">
                <span class="lrow-name">{e.name}</span>
                <span class="lrow-sub">{e.id === 'extend' ? 'default' : e.id === 'reuse' ? 'no new research' : 'full Deep Dive'}</span>
              </span>
              <span class="lrow-note">{e.note}</span>
            </label>
          {/each}
        </div>
      </div>
    {:else}
      <div class="nb-sec">
        <SectionHead
          kicker="C / Budget · when it stops"
          title={['Caps, not', 'targets']}
          strap="Every one of these ends the build when it is hit. Left blank means no cap of that kind — the others still apply."
        />
        <div class="ledger">
          <div class="lrow static">
            <span class="lrow-sig">
              <span class="lrow-name">Active minutes per hour</span>
              <span class="lrow-sub">{activeMinutesPerHour}m</span>
            </span>
            <span class="lrow-note">
              How much of each hour the builder may actually work. Below the default of 45 it
              idles in a cooldown between iterations.
            </span>
            <span class="lrow-ctl">
              <input type="range" min="1" max="60" bind:value={activeMinutesPerHour} aria-label="Active minutes per hour" />
            </span>
          </div>

          <div class="lrow static">
            <span class="lrow-sig">
              <span class="lrow-name">Max tokens per hour</span>
              <span class="lrow-sub">{maxTokensPerHour ? `${maxTokensPerHour}` : 'unlimited'}</span>
            </span>
            <span class="lrow-note">
              A spend ceiling. Most of a build’s token count is re-sent context rather than new
              work, so set this high or not at all.
            </span>
            <span class="lrow-ctl">
              <input class="nb-num" type="number" bind:value={maxTokensPerHour} placeholder="Unlimited" aria-label="Max tokens per hour" />
            </span>
          </div>

          <div class="lrow static">
            <span class="lrow-sig">
              <span class="lrow-name">Max iterations</span>
              <span class="lrow-sub">{maxIterations ? `${maxIterations}` : 'unlimited'}</span>
            </span>
            <span class="lrow-note">
              The count of build-and-check rounds. A build that stops here reports budget_cap,
              not failure — its work is kept.
            </span>
            <span class="lrow-ctl">
              <input class="nb-num" type="number" bind:value={maxIterations} placeholder="Unlimited" aria-label="Max iterations" />
            </span>
          </div>

          <div class="lrow static">
            <span class="lrow-sig">
              <span class="lrow-name">Total time cap</span>
              <span class="lrow-sub">{maxTotalMinutes ? `${maxTotalMinutes}m` : 'unlimited'}</span>
            </span>
            <span class="lrow-note">
              Wall clock from start to stop, counting the cooldowns as well as the work.
            </span>
            <span class="lrow-ctl">
              <input class="nb-num" type="number" bind:value={maxTotalMinutes} placeholder="Unlimited" aria-label="Total time cap in minutes" />
            </span>
          </div>
        </div>
      </div>

      <div class="nb-sec">
        <SectionHead
          kicker="D / Strategy · how it works"
          title={['Model and', 'method']}
          strap="Defaults suit a straightforward build. Plan approval is the one worth turning on for anything with more than one moving part."
        />
        <div class="ledger">
          <div class="lrow static model">
            <span class="lrow-sig">
              <span class="lrow-name">Model</span>
              <!-- The id, not just the provider. ModelPicker fills its options
                   from two fetches in onMount, so until those land its <select>
                   has nothing matching `value.modelId` and renders BLANK — the
                   row looked broken on first paint while the model was set
                   correctly the whole time. This line always says what is
                   actually going to run. -->
              <span class="lrow-sub">{builderModel.modelId}</span>
            </span>
            <span class="lrow-note">
              The agent behind every iteration. Codex ids cost quota rather than cash.
            </span>
            <span class="lrow-ctl wide">
              <ModelPicker bind:value={builderModel} label="" />
            </span>
          </div>

          <label class="lrow">
            <span class="lrow-sig">
              <span class="lrow-name">Design system</span>
              <span class="lrow-sub">{enforceDesignSystem ? 'enforced' : 'off'}</span>
            </span>
            <span class="lrow-note">
              Lints generated Svelte against the site’s tokens and type scale. Skipped
              automatically on workspaces that are not Svelte, so leaving it on costs nothing.
            </span>
            <span class="lrow-ctl">
              <input type="checkbox" bind:checked={enforceDesignSystem} />
            </span>
          </label>

          <label class="lrow">
            <span class="lrow-sig">
              <span class="lrow-name">Plan approval</span>
              <span class="lrow-sub">{planFirst ? 'required' : 'skipped'}</span>
            </span>
            <span class="lrow-note">
              Runs a proposer/critic/revision debate and pauses for you before iteration 1.
              Roughly 90 seconds, and worth it for anything with more than one moving part.
            </span>
            <span class="lrow-ctl">
              <input type="checkbox" bind:checked={planFirst} />
            </span>
          </label>

          <div class="lrow static">
            <span class="lrow-sig">
              <span class="lrow-name">Thinking level</span>
              <span class="lrow-sub">{thinkingLevel}</span>
            </span>
            <span class="lrow-note">
              How much reasoning the agent does per step. Higher is slower and, on some models,
              eats the output budget.
            </span>
            <span class="lrow-ctl">
              <select class="nb-select" bind:value={thinkingLevel} aria-label="Thinking level">
                {#each THINKING as lv (lv)}
                  <option value={lv}>{lv}</option>
                {/each}
              </select>
            </span>
          </div>
        </div>
      </div>
    {/if}

    <div class="nb-foot">
      {#if error}
        <p class="nb-error" role="alert">{error}</p>
      {/if}
      <button class="nb-go" type="submit" disabled={!prompt.trim() || submitting}>
        {submitting ? 'Starting…' : studioMode ? 'Start studio build' : 'Start build'}
      </button>
    </div>
  </div>
</form>

<style>
  .nb {
    display: block;
    padding: clamp(28px, 4vw, 56px) clamp(20px, 3vw, 44px) clamp(56px, 6vw, 96px);
  }
  /* The /health measure. Every section on that hub is set to it, and this page
     was `max-w-2xl` (672px) — half of it — which is what made a four-column
     budget grid read as a stack of clipped boxes. */
  .nb-inner {
    max-width: min(1400px, 100%);
    margin: 0 auto;
  }
  .nb-sec {
    margin-top: clamp(44px, 5vw, 76px);
  }

  /* --- Lane rows (ranked-moves) --- */
  .lanes {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
  }
  .lane {
    background: var(--bg);
    display: grid;
    grid-template-columns: 56px minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr);
    gap: clamp(14px, 1.8vw, 28px);
    padding: 24px;
    align-items: start;
    cursor: pointer;
    position: relative;
  }
  .lane.on {
    background: var(--accent-tint-08);
  }
  /* The real radio stays in the DOM and keeps focus and keyboard arrow-keys;
     it is only moved out of sight. `display: none` would take the whole
     radiogroup off the keyboard. */
  .lane-input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    margin: 0;
  }
  .lane:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .lane-rank {
    font-family: var(--font-display);
    font-size: 40px;
    line-height: 0.8;
    letter-spacing: -0.03em;
    color: rgba(26, 16, 8, 0.3);
  }
  .lane.on .lane-rank {
    color: var(--accent);
  }

  .lane-cell {
    min-width: 0;
    display: block;
  }
  .lane-name {
    display: block;
    font-family: var(--font-display);
    font-size: 20px;
    line-height: 1.05;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }
  .lane-rationale {
    display: block;
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .lane-label {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-bottom: 8px;
  }
  .lane-text {
    display: block;
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--text-secondary);
  }

  /* --- Ledger rows (tripwire) --- */
  .ledger {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
  }
  .lrow {
    background: var(--bg);
    display: grid;
    grid-template-columns: minmax(0, 200px) minmax(30ch, 1fr) minmax(0, 220px);
    gap: clamp(14px, 1.8vw, 28px);
    padding: 18px 24px;
    align-items: start;
    font-size: var(--fs-nav);
    position: relative;
  }
  label.lrow {
    cursor: pointer;
  }
  .lrow.on {
    background: var(--accent-tint-08);
  }
  .lrow:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  /* The evidence rows carry no control column — the whole row is the radio. */
  .ledger .lrow:not(.static) .lrow-note:last-child {
    grid-column: 2 / -1;
  }

  .lrow-sig {
    min-width: 0;
    display: block;
  }
  .lrow-name {
    display: block;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }
  .lrow-sub {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-top: 4px;
  }
  /* Body font, own column, readable measure — the tripwire ledger's whole
     point is that the explaining sentence is not squeezed into a label. */
  .lrow-note {
    min-width: 0;
    display: block;
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--text-secondary);
    text-wrap: pretty;
  }
  .lrow-ctl {
    min-width: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
  }
  /* Checkboxes, radios and the range thumb are UA-painted and default to the
     browser's blue, which is the one hue this palette does not contain. */
  .lrow-ctl :global(input),
  .lrow-ctl :global(select) {
    accent-color: var(--accent);
  }
  /* A model id is long and the picker is a native <select> that cannot ellipsize
     its closed value, so this row gets a wider control column than the
     checkboxes need. */
  .lrow.model {
    grid-template-columns: minmax(0, 200px) minmax(30ch, 1fr) minmax(0, 340px);
  }
  .lrow-ctl :global(input[type='range']) {
    width: 100%;
  }
  .lrow-ctl.wide {
    justify-content: stretch;
  }
  .lrow-ctl.wide :global(select) {
    width: 100%;
  }

  /* --- Fields --- */
  .nb-textarea,
  .nb-num,
  .nb-select {
    background: var(--card-bg);
    border: 1px solid var(--line-strong);
    color: var(--text-primary);
    border-radius: var(--radius-round);
    font-family: inherit;
    /* 16px floor on form fields — anything smaller makes mobile Safari zoom on
       focus, which the font-size gate treats as an error. */
    font-size: 1rem;
  }
  .nb-textarea {
    width: 100%;
    padding: 14px 16px;
    resize: vertical;
    line-height: 1.55;
  }
  .nb-num,
  .nb-select {
    width: 100%;
    padding: 6px 10px;
  }

  .nb-foot {
    margin-top: clamp(32px, 4vw, 56px);
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
  }
  .nb-error {
    color: var(--error);
    font-size: var(--fs-nav);
    margin: 0;
  }
  .nb-go {
    font-family: var(--font-mono);
    font-size: var(--fs-nav);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius-round);
    padding: 13px 28px;
    cursor: pointer;
  }
  .nb-go:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .nb-go:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  @media (max-width: 1080px) {
    .lane {
      grid-template-columns: 56px minmax(0, 1fr);
    }
    /* `.lrow.model` above is (0,2,0); a media query adds no specificity, so the
       narrow rules have to match it too or the model row never collapses. */
    .lrow,
    .lrow.model {
      grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
    }
    .lrow-ctl {
      grid-column: 2;
      justify-content: flex-start;
    }
  }
  @media (max-width: 560px) {
    .lane {
      grid-template-columns: minmax(0, 1fr);
    }
    .lrow,
    .lrow.model {
      grid-template-columns: minmax(0, 1fr);
    }
    .lrow-ctl {
      grid-column: 1;
    }
  }
</style>
