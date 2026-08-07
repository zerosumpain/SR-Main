<script lang="ts">
  // FilePipeline — six kinds of file, six different routes to being searchable.
  //
  // The reason this is an instrument and not a list: a store presents one uniform surface, so
  // a reader assumes one uniform capability behind it. Picking a photograph and reading
  // "caption it with a vision model" is the moment that assumption breaks, and picking a
  // video and reading "skipped" is the moment it is replaced with something true.
  import Steps from '../../../components/viz/Steps.svelte';
  import { FILE_KINDS, INDEX } from '../../../lib/drive';

  let sel = $state(FILE_KINDS[0].id);
  const kind = $derived(FILE_KINDS.find((k) => k.id === sel) ?? FILE_KINDS[0]);

  const MODALITY: Record<string, { label: string; tone: string }> = {
    text: { label: 'read as text', tone: 'var(--success)' },
    image: { label: 'described, then read', tone: 'var(--accent)' },
    audio: { label: 'transcribed, then read', tone: 'var(--accent-ink)' },
    refused: { label: 'not indexed', tone: '#8a2d3a' },
  };

  const steps = $derived(
    kind.path.map((label, i) => ({
      id: `${kind.id}-${i}`,
      label,
      state: (kind.modality === 'refused' && i === kind.path.length - 1 ? 'skipped' : 'done') as
        'done' | 'skipped',
    })),
  );

  const indexed = $derived(kind.modality !== 'refused');
</script>

<div class="fp">
  <div class="kinds" role="group" aria-label="Kinds of file">
    {#each FILE_KINDS as k (k.id)}
      <button type="button" class:on={sel === k.id} aria-pressed={sel === k.id}
              onclick={() => (sel = k.id)} title={k.example}>
        {k.label}
      </button>
    {/each}
  </div>

  <div class="head">
    <span class="h-eg">{kind.example}</span>
    <span class="h-mode" style="--m:{MODALITY[kind.modality].tone}">{MODALITY[kind.modality].label}</span>
  </div>

  <Steps items={steps} tone={MODALITY[kind.modality].tone} />

  <p class="note" aria-live="polite">{kind.note}</p>

  <div class="outcome" class:no={!indexed}>
    {#if indexed}
      <b>Findable</b>
      by anything in its text, in the always-on {INDEX.globalDims.toLocaleString('en-GB')}-dimension index —
      alongside every other file, whatever kind it is.
    {:else}
      <b>Findable by its name and nothing else.</b>
      Nothing in the store pretends to have read it, which is the only honest option and is easy to get wrong.
    {/if}
  </div>
</div>

<style>
  .fp { display: flex; flex-direction: column; gap: 11px; min-width: 0; }

  .kinds { display: flex; gap: 5px; flex-wrap: wrap; }
  .kinds button { font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer;
    transition: background 0.12s, border-color 0.12s; }
  .kinds button:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.34); }
  .kinds button.on { background: var(--success); border-color: var(--success); color: #fff; }

  .head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .h-eg { font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--text-primary); }
  .h-mode { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.1em;
    text-transform: uppercase; padding: 2px 8px; border-radius: var(--radius-pill);
    color: var(--m); background: color-mix(in srgb, var(--m) 14%, transparent); }

  .note { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.72); max-width: 86ch; }

  .outcome { padding: 9px 13px; border-left: 3px solid var(--success);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--success) 9%, transparent);
    font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.76); max-width: 88ch; }
  .outcome.no { border-left-color: #8a2d3a; background: rgba(138,45,58,0.07); }
  .outcome b { color: var(--text-primary); }
</style>
