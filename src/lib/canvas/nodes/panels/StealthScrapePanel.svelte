<script lang="ts">
  import type { PanelProps } from './registry';
  import { onMount } from 'svelte';

  let { config, onChange }: PanelProps = $props();

  // Local draft — mirrored from config on mount and when config changes externally
  let url = $state((config.url as string) ?? '');
  let profile = $state((config.profile as string) ?? '');

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

  let profiles = $state<string[]>([]);
  let credentials = $state<Array<{ id: number; domain: string; label: string }>>([]);

  onMount(async () => {
    try {
      const [pRes, cRes] = await Promise.all([
        fetch('/api/scraper/profiles'),
        fetch('/api/scraper/credentials'),
      ]);
      if (pRes.ok) profiles = await pRes.json();
      if (cRes.ok) credentials = await cRes.json();
    } catch { /* non-fatal */ }
  });

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

    const out: Record<string, unknown> = { url, profile, wait, extractRules: rules, pagination };
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

  // Re-sync local state when config prop is replaced (e.g. after external save/revert)
  $effect(() => {
    url = (config.url as string) ?? '';
    profile = (config.profile as string) ?? '';
  });
</script>

<div class="panel">
  <!-- Target URL -->
  <section class="ps">
    <div class="ps-hd">
      <span class="ps-label">Target URL</span>
    </div>
    <input class="ps-input" type="text" value={url}
      oninput={(e) => { url = (e.target as HTMLInputElement).value; emit(); }}
      placeholder="https://example.com/jobs" />
    <div class="ps-hint">Supports <code>{'{{input.x}}'}</code> templates.</div>
  </section>

  <!-- Profile -->
  <section class="ps">
    <div class="ps-hd"><span class="ps-label">Profile</span></div>
    <input class="ps-input" type="text" list="scrape-profiles" value={profile}
      oninput={(e) => { profile = (e.target as HTMLInputElement).value; emit(); }}
      placeholder="e.g. civilservicejobs-gov-uk" />
    <datalist id="scrape-profiles">
      {#each profiles as p (p)}
        <option value={p}>{p}</option>
      {/each}
    </datalist>
  </section>

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
          placeholder="https://example.com/jobs?page={{page}}" />
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
    <select class="ps-select ps-select-wide" value={credentialId}
      onchange={(e) => { credentialId = (e.target as HTMLSelectElement).value; emit(); }}>
      <option value="">None</option>
      {#each credentials as c (c.id)}
        <option value={String(c.id)}>{c.label} ({c.domain})</option>
      {/each}
    </select>
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
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 0; }
  .ps { padding: 10px 0; border-bottom: 1px solid var(--divider); display: flex; flex-direction: column; gap: 6px; }
  .ps:last-child { border-bottom: none; }
  .ps-hd { display: flex; align-items: baseline; gap: 8px; }
  .ps-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .ps-meta {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-ghost);
  }
  .ps-hint {
    font-family: var(--font-mono);
    font-size: 9px;
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
    font-size: 11px;
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
    font-size: 11px;
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
    font-size: 9px;
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
    font-size: 10px;
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
    font-size: 14px;
    padding: 0 2px;
    line-height: 1;
    flex-shrink: 0;
  }
  .ps-remove:hover { color: #c44; }
  .ps-add-btn {
    font-family: var(--font-mono);
    font-size: 10px;
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
