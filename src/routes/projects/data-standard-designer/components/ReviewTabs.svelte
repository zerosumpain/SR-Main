<script lang="ts">
  import { page } from '$app/stores';
  const base = '/projects/data-standard-designer';
  const seg = $derived($page.url.pathname.replace(/\/$/, '').split('/').pop());
</script>

<div class="rtabs">
  <span class="rt-label">Step 03 · Review</span>
  <div class="rt-group">
    <a class="rt" class:on={seg === 'interoperability'} href={`${base}/interoperability`}>Interoperability</a>
    <a class="rt" class:on={seg === 'impact'} href={`${base}/impact`}>Impact &amp; assurance</a>
  </div>
</div>

<style>
  .rtabs { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
  .rt-label { font-family: var(--font-mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); }
  .rt-group { display: inline-flex; border: 1.5px solid var(--card-border); border-radius: var(--radius-pill); padding: 3px; }
  .rt { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; padding: 6px 14px; border-radius: var(--radius-pill); color: var(--text-muted); }
  .rt:hover { color: var(--text-primary); }
  .rt.on { background: var(--accent); color: #fff; }
</style>
