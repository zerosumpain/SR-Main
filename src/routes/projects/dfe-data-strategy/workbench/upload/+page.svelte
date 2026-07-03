<script lang="ts">
  import UploadSynth from '../../components/UploadSynth.svelte';
</script>

<svelte:head><title>Upload & synthesise — Keystone</title></svelte:head>

<div class="pe-route up">
  <span class="pe-eyebrow">Private workbench · upload & synthesise</span>
  <h1 class="pe-h1">Bring your own evidence</h1>
  <p class="pe-lede intro">
    Upload an existing strategy, audit, data map or maturity assessment. The model extracts the text, synthesises it, and reads it against this tool's framework — detecting the maturity signals it implies, the pressures it already addresses, and where your current levers might move as a result.
  </p>

  <UploadSynth />

  <p class="back"><a href="/projects/dfe-data-strategy/author?tab=diagnose">← Back to the diagnostic</a></p>
</div>

<style>
  .up { max-width: 860px; }
  .intro { max-width: 76ch; margin-bottom: 18px; }
  .back { margin-top: 22px; font-size: 13px; }
  .back a { color: var(--accent-ink); }
</style>
