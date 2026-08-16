<script lang="ts">
  // QueryExplorer — the drill-down anatomy of one federated ask: the signed
  // query itself, the per-estate partial responses, and what actually lands
  // back at the DfE. Pure presentation over a deterministic QueryRun.
  import { basisLabel, type QueryRun, type PartialStatus } from '$lib/sim/federation/queries';

  let { run }: { run: QueryRun } = $props();

  const q = $derived(run.query);
  const a = $derived(run.assembled);

  const STATUS_META: Record<PartialStatus, { label: string; cls: string }> = {
    answered: { label: 'answered', cls: 'ok' },
    'opted-out': { label: 'opted out', cls: 'no' },
    'must-answer': { label: 'objected · must answer', cls: 'warn' },
  };

  const fmt = (n: number) => n.toLocaleString('en-GB');
</script>

<div class="qx">
  <!-- STAGE 1 · THE QUERY -->
  <section class="qx-stage">
    <header>
      <span class="qx-n">1</span>
      <div>
        <span class="qx-lab">The query — what actually travels</span>
        <p class="qx-note">Not a form, not an extract request: a signed contract carrying the executable question and its legal basis.</p>
      </div>
      <span class="basis {q.basis}">{basisLabel(q.basis)}</span>
    </header>
    <dl class="qx-contract">
      <dt>Question</dt><dd>{q.question}</dd>
      <dt>Requester</dt><dd>{q.requester}</dd>
      <dt>Basis</dt><dd>{q.instrument}</dd>
      <dt>Aggregation</dt><dd>{q.aggregation}</dd>
      <dt>Retention</dt><dd>{q.retention}</dd>
    </dl>
    <pre class="qx-sql"><code>{q.queryBody}</code></pre>
  </section>

  <!-- STAGE 2 · THE PARTIALS -->
  <section class="qx-stage">
    <header>
      <span class="qx-n">2</span>
      <div>
        <span class="qx-lab">The partials — each estate answers for itself</span>
        <p class="qx-note">
          {q.needsEdtech
            ? 'The signal holders here are edtech platforms: each aggregates inside its own estate, under per-platform pseudonyms.'
            : 'Every gateway computes locally, suppresses small cells at source, and returns only its parcel of aggregates.'}
        </p>
      </div>
    </header>
    <div class="qx-tablewrap">
      <table>
        <thead>
          <tr>
            <th>{q.needsEdtech ? 'Platform' : 'Supplier'}</th>
            <th class="num">{q.needsEdtech ? 'Schools reached' : 'Schools'}</th>
            <th>Gateway decision</th>
            <th class="num">Value returned</th>
            <th class="num">Cells suppressed</th>
            <th class="num">Payload</th>
          </tr>
        </thead>
        <tbody>
          {#each run.partials as p (p.supplierId)}
            <tr class:dim={p.status === 'opted-out'}>
              <td class="sup">{p.supplierLabel}</td>
              <td class="num">{fmt(p.schools)}</td>
              <td><span class="st {STATUS_META[p.status].cls}">{STATUS_META[p.status].label}</span></td>
              <td class="num">{p.status === 'opted-out' ? '—' : fmt(p.value)}</td>
              <td class="num">{p.status === 'opted-out' ? '—' : fmt(p.suppressedCells)}</td>
              <td class="num">{p.status === 'opted-out' ? '—' : `${fmt(p.payloadKB)} KB`}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <!-- STAGE 3 · THE RETURN -->
  <section class="qx-stage">
    <header>
      <span class="qx-n">3</span>
      <div>
        <span class="qx-lab">The return — what lands at the DfE</span>
        <p class="qx-note">Aggregates and a coverage statement. The records themselves never left their estates.</p>
      </div>
    </header>
    <div class="qx-return">
      <div class="qx-head-nums">
        <div class="hn">
          <b>{fmt(a.totalValue)}</b>
          <span>{q.unit}</span>
        </div>
        <div class="hn">
          <b>{a.coveragePct}%</b>
          <span>coverage · {fmt(a.schoolsCovered)} schools</span>
        </div>
        <div class="hn">
          <b>{fmt(a.suppressedCells)}</b>
          <span>small cells suppressed at source</span>
        </div>
        <div class="hn zero">
          <b>0</b>
          <span>pupil-level rows moved</span>
        </div>
      </div>
      <div class="qx-covbar" role="img" aria-label="Coverage {a.coveragePct}%">
        <i style="width:{Math.min(a.coveragePct, 100)}%"></i>
      </div>
      {#if a.partial}
        <p class="qx-flag partial">Answer labelled <b>PARTIAL</b> — {a.optedOut.join(', ')} declined this voluntary ask, and the answer says so on its face.</p>
      {/if}
      {#if a.overridden.length}
        <p class="qx-flag override">Objection{a.overridden.length > 1 ? 's' : ''} from <b>{a.overridden.join(', ')}</b> noted and overridden — the basis is statutory, so the gateway must answer. The objection itself is now on the ledger.</p>
      {/if}
      <ul class="qx-notes">
        {#each q.returnNotes as note}
          <li>{note}</li>
        {/each}
      </ul>
    </div>
  </section>
</div>

<style>
  .qx { display: flex; flex-direction: column; gap: 14px; }
  .qx-stage { border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 16px 18px; }
  .qx-stage header { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
  .qx-n { flex: 0 0 auto; width: 26px; height: 26px; display: grid; place-content: center; background: var(--ink); color: var(--paper, #f1ead6); border-radius: var(--radius-pill); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .qx-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent-ink); }
  .qx-note { margin: 3px 0 0; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.65); max-width: 70ch; }
  .basis { margin-left: auto; flex: 0 0 auto; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em; padding: 4px 10px; border-radius: var(--radius-sharp); color: #fff; }
  .basis.statutory { background: var(--accent-ink); }
  .basis.voluntary { background: #b0892a; }

  .qx-contract { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 3px 12px; margin: 0 0 12px; }
  .qx-contract dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); padding-top: 2px; }
  .qx-contract dd { margin: 0; font-size: var(--fs-label); line-height: 1.45; color: rgba(28,22,17,0.82); }

  .qx-sql { margin: 0; background: #1c1611; border-radius: var(--radius-sharp); padding: 14px 16px; overflow-x: auto; }
  .qx-sql code { font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.6; color: #e8dcc3; white-space: pre; }

  .qx-tablewrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: var(--fs-label-xs); }
  th { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); text-align: left; padding: 4px 8px; border-bottom: 1px solid rgba(28,22,17,0.2); }
  td { padding: 5px 8px; border-bottom: 1px solid rgba(28,22,17,0.08); color: rgba(28,22,17,0.82); }
  tr.dim td { color: rgba(28,22,17,0.4); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .sup { font-weight: 600; color: var(--ink); }
  tr.dim .sup { color: rgba(28,22,17,0.45); }
  .st { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.05em; padding: 2px 7px; border-radius: var(--radius-pill); white-space: nowrap; }
  .st.ok { background: rgba(47,125,79,0.12); color: #2f7d4f; }
  .st.no { background: rgba(138,45,58,0.12); color: #8a2d3a; }
  .st.warn { background: rgba(176,137,42,0.14); color: #8a6a1e; }

  .qx-head-nums { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 10px; }
  .hn b { display: block; font-family: var(--fs-serif); font-weight: 600; font-size: clamp(22px, 2.4vw, 34px); line-height: 1.05; color: var(--ink); letter-spacing: -0.02em; }
  .hn span { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .hn.zero b { color: var(--accent, #c4570a); }

  .qx-covbar { height: 8px; border-radius: var(--radius-pill); background: rgba(28,22,17,0.1); overflow: hidden; margin-bottom: 10px; }
  .qx-covbar i { display: block; height: 100%; background: var(--accent-ink); border-radius: var(--radius-pill); transition: width 0.4s ease; }

  .qx-flag { font-size: var(--fs-label); line-height: 1.5; border-radius: var(--radius-sharp); padding: 8px 12px; margin: 0 0 8px; }
  .qx-flag.partial { background: rgba(138,45,58,0.07); border: 1px solid rgba(138,45,58,0.3); color: rgba(28,22,17,0.8); }
  .qx-flag.override { background: rgba(176,137,42,0.08); border: 1px solid rgba(176,137,42,0.35); color: rgba(28,22,17,0.8); }

  .qx-notes { margin: 6px 0 0; padding-left: 18px; }
  .qx-notes li { font-size: var(--fs-label); line-height: 1.6; color: rgba(28,22,17,0.72); margin-bottom: 2px; }
</style>
