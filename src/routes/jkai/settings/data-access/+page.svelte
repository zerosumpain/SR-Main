<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();

  const consumers = ['jkai', 'daydream', 'briefing', 'workflow', 'intel', 'mcp'];

  function allowed(connectionId: string, consumer: string): number {
    return data.grants.filter((grant) =>
      grant.connectionId === connectionId && grant.consumer === consumer && grant.allowed,
    ).length;
  }

  function total(connectionId: string, consumer: string): number {
    return data.grants.filter((grant) =>
      grant.connectionId === connectionId && grant.consumer === consumer,
    ).length;
  }
</script>

<svelte:head><title>Data access — JKAI</title></svelte:head>

<main class="access-shell">
  <a class="back" href="/jkai/sources">← Sources</a>
  <header>
    <p class="eyebrow">JKAI · Personal data</p>
    <h1>Data access</h1>
    <p>Every source has separate permissions for each consumer and data class. A connection-level change takes effect before background cleanup.</p>
  </header>

  <section>
    <div class="section-head">
      <div><p class="section-code">A / Access matrix</p><h2>{data.connections.length} source{data.connections.length === 1 ? '' : 's'}</h2></div>
      <p>Allowed classes / available classes</p>
    </div>
    {#if data.connections.length === 0}
      <div class="empty"><p>No source permissions yet.</p><a href="/jkai/sources">Open the source catalogue →</a></div>
    {:else}
      <div class="matrix-wrap">
        <div class="matrix">
          <div class="head"><span>Source</span>{#each consumers as consumer}<span>{consumer}</span>{/each}</div>
          {#each data.connections as connection (connection.id)}
            <a class="row" href="/jkai/sources/connections/{connection.id}">
              <span><strong>{connection.label}</strong><small>{connection.provider}</small></span>
              {#each consumers as consumer (consumer)}
                {@const on = allowed(connection.id, consumer)}
                {@const count = total(connection.id, consumer)}
                <span class:some={on > 0} class:all={count > 0 && on === count}>{on} / {count}</span>
              {/each}
            </a>
          {/each}
        </div>
      </div>
    {/if}
  </section>

  <section class="rules">
    <p class="section-code">B / Standing rules</p>
    <ul>
      <li><strong>Raw content is independent.</strong><span>Allowing activity metadata never grants post, comment or search text.</span></li>
      <li><strong>Location is independent.</strong><span>Precise location cannot be implied by another source permission.</span></li>
      <li><strong>Unknown stays unknown.</strong><span>A private, stale or snapshot-only source never becomes zero activity.</span></li>
      <li><strong>Delete means derived data too.</strong><span>Disconnect queues credential, event and projection erasure.</span></li>
    </ul>
  </section>
</main>

<style>
  .access-shell { width: min(1060px, calc(100% - 32px)); margin: 0 auto; padding: 38px 0 80px; color: var(--text-primary); }
  .back { display: inline-block; margin-bottom: 34px; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label); text-decoration: none; }
  header { padding-bottom: 28px; border-bottom: 2px solid var(--line-strong); }
  .eyebrow, .section-code { margin: 0 0 8px; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: .12em; text-transform: uppercase; }
  h1 { margin: 0; font-family: var(--font-display); font-size: clamp(42px, 7vw, 72px); font-weight: 500; line-height: 1; }
  header > p:last-child { max-width: 720px; margin: 12px 0 0; color: var(--text-muted); line-height: 1.55; }
  section { padding: 30px 0; border-bottom: 1px solid var(--line-strong); }
  .section-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
  h2 { margin: 0; font-family: var(--font-display); font-size: 30px; font-weight: 500; }
  .section-head > p { margin: 0; color: var(--text-ghost); font-size: var(--fs-label-xs); }
  .matrix-wrap { overflow-x: auto; }
  .matrix { min-width: 830px; border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  .head, .row { display: grid; grid-template-columns: minmax(190px, 1fr) repeat(6, 95px); color: inherit; text-decoration: none; }
  .head span, .row > span { padding: 10px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .head span { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .row > span { display: grid; place-items: center; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .row > span:first-child { place-items: start; gap: 3px; font-family: var(--font-body); }
  .row strong { color: var(--text-primary); font-size: var(--fs-label); }
  .row small { color: var(--text-ghost); text-transform: uppercase; }
  .row > span.some { color: var(--warn, #b0892a); }
  .row > span.all { color: var(--success, #2d7a3a); }
  .row:hover strong { color: var(--accent, #c4570a); }
  .empty { padding: 18px; border: 1px dashed var(--line-strong); }
  .empty p { margin: 0 0 7px; }
  .empty a { color: var(--accent, #c4570a); font-size: var(--fs-label); }
  .rules ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, 1fr); border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  .rules li { display: grid; gap: 5px; padding: 15px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .rules strong { font-size: var(--fs-label); }
  .rules span { color: var(--text-muted); font-size: var(--fs-label-xs); line-height: 1.5; }
  @media (max-width: 650px) {
    .access-shell { width: min(100% - 20px, 1060px); }
    .section-head { align-items: flex-start; flex-direction: column; }
    .rules ul { grid-template-columns: 1fr; }
  }
</style>
