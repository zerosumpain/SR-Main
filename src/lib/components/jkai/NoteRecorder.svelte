<script lang="ts">
  // A record control for the notebook.
  //
  // The MediaRecorder handling is the same shape VoiceRecorder.svelte proved in
  // the chat composer — same codec negotiation, same track cleanup. What is
  // different is the interaction and the dress: chat wants a hold-to-talk chip
  // in a Tailwind-styled composer, a notebook wants a deliberate start/stop for
  // a recording that may run for minutes, in the page's own mono/ink language.
  //
  // It owns no upload logic. `onrecorded` hands the blob and its duration up,
  // and the page decides whether that becomes a new note or joins the open one.

  let {
    label = 'Record',
    busy = false,
    busyLabel = 'Transcribing…',
    disabled = false,
    tone = 'paper',
    onrecorded,
  }: {
    label?: string;
    busy?: boolean;
    busyLabel?: string;
    disabled?: boolean;
    /** `ink` sits on the dark cover, `paper` on the cream workspace. */
    tone?: 'ink' | 'paper';
    onrecorded: (blob: Blob, durationSec: number) => void | Promise<void>;
  } = $props();

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let recording = $state(false);
  let elapsed = $state(0);
  let micError = $state<string | null>(null);
  let tick: ReturnType<typeof setInterval> | null = null;
  let startedAt = 0;

  function mmss(total: number): string {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  async function start() {
    if (recording || busy || disabled) return;
    micError = null;
    chunks = [];
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, or no device. Say so in the UI rather than only the console —
      // a record button that does nothing is the worst version of this.
      micError = 'No microphone access.';
      return;
    }
    const preferred = 'audio/webm;codecs=opus';
    const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : 'audio/webm';
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const seconds = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
      const blob = new Blob(chunks, { type: 'audio/webm' });
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      recorder = null;
      chunks = [];
      if (blob.size > 0) void onrecorded(blob, seconds);
    };
    recorder.start();
    recording = true;
    startedAt = performance.now();
    elapsed = 0;
    tick = setInterval(() => {
      elapsed = Math.floor((performance.now() - startedAt) / 1000);
    }, 250);
  }

  function stop() {
    if (!recording) return;
    recording = false;
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    recorder?.stop();
  }

  /** Drop the recording instead of transcribing it. Tracks still have to be
   *  released, or the browser keeps showing the tab as recording. */
  function cancel() {
    if (!recording) return;
    recording = false;
    if (tick) {
      clearInterval(tick);
      tick = null;
    }
    if (recorder) recorder.onstop = null;
    recorder?.stop();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
    chunks = [];
    elapsed = 0;
  }
</script>

<div class="rec" class:ink={tone === 'ink'}>
  {#if busy}
    <span class="rec-busy"><span class="rec-spin" aria-hidden="true"></span>{busyLabel}</span>
  {:else if recording}
    <button type="button" class="rec-btn rec-stop" onclick={stop}>
      <span class="rec-dot" aria-hidden="true"></span>
      Stop · {mmss(elapsed)}
    </button>
    <button type="button" class="rec-cancel" onclick={cancel} title="Discard this recording">Discard</button>
  {:else}
    <button type="button" class="rec-btn" onclick={start} {disabled}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 18v4M8 22h8" />
      </svg>
      {label}
    </button>
  {/if}
  {#if micError}<span class="rec-err">{micError}</span>{/if}
</div>

<style>
  .rec {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .rec-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 13px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    transition: color 0.2s ease-out, border-color 0.2s ease-out;
  }
  .rec-btn:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }
  .rec-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .rec-stop {
    border-color: var(--accent);
    color: var(--accent);
  }
  .rec-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-pill);
    background: var(--error);
    animation: rec-pulse 1.4s ease-in-out infinite;
  }
  @keyframes rec-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.25; }
  }
  .rec-cancel,
  .rec-busy,
  .rec-err {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .rec-cancel {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-ghost);
    cursor: pointer;
  }
  .rec-cancel:hover { color: var(--error); }
  .rec-busy {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
  }
  .rec-spin {
    width: 10px;
    height: 10px;
    border: 2px solid var(--line-strong);
    border-top-color: var(--accent);
    border-radius: var(--radius-pill);
    animation: rec-spin 0.8s linear infinite;
  }
  @keyframes rec-spin { to { transform: rotate(360deg); } }
  .rec-err { color: var(--error); }

  /* On the ink cover the hairlines and text invert — same control, dark ground. */
  .rec.ink .rec-btn {
    border-color: rgba(237, 228, 212, 0.32);
    color: var(--bg);
  }
  .rec.ink .rec-btn:hover:not(:disabled) {
    background: var(--bg);
    border-color: var(--bg);
    color: var(--text-primary);
  }
  .rec.ink .rec-stop {
    border-color: var(--accent-on-dark);
    color: var(--accent-on-dark);
  }
  .rec.ink .rec-busy { color: rgba(237, 228, 212, 0.72); }
  .rec.ink .rec-cancel { color: rgba(237, 228, 212, 0.5); }
  .rec.ink .rec-spin { border-color: rgba(237, 228, 212, 0.28); border-top-color: var(--accent-on-dark); }

  @media (prefers-reduced-motion: reduce) {
    .rec-dot, .rec-spin { animation: none; }
  }
</style>
