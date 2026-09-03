<script lang="ts">
  /**
   * The naming session — thirty places in ten minutes, rather than four
   * notifications a day for a week.
   *
   * The interruption budget in `deliver.ts` exists to protect attention the
   * owner has not offered; a page they chose to open is attention they have,
   * so the session spends none of it.
   *
   * Every row arrives pre-filled from `suggestedLabel`, which the background
   * geocoder wrote hours ago. That is the difference between a confirmation
   * and a memory test: "Costa Coffee, 12 High Row — yes?" is answerable on a
   * phone, and a lat/lon is not.
   *
   * The queue is fetched ON DEMAND: this component is mounted by the "Name
   * them in one go" press and by nothing else, so mounting is the request. It
   * is deliberately NOT part of the room's server load — sixty rows with a
   * reverse-geocode each is not a cost every arrival at /places should pay.
   */
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { PLACE_KINDS } from './places-shared';

  interface QueuePlace {
    id: string;
    visitCount: number;
    medianDwellMins: number;
    rhythm: string;
    lastSeenAt: string | null;
    suggestedLabel: string | null;
    suggestedKind: string | null;
    suggestedAddress: string | null;
  }

  interface Props {
    /** How many to pull. The endpoint clamps to 200. */
    limit?: number;
  }

  let { limit = 60 }: Props = $props();

  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let queue = $state<QueuePlace[]>([]);
  let busy = $state<string | null>(null);
  /** placeId → what the owner has typed. Absent means untouched, so a row the
   *  owner never looked at is never saved with a machine's guess in it. */
  let drafts = $state<Record<string, { label: string; kind: string }>>({});
  let done = $state<{ named: number; failed: number; thoughtsResolved: number } | null>(null);

  const draftCount = $derived(Object.values(drafts).filter((d) => d.label.trim().length > 0).length);

  onMount(() => {
    void loadQueue();
  });

  async function loadQueue() {
    loading = true;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'naming_queue', limit }),
      });
      const out = (await res.json().catch(() => ({}))) as { places?: QueuePlace[]; error?: string };
      if (out.error) throw new Error(out.error);
      queue = out.places ?? [];
      drafts = {};
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      queue = [];
    } finally {
      loading = false;
    }
  }

  /** Accept the suggestion as-is. The commonest action, so it is one tap and
   *  the row stays editable afterwards. */
  function acceptSuggestion(p: QueuePlace) {
    if (!p.suggestedLabel) return;
    drafts = { ...drafts, [p.id]: { label: p.suggestedLabel, kind: p.suggestedKind ?? 'other' } };
  }

  function editDraft(p: QueuePlace, field: 'label' | 'kind', value: string) {
    const current = drafts[p.id] ?? { label: '', kind: p.suggestedKind ?? 'other' };
    drafts = { ...drafts, [p.id]: { ...current, [field]: value } };
  }

  function clearDraft(id: string) {
    const { [id]: _dropped, ...rest } = drafts;
    drafts = rest;
  }

  async function ignorePlace(id: string) {
    busy = `ignore:${id}`;
    error = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'ignore_place', placeId: id }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        error = out.error ?? 'that did not work';
        return;
      }
      // Out of the queue as well as out of the ledger: "never ask" that leaves
      // the row sitting there is indistinguishable from a press that missed.
      queue = queue.filter((q) => q.id !== id);
      clearDraft(id);
      await invalidateAll();
    } catch {
      error = 'that did not work';
    } finally {
      busy = null;
    }
  }

  async function saveSession() {
    const payload = Object.entries(drafts)
      .filter(([, d]) => d.label.trim().length > 0)
      .map(([placeId, d]) => ({ placeId, label: d.label.trim(), kind: d.kind }));
    if (payload.length === 0) return;

    saving = true;
    error = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'name_places', places: payload }),
      });
      const out = (await res.json().catch(() => ({}))) as {
        named?: number;
        failed?: { placeId: string; error: string }[];
        thoughtsResolved?: number;
        error?: string;
      };
      if (out.error) throw new Error(out.error);
      done = {
        named: out.named ?? 0,
        failed: (out.failed ?? []).length,
        thoughtsResolved: out.thoughtsResolved ?? 0,
      };
      // Drop the rows that landed, so a partial failure leaves exactly the
      // unsaved answers on screen rather than making the owner retype them.
      const savedIds = new Set(payload.map((x) => x.placeId));
      for (const f of out.failed ?? []) savedIds.delete(f.placeId);
      queue = queue.filter((q) => !savedIds.has(q.id));
      const remaining: Record<string, { label: string; kind: string }> = {};
      for (const [k, v] of Object.entries(drafts)) if (!savedIds.has(k)) remaining[k] = v;
      drafts = remaining;
      await invalidateAll();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<div class="session-bar">
  <p class="field-label">The session</p>
  <div class="session-controls">
    {#if draftCount}
      <button type="button" class="cta" disabled={saving} onclick={() => void saveSession()}>
        {saving ? 'Saving…' : `Save ${draftCount} name${draftCount === 1 ? '' : 's'}`}
      </button>
    {/if}
    <span class="dim session-count">
      {#if loading}
        loading the queue…
      {:else}
        {queue.length} in the queue{draftCount ? ` · ${draftCount} answered` : ''}
      {/if}
    </span>
  </div>
</div>

{#if done}
  <p class="note good">
    Named {done.named}{done.failed ? `, ${done.failed} failed` : ''}.
    {#if done.thoughtsResolved}
      Closed {done.thoughtsResolved} open question{done.thoughtsResolved === 1 ? '' : 's'}.
    {/if}
  </p>
{/if}
{#if error}<p class="err">{error}</p>{/if}

{#if loading}
  <p class="lede">Loading the queue…</p>
{:else if queue.length === 0}
  <p class="lede">Nothing left unnamed.</p>
{:else}
  <div class="stack tight">
    {#each queue as q (q.id)}
      {@const draft = drafts[q.id]}
      <div class="card t-{draft && draft.label.trim() ? 'good' : 'action'} row">
        <div class="row-id">
          <p class="card-kicker">{q.rhythm}</p>
          {#if q.suggestedAddress}
            <p class="card-body sm">{q.suggestedAddress}</p>
          {:else}
            <p class="card-body sm dim">no address found for this spot</p>
          {/if}
        </div>
        <div class="row-controls">
          {#if !draft && q.suggestedLabel}
            <button type="button" class="cta" onclick={() => acceptSuggestion(q)}>
              {q.suggestedLabel}{q.suggestedKind ? ` · ${q.suggestedKind}` : ''}
            </button>
            <button type="button" class="btn" onclick={() => editDraft(q, 'label', '')}>Something else</button>
          {:else}
            <input
              class="text-input"
              value={draft?.label ?? ''}
              placeholder={q.suggestedLabel ?? 'What is it called?'}
              oninput={(e) => editDraft(q, 'label', e.currentTarget.value)}
            />
            <select
              class="text-input select"
              value={draft?.kind ?? q.suggestedKind ?? 'other'}
              onchange={(e) => editDraft(q, 'kind', e.currentTarget.value)}
            >
              {#each PLACE_KINDS as k (k)}<option value={k}>{k}</option>{/each}
            </select>
            {#if draft}
              <button type="button" class="btn" onclick={() => clearDraft(q.id)}>Skip</button>
            {/if}
          {/if}
          <button
            type="button"
            class="btn danger"
            disabled={busy === `ignore:${q.id}`}
            onclick={() => void ignorePlace(q.id)}
          >Never ask</button>
        </div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .session-bar {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding: 16px 0 18px;
    border-top: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
    margin-bottom: 20px;
  }
  .session-controls {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    min-width: 0;
  }
  .session-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
  }
  .row-id {
    min-width: 0;
    flex: 1 1 320px;
  }
  .row-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }
</style>
