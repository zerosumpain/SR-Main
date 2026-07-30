<script lang="ts">
  import type { PanelProps } from './registry';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import { onMount } from 'svelte';
  import ResourcePicker from './shared/ResourcePicker.svelte';

  let { config, onChange }: PanelProps = $props();

  // ResourcePicker fetchers (kept here so they close over the same
  // HTTP layer the rest of this panel uses, and so the picker shows
  // a sensible fallback if the API errors).
  async function fetchProfiles(): Promise<Array<{ value: string; label: string }>> {
    const res = await fetch('/api/scraper/profiles');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Expected string[]');
    return rows
      .filter((r): r is string => typeof r === 'string' && r.length > 0)
      .map((name) => ({ value: name, label: name }));
  }

  async function fetchCredentials(): Promise<Array<{ value: string; label: string; meta?: string }>> {
    const res = await fetch('/api/scraper/credentials');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Expected array');
    return rows
      .filter((r) => r && typeof r === 'object' && r.id != null)
      .map((r) => {
        const id = String(r.id);
        const label = typeof r.label === 'string' && r.label ? r.label : `credential ${id}`;
        const domain = typeof r.domain === 'string' ? r.domain : '';
        return { value: id, label, meta: domain || undefined };
      });
  }

  // Local draft — mirrored from config on mount and when config changes externally
  let url = $state((config.url as string) ?? '');
  let profile = $state((config.profile as string) ?? '');
  // Plain-English fields that drive the auto-mapping pipeline on new domains.
  // When these are set AND no playbook exists for the URL's domain yet, the
  // node invokes an LLM agent to navigate and record the recipe on first run.
  let goal = $state((config.goal as string) ?? '');
  let searchQuery = $state((config.searchQuery as string) ?? '');
  let advancedOpen = $state(false);

  type WaitConfig = { type: 'networkidle' } | { type: 'selector'; selector: string; timeoutMs: number } | { type: 'timeout'; ms: number };
  const waitCfg = (config.wait as WaitConfig | undefined) ?? { type: 'networkidle' };
  let waitType = $state<'networkidle' | 'selector' | 'timeout'>(waitCfg.type);
  let waitSelector = $state((waitCfg as { selector?: string }).selector ?? '');
  let waitSelectorMs = $state((waitCfg as { timeoutMs?: number }).timeoutMs ?? 5000);
  let waitTimeoutMs = $state((waitCfg as { ms?: number }).ms ?? 3000);

  type ExtractRule = { field: string; selector: string; attr: string; customAttr: string; multi: boolean; trim: boolean; regex: string };
  function makeRule(r?: Partial<ExtractRule>): ExtractRule {
    return { field: r?.field ?? '', selector: r?.selector ?? '', attr: r?.attr ?? 'text', customAttr: r?.customAttr ?? '', multi: r?.multi ?? false, trim: r?.trim !== false, regex: r?.regex ?? '' };
  }
  let extractRules = $state<ExtractRule[]>(
    Array.isArray(config.extractRules) && (config.extractRules as unknown[]).length > 0
      ? (config.extractRules as Array<Record<string, unknown>>).map((r) => makeRule(r as Partial<ExtractRule>))
      : [makeRule()]
  );

  type PaginationConfig = { type: 'none' } | { type: 'next-link'; selector: string; maxPages: number } | { type: 'url-template'; template: string; start: number; maxPages: number };
  const pagCfg = (config.pagination as PaginationConfig | undefined) ?? { type: 'none' };
  let pagType = $state<'none' | 'next-link' | 'url-template'>(pagCfg.type);
  let pagSelector = $state((pagCfg as { selector?: string }).selector ?? '');
  let pagMaxPages = $state((pagCfg as { maxPages?: number }).maxPages ?? 10);
  let pagTemplate = $state((pagCfg as { template?: string }).template ?? '');
  let pagStart = $state((pagCfg as { start?: number }).start ?? 1);

  let credentialId = $state(config.credentialId != null ? String(config.credentialId) : '');
  let pacingMin = $state((config.pacingMinMs as number | undefined) ?? null);
  let pacingMax = $state((config.pacingMaxMs as number | undefined) ?? null);

  // Playbook status for this URL's domain — the node dispatches through
  // this deterministically when present, and auto-maps on first run when
  // absent. Fetched on mount + after any explicit refresh.
  interface PlaybookMeta {
    domain: string;
    playbook: unknown | null;
    playbookUpdatedAt: string | null;
  }
  let playbookMeta = $state<PlaybookMeta | null>(null);
  let playbookLoading = $state(false);
  let playbookExpanded = $state(false);
  let playbookError = $state<string | null>(null);

  // Script (preferred over playbook): if a saved Python scrape script
  // exists for this profile, the node skips authoring and runs it
  // deterministically.
  interface ScriptMetaWire {
    declaredVars: Array<{ name: string; hint: string }>;
    goal: string;
    seedUrl: string;
    generatedAt: string;
    lastSuccessAt: string | null;
    runCount: number;
    successCount: number;
  }
  interface ScriptStatus {
    profile: string;
    code: string | null;
    meta: ScriptMetaWire | null;
  }
  let scriptStatus = $state<ScriptStatus | null>(null);
  let scriptLoading = $state(false);
  let scriptExpanded = $state(false);
  let scriptError = $state<string | null>(null);

  async function refreshScript() {
    if (!profile.trim()) {
      scriptStatus = null;
      return;
    }
    scriptLoading = true;
    scriptError = null;
    try {
      const res = await fetch(`/api/scraper/script?profile=${encodeURIComponent(profile)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      scriptStatus = await res.json();
    } catch (e) {
      scriptError = e instanceof Error ? e.message : String(e);
      scriptStatus = null;
    } finally {
      scriptLoading = false;
    }
  }

  async function clearScript() {
    if (!profile.trim()) return;
    if (!confirm('Delete the saved scrape script for this profile? The next run will re-author it from scratch (~5–10 min).')) return;
    scriptLoading = true;
    try {
      const res = await fetch(`/api/scraper/script?profile=${encodeURIComponent(profile)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshScript();
    } catch (e) {
      scriptError = e instanceof Error ? e.message : String(e);
    } finally {
      scriptLoading = false;
    }
  }

  async function refreshPlaybook() {
    if (!url.trim()) {
      playbookMeta = null;
      return;
    }
    playbookLoading = true;
    playbookError = null;
    try {
      const res = await fetch(`/api/scraper/playbook?url=${encodeURIComponent(url)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      playbookMeta = await res.json();
    } catch (e) {
      playbookError = e instanceof Error ? e.message : String(e);
      playbookMeta = null;
    } finally {
      playbookLoading = false;
    }
  }

  async function clearPlaybook() {
    if (!url.trim()) return;
    if (!confirm('Clear the saved playbook for this domain? The next run will auto-map the site from scratch (~3-5 min).')) return;
    playbookLoading = true;
    try {
      const res = await fetch(`/api/scraper/playbook?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshPlaybook();
    } catch (e) {
      playbookError = e instanceof Error ? e.message : String(e);
    } finally {
      playbookLoading = false;
    }
  }

  onMount(async () => {
    // Profile/credential lists are fetched by their respective ResourcePickers.
    await refreshPlaybook();
    await refreshScript();
  });

  // Refresh script when profile changes.
  let lastFetchedProfile = '';
  $effect(() => {
    if (profile.trim() && profile !== lastFetchedProfile) {
      lastFetchedProfile = profile;
      void refreshScript();
    }
  });

  // Also refresh when the URL changes (user typed / pasted a new one).
  let lastFetchedUrl = '';
  $effect(() => {
    if (url.trim() && url !== lastFetchedUrl) {
      lastFetchedUrl = url;
      void refreshPlaybook();
    }
  });

  function hostOf(u: string): string {
    try { return new URL(u).hostname; } catch { return u; }
  }
  function formatWhen(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    return d.toLocaleString();
  }

  function buildConfig(): Record<string, unknown> {
    const wait: Record<string, unknown> = { type: waitType };
    if (waitType === 'selector') { wait.selector = waitSelector; wait.timeoutMs = waitSelectorMs; }
    if (waitType === 'timeout') { wait.ms = waitTimeoutMs; }

    const rules = extractRules.map((r) => {
      const rule: Record<string, unknown> = { field: r.field, selector: r.selector, attr: r.attr === 'custom' ? r.customAttr : r.attr, multi: r.multi, trim: r.trim };
      if (r.regex) rule.regex = r.regex;
      return rule;
    });

    const pagination: Record<string, unknown> = { type: pagType };
    if (pagType === 'next-link') { pagination.selector = pagSelector; pagination.maxPages = pagMaxPages; }
    if (pagType === 'url-template') { pagination.template = pagTemplate; pagination.start = pagStart; pagination.maxPages = pagMaxPages; }

    const out: Record<string, unknown> = { url, profile, goal, searchQuery, wait, extractRules: rules, pagination };
    if (credentialId) out.credentialId = Number(credentialId);
    if (pacingMin != null) out.pacingMinMs = pacingMin;
    if (pacingMax != null) out.pacingMaxMs = pacingMax;
    return out;
  }

  function emit() { onChange(buildConfig()); }

  function addRule() { extractRules = [...extractRules, makeRule()]; emit(); }
  function removeRule(i: number) { extractRules = extractRules.filter((_, idx) => idx !== i); emit(); }
  function setRule<K extends keyof ExtractRule>(i: number, key: K, val: ExtractRule[K]) {
    extractRules = extractRules.map((r, idx) => idx === i ? { ...r, [key]: val } : r);
    emit();
  }

  // Re-sync local state when config prop is replaced (e.g. after external
  // save/revert). Equality-guarded so emit() → parent write → prop change →
  // this effect doesn't bounce back a self-overwrite that re-triggers the
  // effect and cascades into effect_update_depth_exceeded.
  $effect(() => {
    const nextUrl = (config.url as string) ?? '';
    if (nextUrl !== url) url = nextUrl;
    const nextProfile = (config.profile as string) ?? '';
    if (nextProfile !== profile) profile = nextProfile;
    const nextGoal = (config.goal as string) ?? '';
    if (nextGoal !== goal) goal = nextGoal;
    const nextSQ = (config.searchQuery as string) ?? '';
    if (nextSQ !== searchQuery) searchQuery = nextSQ;
  });
</script>

<div class="panel">
  <!-- Target site -->
  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Site URL</span></div>
    <input class="ps-input" type="text" value={url}
      oninput={(e) => { url = (e.target as HTMLInputElement).value; emit(); }}
      placeholder="https://example.com" />
    <div class="ps-hint">
      Root URL of the target site. Supports <code>{'{{input.x}}'}</code> templates.
      When <b>Goal</b> is set below, the node auto-maps the site on first run — you don't need to include search params here.
    </div>
  </section>

  <!-- Goal -->
  <section class="ps ps-highlight">
    <div class="ps-hd"><span class="ps-label">What to extract (goal)</span></div>
    <textarea class="ps-input ps-textarea" rows="3" value={goal}
      oninput={(e) => { goal = (e.target as HTMLTextAreaElement).value; emit(); }}
      placeholder="e.g. the job description and requirements for each job returned"></textarea>
    <div class="ps-hint">
      Plain English. Describe what each <em>item</em> in the result should contain. When set, the node auto-maps the site on first run (~3-5 min), saves a playbook, then every future run is fast + deterministic. Leave blank to run as a vanilla scrape using the extract rules under Advanced below.
    </div>
  </section>

  <!-- Search query -->
  <section class="ps ps-highlight">
    <div class="ps-hd"><span class="ps-label">Search query / filters</span></div>
    <textarea class="ps-input ps-textarea" rows="2" value={searchQuery}
      oninput={(e) => { searchQuery = (e.target as HTMLTextAreaElement).value; emit(); }}
      placeholder="e.g. jobs with analyst in the title, 20 miles from Darlington, over £60k salary"></textarea>
    <div class="ps-hint">
      Plain English, parameterises the site's search form. The LLM decides which form fields map to which words and builds a templated URL — future runs can override via input vars.
    </div>
  </section>

  <!-- Script status (LLM-authored Python scrape function — preferred over playbook) -->
  {#if profile.trim()}
    <section class="ps ps-playbook">
      <div class="ps-hd">
        <span class="ps-label">Script</span>
        <span class="ps-meta">{profile}</span>
      </div>
      {#if scriptLoading}
        <div class="ps-hint">Loading…</div>
      {:else if scriptError}
        <div class="ps-hint ps-hint-error">Error: {scriptError}</div>
      {:else if scriptStatus?.code && scriptStatus.meta}
        {@const m = scriptStatus.meta}
        <div class="ps-playbook-status ps-playbook-status-saved">
          <span class="ps-dot ps-dot-green"></span>
          <span class="ps-playbook-summary">
            <b>Saved</b>
            · {scriptStatus.code.split('\n').length} lines
            · vars: {m.declaredVars.map((v) => v.name).join(', ') || '(none)'}
            · {m.successCount}/{m.runCount} runs ok
            · {formatWhen(m.generatedAt)}
          </span>
        </div>
        <div class="ps-hint ps-playbook-goal">Goal: {m.goal}</div>
        <div class="ps-playbook-actions">
          <button class="ps-link" onclick={() => (scriptExpanded = !scriptExpanded)}>
            {scriptExpanded ? '▾ Hide code' : '▸ View code'}
          </button>
          <button class="ps-link ps-link-danger" onclick={clearScript} disabled={scriptLoading}>
            Delete &amp; re-author
          </button>
          <button class="ps-link" onclick={refreshScript} disabled={scriptLoading}>Refresh</button>
        </div>
        {#if scriptExpanded}
          <pre class="ps-playbook-json">{scriptStatus.code}</pre>
        {/if}
      {:else}
        <div class="ps-playbook-status ps-playbook-status-empty">
          <span class="ps-dot ps-dot-amber"></span>
          <span>No script yet — first run will author one (~5–10 min) if Goal is set.</span>
        </div>
      {/if}
    </section>
  {/if}

  <!-- Playbook status (legacy — replaced by Script above; kept while old playbooks exist) -->
  {#if url.trim()}
    <section class="ps ps-playbook">
      <div class="ps-hd">
        <span class="ps-label">Playbook</span>
        <span class="ps-meta">{hostOf(url)}</span>
      </div>
      {#if playbookLoading}
        <div class="ps-hint">Loading…</div>
      {:else if playbookError}
        <div class="ps-hint ps-hint-error">Error: {playbookError}</div>
      {:else if playbookMeta?.playbook}
        {@const pb = playbookMeta.playbook as { version?: number; steps?: unknown[]; extract?: unknown[]; goal?: string; requiredVars?: Array<{ name: string; hint: string }> }}
        <div class="ps-playbook-status ps-playbook-status-saved">
          <span class="ps-dot ps-dot-green"></span>
          <span class="ps-playbook-summary">
            <b>Saved</b>
            · v{pb.version ?? '?'}
            · {Array.isArray(pb.steps) ? pb.steps.length : 0} steps
            · {Array.isArray(pb.extract) ? pb.extract.length : 0} extract rules
            · {formatWhen(playbookMeta.playbookUpdatedAt)}
          </span>
        </div>
        {#if pb.goal}
          <div class="ps-hint ps-playbook-goal">Goal: {pb.goal}</div>
        {/if}
        {#if Array.isArray(pb.requiredVars) && pb.requiredVars.length > 0}
          <div class="ps-hint ps-playbook-vars">
            Vars decomposed from Search Query: {pb.requiredVars.map((v) => v.name).join(', ')}
          </div>
        {/if}
        <div class="ps-playbook-actions">
          <button class="ps-link" onclick={() => (playbookExpanded = !playbookExpanded)}>
            {playbookExpanded ? '▾ Hide JSON' : '▸ View JSON'}
          </button>
          <button class="ps-link ps-link-danger" onclick={clearPlaybook} disabled={playbookLoading}>
            Clear &amp; re-map
          </button>
          <button class="ps-link" onclick={refreshPlaybook} disabled={playbookLoading}>Refresh</button>
        </div>
        {#if playbookExpanded}
          <pre class="ps-playbook-json">{JSON.stringify(playbookMeta.playbook, null, 2)}</pre>
        {/if}
      {:else}
        <div class="ps-playbook-status ps-playbook-status-empty">
          <span class="ps-dot ps-dot-amber"></span>
          <span>No playbook yet — first run will auto-map this site (if Goal is set).</span>
        </div>
      {/if}
    </section>
  {/if}

  <!-- Profile -->
  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Profile name</span></div>
    <ResourcePicker
      value={profile}
      fetcher={fetchProfiles}
      onChange={(v) => { profile = v; emit(); }}
      placeholder="select a profile"
      emptyHint="No profiles yet — type a new identifier (e.g. civilservicejobs-gov-uk)."
    />
    <div class="ps-hint">Stable identifier for this site. Cookies + solved CAPTCHAs persist under this name across runs.</div>
  </section>

  <!-- Advanced disclosure -->
  <section class="ps">
    <button class="ps-advanced-toggle" onclick={() => { advancedOpen = !advancedOpen; }}>
      {advancedOpen ? '▾' : '▸'} Advanced (wait condition, explicit extract rules, pagination, credentials)
    </button>
  </section>

{#if advancedOpen}

  <!-- Wait for -->
  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Wait for</span></div>
    <div class="ps-row">
      <select class="ps-select" value={waitType}
        onchange={(e) => { waitType = (e.target as HTMLSelectElement).value as typeof waitType; emit(); }}>
        <option value="networkidle">networkidle</option>
        <option value="selector">selector</option>
        <option value="timeout">timeout</option>
      </select>
      {#if waitType === 'selector'}
        <input class="ps-input" type="text" value={waitSelector}
          oninput={(e) => { waitSelector = (e.target as HTMLInputElement).value; emit(); }}
          placeholder="CSS selector" style="flex:1" />
        <input class="ps-input ps-input-narrow" type="number" value={waitSelectorMs}
          oninput={(e) => { waitSelectorMs = Number((e.target as HTMLInputElement).value); emit(); }}
          title="Timeout (ms)" placeholder="ms" />
      {:else if waitType === 'timeout'}
        <input class="ps-input ps-input-narrow" type="number" value={waitTimeoutMs}
          oninput={(e) => { waitTimeoutMs = Number((e.target as HTMLInputElement).value); emit(); }}
          placeholder="ms" />
      {/if}
    </div>
  </section>

  <!-- Extract rules -->
  <section class="ps">
    <div class="ps-hd">
      <span class="ps-label">Extract rules</span>
    </div>
    <div class="ps-rules">
      {#each extractRules as rule, i (i)}
        <div class="ps-rule-row">
          <input class="ps-input" type="text" value={rule.field}
            oninput={(e) => setRule(i, 'field', (e.target as HTMLInputElement).value)}
            placeholder="field name" title="Field name" style="width:90px;flex-shrink:0" />
          <input class="ps-input" type="text" value={rule.selector}
            oninput={(e) => setRule(i, 'selector', (e.target as HTMLInputElement).value)}
            placeholder="CSS selector" title="CSS selector" style="flex:1;min-width:0" />
          <select class="ps-select" value={rule.attr}
            onchange={(e) => setRule(i, 'attr', (e.target as HTMLSelectElement).value)}>
            <option value="text">text</option>
            <option value="html">html</option>
            <option value="href">href</option>
            <option value="src">src</option>
            <option value="custom">custom…</option>
          </select>
          {#if rule.attr === 'custom'}
            <input class="ps-input" type="text" value={rule.customAttr}
              oninput={(e) => setRule(i, 'customAttr', (e.target as HTMLInputElement).value)}
              placeholder="attr name" style="width:80px;flex-shrink:0" />
          {/if}
          <label class="ps-check" title="multi">
            <input type="checkbox" checked={rule.multi}
              onchange={(e) => setRule(i, 'multi', (e.target as HTMLInputElement).checked)} />
            <span>multi</span>
          </label>
          <label class="ps-check" title="trim">
            <input type="checkbox" checked={rule.trim}
              onchange={(e) => setRule(i, 'trim', (e.target as HTMLInputElement).checked)} />
            <span>trim</span>
          </label>
          <input class="ps-input" type="text" value={rule.regex}
            oninput={(e) => setRule(i, 'regex', (e.target as HTMLInputElement).value)}
            placeholder="regex (opt)" title="Optional regex" style="width:90px;flex-shrink:0" />
          <button class="ps-remove" onclick={() => removeRule(i)} title="Remove rule">×</button>
        </div>
      {/each}
      <button class="ps-add-btn" onclick={addRule}>+ Add rule</button>
    </div>
  </section>

  <!-- Pagination -->
  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Pagination</span></div>
    <div class="ps-row">
      <select class="ps-select" value={pagType}
        onchange={(e) => { pagType = (e.target as HTMLSelectElement).value as typeof pagType; emit(); }}>
        <option value="none">none</option>
        <option value="next-link">next-link</option>
        <option value="url-template">url-template</option>
      </select>
    </div>
    {#if pagType === 'next-link'}
      <div class="ps-row ps-row-gap">
        <input class="ps-input" type="text" value={pagSelector}
          oninput={(e) => { pagSelector = (e.target as HTMLInputElement).value; emit(); }}
          placeholder="selector for 'Next' link" style="flex:1" />
        <input class="ps-input ps-input-narrow" type="number" value={pagMaxPages}
          oninput={(e) => { pagMaxPages = Number((e.target as HTMLInputElement).value); emit(); }}
          title="Max pages" placeholder="maxPages" />
      </div>
    {:else if pagType === 'url-template'}
      <div class="ps-col">
        <input class="ps-input" type="text" value={pagTemplate}
          oninput={(e) => { pagTemplate = (e.target as HTMLInputElement).value; emit(); }}
          placeholder={'https://example.com/jobs?page={{page}}'} />
        <div class="ps-row ps-row-gap">
          <label class="ps-label-inline">Start page
            <input class="ps-input ps-input-narrow" type="number" value={pagStart}
              oninput={(e) => { pagStart = Number((e.target as HTMLInputElement).value); emit(); }} />
          </label>
          <label class="ps-label-inline">Max pages
            <input class="ps-input ps-input-narrow" type="number" value={pagMaxPages}
              oninput={(e) => { pagMaxPages = Number((e.target as HTMLInputElement).value); emit(); }} />
          </label>
        </div>
      </div>
    {/if}
  </section>

  <!-- Credential -->
  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Credential</span></div>
    <ResourcePicker
      value={credentialId}
      fetcher={fetchCredentials}
      onChange={(v) => { credentialId = v; emit(); }}
      placeholder="select a credential"
      emptyHint="No credentials saved — leave blank, or add one in /admin/connections/scraper."
    />
  </section>

  <!-- Pacing -->
  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Pacing</span><span class="ps-meta">optional — human-like delay between requests</span></div>
    <div class="ps-row ps-row-gap">
      <label class="ps-label-inline">Min ms
        <input class="ps-input ps-input-narrow" type="number"
          value={pacingMin ?? ''}
          oninput={(e) => { const v = (e.target as HTMLInputElement).value; pacingMin = v ? Number(v) : null; emit(); }}
          placeholder="800" />
      </label>
      <label class="ps-label-inline">Max ms
        <input class="ps-input ps-input-narrow" type="number"
          value={pacingMax ?? ''}
          oninput={(e) => { const v = (e.target as HTMLInputElement).value; pacingMax = v ? Number(v) : null; emit(); }}
          placeholder="2500" />
      </label>
    </div>
  </section>
{/if}

  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => onChange({ ...config, _onError: v })}
  />
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 0; }
  .ps { padding: 10px 0; border-bottom: 1px solid var(--divider); display: flex; flex-direction: column; gap: 6px; }
  .ps:last-child { border-bottom: none; }
  .ps-hd { display: flex; align-items: baseline; gap: 8px; }
  .ps-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .ps-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .ps-highlight {
    border-left: 2px solid var(--accent, #c4570a);
    padding-left: 10px;
    margin-left: -10px;
  }
  .ps-textarea {
    resize: vertical;
    min-height: 54px;
    font-family: var(--font-ui, inherit);
    font-size: var(--fs-label);
    line-height: 1.5;
  }
  .ps-advanced-toggle {
    background: transparent;
    border: 1px dashed var(--card-border, #333);
    color: var(--text-muted);
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    text-align: left;
    cursor: pointer;
    border-radius: 2px;
  }
  .ps-advanced-toggle:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }
  .ps-playbook {
    background: var(--bg-section, #111);
    border: 1px solid var(--card-border, #333);
    border-radius: 3px;
    padding: 8px 10px !important;
    margin: 4px 0;
  }
  .ps-playbook-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .ps-playbook-summary b { font-weight: 600; color: var(--text-primary); }
  .ps-playbook-goal {
    font-style: italic;
    margin-top: 4px;
    opacity: 0.9;
  }
  .ps-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
  }
  .ps-dot-green { background: var(--success); }
  .ps-dot-amber { background: var(--warn); }
  .ps-playbook-actions {
    display: flex;
    gap: 10px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .ps-link {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    padding: 2px 0;
    text-decoration: underline dotted;
  }
  .ps-link:hover:not(:disabled) { color: var(--accent, #c4570a); }
  .ps-link:disabled { opacity: 0.4; cursor: default; }
  .ps-link-danger { color: #c44; }
  .ps-link-danger:hover:not(:disabled) { color: #ff6b6b; }
  .ps-playbook-json {
    margin-top: 8px;
    max-height: 320px;
    overflow: auto;
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    padding: 8px;
    background: var(--bg, #0d0d0d);
    border: 1px solid var(--card-border, #333);
    border-radius: 2px;
    white-space: pre;
    color: var(--text-primary);
  }
  .ps-hint-error {
    color: #c44;
  }
  .ps-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .ps-hint code {
    color: var(--accent);
    font-family: var(--font-mono);
  }
  .ps-input {
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    padding: 4px 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    outline: none;
    box-sizing: border-box;
  }
  .ps-input:focus { border-color: var(--accent); }
  .ps-input-narrow { width: 80px; }
  .ps-select {
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    padding: 4px 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    outline: none;
  }
  .ps-select:focus { border-color: var(--accent); }
  .ps-select-wide { width: 100%; }
  .ps-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .ps-row-gap { gap: 10px; }
  .ps-col { display: flex; flex-direction: column; gap: 6px; }
  .ps-check {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
  }
  .ps-check input[type="checkbox"] { margin: 0; cursor: pointer; }
  .ps-label-inline {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .ps-rules { display: flex; flex-direction: column; gap: 5px; }
  .ps-rule-row {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    background: var(--bg-section);
    padding: 5px 6px;
    border: 1px solid var(--divider);
  }
  .ps-remove {
    background: none;
    border: none;
    color: var(--text-ghost);
    cursor: pointer;
    font-size: var(--fs-body-sm);
    padding: 0 2px;
    line-height: 1;
    flex-shrink: 0;
  }
  .ps-remove:hover { color: #c44; }
  .ps-add-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 4px 10px;
    color: var(--text-muted);
    background: var(--bg);
    border: 1px solid var(--card-border);
    cursor: pointer;
    align-self: flex-start;
  }
  .ps-add-btn:hover { border-color: var(--accent); color: var(--accent); }
</style>
