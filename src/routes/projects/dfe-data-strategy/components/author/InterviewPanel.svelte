<script lang="ts">
  import { onMount } from 'svelte';
  import { author } from '../../lib/author/authorState.svelte';
  import { markdownToHtml } from '../../lib/author/serialize';
  import {
    DEPTHS,
    LENGTHS,
    PAGE_WORDS,
    SKELETONS,
    questionsForDepth,
    type DepthId,
    type LengthId,
    type InterviewAnswer,
    type InterviewQuestion,
  } from '../../lib/author/interview';

  // The interview: the workspace asks the questions, the lead answers through UI
  // (with free text everywhere), and the generator writes the full strategy —
  // 3 question depths × 3 document lengths = nine different documents.

  type Phase = 'setup' | 'questions' | 'review' | 'generating' | 'done';
  interface SectionResult {
    id: string;
    templateId: string | null;
    title: string;
    targetWords: number;
    markdown: string;
    words: number;
    status: 'pending' | 'writing' | 'done' | 'failed';
  }
  interface Outline {
    title: string;
    arc: string;
    shifts: string[];
    briefs: Record<string, string>;
  }

  const STORE_KEY = 'keystone-interview-v1';

  let phase = $state<Phase>('setup');
  let depth = $state<DepthId>('standard');
  let length = $state<LengthId>('working');
  let answers = $state<Record<string, InterviewAnswer>>({});
  let qi = $state(0);
  let outline = $state<Outline | null>(null);
  let results = $state<SectionResult[]>([]);
  let genError = $state('');
  let loadedMsg = $state('');
  let mounted = $state(false);

  const questions = $derived(questionsForDepth(depth));
  const q = $derived(questions[qi] as InterviewQuestion | undefined);
  const answeredCount = $derived(questions.filter((x) => isAnswered(x)).length);
  const totalWords = $derived(results.reduce((a, r) => a + (r.status === 'done' ? r.words : 0), 0));
  const donePages = $derived(Math.max(1, Math.round((totalWords / PAGE_WORDS) * 10) / 10));
  const failedCount = $derived(results.filter((r) => r.status === 'failed').length);
  const skeleton = $derived(SKELETONS[length]);
  const estWords = $derived(skeleton.reduce((a, s) => a + s.words, 0));

  function ans(id: string): InterviewAnswer {
    if (!answers[id]) answers[id] = { id };
    return answers[id];
  }
  function isAnswered(x: InterviewQuestion): boolean {
    const a = answers[x.id];
    if (!a) return false;
    if (x.kind === 'scale') return typeof a.value === 'number';
    if (x.kind === 'text') return !!a.text?.trim();
    return !!a.optionIds?.length || !!a.text?.trim();
  }
  function pickSingle(x: InterviewQuestion, optId: string) {
    const a = ans(x.id);
    a.optionIds = a.optionIds?.[0] === optId ? [] : [optId];
  }
  function pickMulti(x: InterviewQuestion, optId: string) {
    const a = ans(x.id);
    const cur = a.optionIds ?? [];
    a.optionIds = cur.includes(optId) ? cur.filter((o) => o !== optId) : [...cur, optId];
  }

  // ---- persistence ----
  onMount(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.depth) depth = p.depth;
        if (p?.length) length = p.length;
        if (p?.answers && typeof p.answers === 'object') answers = p.answers;
        if (Array.isArray(p?.results) && p.results.length && p.results.every((r: any) => r?.status !== 'writing')) {
          results = p.results;
          outline = p.outline ?? null;
          if (p.phase === 'done') phase = 'done';
          else if (p.phase === 'questions' || p.phase === 'review') phase = p.phase;
        } else if (p?.phase === 'questions' || p?.phase === 'review') {
          phase = p.phase;
        }
      }
    } catch {
      /* fresh start */
    }
    mounted = true;
  });
  $effect(() => {
    if (!mounted) return;
    const snapshot = JSON.stringify({
      phase,
      depth,
      length,
      answers: $state.snapshot(answers),
      outline: $state.snapshot(outline),
      results: $state.snapshot(results),
    });
    try {
      localStorage.setItem(STORE_KEY, snapshot);
    } catch {
      /* quota */
    }
  });

  // ---- generation ----
  async function post(body: Record<string, unknown>): Promise<any> {
    const res = await fetch('/projects/dfe-data-strategy/author/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.text().catch(() => '')).slice(0, 160) || `HTTP ${res.status}`);
    return res.json();
  }
  const answerList = () => Object.values($state.snapshot(answers));

  async function generateSection(i: number) {
    const s = results[i];
    results[i] = { ...s, status: 'writing' };
    try {
      const r = await post({ mode: 'section', depth, length, answers: answerList(), outline, sectionId: s.id });
      results[i] = { ...s, status: 'done', markdown: String(r.markdown ?? ''), words: Number(r.words) || 0 };
    } catch {
      // one quiet retry — long runs shouldn't die on a blip
      try {
        const r = await post({ mode: 'section', depth, length, answers: answerList(), outline, sectionId: s.id });
        results[i] = { ...s, status: 'done', markdown: String(r.markdown ?? ''), words: Number(r.words) || 0 };
      } catch (e: any) {
        results[i] = { ...s, status: 'failed' };
      }
    }
  }

  async function runGeneration() {
    genError = '';
    loadedMsg = '';
    phase = 'generating';
    results = skeleton.map((s) => ({ id: s.id, templateId: s.templateId, title: s.title, targetWords: s.words, markdown: '', words: 0, status: 'pending' as const }));
    try {
      outline = await post({ mode: 'outline', depth, length, answers: answerList() });
    } catch (e: any) {
      outline = { title: 'DfE data strategy', arc: '', shifts: [], briefs: {} };
    }
    for (let i = 0; i < results.length; i++) {
      if (phase !== 'generating') return; // user bailed
      await generateSection(i);
    }
    phase = 'done';
  }

  async function regenerate(i: number) {
    await generateSection(i);
    if (phase === 'generating') phase = 'done';
  }

  // ---- outputs ----
  function assembleMarkdown(): string {
    const head = `# ${outline?.title ?? 'DfE data strategy'}\n\n_A working draft generated in the Keystone workspace, ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Decision-support material, not an official strategy._\n`;
    const body = results
      .filter((r) => r.status === 'done')
      .map((r) => `\n## ${r.title}\n\n${r.markdown}`)
      .join('\n');
    return head + body;
  }
  function loadIntoDraft() {
    const ok = author.importDoc({
      title: outline?.title ?? 'DfE data strategy — generated draft',
      sections: results
        .filter((r) => r.status === 'done')
        .map((r) => ({ id: r.id, templateId: r.templateId, title: r.title, html: markdownToHtml(r.markdown) })),
      updatedAt: Date.now(),
    });
    if (ok) {
      loadedMsg = 'Loaded — it is now the working draft in ✎ Draft, with all the checks live.';
      author.setTab('draft');
    } else {
      loadedMsg = 'Nothing to load yet — no sections have finished.';
    }
  }
  function downloadMd() {
    const blob = new Blob([assembleMarkdown()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dfe-data-strategy-generated.md';
    a.click();
    URL.revokeObjectURL(url);
  }
  async function downloadDocx() {
    try {
      const res = await fetch('/projects/dfe-data-strategy/synth?export=docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: assembleMarkdown(), title: outline?.title ?? 'DfE data strategy' }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dfe-data-strategy-generated.docx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      downloadMd();
    }
  }
  function startAgain(keepAnswers: boolean) {
    phase = keepAnswers ? 'review' : 'setup';
    if (!keepAnswers) {
      answers = {};
      qi = 0;
    }
    results = [];
    outline = null;
    genError = '';
    loadedMsg = '';
  }
</script>

<div class="iv">
  {#if phase === 'setup'}
    <div class="setup">
      <p class="iv-intro">The workspace asks, you answer — through the options or in your own words — and a full strategy is written from what you said. Three question depths × three document lengths: <b>nine different strategies</b>, each downloadable as a Word document or loaded straight into the Draft tab.</p>
      <span class="set-lab">1 · How many questions?</span>
      <div class="cardrow">
        {#each DEPTHS as d}
          <button class="pick" class:on={depth === d.id} onclick={() => (depth = d.id)}>
            <b>{d.label}</b>
            <i>{questionsForDepth(d.id).length} questions</i>
            <span>{d.blurb}</span>
          </button>
        {/each}
      </div>
      <span class="set-lab">2 · How long a strategy?</span>
      <div class="cardrow">
        {#each LENGTHS as l}
          <button class="pick" class:on={length === l.id} onclick={() => (length = l.id)}>
            <b>{l.label}</b>
            <i>{l.pages} · {SKELETONS[l.id].length} sections</i>
            <span>{l.blurb}</span>
          </button>
        {/each}
      </div>
      <div class="set-go">
        <button class="pe-next" onclick={() => { qi = 0; phase = 'questions'; }}>Start the interview →</button>
        <span class="set-note">~{Math.round(estWords / PAGE_WORDS)} pages · {questions.length} questions · every question skippable</span>
      </div>
    </div>
  {:else if phase === 'questions' && q}
    <div class="qs">
      <div class="q-top">
        <span class="q-prog">Question {qi + 1} of {questions.length} · {q.topic}</span>
        <span class="q-bar"><i style="width:{((qi + 1) / questions.length) * 100}%"></i></span>
        <button class="q-skipall" onclick={() => (phase = 'review')}>Skip to review →</button>
      </div>
      <h3 class="q-text">{q.text}</h3>
      {#if q.hint}<p class="q-hint">{q.hint}</p>{/if}

      {#if q.kind === 'single' || q.kind === 'multi'}
        <div class="opts">
          {#each q.options ?? [] as o (o.id)}
            {@const on = (answers[q.id]?.optionIds ?? []).includes(o.id)}
            <button class="opt" class:on onclick={() => (q.kind === 'single' ? pickSingle(q, o.id) : pickMulti(q, o.id))} aria-pressed={on}>
              <span class="o-mark">{q.kind === 'multi' ? (on ? '✓' : '+') : on ? '●' : '○'}</span>
              <span class="o-body">
                <b>{o.label}</b>
                {#if o.detail}<span>{o.detail}</span>{/if}
              </span>
            </button>
          {/each}
        </div>
        {#if q.kind === 'multi' && q.pick}<p class="q-pick">Pick up to {q.pick} — {(answers[q.id]?.optionIds ?? []).length} chosen.</p>{/if}
      {:else if q.kind === 'scale'}
        <div class="scale">
          <span class="s-side">{q.scale?.left}</span>
          <input
            type="range"
            min="0"
            max="100"
            value={answers[q.id]?.value ?? 50}
            oninput={(e) => (ans(q.id).value = Number((e.target as HTMLInputElement).value))}
            aria-label={q.text}
          />
          <span class="s-side right">{q.scale?.right}</span>
        </div>
        <p class="q-pick">{typeof answers[q.id]?.value === 'number' ? `Set at ${answers[q.id].value}/100.` : 'Move the slider to take a position (or skip to stay silent).'}</p>
      {/if}

      {#if q.kind === 'text'}
        <textarea class="q-free big" rows="5" placeholder="Write freely — this is honoured across the whole document." value={answers[q.id]?.text ?? ''} oninput={(e) => (ans(q.id).text = (e.target as HTMLTextAreaElement).value)}></textarea>
      {:else}
        <textarea class="q-free" rows="2" placeholder="Add anything in your own words (optional)…" value={answers[q.id]?.text ?? ''} oninput={(e) => (ans(q.id).text = (e.target as HTMLTextAreaElement).value)}></textarea>
      {/if}

      <div class="q-nav">
        <button class="q-btn" disabled={qi === 0} onclick={() => (qi = Math.max(0, qi - 1))}>← Back</button>
        {#if qi < questions.length - 1}
          <button class="q-btn primary" onclick={() => (qi += 1)}>{isAnswered(q) ? 'Next →' : 'Skip →'}</button>
        {:else}
          <button class="q-btn primary" onclick={() => (phase = 'review')}>Review answers →</button>
        {/if}
      </div>
    </div>
  {:else if phase === 'review'}
    <div class="rev">
      <h3 class="rev-h">Ready to write: {answeredCount} of {questions.length} answered</h3>
      <p class="rev-sub">A <b>{LENGTHS.find((l) => l.id === length)?.label.toLowerCase()}</b> strategy ({LENGTHS.find((l) => l.id === length)?.pages}, {skeleton.length} sections, ≈{Math.round(estWords / PAGE_WORDS)} pages). Unanswered questions get balanced, evidence-led positions. Generation writes section by section — a few minutes for the full document.</p>
      <ul class="rev-list">
        {#each questions as x (x.id)}
          <li class:blank={!isAnswered(x)}>
            <button class="rev-jump" onclick={() => { qi = questions.indexOf(x); phase = 'questions'; }}>
              <b>{x.topic}</b>
              <span>
                {#if isAnswered(x)}
                  {x.kind === 'scale'
                    ? `${answers[x.id].value}/100`
                    : x.kind === 'text'
                      ? `“${(answers[x.id].text ?? '').slice(0, 70)}${(answers[x.id].text ?? '').length > 70 ? '…' : ''}”`
                      : (answers[x.id].optionIds ?? []).map((o) => x.options?.find((p) => p.id === o)?.label).filter(Boolean).join(' + ')}
                  {#if x.kind !== 'text' && answers[x.id]?.text?.trim()}<i> · + note</i>{/if}
                {:else}
                  — skipped
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
      <div class="rev-go">
        <button class="q-btn" onclick={() => { qi = 0; phase = 'questions'; }}>← Change answers</button>
        <button class="pe-next" onclick={runGeneration}>✦ Write the strategy →</button>
        <button class="q-btn quiet" onclick={() => (phase = 'setup')}>change depth / length</button>
      </div>
    </div>
  {:else if phase === 'generating'}
    <div class="gen">
      <h3 class="rev-h">Writing “{outline?.title ?? '…'}”</h3>
      {#if outline?.arc}<p class="rev-sub arc">{outline.arc}</p>{/if}
      <ul class="gen-list">
        {#each results as r, i (r.id)}
          <li class="g-{r.status}">
            <span class="g-mark">{r.status === 'done' ? '✓' : r.status === 'writing' ? '✎' : r.status === 'failed' ? '✕' : '·'}</span>
            <span class="g-title">{r.title}</span>
            <span class="g-words">{r.status === 'done' ? `${r.words}w` : r.status === 'writing' ? 'writing…' : r.status === 'failed' ? 'failed' : ''}</span>
          </li>
        {/each}
      </ul>
      <p class="gen-note">{results.filter((r) => r.status === 'done').length}/{results.length} sections · {totalWords.toLocaleString()} words so far — leave this tab open.</p>
      <button class="q-btn" onclick={() => (phase = 'done')}>Stop here</button>
    </div>
  {:else}
    <div class="done">
      <div class="done-head">
        <div>
          <h3 class="rev-h">“{outline?.title ?? 'DfE data strategy'}”</h3>
          <p class="rev-sub">{totalWords.toLocaleString()} words ≈ <b>{donePages} pages</b> · {results.filter((r) => r.status === 'done').length}/{results.length} sections{failedCount ? ` · ${failedCount} failed — regenerate below` : ''}</p>
        </div>
        <div class="done-acts">
          <button class="pe-next" onclick={loadIntoDraft}>⇥ Load into Draft</button>
          <button class="q-btn primary" onclick={downloadDocx}>↓ Word (.docx)</button>
          <button class="q-btn" onclick={downloadMd}>↓ Markdown</button>
        </div>
      </div>
      {#if loadedMsg}<p class="done-msg">{loadedMsg}</p>{/if}
      {#if genError}<p class="done-err">{genError}</p>{/if}

      <div class="preview">
        {#each results as r, i (r.id)}
          <section class="pv-sec">
            <div class="pv-head">
              <h4>{r.title}</h4>
              <span class="pv-meta">{r.status === 'done' ? `${r.words}w` : r.status}</span>
              <button class="pv-regen" title="Regenerate this section" onclick={() => regenerate(i)} disabled={r.status === 'writing'}>↻</button>
            </div>
            {#if r.status === 'done'}
              <div class="pv-body">{@html markdownToHtml(r.markdown)}</div>
            {:else if r.status === 'failed'}
              <p class="pv-fail">This section failed to generate — ↻ to retry.</p>
            {:else if r.status === 'writing'}
              <p class="pv-fail">Writing…</p>
            {/if}
          </section>
        {/each}
      </div>

      <div class="done-again">
        <button class="q-btn" onclick={() => startAgain(true)}>↩ Same answers, generate again</button>
        <button class="q-btn quiet" onclick={() => startAgain(false)}>start a fresh interview</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .iv {
    max-width: 940px;
  }
  .iv-intro {
    margin: 0 0 16px;
    font-size: 13.5px;
    line-height: 1.6;
    color: rgba(28, 22, 17, 0.72);
    max-width: 80ch;
  }
  .iv-intro b {
    color: var(--ink);
  }
  .set-lab {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.55);
    margin: 14px 0 7px;
  }
  .cardrow {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 9px;
  }
  .pick {
    display: flex;
    flex-direction: column;
    gap: 3px;
    text-align: left;
    padding: 12px 14px;
    border: 1px solid rgba(28, 22, 17, 0.18);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.5);
    cursor: pointer;
  }
  .pick:hover {
    border-color: rgba(28, 22, 17, 0.45);
  }
  .pick.on {
    border-color: var(--accent-ink);
    background: var(--accent-ink-tint-06);
    box-shadow: inset 0 0 0 1px var(--accent-ink);
  }
  .pick b {
    font-family: 'Fraunces', serif;
    font-size: 15.5px;
    font-weight: 600;
    color: var(--ink);
  }
  .pick i {
    font-style: normal;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    color: var(--accent-ink);
  }
  .pick span {
    font-size: 11.5px;
    line-height: 1.45;
    color: rgba(28, 22, 17, 0.65);
  }
  .set-go {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    margin-top: 18px;
  }
  .set-note {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    color: rgba(28, 22, 17, 0.5);
  }

  .q-top {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
  }
  .q-prog {
    flex: none;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.55);
  }
  .q-bar {
    flex: 1;
    height: 4px;
    border-radius: var(--radius-round);
    background: rgba(28, 22, 17, 0.1);
    overflow: hidden;
  }
  .q-bar i {
    display: block;
    height: 100%;
    background: var(--accent-ink);
  }
  .q-skipall {
    flex: none;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    background: none;
    border: none;
    color: rgba(28, 22, 17, 0.5);
    cursor: pointer;
    text-decoration: underline dashed;
  }
  .q-text {
    margin: 0 0 4px;
    font-family: 'Fraunces', serif;
    font-size: 22px;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.25;
  }
  .q-hint {
    margin: 0 0 12px;
    font-size: 12.5px;
    color: rgba(28, 22, 17, 0.6);
  }
  .opts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
    gap: 8px;
    margin: 12px 0 4px;
  }
  .opt {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    text-align: left;
    padding: 11px 13px;
    border: 1px solid rgba(28, 22, 17, 0.16);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.5);
    cursor: pointer;
  }
  .opt:hover {
    border-color: rgba(28, 22, 17, 0.4);
  }
  .opt.on {
    border-color: var(--accent-ink);
    background: var(--accent-ink-tint-06);
  }
  .o-mark {
    flex: none;
    font-size: 12px;
    color: rgba(28, 22, 17, 0.45);
    margin-top: 1px;
  }
  .opt.on .o-mark {
    color: var(--accent-ink);
    font-weight: 700;
  }
  .o-body b {
    display: block;
    font-family: 'DM Sans', sans-serif;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink);
  }
  .o-body span {
    display: block;
    margin-top: 2px;
    font-size: 11.5px;
    line-height: 1.45;
    color: rgba(28, 22, 17, 0.62);
  }
  .q-pick {
    margin: 4px 0 0;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    color: rgba(28, 22, 17, 0.5);
  }
  .scale {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 18px 0 6px;
  }
  .s-side {
    flex: 0 1 220px;
    font-size: 11.5px;
    line-height: 1.4;
    color: rgba(28, 22, 17, 0.7);
  }
  .s-side.right {
    text-align: right;
  }
  .scale input {
    flex: 1;
    accent-color: var(--accent-ink);
  }
  .q-free {
    display: block;
    width: 100%;
    margin-top: 12px;
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    line-height: 1.5;
    padding: 9px 12px;
    border: 1px solid rgba(28, 22, 17, 0.22);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.65);
    color: var(--ink);
    resize: vertical;
  }
  .q-free.big {
    font-size: 14px;
  }
  .q-nav {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  .q-btn {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    padding: 8px 18px;
    border: 1px solid rgba(28, 22, 17, 0.3);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.6);
    color: var(--ink);
    cursor: pointer;
  }
  .q-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .q-btn.primary {
    background: var(--ink);
    color: var(--paper, #f1ead6);
    border-color: var(--ink);
  }
  .q-btn.quiet {
    border-style: dashed;
    font-size: 11.5px;
    color: rgba(28, 22, 17, 0.6);
  }

  .rev-h {
    margin: 0 0 4px;
    font-family: 'Fraunces', serif;
    font-size: 20px;
    font-weight: 600;
    color: var(--ink);
  }
  .rev-sub {
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.55;
    color: rgba(28, 22, 17, 0.68);
    max-width: 80ch;
  }
  .rev-sub.arc {
    font-style: italic;
  }
  .rev-list {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 6px;
  }
  .rev-jump {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: left;
    padding: 8px 11px;
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.5);
    cursor: pointer;
  }
  .rev-jump:hover {
    border-color: var(--accent-ink);
  }
  .rev-jump b {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.55);
  }
  .rev-jump span {
    font-size: 12px;
    color: var(--ink);
    line-height: 1.4;
  }
  .rev-jump i {
    font-style: normal;
    color: var(--accent-ink);
  }
  .rev-list li.blank .rev-jump span {
    color: rgba(28, 22, 17, 0.45);
  }
  .rev-go {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .gen-list {
    list-style: none;
    margin: 8px 0 10px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 560px;
  }
  .gen-list li {
    display: flex;
    align-items: baseline;
    gap: 9px;
    font-size: 13px;
    padding: 4px 10px;
    border-radius: var(--radius-round);
  }
  .g-mark {
    flex: none;
    width: 14px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: rgba(28, 22, 17, 0.4);
  }
  .g-done .g-mark {
    color: #2f7d4f;
  }
  .g-writing {
    background: var(--accent-ink-tint-06);
  }
  .g-writing .g-mark {
    color: var(--accent-ink);
  }
  .g-failed .g-mark {
    color: #b1455e;
  }
  .g-title {
    color: var(--ink);
  }
  .g-pending .g-title {
    color: rgba(28, 22, 17, 0.45);
  }
  .g-words {
    margin-left: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    color: rgba(28, 22, 17, 0.5);
  }
  .gen-note {
    margin: 0 0 12px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: rgba(28, 22, 17, 0.55);
  }

  .done-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px 18px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .done-acts {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .done-msg {
    margin: 0 0 10px;
    font-size: 12.5px;
    color: #2f6155;
    font-weight: 600;
  }
  .done-err {
    margin: 0 0 10px;
    font-size: 12.5px;
    color: #b1455e;
  }
  .preview {
    border: 1px solid rgba(28, 22, 17, 0.16);
    border-radius: var(--radius-round);
    background: #fdfaf2;
    padding: 6px 22px 18px;
    max-height: 62vh;
    overflow-y: auto;
  }
  .pv-sec {
    border-bottom: 1px dashed rgba(28, 22, 17, 0.15);
    padding: 14px 0 12px;
  }
  .pv-sec:last-child {
    border-bottom: none;
  }
  .pv-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .pv-head h4 {
    margin: 0;
    font-family: 'Fraunces', serif;
    font-size: 17px;
    font-weight: 600;
    color: var(--ink);
  }
  .pv-meta {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    color: rgba(28, 22, 17, 0.45);
  }
  .pv-regen {
    margin-left: auto;
    font-size: 13px;
    background: none;
    border: 1px solid rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-round);
    padding: 1px 9px;
    color: rgba(28, 22, 17, 0.6);
    cursor: pointer;
  }
  .pv-regen:hover {
    color: var(--accent-ink);
    border-color: var(--accent-ink);
  }
  .pv-body {
    font-size: 13.5px;
    line-height: 1.65;
    color: rgba(28, 22, 17, 0.85);
  }
  .pv-body :global(p) {
    margin: 8px 0;
  }
  .pv-body :global(ul),
  .pv-body :global(ol) {
    margin: 8px 0;
    padding-left: 20px;
  }
  .pv-body :global(h3),
  .pv-body :global(h4) {
    margin: 14px 0 4px;
    font-family: 'Fraunces', serif;
    font-size: 14.5px;
    color: var(--ink);
  }
  .pv-fail {
    margin: 8px 0 0;
    font-size: 12px;
    color: rgba(28, 22, 17, 0.5);
    font-style: italic;
  }
  .done-again {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 14px;
  }
  @media (max-width: 760px) {
    .cardrow {
      grid-template-columns: 1fr;
    }
    .scale {
      flex-direction: column;
      align-items: stretch;
    }
    .s-side.right {
      text-align: left;
    }
  }
</style>
