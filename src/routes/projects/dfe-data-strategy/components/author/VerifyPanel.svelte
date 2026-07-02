<script lang="ts">
  import { author } from '../../lib/author/authorState.svelte';
  import { app } from '../../lib/appState.svelte';
  import { POSTURE_AXES } from '../../lib/postures';
  import { htmlToMarkdown } from '../../lib/author/serialize';
  import { HEURISTIC_LABELS } from '../../lib/author/heuristics';
  import GapList from './GapList.svelte';
  import CoverageMatrix from './CoverageMatrix.svelte';

  let running = $state(false);
  let statusMsg = $state('');
  let errorMsg = $state('');

  const cov = $derived(author.coverage);
  const covPct = $derived(Math.round(cov.score * 100));
  const heurRows = $derived(
    author.doc.sections.map((s) => ({
      id: s.id,
      title: s.title,
      words: author.wordCounts[s.id] ?? 0,
      checks: author.heuristicsBySection[s.id] ?? [],
    })),
  );
  const heurPassRate = $derived.by(() => {
    const withText = heurRows.filter((r) => r.words > 0);
    const all = withText.flatMap((r) => r.checks);
    return all.length ? Math.round((all.filter((c) => c.pass).length / all.length) * 100) : 0;
  });

  function postureSummary(): string {
    return POSTURE_AXES.map((ax) => {
      const v = app.state.postures[ax.id] ?? 0;
      const lean = Math.abs(v) < 0.12 ? 'balanced' : `${Math.round(Math.abs(v) * 100)}% toward ${v < 0 ? ax.leftLabel : ax.rightLabel}`;
      return `${ax.leftLabel}↔${ax.rightLabel}: ${lean}`;
    }).join('; ');
  }

  async function runDeepReview(focus?: string) {
    if (running) return;
    running = true;
    errorMsg = '';
    statusMsg = 'Starting the review…';
    try {
      const res = await fetch('/projects/dfe-data-strategy/author/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: author.doc.title,
          focus: focus ?? null,
          scenario: { name: app.scenarioName, postures: postureSummary() },
          sections: author.doc.sections.map((s) => ({
            id: s.id,
            templateId: s.templateId,
            title: s.title,
            text: htmlToMarkdown(s.html),
          })),
        }),
      });
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => '')) || `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let ticks = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let msg: any;
          try {
            msg = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (msg.type === 'status') statusMsg = msg.message;
          else if (msg.type === 'tick') {
            ticks++;
            if (ticks % 12 === 0) statusMsg = `Reviewing… (${ticks} thoughts in)`;
          } else if (msg.type === 'result') {
            author.review = { at: Date.now(), sections: msg.data.sections, document: msg.data.document };
          } else if (msg.type === 'error') errorMsg = msg.message;
        }
      }
      if (!author.review && !errorMsg) errorMsg = 'The review returned nothing — try again.';
    } catch (e: any) {
      errorMsg = (e?.message ?? 'review failed').slice(0, 200);
    } finally {
      running = false;
      statusMsg = '';
    }
  }

  const score = (n: number) => (n >= 76 ? 'good' : n >= 56 ? 'fair' : n >= 31 ? 'weak' : 'bad');
  let openSection = $state<string | null>(null);
</script>

<div class="vp">
  <div class="strip">
    <div class="stat">
      <b class={covPct >= 60 ? 'g' : covPct >= 30 ? 'a' : 'r'}>{author.totalWords ? `${covPct}%` : '—'}</b>
      <span>ledger coverage<br />(deterministic sweep)</span>
    </div>
    <div class="stat">
      <b class={cov.statutoryGaps.length === 0 ? 'g' : 'r'}>{author.totalWords ? cov.statutoryGaps.length : '—'}</b>
      <span>statutory obligations<br />unaddressed</span>
    </div>
    <div class="stat">
      <b class={heurPassRate >= 70 ? 'g' : heurPassRate >= 40 ? 'a' : 'r'}>{author.totalWords ? `${heurPassRate}%` : '—'}</b>
      <span>completeness checks<br />passing</span>
    </div>
    <div class="stat">
      <b class={author.review ? score(author.review.document.score) === 'good' ? 'g' : score(author.review.document.score) === 'fair' ? 'a' : 'r' : ''}>
        {author.review ? `${author.review.document.score}` : '—'}
      </b>
      <span>deep review score<br />{author.review ? `run ${new Date(author.review.at).toLocaleDateString('en-GB')}` : 'not yet run'}</span>
    </div>
    <div class="run">
      <button class="deep" disabled={running || author.totalWords === 0} onclick={() => runDeepReview()}>
        {running ? '◌ Reviewing…' : author.review ? '↻ Re-run deep review' : '✦ Run the deep review'}
      </button>
      <p class="run-note">{running ? statusMsg : 'The model reviews every section against the rubric, the must-answer commitments and your declared posture.'}</p>
      {#if errorMsg}<p class="err">{errorMsg}</p>{/if}
    </div>
  </div>

  {#if author.review}
    <section class="rev">
      <h3 class="vp-h">The deep review</h3>
      <p class="verdict">{author.review.document.verdict}</p>
      {#if author.review.document.topFixes.length}
        <ol class="fixes">
          {#each author.review.document.topFixes as f, i}
            <li><b>Fix {i + 1}.</b> {f}</li>
          {/each}
        </ol>
      {/if}
      <div class="rev-cols">
        {#if author.review.document.contradictions.length}
          <div class="rc">
            <h4>Contradictions</h4>
            <ul>
              {#each author.review.document.contradictions as c}<li>{c}</li>{/each}
            </ul>
          </div>
        {/if}
        {#if author.review.document.missingComponents.length}
          <div class="rc">
            <h4>Missing components</h4>
            <ul>
              {#each author.review.document.missingComponents as m}<li>{m}</li>{/each}
            </ul>
          </div>
        {/if}
      </div>
      <div class="secscores">
        {#each author.review.sections as rs (rs.id)}
          {@const sec = author.doc.sections.find((s) => s.id === rs.id)}
          {#if sec}
            <button class="ss" class:open={openSection === rs.id} onclick={() => (openSection = openSection === rs.id ? null : rs.id)}>
              <span class="ss-t">{sec.title}</span>
              <span class="ss-bar"><i class={score(rs.score)} style="width:{rs.score}%"></i></span>
              <span class="ss-n {score(rs.score)}">{rs.score}</span>
            </button>
            {#if openSection === rs.id}
              <div class="ss-detail">
                <p class="ss-v">{rs.verdict}</p>
                {#if rs.strengths.length}<p class="ss-l"><b>Strengths:</b> {rs.strengths.join(' · ')}</p>{/if}
                {#if rs.weaknesses.length}<p class="ss-l"><b>Weaknesses:</b> {rs.weaknesses.join(' · ')}</p>{/if}
                {#if rs.suggestions.length}
                  <ul class="ss-sugg">
                    {#each rs.suggestions as sg}<li>{sg}</li>{/each}
                  </ul>
                {/if}
              </div>
            {/if}
          {/if}
        {/each}
      </div>
    </section>
  {/if}

  <div class="two">
    <section>
      <h3 class="vp-h">Gaps — what the draft doesn't answer</h3>
      <GapList />
    </section>
    <section>
      <h3 class="vp-h">Completeness checks, section by section</h3>
      {#if author.totalWords === 0}
        <p class="empty">Write something first.</p>
      {:else}
        <div class="heur-wrap">
          <table class="heur">
            <thead>
              <tr>
                <th></th>
                {#each Object.values(HEURISTIC_LABELS) as h}<th>{h.label}</th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each heurRows as r (r.id)}
                <tr class:mute={r.words === 0}>
                  <th>{r.title}</th>
                  {#each Object.keys(HEURISTIC_LABELS) as hid}
                    {@const chk = r.checks.find((c) => c.id === hid)}
                    <td title={chk?.note ?? 'not applicable to this section'}>
                      {#if r.words === 0}<span class="na">·</span>
                      {:else if !chk}<span class="na">—</span>
                      {:else}<span class={chk.pass ? 'ok' : 'no'}>{chk.pass ? '✓' : '✕'}</span>{/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  </div>

  <section>
    <h3 class="vp-h">The coverage matrix — commitments × sections</h3>
    <CoverageMatrix />
  </section>
</div>

<style>
  .vp {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .vp-h {
    margin: 0 0 10px;
    font-family: 'Fraunces', serif;
    font-size: 17px;
    font-weight: 600;
    color: var(--ink);
  }
  .strip {
    display: grid;
    grid-template-columns: repeat(4, auto) 1fr;
    gap: 14px 26px;
    align-items: center;
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.5);
    padding: 14px 20px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .stat b {
    font-family: 'Fraunces', serif;
    font-size: 30px;
    font-weight: 600;
    line-height: 1;
    color: var(--ink);
  }
  .stat b.g {
    color: #2f6155;
  }
  .stat b.a {
    color: #b07d2b;
  }
  .stat b.r {
    color: #b04a2f;
  }
  .stat span {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.55);
    line-height: 1.4;
  }
  .run {
    justify-self: end;
    text-align: right;
    max-width: 320px;
  }
  .deep {
    font-family: 'DM Sans', sans-serif;
    font-size: 13.5px;
    font-weight: 600;
    padding: 10px 18px;
    background: var(--accent-ink);
    color: #fff;
    border: none;
    border-radius: var(--radius-pill, 99px);
    cursor: pointer;
  }
  .deep:hover:not(:disabled) {
    background: var(--accent-ink-hover, #6d2430);
  }
  .deep:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .run-note {
    margin: 6px 0 0;
    font-size: 10.5px;
    line-height: 1.45;
    color: rgba(28, 22, 17, 0.55);
  }
  .err {
    margin: 5px 0 0;
    font-size: 11px;
    color: var(--error, #a33);
  }

  .rev {
    border: 1px solid var(--accent-ink-tint-35);
    border-left: 4px solid var(--accent-ink);
    border-radius: var(--radius-round);
    background: var(--accent-ink-tint-06);
    padding: 14px 18px;
  }
  .verdict {
    margin: 0 0 10px;
    font-family: 'Fraunces', serif;
    font-size: 16.5px;
    line-height: 1.45;
    color: var(--ink);
    max-width: 90ch;
  }
  .fixes {
    margin: 0 0 12px;
    padding-left: 18px;
  }
  .fixes li {
    font-size: 13px;
    line-height: 1.55;
    margin-bottom: 5px;
    color: rgba(28, 22, 17, 0.8);
  }
  .rev-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-bottom: 12px;
  }
  .rc h4 {
    margin: 0 0 5px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #b04a2f;
  }
  .rc ul {
    margin: 0;
    padding-left: 16px;
  }
  .rc li {
    font-size: 12px;
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.72);
    margin-bottom: 4px;
  }
  .secscores {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .ss {
    display: grid;
    grid-template-columns: 220px 1fr 34px;
    align-items: center;
    gap: 12px;
    background: rgba(255, 255, 255, 0.55);
    border: 1px solid rgba(28, 22, 17, 0.12);
    border-radius: var(--radius-round);
    padding: 6px 12px;
    cursor: pointer;
    text-align: left;
  }
  .ss:hover {
    border-color: rgba(28, 22, 17, 0.3);
  }
  .ss-t {
    font-family: 'DM Sans', sans-serif;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ss-bar {
    height: 8px;
    background: rgba(28, 22, 17, 0.08);
    border-radius: var(--radius-pill, 99px);
    overflow: hidden;
  }
  .ss-bar i {
    display: block;
    height: 100%;
    border-radius: inherit;
  }
  .ss-bar i.good {
    background: #2f6155;
  }
  .ss-bar i.fair {
    background: #b07d2b;
  }
  .ss-bar i.weak {
    background: #b04a2f;
  }
  .ss-bar i.bad {
    background: rgba(28, 22, 17, 0.35);
  }
  .ss-n {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 600;
    text-align: right;
  }
  .ss-n.good {
    color: #2f6155;
  }
  .ss-n.fair {
    color: #b07d2b;
  }
  .ss-n.weak,
  .ss-n.bad {
    color: #b04a2f;
  }
  .ss-detail {
    margin: 2px 0 8px;
    padding: 9px 14px;
    border-left: 3px solid var(--accent-ink-tint-35);
    background: rgba(255, 255, 255, 0.5);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
  }
  .ss-v {
    margin: 0 0 6px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--ink);
  }
  .ss-l {
    margin: 0 0 4px;
    font-size: 11.5px;
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.7);
  }
  .ss-sugg {
    margin: 4px 0 0;
    padding-left: 16px;
  }
  .ss-sugg li {
    font-size: 11.5px;
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.72);
    margin-bottom: 3px;
  }

  .two {
    display: grid;
    grid-template-columns: 1.1fr 0.9fr;
    gap: 20px;
    align-items: start;
  }
  .empty {
    margin: 0;
    font-size: 12.5px;
    color: rgba(28, 22, 17, 0.6);
  }
  .heur-wrap {
    overflow-x: auto;
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.45);
  }
  .heur {
    border-collapse: collapse;
    width: 100%;
  }
  .heur thead th {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.5);
    padding: 7px 6px;
    border-bottom: 1px solid rgba(28, 22, 17, 0.12);
  }
  .heur tbody th {
    text-align: left;
    font-family: 'DM Sans', sans-serif;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--ink);
    padding: 5px 10px;
    max-width: 210px;
  }
  .heur td {
    text-align: center;
    padding: 4px 6px;
  }
  .heur tr.mute th,
  .heur tr.mute td {
    opacity: 0.4;
  }
  .ok {
    color: #2f6155;
    font-weight: 600;
  }
  .no {
    color: #b04a2f;
    font-weight: 600;
  }
  .na {
    color: rgba(28, 22, 17, 0.3);
  }
  @media (max-width: 1000px) {
    .strip {
      grid-template-columns: repeat(2, 1fr);
    }
    .run {
      grid-column: 1 / -1;
      justify-self: start;
      text-align: left;
    }
    .two,
    .rev-cols {
      grid-template-columns: 1fr;
    }
    .ss {
      grid-template-columns: 130px 1fr 30px;
    }
  }
</style>
