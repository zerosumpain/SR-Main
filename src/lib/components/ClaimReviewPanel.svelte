<script lang="ts">
  interface RankedCandidate {
    url: string;
    title: string;
    domain: string;
    reputable: boolean;
    why: string;
    score: number;
  }

  interface ReviewedClaim {
    claim: string;
    snippet: string;
    searchQuery: string;
    candidates: RankedCandidate[];
    status: 'pending' | 'searching' | 'done' | 'error';
    error?: string;
    resultsCount?: number;
    inserted?: { url: string; mode: 'inline' | 'footnote'; n?: number };
  }

  interface Props {
    getHTML: () => string;
    insertInlineLink: (snippet: string, url: string, title?: string) => boolean;
    insertFootnote: (snippet: string, url: string, title?: string) => number;
    adminToken: string;
  }

  let { getHTML, insertInlineLink, insertFootnote, adminToken }: Props = $props();

  type Phase = 'idle' | 'extracting' | 'searching' | 'done' | 'error';

  let phase = $state<Phase>('idle');
  let phaseMsg = $state<string>('');
  let error = $state<string | null>(null);
  let claims = $state<ReviewedClaim[]>([]);
  let lastRunAt = $state<Date | null>(null);
  let mode = $state<'inline' | 'footnote'>('footnote');
  let abortCtl: AbortController | null = null;

  let progressDone = $derived(claims.filter((c) => c.status === 'done' || c.status === 'error').length);
  let progressTotal = $derived(claims.length);

  function reset() {
    error = null;
    claims = [];
    phase = 'idle';
    phaseMsg = '';
  }

  async function review() {
    reset();
    abortCtl?.abort();
    abortCtl = new AbortController();

    const html = getHTML();
    if (!html.trim()) {
      error = 'Nothing to review yet.';
      phase = 'error';
      return;
    }

    phase = 'extracting';
    phaseMsg = 'Connecting…';

    try {
      const res = await fetch(`/api/admin/blog/review-claims?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, format: 'html' }),
        signal: abortCtl.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = body.error ?? `Error ${res.status}`;
        phase = 'error';
        return;
      }
      if (!res.body) {
        error = 'No response stream';
        phase = 'error';
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            handleEvent(JSON.parse(line));
          } catch (parseErr) {
            console.error('bad event line:', line, parseErr);
          }
        }
      }
      // flush any trailing line
      if (buf.trim()) {
        try { handleEvent(JSON.parse(buf.trim())); } catch { /* ignore */ }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        phase = 'idle';
        return;
      }
      error = e instanceof Error ? e.message : 'Network error';
      phase = 'error';
    }
  }

  function cancel() {
    abortCtl?.abort();
    phase = 'idle';
    phaseMsg = '';
  }

  function handleEvent(ev: any) {
    switch (ev.type) {
      case 'phase':
        phase = ev.phase as Phase;
        phaseMsg = ev.message ?? '';
        break;
      case 'claims-found':
        claims = (ev.seeds ?? []).map((s: any) => ({
          claim: s.claim,
          snippet: s.snippet,
          searchQuery: s.searchQuery,
          candidates: [],
          status: 'pending' as const,
        }));
        if (claims.length === 0) phaseMsg = 'No factual claims found in this post.';
        break;
      case 'claim-start': {
        const i = ev.index as number;
        if (claims[i]) claims[i] = { ...claims[i], status: 'searching' };
        break;
      }
      case 'claim-done': {
        const i = ev.index as number;
        if (claims[i]) {
          claims[i] = {
            ...claims[i],
            status: ev.error ? 'error' : 'done',
            candidates: ev.candidates ?? [],
            resultsCount: ev.resultsCount,
            error: ev.error,
          };
        }
        break;
      }
      case 'done':
        phase = 'done';
        phaseMsg = '';
        lastRunAt = new Date();
        if ((ev.claims ?? claims).length === 0) phaseMsg = 'No factual claims found.';
        break;
      case 'error':
        error = ev.error ?? 'Unknown error';
        phase = 'error';
        break;
    }
  }

  function insert(claimIdx: number, candidate: RankedCandidate) {
    const c = claims[claimIdx];
    if (!c) return;
    if (mode === 'inline') {
      const ok = insertInlineLink(c.snippet, candidate.url, candidate.title);
      if (!ok) {
        error = `Couldn't locate snippet in editor: "${c.snippet.slice(0, 60)}…"`;
        return;
      }
      claims[claimIdx] = { ...c, inserted: { url: candidate.url, mode: 'inline' } };
    } else {
      const n = insertFootnote(c.snippet, candidate.url, candidate.title);
      claims[claimIdx] = { ...c, inserted: { url: candidate.url, mode: 'footnote', n } };
    }
  }

  let isRunning = $derived(phase === 'extracting' || phase === 'searching');
</script>

<section class="nm-sec claim-panel">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Fact-check &amp; Sources</span>
    <span style="margin-left: auto; display: flex; gap: 0.5rem; align-items: center;">
      <label class="mode-pick">
        Insert as
        <select bind:value={mode} class="nm-text-input mode-select" disabled={isRunning}>
          <option value="footnote">Footnote</option>
          <option value="inline">Inline link</option>
        </select>
      </label>
      {#if isRunning}
        <button class="nm-link-btn danger" onclick={cancel}>Cancel</button>
      {/if}
      <button class="nm-save-btn" onclick={review} disabled={isRunning}>
        {isRunning ? 'Reviewing…' : 'Review claims'}
      </button>
    </span>
  </div>

  {#if isRunning}
    <div class="progress">
      <div class="progress-line">
        <span class="spinner" aria-hidden="true"></span>
        <span class="progress-text">
          {#if phase === 'extracting'}
            {phaseMsg || 'Extracting claims…'}
          {:else if phase === 'searching'}
            Searching sources via Tavily — {progressDone}/{progressTotal} done
          {/if}
        </span>
      </div>
      {#if progressTotal > 0}
        <div class="bar"><div class="bar-fill" style:width={`${(progressDone / progressTotal) * 100}%`}></div></div>
      {/if}
    </div>
  {/if}

  {#if error}
    <div class="banner banner-error">{error}</div>
  {/if}

  {#if !isRunning && claims.length === 0 && !error}
    <p class="muted">Click <strong>Review claims</strong> to extract factual statements and find reputable sources via Tavily + the default model.</p>
  {/if}

  {#if claims.length > 0}
    {#if lastRunAt && phase === 'done'}
      <p class="muted small">Reviewed {lastRunAt.toLocaleTimeString()} · {claims.length} claim{claims.length === 1 ? '' : 's'}</p>
    {/if}
    <ol class="claims">
      {#each claims as c, i}
        <li class="claim claim-{c.status}" class:has-insert={!!c.inserted}>
          <div class="claim-head">
            <div class="claim-num">{i + 1}</div>
            <div class="claim-body">
              <div class="claim-text">{c.claim}</div>
              <div class="claim-meta">
                {#if c.status === 'pending'}
                  <span class="status-dot pending"></span> Queued
                {:else if c.status === 'searching'}
                  <span class="spinner small" aria-hidden="true"></span> Searching: <code>{c.searchQuery}</code>
                {:else if c.status === 'done'}
                  <span class="status-dot done"></span>
                  {c.candidates.length} source{c.candidates.length === 1 ? '' : 's'}{c.resultsCount ? ` (from ${c.resultsCount} results)` : ''} · query: <code>{c.searchQuery}</code>
                {:else}
                  <span class="status-dot error"></span> {c.error ?? 'lookup failed'}
                {/if}
              </div>
              <div class="claim-snippet">&ldquo;{c.snippet}&rdquo;</div>
            </div>
          </div>

          {#if c.status === 'done' && c.candidates.length === 0}
            <div class="claim-error">No sources found. Try rewording the claim or check the search query above.</div>
          {:else if c.candidates.length > 0}
            <ul class="candidates">
              {#each c.candidates as cand}
                <li class="cand" class:reputable={cand.reputable}>
                  <a href={cand.url} target="_blank" rel="noopener noreferrer" class="cand-url">
                    <span class="cand-title">{cand.title}</span>
                    <span class="cand-domain">{cand.domain}{cand.reputable ? ' · reputable' : ''}</span>
                  </a>
                  {#if cand.why}<div class="cand-why">{cand.why}</div>{/if}
                  <button
                    class="nm-btn-ghost cand-insert"
                    onclick={() => insert(i, cand)}
                    disabled={!!c.inserted}
                  >
                    {c.inserted?.url === cand.url ? 'Inserted' : `Insert as ${mode === 'footnote' ? 'footnote' : 'inline link'}`}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .claim-panel { display: flex; flex-direction: column; gap: 0.6rem; }
  .mode-pick {
    display: inline-flex; align-items: center; gap: 0.4rem;
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--text-secondary);
  }
  .mode-select { width: auto; padding: 4px 8px; }
  .muted { color: var(--text-secondary); margin: 0; }
  .small { font-size: 0.85rem; color: var(--text-ghost); }

  .progress {
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--accent);
    background: rgba(196,87,10,0.04);
    border-radius: 6px;
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .progress-line { display: flex; align-items: center; gap: 0.5rem; }
  .progress-text { color: var(--text-primary); font-size: 0.9rem; }
  .bar { height: 4px; background: var(--card-border); border-radius: 2px; overflow: hidden; }
  .bar-fill { height: 100%; background: var(--accent); transition: width 0.25s ease-out; }

  .spinner {
    display: inline-block;
    width: 14px; height: 14px;
    border: 2px solid var(--line-strong);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  .spinner.small { width: 10px; height: 10px; border-width: 1.5px; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .status-dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    flex-shrink: 0; margin-right: 2px; vertical-align: middle;
  }
  .status-dot.pending { background: var(--text-ghost); }
  .status-dot.done { background: #4a9; }
  .status-dot.error { background: #c44; }

  .claims { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.9rem; }
  .claim {
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    padding: 0.75rem 0.9rem;
    background: var(--card-bg);
    display: flex; flex-direction: column; gap: 0.55rem;
  }
  .claim-pending { opacity: 0.7; }
  .claim-searching { border-color: var(--accent); }
  .claim-error { color: #c44; font-size: 0.85rem; }
  .claim.has-insert { border-color: #4a9; background: rgba(74,170,118,0.04); }

  .claim-head { display: flex; gap: 0.6rem; align-items: flex-start; }
  .claim-num {
    flex-shrink: 0;
    width: 24px; height: 24px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    background: var(--accent); color: white;
    font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700;
  }
  .claim-body { flex: 1; min-width: 0; }
  .claim-text { font-weight: 600; color: var(--text-primary); margin-bottom: 0.3rem; }
  .claim-meta {
    display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-secondary); margin-bottom: 0.35rem;
  }
  .claim-meta code {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    padding: 1px 5px; background: var(--card-border); border-radius: 3px; text-transform: none;
  }
  .claim-snippet { font-style: italic; color: var(--text-ghost); font-size: 0.88rem; }

  .candidates { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.45rem; }
  .cand {
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    padding: 0.55rem 0.75rem;
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.7rem;
  }
  .cand.reputable { border-color: var(--accent); background: rgba(196,87,10,0.04); }
  .cand-url { display: flex; flex-direction: column; flex: 1 1 60%; text-decoration: none; }
  .cand-title { color: var(--text-primary); font-weight: 600; font-size: 0.95rem; }
  .cand-domain { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; }
  .cand-why { width: 100%; color: var(--text-secondary); font-size: 0.85rem; }
  .cand-insert { margin-left: auto; }

  .banner {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    font-size: 0.9rem;
  }
  .banner-error { color: #c44; border-color: rgba(204,68,68,0.4); background: rgba(204,68,68,0.05); }
</style>
