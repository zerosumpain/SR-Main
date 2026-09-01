<script lang="ts">
  /**
   * Point one LLM activity at a different model, from the page that shows what
   * that activity costs.
   *
   * Deliberately NOT the /jkai `OpenRouterModelPicker` overlay. That component
   * is a full-screen browser built for choosing a model for a CONVERSATION —
   * quality/price sliders, comparison exhibits, chat-specific pin targets. Here
   * the question is narrower and the context is the point: you are looking at
   * "vision cost $2.10 this month" and want the row beneath it to say what the
   * alternatives cost. So the options carry prices and the panel never covers
   * the figure that prompted the change.
   *
   * Ordering is by USE, not by price. A 338-row catalogue sorted cheapest-first
   * buries the six models this site actually runs on somewhere past the
   * hundredth option, which is how "pick from a list" degrades into "know the
   * slug already". Price stays on every row and still orders the tail.
   *
   * The panel renders in a FULL-WIDTH row beneath the activity, not in the last
   * table cell. In the cell it widened the table from 1147px to 1922px inside an
   * `overflow-x: auto` scroller, so two thirds of the control — including the
   * Save button — sat off the right edge and had to be scrolled to. A picker you
   * cannot see is indistinguishable from no picker at all, which is how "change
   * the model" came to mean "know the slug and type it".
   *
   * All write paths are existing endpoints, not new ones — a model change keeps
   * exactly one server-side guard on the whole site (see $lib/models/save-model).
   */
  import type { WorkloadState } from '$lib/models/workloads';
  import { emitsImages } from '$lib/models/workloads';
  import type { CatalogueModel } from '$lib/costs/analysis';
  import { pricePerMTokens, canServe, isFreeTier } from '$lib/costs/analysis';
  import { saveWorkloadModel, saveSiteDefaultModel } from '$lib/models/save-model';

  let {
    workload,
    catalogue,
    /** What this activity runs on now. Passed in rather than read off
     *  `workload`, because the site default has no workload row and used to
     *  reach this panel as an empty string — so the one row on the page that
     *  every unpinned role inherits was the one row whose picker could not mark
     *  its own current model or price anything relative to it. */
    currentModelId,
    /** The activity's observed token mix, so option prices are quoted for the
     *  work this role actually does rather than a nominal 3:1 blend. */
    tokensIn = 0,
    tokensOut = 0,
    /** Model id → calls across the site, over a fixed 90 days. Orders the list. */
    usage = [],
    /** Models this role has actually been observed running on. The only list
     *  that exists for the roles OpenRouter's catalogue cannot describe. */
    seenModelIds = [],
    onchanged,
    onclose,
  }: {
    workload: WorkloadState | null;
    catalogue: CatalogueModel[];
    currentModelId: string;
    tokensIn?: number;
    tokensOut?: number;
    usage?: { id: string; calls: number }[];
    seenModelIds?: string[];
    /** Fired after a successful save so the page can re-read its data. */
    onchanged: () => void;
    /** Dismiss without saving. The row that opened this panel owns it. */
    onclose: () => void;
  } = $props();

  let saving = $state(false);
  let err = $state<string | null>(null);
  let choice = $state('');
  /** Free-text slug for roles with no catalogue to pick from (embeddings, FLUX). */
  let typed = $state('');

  /**
   * `chat` is the site default itself, which is not a workload row: it has no
   * `requires`, and it saves through a different endpoint. It is included here
   * because from the operator's side it is the same question — "what runs
   * this?" — and excluding it would leave the biggest single lever off the page.
   */
  const isSiteDefault = $derived(workload === null);

  /** Options this role may legally run on. The server re-checks all of this on
   *  save (`workloadBlockReason`); the filter here is so an impossible pick is
   *  not offered, not so it is trusted. */
  const options = $derived.by(() => {
    if (isSiteDefault) {
      // The site default must be able to drive tools — every agentic role
      // inherits it. Same rule the models page enforces on save.
      return catalogue.filter((c) => c.toolsSupported);
    }
    const w = workload!;
    if (w.catalogue === 'none') return [];
    if (w.catalogue === 'image-out') return catalogue.filter((c) => emitsImages(c.modality));
    // Every requirement, not just `tools`. Vision and audio used to fall
    // through to the unfiltered catalogue, so the dropdown offered text-only
    // models for them and the save 400'd — the opposite of what the comment
    // above promises.
    return catalogue.filter((c) => canServe(c, w.requires));
  });

  /**
   * A catalogue of 0 is not the same as a role with no catalogue, but it dead-
   * ends the same way: a select whose only entry is "— pick a model —" and a
   * Save that can never enable. Both fall through to the typed field.
   */
  const listable = $derived(options.length > 0);

  const callsById = $derived(new Map(usage.map((u) => [u.id, u.calls])));
  const calls = (id: string) => callsById.get(id) ?? 0;

  /**
   * Most-used first, then the rest cheapest-first, then the free tiers.
   *
   * Three groups rather than one blended score: "we run this already", "this is
   * cheap" and "this is free and will stop working" are different reasons to
   * pick a model, and the operator should see which one applies. The free tiers
   * go LAST despite being the cheapest by definition — they price at zero, so a
   * flat price sort puts a dozen of them above every real option, and the same
   * page already refuses to recommend one because their daily caps rate-limit
   * the site to a standstill by mid-morning. Ranked down, not removed: pinning
   * one deliberately is still a decision an operator is allowed to make.
   *
   * "Free" here is a PRICE of zero, not just a `:free` suffix. `openrouter/free`
   * carries the same daily caps and none of the naming, and a suffix test put it
   * at the top of the list the operator is meant to pick from.
   */
  const groups = $derived.by(() => {
    const byPrice = (a: CatalogueModel, b: CatalogueModel) => {
      const pa = pricePerMTokens(a, tokensIn || 3, tokensOut || 1);
      const pb = pricePerMTokens(b, tokensIn || 3, tokensOut || 1);
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb;
    };
    const free = (m: CatalogueModel) =>
      isFreeTier(m.id) || pricePerMTokens(m, tokensIn || 3, tokensOut || 1) === 0;
    const used = options.filter((m) => calls(m.id) > 0).sort((a, b) => calls(b.id) - calls(a.id));
    const unused = options.filter((m) => calls(m.id) === 0);
    return {
      used,
      rest: unused.filter((m) => !free(m)).sort(byPrice),
      free: unused.filter(free).sort(byPrice),
    };
  });

  function priceLabel(m: CatalogueModel): string {
    const p = pricePerMTokens(m, tokensIn || 3, tokensOut || 1);
    if (p == null) return 'unpriced';
    return `$${p < 1 ? p.toFixed(3) : p.toFixed(2)}/M`;
  }

  /** "12k calls" — why this model is at the top of the list. */
  function callsLabel(id: string): string {
    const c = calls(id);
    if (c >= 1000) return `${Math.round(c / 1000)}k calls`;
    return `${c} call${c === 1 ? '' : 's'}`;
  }

  const currentPrice = $derived.by(() => {
    const m = catalogue.find((c) => c.id === currentModelId);
    return m ? pricePerMTokens(m, tokensIn || 3, tokensOut || 1) : null;
  });

  /** "62% of what it runs on now" — the whole reason to choose from this page. */
  function relative(m: CatalogueModel): string | null {
    const p = pricePerMTokens(m, tokensIn || 3, tokensOut || 1);
    if (p == null || currentPrice == null || currentPrice <= 0) return null;
    const pct = (p / currentPrice) * 100;
    if (Math.abs(pct - 100) < 1) return 'same price';
    return pct < 100 ? `${(100 - pct).toFixed(0)}% cheaper` : `${(pct - 100).toFixed(0)}% dearer`;
  }

  function optionLabel(m: CatalogueModel, showCalls: boolean): string {
    const rel = m.id === currentModelId ? '(current)' : relative(m);
    const parts = [priceLabel(m), m.id];
    if (showCalls) parts.push(callsLabel(m.id));
    if (rel) parts.push(rel);
    return parts.join(' · ');
  }

  /** Slugs this role has demonstrably run on, minus whatever it is on now.
   *  For embeddings and the FLUX image tool this is the ONLY evidence of a
   *  valid model id anywhere in the system — OpenRouter's feed carries neither. */
  const seen = $derived(
    [...new Set(seenModelIds.filter(Boolean))].filter((id) => id !== currentModelId),
  );

  async function save(modelId: string | null) {
    saving = true;
    err = null;
    try {
      if (isSiteDefault) {
        // Clearing has no meaning for the site default — there is nothing
        // beneath it to fall back to.
        if (modelId) await saveSiteDefaultModel(modelId);
      } else {
        await saveWorkloadModel(workload!.id, modelId);
      }
      choice = '';
      typed = '';
      onchanged();
    } catch (e) {
      err = e instanceof Error ? e.message : 'save failed';
    } finally {
      saving = false;
    }
  }

  function submit() {
    const id = listable ? choice : typed.trim();
    if (!id) return;
    void save(id);
  }
</script>

<div class="sw">
  <div class="sw-panel">
    <span class="sw-for">
      {isSiteDefault ? 'Site default' : workload!.label} runs on <code>{currentModelId || '—'}</code>
    </span>
    {#if listable}
      <select class="nm-select" bind:value={choice} disabled={saving} aria-label="Model">
        <option value="">— pick a model —</option>
        {#if groups.used.length}
          <optgroup label="Already running on this site — most used first">
            {#each groups.used as m (m.id)}
              <option value={m.id} disabled={m.id === currentModelId}>{optionLabel(m, true)}</option>
            {/each}
          </optgroup>
        {/if}
        {#if groups.rest.length}
          <optgroup label="Everything else — cheapest first">
            {#each groups.rest as m (m.id)}
              <option value={m.id} disabled={m.id === currentModelId}>{optionLabel(m, false)}</option>
            {/each}
          </optgroup>
        {/if}
        {#if groups.free.length}
          <optgroup label="Free tiers — hard daily caps, will stop mid-morning">
            {#each groups.free as m (m.id)}
              <option value={m.id} disabled={m.id === currentModelId}>{optionLabel(m, false)}</option>
            {/each}
          </optgroup>
        {/if}
      </select>
    {:else}
      <!-- OpenRouter's /models feed carries neither embedding models nor the
           /images/generations namespace, so there is genuinely no list to
           offer — except the one the ledger keeps. A slug this role has
           already billed against is the only kind that is known to work, so
           it is offered as a press rather than something to re-type. -->
      {#if seen.length}
        <span class="sw-seen">
          <span class="sw-seen-label">used before</span>
          {#each seen as id (id)}
            <button class="nm-btn-ghost sw-chip" onclick={() => save(id)} disabled={saving}>
              {id}
            </button>
          {/each}
        </span>
      {/if}
      <input
        class="nm-input"
        type="text"
        placeholder={workload?.id === 'image-tool' ? 'an /images/generations model' : 'vendor/model-slug'}
        bind:value={typed}
        disabled={saving}
        aria-label="Model slug"
      />
      <span class="sw-note">
        {#if workload?.id === 'image-tool'}
          Must serve OpenRouter's /images/generations endpoint — a chat model typed here fails at
          draw time, not at save time.
        {:else if workload?.catalogue === 'none'}
          Not in OpenRouter's catalogue, so the slug cannot be checked before it is used.
        {:else}
          No catalogue rows loaded, so there is nothing to list — the nightly model sync has not
          run. The slug is still checked on save.
        {/if}
      </span>
    {/if}

    <button class="nm-save-btn" onclick={submit} disabled={saving || !(listable ? choice : typed.trim())}>
      {saving ? 'Saving…' : 'Save'}
    </button>

    {#if !isSiteDefault && workload!.scope === 'site' && workload!.setModelId}
      <button class="nm-link-btn" onclick={() => save(null)} disabled={saving}>
        clear pin
      </button>
    {/if}
    <button class="nm-link-btn" onclick={() => { err = null; onclose(); }} disabled={saving}>
      cancel
    </button>

    {#if err}<span class="sw-err">{err}</span>{/if}
  </div>
</div>

<style>
  .sw {
    /* The panel lives in a `colspan` cell of a horizontally scrolling table, so
       on a phone it renders at the table's left edge while the button that
       opened it is at the right — tapping "change model" produced a visibly
       EMPTY band. Sticky pins it to the scrollport instead, so it is on screen
       wherever the table is scrolled to. */
    position: sticky;
    left: 0;
    width: fit-content;
    max-width: 100%;
  }
  .sw-panel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    /* A DEFINITE cap, because this sits in a table cell and a table cell sizes
       to its content: without one, the widest child (a chip row, a sentence)
       decides the width of the whole table and pushes Save back off the right
       edge of the scroller. Definite is what makes `flex-basis: 100%` and
       `max-width: Nch` below resolve against something instead of against the
       content they are meant to constrain. */
    max-width: min(68rem, calc(100vw - 4rem));
    /* Wider than the usual 0.5rem: the trailing controls are all uppercase
       tracked mono, and at 0.5rem "clear pin" and "cancel" read as one word. */
    gap: 0.75rem;
    padding: 0.4rem 0;
  }
  .sw-for {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .sw-for code {
    text-transform: none;
    color: var(--text-secondary);
  }
  .sw-panel :global(.nm-select) {
    /* Wide enough to read a slug, price and call count on the closed control —
       and capped, because a table cell sizes to its content: an uncapped select
       makes the whole table wider than its scroller again and puts Save back
       off the right edge. The open dropdown is drawn by the browser at its own
       width, so nothing is lost by capping the closed one. */
    min-width: 22rem;
    width: 34rem;
    max-width: 100%;
    font-family: var(--font-mono);
    /* Form controls stay at --fs-body — anything smaller force-zooms mobile
       Safari, which strands the rest of the row off-screen. */
    font-size: var(--fs-body);
  }
  .nm-input {
    font-family: var(--font-mono);
    /* --fs-body, not smaller: a sub-16px typed field makes mobile Safari
       force-zoom the viewport (see scripts/check-font-sizes.mjs). */
    font-size: var(--fs-body);
    padding: 0.4rem 0.6rem;
    min-width: 18rem;
    background: var(--surface-sunken, var(--bg-section));
    color: var(--text-primary);
    border: 1px solid var(--card-border);
  }
  .nm-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .sw-seen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }
  .sw-seen-label,
  .sw-note,
  .sw-err {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
  }
  .sw-seen-label {
    color: var(--text-ghost);
    text-transform: uppercase;
  }
  .sw-chip {
    /* A slug is the label here, so it keeps its own case and spacing rather
       than the uppercase/tracked treatment ghost buttons use for words. */
    text-transform: none;
    letter-spacing: 0;
    padding: 4px 10px;
  }
  .sw-note {
    color: var(--text-ghost);
    /* Its own line, wrapped and measured. Inline in the control strip it is one
       unbreakable sentence in a table cell that sizes to its content, which put
       the row 970px past the scroller — the same fault that hid the picker. */
    flex: 1 0 100%;
    max-width: 78ch;
    white-space: normal;
    line-height: 1.5;
  }
  .sw-err {
    color: var(--error);
  }
</style>
