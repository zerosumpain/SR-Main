<script lang="ts">
  let { onRecorded, disabled = false }: { onRecorded: (blob: Blob) => void | Promise<void>; disabled?: boolean } = $props();

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let recording = $state(false);
  let previewMode = $state(false);
  let previewBlob = $state<Blob | null>(null);
  let previewUrl = $state<string | null>(null);
  let elapsed = $state(0);
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let startedAt = 0;
  let pressStart = 0;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const HOLD_THRESHOLD_MS = 300;

  async function startRecording() {
    if (recording) return;
    chunks = [];
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        previewBlob = blob;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        stream?.getTracks().forEach((t) => t.stop());
        stream = null; recorder = null;
      };
      recorder.start();
      recording = true;
      startedAt = performance.now();
      elapsed = 0;
      tickTimer = setInterval(() => { elapsed = Math.floor((performance.now() - startedAt) / 1000); }, 250);
    } catch (err) {
      console.error('mic error', err);
      recording = false;
    }
  }

  function stopRecording(): void {
    if (!recording) return;
    recorder?.stop();
    recording = false;
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  async function onDown(e: PointerEvent) {
    if (disabled) return;
    pressStart = performance.now();
    const el = e.currentTarget;
    if (el instanceof HTMLElement) el.setPointerCapture(e.pointerId);
    pressTimer = setTimeout(() => { void startRecording(); pressTimer = null; }, HOLD_THRESHOLD_MS);
  }

  async function onUp() {
    const heldMs = performance.now() - pressStart;
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (heldMs < HOLD_THRESHOLD_MS) {
      if (!recording && !previewMode) {
        previewMode = true;
        await startRecording();
      } else if (recording && previewMode) {
        stopRecording();
      }
    } else if (recording && !previewMode) {
      stopRecording();
      await waitForBlob().then((b) => onRecorded(b));
      cleanup();
    }
  }

  function waitForBlob(): Promise<Blob> {
    return new Promise((resolve) => {
      const iv = setInterval(() => { if (previewBlob) { clearInterval(iv); resolve(previewBlob); } }, 50);
    });
  }

  async function sendPreview() {
    if (!previewBlob) return;
    await onRecorded(previewBlob);
    cleanup();
  }

  function cleanup() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    previewBlob = null;
    previewMode = false;
    elapsed = 0;
  }
</script>

<div class="flex items-center gap-1">
  {#if previewMode && previewBlob && previewUrl}
    <button type="button" onclick={cleanup} class="p-1.5 opacity-60 hover:opacity-100" aria-label="discard" title="Discard">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
    </button>
    <audio controls src={previewUrl} class="max-w-[140px] h-8"></audio>
    <button type="button" onclick={sendPreview} class="p-1.5 opacity-80 hover:opacity-100" aria-label="send" title="Send voice note" style="color: var(--accent);">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
    </button>
  {:else if previewMode && recording}
    <button type="button" onclick={stopRecording} class="p-1.5" aria-label="stop" title="Stop recording" style="color: #ef4444;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
    </button>
    <span class="text-[10px] opacity-70 tabular-nums">{elapsed}s</span>
  {:else}
    <button
      type="button"
      onpointerdown={onDown}
      onpointerup={onUp}
      onpointercancel={() => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } stopRecording(); cleanup(); }}
      class="p-1.5 opacity-60 hover:opacity-100 shrink-0"
      class:ring-2={recording}
      class:ring-red-500={recording}
      aria-label="Record voice note"
      title="Hold to record, tap to preview"
      {disabled}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="2" width="6" height="12" rx="3"/>
        <path d="M5 10a7 7 0 0014 0M12 18v4M8 22h8"/>
      </svg>
    </button>
    {#if recording}<span class="text-[10px] opacity-70 tabular-nums">{elapsed}s</span>{/if}
  {/if}
</div>
