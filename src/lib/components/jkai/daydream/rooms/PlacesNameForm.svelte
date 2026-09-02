<script lang="ts">
  /**
   * Naming ONE place, inline under its row.
   *
   * Opening the form shows a map and asks the geocoder what is there, so the
   * question the owner answers is "is this right?" rather than "where were you
   * on the 14th?". Both halves — the reverse geocode and the visit list —
   * arrive in one round trip, because two requests for one panel is two
   * chances to half-render.
   *
   * A geocoded guess is weaker evidence than the owner's own answer, so it
   * PRE-FILLS and never auto-saves; only a confirmed name is ever quoted back
   * as fact.
   */
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import PlaceMap from '$lib/components/jkai/PlaceMap.svelte';
  import { PLACE_KINDS, cap } from './places-shared';

  interface Visit {
    startedAt: string;
    dwellMins: number;
    subject: string;
    dateLabel: string;
    dayName: string;
    timeLabel: string;
  }
  interface Suggestion {
    name: string | null;
    kind: string | null;
    address: string | null;
  }

  interface Props {
    placeId: string;
    lat: number;
    lon: number;
    radiusM: number;
    /** Dismiss the form — on Cancel, and after a name lands. */
    onclose: () => void;
  }

  let { placeId, lat, lon, radiusM, onclose }: Props = $props();

  let label = $state('');
  let kind = $state('other');
  let suggesting = $state(true);
  let suggestion = $state<Suggestion | null>(null);
  let visits = $state<Visit[]>([]);
  let saving = $state(false);
  let error = $state<string | null>(null);

  // One place per mounted form: the row renders this component only while it is
  // the open one, so mounting IS the "Name it" press and there is nothing to
  // re-key on.
  onMount(() => {
    void lookUp();
  });

  async function lookUp() {
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'suggest_name', placeId }),
      });
      const out = (await res.json().catch(() => ({}))) as {
        suggestion?: Suggestion;
        visits?: Visit[];
      };
      visits = out.visits ?? [];
      if (out.suggestion) {
        suggestion = out.suggestion;
        if (out.suggestion.name) label = out.suggestion.name;
        if (out.suggestion.kind) kind = out.suggestion.kind;
      }
    } catch {
      suggestion = null;
      visits = [];
    } finally {
      suggesting = false;
    }
  }

  async function submitName() {
    if (!label.trim() || saving) return;
    saving = true;
    error = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'name_place', placeId, label, kind }),
      });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        error = out.error ?? 'that did not work';
        return;
      }
      await invalidateAll();
      onclose();
    } catch {
      error = 'that did not work';
    } finally {
      saving = false;
    }
  }
</script>

<div class="detail wide">
  <PlaceMap {lat} {lon} {radiusM} />
  <p class="note">
    {#if suggesting}
      Looking up what is there…
    {:else if suggestion?.address}
      {suggestion.address}
      {#if suggestion.name}<span class="dim"> · suggested, check it</span>{/if}
    {:else}
      No address found for this spot — the map is the better guide.
    {/if}
  </p>

  {#if visits.length}
    <div class="detail-block">
      <p class="field-label">Who was here, and when</p>
      <div class="tbl-wrap boxed">
        <table class="tbl compact">
          <thead>
            <tr>
              <th>Who</th>
              <th>Day</th>
              <th>Date</th>
              <th class="right">At</th>
              <th class="right">Stayed</th>
            </tr>
          </thead>
          <tbody>
            {#each visits as v (v.startedAt + v.subject)}
              <tr>
                <td>{cap(v.subject)}</td>
                <td>{v.dayName}</td>
                <td>{v.dateLabel}</td>
                <td class="right">{v.timeLabel}</td>
                <td class="right">{v.dwellMins} min</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  {#if error}<p class="err">{error}</p>{/if}

  <div class="row-controls">
    <input
      class="text-input"
      bind:value={label}
      placeholder="What is it called?"
      onkeydown={(e) => {
        if (e.key === 'Enter') void submitName();
      }}
    />
    <select class="text-input select" bind:value={kind}>
      {#each PLACE_KINDS as k (k)}<option value={k}>{k}</option>{/each}
    </select>
    <button type="button" class="cta" disabled={saving || !label.trim()} onclick={() => void submitName()}>
      {saving ? 'Saving…' : 'Save'}
    </button>
    <button type="button" class="btn" onclick={onclose}>Cancel</button>
  </div>
</div>

<style>
  /* `.detail` is the shared vocabulary; `.wide` is the one thing this needs on
     top of it — the row it opens under is a flex container, so the panel has to
     claim a whole line of its own rather than sit beside the controls. */
  .wide {
    flex-basis: 100%;
    width: 100%;
  }
  .row-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  }
  /* The vocabulary's `.tbl-wrap` scrolls; a table nested inside a card also
     wants an edge, or it reads as part of the card's own body. */
  .boxed {
    border: 1px solid var(--card-border);
    margin-top: 14px;
  }
</style>
