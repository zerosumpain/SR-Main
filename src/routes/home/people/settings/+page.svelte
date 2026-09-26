<script lang="ts">
  /**
   * The owner's household settings — /home/people/settings.
   *
   * One card per person: their name, the email they sign in with, where their
   * location comes from (Life360 through Home Assistant, the iPhone app, or
   * nowhere), their WhatsApp number and whether crossings reach them by
   * WhatsApp, and whose movements alert them.
   *
   * A number appears in full only inside its own input; anywhere else on the
   * page it is the last three digits.
   *
   * Owner only; the load and the action both check.
   */
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const members = $derived(data.members);
  const onApp = $derived(members.filter((m) => m.source === 'companion').length);
  const onLife = $derived(members.filter((m) => m.source === 'life360').length);
  const byWhatsApp = $derived(members.filter((m) => m.alerts?.whatsapp && m.whatsapp).length);
  const summary = $derived([
    { label: 'People', value: String(members.length), sub: 'in the household' },
    { label: 'On the app', value: String(onApp), sub: `${onLife} on Life360` },
    { label: 'WhatsApp', value: String(byWhatsApp), sub: 'get messages' },
  ]);

  const SOURCE_LABEL: Record<string, string> = {
    life360: 'Life360 (Home Assistant)',
    companion: 'The iPhone app',
    none: 'Not tracked',
  };

  const SOURCE_SHORT: Record<string, string> = {
    life360: 'Life360',
    companion: 'app',
    none: 'not tracked',
  };

  type Member = PageData['members'][number];

  /** Who this person hears about, in the words of the card's summary line. */
  function alertsLine(m: Member): string {
    const follow = m.alerts?.follow;
    if (follow == null) return 'alerts about everyone';
    if (!follow.length) return 'no alerts';
    const names = follow.map((s) => members.find((o) => o.subject === s)?.displayName ?? s);
    return names.length > 2 ? `alerts about ${names.length} people` : `alerts about ${names.join(' and ')}`;
  }

  /** Which cards are open. All start closed; a save error opens its card. */
  const opened = $state<Record<string, boolean>>({});
  $effect(() => {
    const f = form;
    untrack(() => {
      if (f && 'error' in f && f.error && f.subject) opened[f.subject] = true;
    });
  });

  function masked(n: string | null): string {
    if (!n) return 'no number';
    return `number …${n.replace(/\D/g, '').slice(-3)}`;
  }

  const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
    await update({ reset: false });
  };
</script>

<HomeFrame
  path="/home/people/settings"
  kicker="Home · People · Settings"
  title={['Who is in the', 'household, and how']}
  standfirst="Where each person’s location comes from, and who hears when they arrive or leave."
  {summary}
  footer={['strangeramblings.com/home/people/settings', 'Household members', 'Owner only']}
>
  {#if data.loadError}
    <section class="band"><div class="inner"><LoadErrorCard kicker="The household did not load" message={data.loadError} /></div></section>
  {/if}

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="A / People"
        title={['Each person,', 'one card']}
        strap="App alerts reach people on the app. WhatsApp reaches people with a number and it on, for places with WhatsApp on. Nobody hears about their own movements."
      />

      {#if !members.length}
        <p class="lede">Nobody in the household table.</p>
      {:else}
        <div class="stack people">
          {#each members as m (m.subject)}
            {@const others = members.filter((o) => o.subject !== m.subject)}
            {@const followAll = m.alerts?.follow == null}
            <details class="card person" bind:open={opened[m.subject]}>
              <summary>
                <span class="who">{m.displayName}</span>
                <span class="facts">{SOURCE_SHORT[m.source] ?? m.source} · {masked(m.whatsapp)} · {alertsLine(m)}</span>
              </summary>
            <form method="POST" action="?/save" use:enhance={keep}>
              <input type="hidden" name="subject" value={m.subject} />

              <div class="fields">
                <label class="field">
                  <span class="field-label">Name</span>
                  <input class="text-input" name="displayName" value={m.displayName} maxlength="60" required autocomplete="off" />
                </label>
                <label class="field">
                  <span class="field-label">Email they sign in with</span>
                  <input class="text-input" name="email" type="email" value={m.email ?? ''} autocomplete="off" />
                </label>
                <div class="field">
                  <label class="field-label" for="src-{m.subject}">Location from</label>
                  <select id="src-{m.subject}" class="text-input select" name="source" aria-describedby="src-hint-{m.subject}">
                    {#each data.sources as s (s)}
                      <option value={s} selected={s === m.source}>{SOURCE_LABEL[s] ?? s}</option>
                    {/each}
                  </select>
                  <p class="note hint" id="src-hint-{m.subject}">
                    The app takes their location from their phone only: with sharing off they show as not sharing, never
                    picked up from Life360 instead.
                  </p>
                </div>
                <div class="field">
                  <label class="field-label" for="wa-{m.subject}">WhatsApp number</label>
                  <input
                    id="wa-{m.subject}"
                    class="text-input"
                    name="whatsapp"
                    type="tel"
                    value={m.whatsapp ?? ''}
                    placeholder="07… or +44…"
                    autocomplete="off"
                  />
                  <label class="toggle">
                    <input type="checkbox" name="whatsappOn" checked={m.alerts?.whatsapp === true} />
                    <span>WhatsApp alerts</span>
                  </label>
                </div>
              </div>

              <fieldset class="follow">
                <legend class="field-label">Alerts about</legend>
                <label class="toggle">
                  <input type="checkbox" name="followAll" checked={followAll} />
                  <span>Everyone, including anyone added later</span>
                </label>
                {#each others as o (o.subject)}
                  <label class="toggle">
                    <input
                      type="checkbox"
                      name="follow"
                      value={o.subject}
                      checked={followAll || (m.alerts?.follow ?? []).includes(o.subject)}
                    />
                    <span>{o.displayName}</span>
                  </label>
                {/each}
                <p class="note">With “everyone” off, only the people ticked. None ticked means no alerts at all.</p>
              </fieldset>

              <fieldset class="follow">
                <legend class="field-label">Guardian of</legend>
                {#each others as o (o.subject)}
                  <label class="toggle">
                    <input type="checkbox" name="guardianOf" value={o.subject} checked={(m.guardianOf ?? []).includes(o.subject)} />
                    <span>{o.displayName}</span>
                  </label>
                {/each}
                <p class="note">
                  Their kids. With Family Admin at /admin/access, they see each ticked person's day and journeys as
                  their own. Without it, this does nothing.
                </p>
              </fieldset>

              <div class="card-actions">
                <button class="cta sm" type="submit">Save</button>
                {#if form && 'saved' in form && form.saved === m.subject}<span class="note good inline">Saved.</span>{/if}
              </div>
              {#if form && 'error' in form && form.error && form.subject === m.subject}
                <p class="err" role="alert">{form.error}</p>
              {/if}
            </form>
            </details>
          {/each}
        </div>
      {/if}
      {#if form && 'error' in form && form.error && !form.subject}
        <p class="err" role="alert">{form.error}</p>
      {/if}
    </div>
  </section>
</HomeFrame>

<style>
  /* Room-specific only — `.card`, `.text-input`, `.field-label`, `.actions`,
     `.card-actions`, `.cta`, `.note`, `.err` come from HomeFrame's DsVocab,
     and the input-height fix for a `.field` column from HomeFrame. */
  .stack.people {
    gap: 8px;
  }
  .card.person {
    padding: 0;
  }
  .person > summary {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 8px;
    padding: 14px 20px 14px 44px;
    position: relative;
    cursor: pointer;
    list-style: none;
  }
  .person > summary::-webkit-details-marker {
    display: none;
  }
  .person > summary::before {
    content: '+';
    position: absolute;
    left: 18px;
    top: 13px;
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--accent);
  }
  .person[open] > summary::before {
    content: '−';
  }
  .person > summary:hover .who {
    color: var(--accent);
  }
  .person > summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .who {
    font-family: var(--font-body);
    font-size: var(--fs-body);
    font-weight: 700;
    color: var(--text-primary);
  }
  .hint {
    margin: 6px 0 0;
  }
  .facts {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
    color: var(--text-muted);
    min-width: 0;
  }
  .person > form {
    padding: 4px 20px 18px;
    border-top: 1px solid var(--line-hair);
  }
  /* Name | Email, then Location from | WhatsApp number with its toggle
     directly under the number. One column on a phone. */
  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 18px;
    margin-top: 14px;
    align-items: start;
  }
  .field {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .field .field-label {
    margin-bottom: 6px;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    padding: 6px 0;
  }
  .field .toggle {
    margin-top: 6px;
  }
  .toggle input {
    accent-color: var(--accent);
    width: 18px;
    height: 18px;
  }
  .follow {
    border: 0;
    border-top: 1px solid var(--line-hair);
    margin: 16px 0 0;
    padding: 14px 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
  }
  .follow legend {
    padding: 0;
    float: left;
    width: 100%;
  }
  .follow .note {
    width: 100%;
    margin: 4px 0 0;
  }
  .inline {
    margin: 0;
  }
  @media (max-width: 720px) {
    .fields {
      grid-template-columns: minmax(0, 1fr);
    }
    .person > summary {
      padding: 8px 14px 8px 36px;
      gap: 2px 8px;
    }
    .person > summary::before {
      left: 14px;
      top: 7px;
    }
    .stack.people {
      gap: 6px;
    }
    .facts {
      letter-spacing: 0;
    }
    .person > form {
      padding: 4px 14px 16px;
    }
  }
</style>
