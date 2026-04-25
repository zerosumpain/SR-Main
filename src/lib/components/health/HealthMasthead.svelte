<script lang="ts">
  let { onopenEvidence }: { onopenEvidence?: () => void } = $props();
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
</script>

<header class="hm">
  <div class="hm-left">
    <div class="hm-kicker">DAILY · {today}</div>
    <h1 class="hm-title">Health</h1>
    <p class="hm-sub">
      Readiness, autonomic balance, training load, sleep, body signals — derived from Whoop,
      Apple Health and Strava and contextualised against current research.
    </p>
  </div>
  <div class="hm-right">
    <button type="button" class="hm-evidence" onclick={() => onopenEvidence?.()}>
      Evidence &amp; methodology →
    </button>
  </div>
</header>

<style>
  .hm {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    padding: 1.5rem 0 1rem;
    border-bottom: 2px solid var(--text-primary);
    margin: 1.25rem auto 1.25rem;
    max-width: 1200px;
  }
  .hm-kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  .hm-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    line-height: 1.05;
    color: var(--text-primary);
  }
  .hm-sub {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--text-secondary);
    max-width: 60ch;
  }
  .hm-evidence {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    flex-shrink: 0;
  }
  .hm-evidence:hover { color: var(--accent-hover); text-decoration: underline; }
  @media (max-width: 640px) {
    .hm { flex-direction: column; align-items: flex-start; gap: 0.75rem; padding: 1rem 0 0.75rem; }
    .hm-title { font-size: 1.6rem; }
  }
</style>
