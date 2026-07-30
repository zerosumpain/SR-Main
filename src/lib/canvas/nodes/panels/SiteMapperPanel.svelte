<script lang="ts">
  import type { PanelProps } from './registry';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  let { config, onChange }: PanelProps = $props();

  let seedUrl = $state((config.seedUrl as string) ?? '');
  let goal = $state((config.goal as string) ?? '');
  let searchQuery = $state((config.searchQuery as string) ?? '');
  let profile = $state((config.profile as string) ?? 'default');
  let model = $state((config.model as string) ?? '');

  function emit() {
    onChange({
      seedUrl,
      goal,
      searchQuery,
      profile,
      model,
    });
  }

  // Equality-guarded prop→state sync. Avoids the effect-cascade pattern that
  // caught the other panels (see feedback_svelte5_state_in_effect_loop).
  $effect(() => {
    const nextSeedUrl = (config.seedUrl as string) ?? '';
    if (nextSeedUrl !== seedUrl) seedUrl = nextSeedUrl;
    const nextGoal = (config.goal as string) ?? '';
    if (nextGoal !== goal) goal = nextGoal;
    const nextSearchQuery = (config.searchQuery as string) ?? '';
    if (nextSearchQuery !== searchQuery) searchQuery = nextSearchQuery;
    const nextProfile = (config.profile as string) ?? 'default';
    if (nextProfile !== profile) profile = nextProfile;
    const nextModel = (config.model as string) ?? '';
    if (nextModel !== model) model = nextModel;
  });
</script>

<div class="panel">
  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Seed URL</span></div>
    <input
      class="ps-input"
      type="text"
      value={seedUrl}
      oninput={(e) => { seedUrl = (e.target as HTMLInputElement).value; emit(); }}
      placeholder="https://example.com/search?keyword=data+engineer"
    />
    <div class="ps-hint">
      The page the mapper loads first — typically the target site's search/listing page.
      Include any query params needed to reach the results the scraper should extract.
    </div>
  </section>

  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Goal (what to extract)</span></div>
    <textarea
      class="ps-input ps-textarea"
      value={goal}
      oninput={(e) => { goal = (e.target as HTMLTextAreaElement).value; emit(); }}
      placeholder="data engineer job listings with title, organisation, salary, closing date, and job URL"
      rows="3"
    ></textarea>
    <div class="ps-hint">Plain English. The LLM uses this to decide selectors + URL pattern.</div>
  </section>

  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Search query</span></div>
    <input
      class="ps-input"
      type="text"
      value={searchQuery}
      oninput={(e) => { searchQuery = (e.target as HTMLInputElement).value; emit(); }}
      placeholder="data engineer"
    />
    <div class="ps-hint">
      Substituted into the playbook's <code>{'{{keyword}}'}</code> placeholder during validation,
      so the mapper can confirm the playbook actually returns items.
    </div>
  </section>

  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Profile</span></div>
    <input
      class="ps-input"
      type="text"
      value={profile}
      oninput={(e) => { profile = (e.target as HTMLInputElement).value; emit(); }}
      placeholder="default"
    />
    <div class="ps-hint">
      Must match the downstream stealth-scrape's profile so cookies (e.g. cookie-consent) carry over.
    </div>
  </section>

  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Model (optional)</span></div>
    <input
      class="ps-input"
      type="text"
      value={model}
      oninput={(e) => { model = (e.target as HTMLInputElement).value; emit(); }}
      placeholder="leave blank for the admin chat default"
    />
    <div class="ps-hint">
      Empty uses the admin default. Slashed IDs (e.g. <code>anthropic/claude-3.5-sonnet</code>) route via OpenRouter.
    </div>
  </section>

  <section class="ps ps-note">
    <div class="ps-hd"><span class="ps-label">Where to wire this</span></div>
    <div class="ps-hint">
      Run the site-mapper <b>once</b>, standalone (no edges needed — or wire it to the Trigger if you want
      the Run button to fire it). It saves the playbook to <code>scraper_target_knowledge</code> for its
      domain. Any stealth-scrape node targeting the same domain — on this canvas or any other — automatically
      dispatches through the saved playbook on every run. No edge needed between site-mapper and stealth-scrape.
    </div>
  </section>

  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => onChange({ ...config, _onError: v })}
  />
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 14px; }
  .ps { display: flex; flex-direction: column; gap: 4px; }
  .ps-hd { display: flex; align-items: center; gap: 8px; }
  .ps-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .ps-input {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    padding: 6px 8px;
    background: var(--bg, #0d0d0d);
    border: 1px solid var(--card-border, #333);
    color: var(--text-primary);
    outline: none;
    border-radius: 2px;
  }
  .ps-input:focus { border-color: var(--accent, #c4570a); }
  .ps-textarea { resize: vertical; min-height: 64px; }
  .ps-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    line-height: 1.4;
  }
  .ps-hint code {
    background: var(--bg-section, #111);
    padding: 1px 4px;
    border-radius: 2px;
    font-size: var(--fs-label-xs);
  }
  .ps-note {
    padding: 10px 12px;
    background: rgba(196, 87, 10, 0.06);
    border: 1px solid rgba(196, 87, 10, 0.25);
    border-radius: 3px;
  }
</style>
