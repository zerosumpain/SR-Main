<svelte:head><title>App — Admin</title></svelte:head>
<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import { LANE_LABEL, appLabel } from '$lib/access/device-rows';
  import { STALE_DAYS } from '$lib/access/fleet';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const CHANNEL: Record<string, string> = { testflight: 'TestFlight', adhoc: 'Ad-hoc copy', xcode: 'Xcode' };

  function when(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function ago(iso: string | null | undefined): string {
    if (!iso) return 'never';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return 'just now';
    if (s < 90 * 60) return `${Math.round(s / 60)} min ago`;
    if (s < 36 * 3600) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  }

  const personHref = (email: string) => `/admin/access/${encodeURIComponent(email)}`;
  const totals = $derived(data.fleet.totals);
</script>

<PageWrap>
  <PageHeader
    kicker="Access"
    title="App"
    sub="Every phone the household runs the app on: what it is running, when it was last heard from, and which build the family's phones are offered. A phone is connected, and signed out, from its person's page."
  />

  {#if form && 'error' in form && form.error}<p class="result-bad" role="alert">{form.error}</p>{/if}
  {#each data.warnings as w}<p class="nm-sec-error">{w}</p>{/each}

  <section class="nm-sec" data-section="pipeline">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Builds</span>
      {#if data.pipeline.running}<span class="nm-pill" data-state="connected">building</span>{/if}
    </div>
    <div class="strip">
      <div class="stat">
        <span class="sr-label-tight">Newest build</span>
        {#if data.pipeline.latest === undefined}
          <span class="result-bad">GitHub could not be read</span>
        {:else if data.pipeline.latest}
          <span class="big mono">{data.pipeline.latest.build}</span>
          <span class="muted">{data.pipeline.latest.commit.slice(0, 8)} · {when(data.pipeline.latest.at)}</span>
        {:else}
          <span class="muted">none yet</span>
        {/if}
      </div>
      <div class="stat">
        <span class="sr-label-tight">Released to the family</span>
        {#if data.pipeline.copy === undefined}
          <span class="result-bad">could not be read</span>
        {:else if data.pipeline.copy}
          <span class="big mono">{data.pipeline.copy.version}</span>
          <span class="muted">built {when(data.pipeline.copy.builtAt)} · installs on {data.pipeline.copy.devices.length} {data.pipeline.copy.devices.length === 1 ? 'phone' : 'phones'}</span>
        {:else}
          <span class="muted">none built yet</span>
        {/if}
      </div>
      <div class="stat">
        <span class="sr-label-tight">Phones</span>
        <span class="big mono">{totals.phones}</span>
        <span class="muted">
          {totals.behind} behind · {totals.stale} quiet {STALE_DAYS}+ days · {totals.noPush} without push · {totals.notInCopy} not in the copy
        </span>
      </div>
    </div>
    {#if form && 'adhocError' in form && form.adhocError}<p class="result-bad" role="alert">{form.adhocError}</p>{/if}
    {#if form && 'adhocStarted' in form && form.adhocStarted}<p class="muted" role="status">Building a copy for {form.adhocStarted}. About half an hour.</p>{/if}
    <details class="manual">
      <summary>Build a fresh ad-hoc copy — with a UDID read off a computer, or just the newest app</summary>
      <form method="POST" action="?/adhocBuild" use:enhance class="add-row">
        <input class="nm-text-input" name="name" placeholder="Rory's iPhone" maxlength="50" aria-label="Phone name" />
        <input class="nm-text-input mono" name="udid" placeholder="00008110-001A2C3E0E12801E" aria-label="UDID" />
        <button class="nm-btn-ghost">Build a copy</button>
      </form>
      <p class="muted">
        Leave the UDID empty to rebuild the newest app for the phones already listed. A phone that cannot use TestFlight
        is normally enrolled from its person's page (Connect a phone → No TestFlight) and installs at
        <a href={data.pipeline.appUrl}>{data.pipeline.appUrl}</a>.
      </p>
    </details>
  </section>

  <section class="nm-sec" data-section="releases" id="releases">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Releases</span>
      {#if data.releases.offered}<span class="nm-pill" data-state="connected">family on {data.releases.offered}</span>{/if}
    </div>
    <p class="muted">
      The family's phones (the ad-hoc copy) are offered only the build released here — at /app, on the install page, and by
      the app's hourly "a new version is ready". A newer build waits while you try it on TestFlight. Releasing an older build
      rolls back new installs; a phone already on a later build is not asked to go back.
    </p>
    {#if data.releases.testflight}
      <p class="muted">
        Your TestFlight: build <span class="mono">{data.releases.testflight.build}</span>
        {#if data.releases.testflight.branch && data.releases.testflight.branch !== 'main'}from the branch <span class="mono">{data.releases.testflight.branch}</span> — not releasable until it is merged{/if}
        · {when(data.releases.testflight.at)}
      </p>
    {/if}
    {#if form && 'releaseError' in form && form.releaseError}<p class="result-bad" role="alert">{form.releaseError}</p>{/if}
    {#if form && 'released' in form && form.released}<p class="ok" role="status">Build {form.released} is released. Phones see it within the hour.</p>{/if}
    {#if !data.releases.readable}
      <p class="result-bad">GitHub could not be read, so the builds cannot be listed. The family keep the build they were offered.</p>
    {:else if data.releases.builds.length === 0}
      <p class="muted">No ad-hoc copy has been built yet.</p>
    {:else}
      {#if data.releases.release && !data.releases.offered}
        <p class="result-bad">Build {data.releases.release.build} is released but GitHub no longer holds it — release one of these.</p>
      {/if}
      <div class="table-wrap">
        <table class="fleet">
          <thead><tr><th>Build</th><th>Commit</th><th>Built</th><th>Phones</th><th>State</th><th></th></tr></thead>
          <tbody>
            {#each data.releases.builds as b (b.run)}
              <tr data-state={b.state}>
                <td data-label="Build" class="mono">{b.version}</td>
                <td data-label="Commit" class="mono">
                  {#if b.commit}<a class="row-link" href="{data.releases.repo}/commit/{b.commit}">{b.commit.slice(0, 8)}</a>{:else}—{/if}
                </td>
                <td data-label="Built" class="mono">{when(b.builtAt)}</td>
                <td data-label="Phones" class="mono">{b.devices ?? '—'}</td>
                <td data-label="State">
                  {#if b.state === 'released'}<span class="ok">released</span>
                  {:else if b.state === 'waiting'}<span class="waiting">waiting for you</span>
                  {:else}<span class="muted">older</span>{/if}
                </td>
                <td>
                  {#if b.state !== 'released'}
                    <form
                      method="POST"
                      action="?/release"
                      class="inline"
                      use:enhance={({ cancel }) => {
                        const verb = b.state === 'waiting' ? 'Release' : 'Roll back to';
                        if (!confirm(`${verb} build ${b.run} for the family's phones?`)) cancel();
                      }}
                    >
                      <input type="hidden" name="build" value={b.run} />
                      <button class="nm-btn-ghost" type="submit">{b.state === 'waiting' ? 'Release' : 'Roll back'}</button>
                    </form>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {#if data.releases.release?.history.length}
      <details class="manual">
        <summary>Release history</summary>
        <ul class="enrolled">
          {#each data.releases.release.history as h, i (i)}
            <li>
              <span class="mono">{when(h.at)}</span>
              <span>{h.kind === 'pinned' ? 'Pinned' : h.kind === 'rollback' ? 'Rolled back to' : 'Released'} build <span class="mono">{h.build}</span></span>
              <span class="muted">{h.by ?? 'by the site, when releases began'}</span>
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </section>

  {#if data.fleet.people.length === 0}
    <section class="nm-sec"><p class="muted">No phones yet. Connect one from a person's page under <a href="/admin/access">People</a>.</p></section>
  {/if}

  {#each data.fleet.people as person (person.email)}
    <section class="nm-sec" data-section="person">
      <div class="nm-sec-hd">
        <a class="sr-label-tight person-link" href={personHref(person.email)}>{person.person}</a>
        <span class="nm-pill" data-state={person.phones.length ? 'connected' : 'disconnected'}>
          {person.phones.length} {person.phones.length === 1 ? 'phone' : 'phones'}
        </span>
        {#if data.lastFix[person.email]}
          {@const fix = data.lastFix[person.email]}
          <span class="muted fix">last fix {ago(fix.at)}{fix.batteryPct !== null ? ` · ${fix.batteryPct}% battery` : ''}</span>
        {/if}
      </div>

      {#if person.phones.length}
        <div class="table-wrap">
          <table class="fleet">
            <thead>
              <tr>
                <th>Phone</th>
                <th>Pairings</th>
                <th>Channel</th>
                <th>App</th>
                <th>iOS</th>
                <th>Last seen</th>
                <th>Last upload</th>
                <th>Push</th>
              </tr>
            </thead>
            <tbody>
              {#each person.phones as phone (phone.key)}
                <tr>
                  <td data-label="Phone"><a class="row-link" href={personHref(person.email)}>{phone.label}</a></td>
                  <td data-label="Pairings">
                    {#each phone.lanes as lane (lane)}<span class="chip lane-{lane}">{LANE_LABEL[lane]}</span>{/each}
                  </td>
                  <td data-label="Channel">{phone.channel ? (CHANNEL[phone.channel] ?? phone.channel) : '—'}</td>
                  <td data-label="App" class="mono">
                    {#if phone.app}
                      {appLabel(phone)}
                      <span class="state" data-build={phone.build}>{phone.build === 'behind' ? 'behind' : phone.build === 'current' ? 'current' : ''}</span>
                    {:else}
                      <span class="muted">—</span>
                    {/if}
                  </td>
                  <td data-label="iOS" class="mono">{phone.os ?? '—'}</td>
                  <td data-label="Last seen" class="mono">{ago(phone.lastSeen)}</td>
                  <td data-label="Last upload" class="mono">{phone.lanes.includes('companion') ? ago(phone.lastUpload) : '—'}</td>
                  <td data-label="Push">{phone.push === null ? '—' : phone.push ? 'yes' : 'no'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if person.enrolments.length}
        <ul class="enrolled">
          {#each person.enrolments as e (e.id)}
            <li>
              <span>Enrolled for the ad-hoc copy: <strong>{e.name}</strong>{e.product ? ` · ${e.product}` : ''}{e.os ? ` · iOS ${e.os}` : ''} · {when(e.enrolledAt)}</span>
              {#if e.inLatestCopy === false}<span class="result-bad">not in the newest copy — rebuild</span>
              {:else if e.inLatestCopy}<span class="ok">in the copy</span>{/if}
              <form method="POST" action="?/forget" use:enhance class="inline">
                <input type="hidden" name="id" value={e.id} />
                <button class="row-link danger" type="submit">Forget</button>
              </form>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
</PageWrap>

<style>
  .muted { margin: 0; font-size: var(--fs-nav); color: var(--text-secondary); }
  .result-bad { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--error); margin: 0 0 0.75rem; }
  .ok { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--success); }
  .mono { font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .strip { display: flex; flex-wrap: wrap; gap: 1.5rem 2.5rem; margin: 0.25rem 0 0.75rem; }
  .stat { display: flex; flex-direction: column; gap: 0.2rem; min-width: 10rem; }
  .big { font-size: var(--fs-h3); color: var(--text-primary); }
  .add-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.8rem; margin-top: 0.8rem; }
  .manual summary { cursor: pointer; font-size: var(--fs-nav); color: var(--text-secondary); margin: 0.5rem 0; }
  .person-link { color: var(--text-primary); text-decoration: none; }
  .person-link:hover { text-decoration: underline; }
  .fix { margin-left: auto; }
  .table-wrap { overflow-x: auto; }
  .fleet { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .fleet th { text-align: left; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary); padding: 0.4rem; border-bottom: 1px solid var(--line-strong); }
  .fleet td { padding: 0.4rem; border-bottom: 1px solid var(--divider); vertical-align: top; }
  .chip { display: inline-block; font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 0.1rem 0.4rem; border: 1px solid var(--line-strong); border-radius: 2px; margin-right: 0.3rem; }
  .state[data-build='behind'] { color: var(--error); margin-left: 0.3rem; }
  .state[data-build='current'] { color: var(--success); margin-left: 0.3rem; }
  .waiting { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); }
  .row-link { background: none; border: none; padding: 0; font: inherit; color: var(--text-primary); text-decoration: underline; cursor: pointer; }
  .row-link.danger { color: var(--error); }
  .enrolled { list-style: none; margin: 0.6rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; }
  .enrolled li { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: baseline; }
  .inline { display: inline; }
</style>
