<script lang="ts">
  // The detached runner window. `+page@.svelte` (not `+page.svelte`) resets to
  // the ROOT layout on purpose: /jkai/+layout.svelte carries the hub header,
  // tab bar, command palette and PWA registration, none of which belong in a
  // 820px utility window sitting beside the chat.
  //
  // Owner-gated by fall-through — /jkai/run has no entry in gate-bypasses.ts.
  import { onMount } from 'svelte';
  import { readRunPayload, type RunPayload } from '$lib/jkai/run-window';
  import { normaliseLang } from '$lib/jkai/code-blocks';

  type ExecResult = {
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    truncated?: boolean;
  };

  let payload = $state<RunPayload | null>(null);
  let missing = $state(false);
  let code = $state('');
  let lang = $state('');
  let lane = $state<'browser' | 'container'>('browser');

  /** javascript defaults to the iframe; this sends it to node in the sandbox. */
  let useNode = $state(false);
  let running = $state(false);
  let result = $state<ExecResult | null>(null);
  let error = $state<string | null>(null);
  /** console.* and uncaught errors relayed out of the sandboxed iframe. */
  let logs = $state<Array<{ level: string; text: string }>>([]);
  let srcdoc = $state<string | null>(null);

  // Plain `let`, not $state: an element handle nothing reactive reads. A
  // $state handle that a listener both reads and writes is the classic
  // effect_update_depth_exceeded trap.
  let iframeEl: HTMLIFrameElement | null = null;

  const serverLane = $derived(lane === 'container' || (lang === 'javascript' && useNode));
  const runtime = $derived(
    lang === 'javascript' ? 'node' : lang === 'python' ? 'python' : 'bash',
  );

  function load(): void {
    const id = location.hash.replace(/^#/, '');
    const p = id ? readRunPayload(id) : null;
    if (!p) {
      missing = true;
      return;
    }
    payload = p;
    code = p.code;
    lang = normaliseLang(p.lang);
    lane = p.lane;
  }

  // Relays from the sandboxed iframe. It has `allow-scripts` but NOT
  // `allow-same-origin`, so it is an opaque origin and `event.origin` is the
  // string "null" — identity has to come from the source window instead.
  function onMessage(e: MessageEvent): void {
    if (!iframeEl || e.source !== iframeEl.contentWindow) return;
    const d = e.data as { __jkaiRun?: true; level?: string; text?: string } | null;
    if (!d || d.__jkaiRun !== true) return;
    logs = [...logs, { level: d.level ?? 'log', text: d.text ?? '' }];
  }

  onMount(() => {
    load();
    window.addEventListener('message', onMessage);
    window.addEventListener('hashchange', load);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('hashchange', load);
    };
  });

  // Injected at the top of every preview document so console output and
  // uncaught errors reach the pane below instead of a devtools window nobody
  // has open. Kept as a plain string: it runs inside the sandbox, not here.
  const CONSOLE_SHIM = `
    (function () {
      var send = function (level, args) {
        try {
          parent.postMessage({
            __jkaiRun: true,
            level: level,
            text: Array.prototype.map.call(args, function (a) {
              if (typeof a === 'string') return a;
              try { return JSON.stringify(a); } catch (e) { return String(a); }
            }).join(' ')
          }, '*');
        } catch (e) { /* nothing useful to do from in here */ }
      };
      ['log', 'info', 'warn', 'error', 'debug'].forEach(function (m) {
        var orig = console[m];
        console[m] = function () { send(m, arguments); if (orig) orig.apply(console, arguments); };
      });
      window.addEventListener('error', function (e) { send('error', [e.message]); });
      window.addEventListener('unhandledrejection', function (e) {
        send('error', ['Unhandled rejection: ' + (e.reason && e.reason.message || e.reason)]);
      });
    })();
  `;

  // Svelte's compiler scans this block for tags textually, so writing a script
  // or style tag out in full — even inside a string, even in a comment like this
  // one — opens an element as far as it is concerned, and escaping only the
  // closing tag is not enough. Both halves are assembled from fragments.
  const S_OPEN = '<scr' + 'ipt>';
  const S_MODULE = '<scr' + 'ipt type="module">';
  const S_CLOSE = '</scr' + 'ipt>';
  const CSS_OPEN = '<sty' + 'le>';
  const CSS_CLOSE = '</sty' + 'le>';

  function buildSrcdoc(source: string, language: string): string {
    const shim = `${S_OPEN}${CONSOLE_SHIM}${S_CLOSE}`;
    const base =
      `${CSS_OPEN}` +
      ':root { color-scheme: light; }' +
      'body { font-family: system-ui, sans-serif; margin: 16px; color: #1a1008; background: #fff; }' +
      `${CSS_CLOSE}`;

    if (language === 'html') {
      // The snippet IS the document; the shim has to land before its scripts run.
      return /<html[\s>]/i.test(source)
        ? source.replace(/<head([^>]*)>/i, `<head$1>${shim}`)
        : `${shim}${base}${source}`;
    }
    if (language === 'css') {
      // A stylesheet with nothing to style shows nothing, so give it a small
      // scaffold of the elements a snippet is most likely to target.
      return (
        `${shim}${base}${CSS_OPEN}${source}${CSS_CLOSE}` +
        '<h1>Heading</h1>' +
        '<p>Body copy with a <a href="#">link</a> and <code>inline code</code>.</p>' +
        '<button>Button</button>' +
        '<ul><li>First item</li><li>Second item</li></ul>' +
        '<div class="box">A div with class "box"</div>'
      );
    }
    return `${shim}${base}${S_MODULE}${source}${S_CLOSE}`;
  }

  async function run(): Promise<void> {
    if (running || !code.trim()) return;
    running = true;
    error = null;
    result = null;
    logs = [];

    if (!serverLane) {
      // Cheap and synchronous — swapping srcdoc reloads the frame.
      srcdoc = buildSrcdoc(code, lang);
      running = false;
      return;
    }

    srcdoc = null;
    try {
      const res = await fetch('/api/jkai/run-snippet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, runtime }),
      });
      const data = await res.json();
      if (!res.ok) {
        error = data?.error ?? `Run failed (${res.status})`;
      } else {
        result = data as ExecResult;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      running = false;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void run();
    }
  }
</script>

<svelte:head>
  <title>run · {lang || 'code'} · jkai</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<svelte:window onkeydown={onKey} />

<!-- .jkai-runner is the type hook: this page resets to the ROOT layout so
     .jkai-root is absent, and app.css keys the jkai Segoe UI scope off both. -->
<div class="runner jkai-runner">
  <header class="rn-hdr">
    <span class="kicker">jkai runner</span>
    <span class="rn-lang">{lang || 'code'}</span>
    <span class="rn-spacer"></span>
    {#if lang === 'javascript'}
      <label class="rn-toggle">
        <input type="checkbox" bind:checked={useNode} />
        run with node
      </label>
    {/if}
    <button class="rn-run" onclick={run} disabled={running || missing}>
      {running ? 'running…' : 'run'}
    </button>
  </header>

  {#if missing}
    <p class="rn-empty">
      This snippet is no longer in the handover buffer — it was cleared, or the
      window was opened from a link rather than a Run button. Click Run again in
      the chat.
    </p>
  {:else}
    <section class="rn-pane rn-source">
      <div class="rn-pane-hd">
        <span class="sr-label-tight">source</span>
        <span class="rn-hint">edit freely — {serverLane ? 'runs in the sandbox container' : 'runs in a sandboxed frame'} · ⌘↵</span>
      </div>
      <textarea class="rn-code" bind:value={code} spellcheck="false"></textarea>
    </section>

    <section class="rn-pane rn-out">
      <div class="rn-pane-hd">
        <span class="sr-label-tight">output</span>
        {#if result}
          <span class="rn-meta" class:bad={result.exitCode !== 0}>
            exit {result.exitCode} · {result.durationMs}ms{result.truncated ? ' · truncated' : ''}
          </span>
        {/if}
      </div>

      {#if error}
        <pre class="rn-stream rn-err">{error}</pre>
      {/if}

      {#if serverLane}
        {#if result}
          {#if result.stdout}<pre class="rn-stream">{result.stdout}</pre>{/if}
          {#if result.stderr}<pre class="rn-stream rn-err">{result.stderr}</pre>{/if}
          {#if !result.stdout && !result.stderr}
            <p class="rn-quiet">No output.</p>
          {/if}
        {:else if !error}
          <p class="rn-quiet">Press run.</p>
        {/if}
      {:else}
        {#if srcdoc !== null}
          <!-- allow-scripts WITHOUT allow-same-origin: the frame gets an opaque
               origin, so model-written code cannot reach this document, its
               cookies, or any same-origin API. Do not add allow-same-origin. -->
          <iframe
            bind:this={iframeEl}
            class="rn-frame"
            title="Code preview"
            sandbox="allow-scripts allow-modals allow-forms"
            {srcdoc}
          ></iframe>
          {#if logs.length > 0}
            <!-- A javascript snippet in chat is usually console-driven and paints
                 nothing, so the frame would otherwise be a large blank panel above
                 one line of output. html and css are the reverse. -->
            <div class="rn-console" class:tall={lang === 'javascript'}>
              {#each logs as l, i (i)}
                <div class="rn-log" class:bad={l.level === 'error'} class:warn={l.level === 'warn'}>
                  <span class="rn-log-lvl">{l.level}</span>{l.text}
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <p class="rn-quiet">Press run.</p>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  .runner {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
    color: var(--text-primary);
  }

  .rn-hdr {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 2px solid var(--line-title);
    flex: 0 0 auto;
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .rn-lang {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .rn-spacer { flex: 1; }
  .rn-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .rn-run {
    padding: 5px 16px;
    background: var(--accent);
    color: var(--bg);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
  }
  .rn-run:hover:not(:disabled) { background: var(--accent-hover); }
  .rn-run:disabled { opacity: 0.5; cursor: default; }

  .rn-pane {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .rn-source { flex: 0 0 45%; border-bottom: 1px solid var(--line-strong); }
  .rn-out { flex: 1 1 auto; }

  .rn-pane-hd {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 7px 14px;
    background: var(--bg-section);
    flex: 0 0 auto;
  }
  .sr-label-tight {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
  }
  .rn-hint, .rn-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    margin-left: auto;
  }
  .rn-meta.bad { color: var(--error); }

  .rn-code {
    flex: 1 1 auto;
    width: 100%;
    resize: none;
    border: none;
    outline: none;
    padding: 12px 14px;
    background: var(--code-bg);
    color: #e8dece;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
    tab-size: 2;
  }

  .rn-stream {
    margin: 0;
    padding: 12px 14px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-primary);
  }
  .rn-err { color: var(--error); background: var(--error-bg); }

  .rn-quiet {
    margin: 0;
    padding: 12px 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .rn-empty {
    margin: 0;
    padding: 24px 16px;
    font-family: var(--font-body);
    font-size: 0.9rem;
    color: var(--text-secondary);
    max-width: 46ch;
  }

  .rn-frame {
    flex: 1 1 auto;
    width: 100%;
    border: none;
    background: #fff;
    min-height: 0;
  }
  .rn-console {
    flex: 0 0 auto;
    max-height: 34%;
    overflow: auto;
  }
  .rn-console.tall {
    max-height: 65%;
    border-top: 1px solid var(--line-strong);
    background: var(--surface-elevated);
  }
  .rn-log {
    display: flex;
    gap: 8px;
    padding: 3px 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    border-bottom: 1px solid var(--line-hair);
  }
  .rn-log-lvl {
    flex: 0 0 auto;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .rn-log.bad { color: var(--error); }
  .rn-log.bad .rn-log-lvl { color: var(--error); }
  .rn-log.warn { color: var(--warn); }
  .rn-log.warn .rn-log-lvl { color: var(--warn); }
</style>
