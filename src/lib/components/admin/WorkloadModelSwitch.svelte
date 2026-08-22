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
   * alternatives cost. So the options carry prices, sorted cheapest first, and
   * the panel never covers the figure that prompted the change.
   *
   * All three write paths are existing endpoints, not new ones — a model change
   * keeps exactly one server-side guard on the whole site:
   *   site workload   → POST /api/jkai/models/workloads
   *   hermes workload → POST /api/jkai/models/workloads  (config set + restart)
   *   site default    → POST /api/admin/models/settings
   */
  import type { WorkloadState } from '$lib/models/workloads';
  import { emitsImages } from '$lib/models/workloads';
  import type { CatalogueModel } from '$lib/costs/analysis';
  import { pricePerMTokens } from '$lib/costs/analysis';

  let {
    workload,
    catalogue,
    /** The activity's observed token mix, so option prices are quoted for the
     *  work this role actually does rather than a nominal 3:1 blend. */
    tokensIn = 0,
    tokensOut = 0,
    onchanged,
  }: {
    workload: WorkloadState | null;
    catalogue: CatalogueModel[];
    tokensIn?: number;
    tokensOut?: number;
    /** Fired after a successful save so the page can re-read its data. */
    onchanged: () => void;
  } = $props();

  let open = $state(false);
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
  const listable = $derived(!isSiteDefault && workload!.catalogue !== 'none');

  /** Options this role may legally run on, cheapest first at ITS token mix.
   *  The server re-checks all of this on save (`workloadBlockReason`); the
   *  filter here is so an impossible pick is not offered, not so it is trusted. */
  const options = $derived.by(() => {
    if (isSiteDefault) {
      // The site default must be able to drive tools — every agentic role
      // inherits it. Same rule the models page enforces on save.
      return rank(catalogue.filter((c) => c.toolsSupported));
    }
    const w = workload!;
    if (w.catalogue === 'image-out') return rank(catalogue.filter((c) => emitsImages(c.modality)));
    if (w.requires === 'tools') return rank(catalogue.filter((c) => c.toolsSupported));
    return rank(catalogue);
  });

  function rank(rows: CatalogueModel[]): CatalogueModel[] {
    return [...rows].sort((a, b) => {
      const pa = pricePerMTokens(a, tokensIn || 3, tokensOut || 1);
      const pb = pricePerMTokens(b, tokensIn || 3, tokensOut || 1);
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb;
    });
  }

  function priceLabel(m: CatalogueModel): string {
    const p = pricePerMTokens(m, tokensIn || 3, tokensOut || 1);
    if (p == null) return 'unpriced';
    return `$${p < 1 ? p.toFixed(3) : p.toFixed(2)}/M`;
  }

  const currentModelId = $derived(isSiteDefault ? '' : workload!.effectiveModelId);
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

  async function save(modelId: string | null) {
    saving = true;
    err = null;
    try {
      const res = isSiteDefault
        ? await fetch('/api/admin/models/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chatDefaultModelId: modelId }),
          })
        : await fetch('/api/jkai/models/workloads', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ workloadId: workload!.id, modelId }),
          });
      if (!res.ok) {
        // The endpoints answer with a REASON, not just a status — a text-only
        // model refused for a vision role explains itself. Surface it verbatim.
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `save failed (${res.status})`);
      }
      open = false;
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
    const id = listable || isSiteDefault ? choice : typed.trim();
    if (!id) return;
    void save(id);
  }
</script>

<div class="sw">
  {#if !open}
    <button class="nm-link-btn" onclick={() => (open = true)}>change model</button>
  {:else}
    <div class="sw-panel">
      {#if listable || isSiteDefault}
        <select class="nm-select" bind:value={choice} disabled={saving} aria-label="Model">
          <option value="">— pick a model —</option>
          {#each options as m (m.id)}
            {@const rel = relative(m)}
            <option value={m.id} disabled={m.id === currentModelId}>
              {priceLabel(m)} · {m.id}{m.id === currentModelId ? ' (current)' : rel ? ` · ${rel}` : ''}
            </option>
          {/each}
        </select>
      {:else}
        <!-- OpenRouter's /models feed carries neither embedding models nor the
             /images/generations namespace, so there is genuinely no list to
             offer. Typed, then validated server-side. -->
        <input
          class="nm-input"
          type="text"
          placeholder="vendor/model-slug"
          bind:value={typed}
          disabled={saving}
          aria-label="Model slug"
        />
      {/if}

      <button class="nm-save-btn" onclick={submit} disabled={saving || !(choice || typed.trim())}>
        {saving ? 'Saving…' : 'Save'}
      </button>

      {#if !isSiteDefault && workload!.scope === 'site' && workload!.setModelId}
        <button class="nm-link-btn" onclick={() => save(null)} disabled={saving}>
          clear pin
        </button>
      {/if}
      <button class="nm-link-btn" onclick={() => { open = false; err = null; }} disabled={saving}>
        cancel
      </button>

      {#if !isSiteDefault && workload!.scope === 'hermes'}
        <span class="sw-note">Applied with a gateway restart.</span>
      {/if}
      {#if err}<span class="sw-err">{err}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .sw-panel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
  }
  .sw-panel :global(.nm-select) {
    min-width: 22rem;
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
  .sw-note,
  .sw-err {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
  }
  .sw-note {
    color: var(--text-ghost);
  }
  .sw-err {
    color: var(--error);
  }
</style>
