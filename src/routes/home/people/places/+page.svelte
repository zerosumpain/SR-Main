<script lang="ts">
  /**
   * The owner's places panel — /home/people/places.
   *
   * Which places raise an arrive/leave alert for the household, which of those
   * also go by WhatsApp, what each is called and how wide its edge is. Home is
   * always watched, flag or no flag. A radius set here is pinned: the nightly
   * places refresh no longer re-derives it.
   *
   * Owner only; the load and the action both check.
   */
  import { enhance } from '$app/forms';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const places = $derived(data.places);
  const watched = $derived(places.filter((p) => p.alerts || p.isHome).length);
  const byWhatsApp = $derived(places.filter((p) => p.whatsappAlerts).length);
  const summary = $derived([
    { label: 'Places', value: String(places.length), sub: 'named, plus home' },
    { label: 'Alerting', value: String(watched), sub: 'home always' },
    { label: 'WhatsApp', value: String(byWhatsApp), sub: 'also sent by message' },
  ]);

  function kindLabel(kind: string): string {
    return kind === 'unknown' ? 'kind not set' : kind;
  }

  const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
    await update({ reset: false });
  };
</script>

<HomeFrame
  path="/home/people/places"
  kicker="Home · People · Places"
  title={['Where an arrival', 'is worth a message']}
  standfirst="The places that tell the household when someone arrives or leaves. Home always does. A place with WhatsApp on also sends a message to anyone who has asked for them, at most one every half hour per person and place."
  {summary}
  footer={['strangeramblings.com/home/people/places', 'Arrive and leave alerts', 'Owner only']}
>
  {#if data.loadError}
    <section class="band"><div class="inner"><LoadErrorCard kicker="The places did not load" message={data.loadError} /></div></section>
  {/if}

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="A / Places"
        title={['Named places,', 'and home']}
        strap="Someone arrives on the first fix inside the radius and leaves on the first one more than 50 m outside it. Set the radius from 50 to 2,000 m."
      />

      {#if !places.length}
        <p class="lede">No named places yet. Name them from the daydream naming queue and they appear here.</p>
      {:else}
        <div class="stack">
          {#each places as p (p.id)}
            <form class="card place" method="POST" action="?/save" use:enhance={keep}>
              <input type="hidden" name="placeId" value={p.id} />
              <p class="card-kicker">
                {p.isHome ? 'home' : kindLabel(p.kind)} · {p.visitCount} visits{#if p.radiusPinned} · radius set by you{/if}
              </p>
              <div class="actions">
                <label class="field">
                  <span class="field-label">Name</span>
                  <input
                    class="text-input"
                    name="label"
                    value={p.label ?? ''}
                    placeholder={p.isHome ? 'home' : ''}
                    maxlength="200"
                    autocomplete="off"
                  />
                </label>
                <label class="field radius">
                  <span class="field-label">Radius (m)</span>
                  <input
                    class="text-input"
                    name="radiusM"
                    type="number"
                    inputmode="numeric"
                    min={data.radius.min}
                    max={data.radius.max}
                    step="10"
                    value={Math.round(p.radiusM)}
                    required
                  />
                </label>
              </div>
              <div class="card-actions">
                <label class="toggle">
                  <input type="checkbox" name="alerts" checked={p.alerts || p.isHome} disabled={p.isHome} />
                  <span>Alerts{#if p.isHome} (always, for home){/if}</span>
                </label>
                <label class="toggle">
                  <input type="checkbox" name="whatsappAlerts" checked={p.whatsappAlerts} />
                  <span>WhatsApp too</span>
                </label>
                <button class="cta sm" type="submit">Save</button>
                {#if form && 'saved' in form && form.saved === p.id}<span class="note good inline">Saved.</span>{/if}
              </div>
              {#if form && 'error' in form && form.error && form.placeId === p.id}
                <p class="err" role="alert">{form.error}</p>
              {/if}
            </form>
          {/each}
        </div>
      {/if}
      {#if form && 'error' in form && form.error && !form.placeId}
        <p class="err" role="alert">{form.error}</p>
      {/if}
    </div>
  </section>
</HomeFrame>

<style>
  /* Room-specific only — `.card`, `.text-input`, `.field-label`, `.actions`,
     `.card-actions`, `.cta`, `.note`, `.err` come from HomeFrame's DsVocab. */
  .field {
    display: flex;
    flex-direction: column;
    flex: 1 1 220px;
    min-width: 0;
  }
  .field .field-label {
    margin-bottom: 6px;
  }
  .field.radius {
    flex: 0 1 140px;
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
</style>
