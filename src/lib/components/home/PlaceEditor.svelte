<script lang="ts">
  /**
   * One place's editor — /home/people/places. The page shows it in the panel
   * beside the map (under it on a phone) for whichever place is selected.
   *
   * Name, kind (not for home: home is home), radius; whether the household
   * hears about a crossing ("Notify family", OFF unless set — home included)
   * and, only once that is on, which directions and whether by WhatsApp too;
   * who spends how long here; and "Remove place" with a confirm (never home).
   *
   * The page owns the geometry draft (the map drags it too), so the radius
   * field reports through `onradius` and "Undo move" through `onrevert`. The
   * page keys this on the place id, so switching place starts it afresh.
   */
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { Geometry } from '$lib/components/home/PlacesMap.svelte';
  import { clampRadius } from '$lib/home/presence/geo';
  import type { PanelPlace } from '$lib/home/presence/places';
  import type { PersonPlaceTime } from '$lib/home/presence/stats';

  type FormResult = {
    error?: string;
    placeId?: string | null;
    saved?: string;
    note?: string;
    moved?: string;
    notified?: string;
  } | null;

  let {
    place,
    draft,
    moved,
    radius,
    labelMax,
    kinds,
    placeTimeDays,
    placeTime,
    form,
    onradius,
    onrevert,
    afterGeometry,
    afterRemove,
  }: {
    place: PanelPlace;
    draft: Geometry;
    moved: boolean;
    radius: { min: number; max: number };
    labelMax: number;
    kinds: readonly string[];
    placeTimeDays: number;
    placeTime: Promise<Record<string, PersonPlaceTime[]> | null>;
    form: FormResult;
    onradius: (radiusM: number) => void;
    onrevert: () => void;
    afterGeometry: SubmitFunction;
    afterRemove: SubmitFunction;
  } = $props();

  /** Whether "Notify family" is ticked. Follows the stored flag, and the box
   *  while it is being changed: the directions and WhatsApp show (and only
   *  matter) while it is on. */
  let notifyOn = $derived(place.alerts);
  /** "Remove place" is asking for a yes. */
  let confirmRemove = $state(false);

  const REMOVE_NOTE = 'Its alerts stop and it will not be suggested again.';
  const error = $derived(form?.error && form.placeId === place.id ? form.error : null);

  function onRadiusInput(e: Event & { currentTarget: HTMLInputElement }) {
    const v = Number(e.currentTarget.value);
    if (Number.isFinite(v) && v >= radius.min && v <= radius.max) onradius(Math.round(v));
  }

  function onRadiusChange(e: Event & { currentTarget: HTMLInputElement }) {
    const r = clampRadius(Number(e.currentTarget.value));
    onradius(r);
    e.currentTarget.value = String(r);
  }

  function submitOnChange(e: Event & { currentTarget: HTMLInputElement }) {
    e.currentTarget.form?.requestSubmit();
  }

  /** The master switch. Off takes WhatsApp with it (WhatsApp rides on an
   *  alert, and the server would otherwise keep alerts on for it); the
   *  directions keep what they were, for the next time it is ticked. On with
   *  both directions off means both: "Notify family" means arrive and leave. */
  function onNotify(e: Event & { currentTarget: HTMLInputElement }) {
    const box = e.currentTarget;
    notifyOn = box.checked;
    const f = box.form;
    if (!f) return;
    const get = (name: string) => f.elements.namedItem(name) as HTMLInputElement | null;
    if (!box.checked) {
      const wa = get('whatsappAlerts');
      if (wa) wa.checked = false;
    } else {
      const arrive = get('alertArrive');
      const leave = get('alertLeave');
      if (arrive && leave && !arrive.checked && !leave.checked) arrive.checked = leave.checked = true;
    }
    f.requestSubmit();
  }

  const keep: SubmitFunction = () => async ({ update }) => {
    await update({ reset: false });
  };

  /** Keyboard focus onto the confirm's safe answer as it appears. */
  function focusOnMount(node: HTMLElement) {
    node.focus();
  }

  /** Minutes as a length of time: 45m, 5h 20m, then whole hours. */
  function dur(mins: number): string {
    if (mins < 60) return `${mins}m`;
    if (mins < 24 * 60) {
      const m = mins % 60;
      return m ? `${Math.floor(mins / 60)}h ${m}m` : `${mins / 60}h`;
    }
    return `${Math.round(mins / 60)}h`;
  }
</script>

<div class="editor">
  <form method="POST" action="?/save" use:enhance={afterGeometry}>
    <input type="hidden" name="placeId" value={place.id} />
    <input type="hidden" name="lat" value={draft.lat} />
    <input type="hidden" name="lon" value={draft.lon} />
    <div class="actions">
      <label class="field">
        <span class="field-label">Name</span>
        <input
          class="text-input"
          name="label"
          value={place.label ?? ''}
          placeholder={place.isHome ? 'home' : ''}
          maxlength={Math.max(labelMax, (place.label ?? '').length)}
          autocomplete="off"
        />
      </label>
      {#if !place.isHome}
        <label class="field kind">
          <span class="field-label">Kind</span>
          <select class="text-input select" name="kind">
            {#if !kinds.includes(place.kind)}<option value={place.kind} selected>not set</option>{/if}
            {#each kinds as k (k)}<option value={k} selected={k === place.kind}>{k}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="field radius">
        <span class="field-label">Radius (m)</span>
        <input
          class="text-input"
          name="radiusM"
          type="number"
          inputmode="numeric"
          min={radius.min}
          max={radius.max}
          step="10"
          value={draft.radiusM}
          oninput={onRadiusInput}
          onchange={onRadiusChange}
          required
        />
      </label>
    </div>
    <div class="card-actions">
      <button class="cta sm" type="submit">Save</button>
      <button class="btn" type="button" onclick={onrevert} disabled={!moved}>Undo move</button>
      {#if form?.saved === place.id}
        <span class="note inline" class:good={!form.note} role="status">{form.note ?? 'Saved.'}</span>
      {/if}
      {#if form?.moved === place.id}<span class="note good inline" role="status">Moved.</span>{/if}
    </div>
  </form>

  <form class="notify" method="POST" action="?/notify" use:enhance={keep}>
    <input type="hidden" name="placeId" value={place.id} />
    <label class="toggle">
      <input type="checkbox" name="alerts" checked={notifyOn} onchange={onNotify} />
      <span>Notify family</span>
    </label>
    <fieldset class="sub" hidden={!notifyOn}>
      <legend class="field-label">When they</legend>
      <label class="toggle">
        <input type="checkbox" name="alertArrive" checked={place.alertArrive} onchange={submitOnChange} />
        <span>arrive</span>
      </label>
      <label class="toggle">
        <input type="checkbox" name="alertLeave" checked={place.alertLeave} onchange={submitOnChange} />
        <span>leave</span>
      </label>
      <label class="toggle">
        <input type="checkbox" name="whatsappAlerts" checked={place.whatsappAlerts} onchange={submitOnChange} />
        <span>also by WhatsApp</span>
      </label>
    </fieldset>
    {#if !notifyOn}<p class="quiet">No notifications. Who is here is still tracked.</p>{/if}
    <noscript><button class="btn" type="submit">Save alerts</button></noscript>
    {#if form?.notified === place.id}<span class="note good inline" role="status">Saved.</span>{/if}
  </form>

  <div class="time-here">
    <p class="field-label">Time here, last {placeTimeDays} days</p>
    {#await placeTime}
      <p class="quiet">Reading the trail…</p>
    {:then byPlace}
      {@const rows = byPlace ? (byPlace[place.id] ?? []) : null}
      {#if rows === null}
        <p class="quiet">The time here could not be worked out just now.</p>
      {:else if !rows.length}
        <p class="quiet">Nobody has stayed here in that time.</p>
      {:else}
        <div class="tbl-wrap">
          <table class="tbl compact">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col" class="right">Time</th>
                <th scope="col" class="right visits">Visits</th>
                <th scope="col" class="right">Arrives</th>
              </tr>
            </thead>
            <tbody>
              {#each rows as r (r.subject)}
                <tr>
                  <td class="cell-lead">{r.displayName}</td>
                  <td class="right num">{dur(r.minutes)}</td>
                  <td class="right num visits">{r.visits}</td>
                  <td class="right num">{r.usualArrival ?? '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/await}
  </div>

  {#if !place.isHome}
    {#if confirmRemove}
      <form class="confirm" method="POST" action="?/remove" use:enhance={afterRemove}>
        <input type="hidden" name="placeId" value={place.id} />
        <p id="remove-{place.id}">Remove <em>{place.label ?? 'this place'}</em>? {REMOVE_NOTE}</p>
        <div class="card-actions">
          <button class="cta sm" type="submit" aria-describedby="remove-{place.id}">Remove</button>
          <button class="btn" type="button" use:focusOnMount onclick={() => (confirmRemove = false)}>Keep</button>
        </div>
      </form>
    {:else}
      <div class="card-actions">
        <button class="btn" type="button" onclick={() => (confirmRemove = true)}>Remove place</button>
      </div>
    {/if}
  {/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}
</div>

<style>
  /* `.text-input`, `.field-label`, `.actions`, `.card-actions`, `.cta`,
     `.btn`, `.note`, `.err`, `.tbl` come from HomeFrame's DsVocab. */
  .editor {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .field {
    display: flex;
    flex-direction: column;
    flex: 1 1 200px;
    min-width: 0;
  }
  .field .field-label {
    margin-bottom: 6px;
  }
  .field.radius {
    flex: 0 1 130px;
  }
  .field.kind {
    flex: 0 1 140px;
  }
  .notify {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 18px;
    margin: 0;
    padding: 0 0 0 26px;
    border: 0;
  }
  .sub[hidden] {
    display: none;
  }
  .sub legend {
    float: left;
    margin-right: 4px;
    padding: 0;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .toggle input {
    accent-color: var(--accent);
    width: 18px;
    height: 18px;
  }
  .inline {
    margin: 0;
  }
  .quiet {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .notify .quiet {
    padding-left: 26px;
  }
  .time-here {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .time-here .field-label {
    margin: 0;
  }
  @media (max-width: 719px) {
    .time-here .visits {
      display: none;
    }
  }
  .confirm {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--warn);
    background: var(--surface-elevated);
  }
  .confirm p {
    margin: 0;
    font-size: var(--fs-body-sm, 0.95rem);
    color: var(--text-primary);
  }
</style>
