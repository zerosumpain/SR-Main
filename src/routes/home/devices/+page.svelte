<script lang="ts">
  // Is the house's Home Assistant working: every integration graded by its
  // config entry's state and how much of it is unavailable, worst first, and
  // every battery HA can see, lowest first. Read live on each load.
  import type { PageData } from './$types';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import { ago } from '$lib/daydream/format';
  import type { Verdict } from '$lib/home/devices';

  let { data }: { data: PageData } = $props();
  const d = $derived(data.devices);

  const VERDICT: Record<Verdict, { label: string; tone: string }> = {
    down: { label: 'Down', tone: 't-urgent' },
    degraded: { label: 'Degraded', tone: 't-watch' },
    watch: { label: 'Partly', tone: 't-steady' },
    ok: { label: 'Working', tone: 't-good' },
    off: { label: 'Disabled', tone: 't-quiet' },
  };
  /** HA's config-entry states, said plainly. */
  function stateLabel(state: string): string {
    if (state === 'loaded') return 'running';
    if (state === 'setup_retry') return 'retrying setup';
    if (state === 'setup_error') return 'setup failed';
    return state.replace(/_/g, ' ');
  }

  const LOW_BATTERY = 20;
  const low = $derived(d.batteries.filter((b) => b.level <= LOW_BATTERY));
  const attention = $derived(d.counts.down + d.counts.degraded);

  const summary = $derived([
    { label: 'Down', value: String(d.counts.down), sub: d.counts.down ? 'integrations' : 'none' },
    { label: 'Degraded', value: String(d.counts.degraded), sub: 'a quarter or more unavailable' },
    { label: 'Low battery', value: String(low.length), sub: `at or under ${LOW_BATTERY}%` },
  ]);
</script>

<HomeFrame
  path="/home/devices"
  kicker="Home · Devices"
  title={['Is the house', 'working?']}
  standfirst="Every Home Assistant integration, graded by whether it is running and how much of it answers, worst first — and every battery HA can see. Read live each time the page loads."
  {summary}
  footer={['strangeramblings.com/home/devices', `Read from Home Assistant ${ago(data.readAt)}`, 'Owner-gated']}
>
  {#if data.loadError}
    <section class="band"><div class="inner"><LoadErrorCard kicker="Home Assistant could not be read" message={data.loadError} /></div></section>
  {/if}

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="A / Integrations"
        title={attention ? ['What needs', 'looking at'] : ['Everything is', 'answering']}
        strap="Down means the integration itself is not running, or none of its entities answer. Degraded is a quarter or more unavailable. An Alexa alarm or timer sensor reads unavailable whenever nothing is set, so those are not counted."
      />
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr><th>Integration</th><th>Status</th><th>Setup</th><th class="right">Unavailable</th><th>Last change</th></tr>
          </thead>
          <tbody>
            {#each d.integrations as i (i.id)}
              <tr class:dim={i.verdict === 'off'}>
                <td class="lead">
                  {i.label}
                  {#if i.title}<span class="sub">{i.title}</span>{/if}
                  {#if i.unavailableNames.length && i.verdict !== 'ok'}
                    <span class="sub">{i.unavailableNames.join(' · ')}{i.unavailable > i.unavailableNames.length ? ' …' : ''}</span>
                  {/if}
                </td>
                <td class="nowrap"><span class="pill {VERDICT[i.verdict].tone}">{VERDICT[i.verdict].label}</span></td>
                <td class="nowrap">{stateLabel(i.state)}</td>
                <td class="right num">{i.unavailable} / {i.entities}</td>
                <td class="nowrap">{i.lastChangeAt ? ago(i.lastChangeAt) : '—'}</td>
              </tr>
            {:else}
              <tr><td colspan="5">No integrations came back.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="band sunken">
    <div class="inner">
      <SectionHead
        kicker="B / Batteries"
        title={['What will', 'go flat']}
        strap="Every battery level Home Assistant reports — phones through Life360, the doorbell, sensors — lowest first. A zero can mean a dead battery or a device that has stopped reporting one."
      />
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Device</th><th class="right">Battery</th></tr></thead>
          <tbody>
            {#each d.batteries as b (b.entityId)}
              <tr>
                <td class="lead">{b.name}</td>
                <td class="right num" class:bad={b.level <= LOW_BATTERY}>{b.level}%</td>
              </tr>
            {:else}
              <tr><td colspan="2">No battery levels reported.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </section>
</HomeFrame>

<style>
  .sub {
    display: block;
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
</style>
