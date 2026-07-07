import { register } from '../registry-internal';

// ============================================================================
// Scraper scripts — saved LLM-authored Playwright recipes per `profile`.
// The orchestrator uses these to inspect, edit, regenerate, and test scripts
// that drive `stealth-scrape` nodes. Every stealth-scrape node with a saved
// script for its profile dispatches through that script on every run (zero
// LLM cost). The script file lives on disk at
// `<projectRoot>/scraper-scripts/<profile>.py` on homeserv; the SvelteKit
// server bundles it into stdin of the Playwright harness as an async body.
// ============================================================================

register({
  name: 'scraper_script_list',
  description:
    'List every saved scrape script profile with its goal, seed URL, declared vars, run counters, ' +
    'and last-success timestamp. Use to discover what scrapers already exist before planning a new one.',
  parameters: { type: 'object', properties: {} },
  category: 'Scraper',
  toolset: 'scraper',
  handler: async () => {
    const { listScripts } = await import('$lib/workflows/scraper/script-store');
    const metas = await listScripts();
    return { success: true, data: metas };
  },
});

register({
  name: 'scraper_script_read',
  description:
    'Read the full Python script body plus metadata for a given profile. Returns `{ code, meta }`. ' +
    'Call this before editing — always reason from the current code, not from memory.',
  parameters: {
    type: 'object',
    properties: {
      profile: { type: 'string', description: 'Profile name, e.g. `civilservicejobs-gov-uk`.' },
    },
    required: ['profile'],
  },
  category: 'Scraper',
  toolset: 'scraper',
  handler: async (args) => {
    const { readScript } = await import('$lib/workflows/scraper/script-store');
    const result = await readScript(args.profile as string);
    if (!result) return { success: false, error: `No saved script for profile "${args.profile}"` };
    return { success: true, data: result };
  },
});

register({
  name: 'scraper_script_save',
  destructive: true,
  description:
    'Write (create or overwrite) a scrape script for a profile. The `code` is the body of an `async` ' +
    'Python function that receives `page` (a Playwright Page, persistent context, stealth-patched) ' +
    'and `vars` (dict of strings). It must `return` a list of dicts, each with a stable `url` key. ' +
    'Do NOT include `def` or `async def` — just the function body, indented as usual. The browser ' +
    'context is reused across runs so cookies persist. Use `page.context.new_page()` for parallel ' +
    'fetches. Keep it polite: cap concurrency at 4-6 for small sites, 10-15 for Google/Bing. ' +
    'Preserve `declaredVars` across edits unless the user explicitly asked to change them.',
  parameters: {
    type: 'object',
    properties: {
      profile: { type: 'string', description: 'Stable per-domain identifier, e.g. `civilservicejobs-gov-uk`.' },
      code: { type: 'string', description: 'Python function body. `page` and `vars` are in scope; `return` a list of dicts.' },
      goal: { type: 'string', description: 'Plain-English description of what the script extracts (one sentence).' },
      seedUrl: { type: 'string', description: 'Primary URL the script navigates to first.' },
      declaredVars: {
        type: 'array',
        description: 'Runtime variables the script reads via `vars.get("name")`. Used by the caller to decompose searchQuery into these slots.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            hint: { type: 'string', description: 'What this var means (shown to the decomposer LLM).' },
          },
          required: ['name', 'hint'],
        },
      },
    },
    required: ['profile', 'code', 'goal', 'seedUrl'],
  },
  category: 'Scraper',
  toolset: 'scraper',
  handler: async (args) => {
    const { readScript, writeScript } = await import('$lib/workflows/scraper/script-store');
    const profile = args.profile as string;
    const existing = await readScript(profile);
    const now = new Date().toISOString();
    await writeScript(profile, args.code as string, {
      goal: args.goal as string,
      seedUrl: args.seedUrl as string,
      declaredVars: (args.declaredVars as Array<{ name: string; hint: string }>) ?? existing?.meta.declaredVars ?? [],
      generatedAt: existing?.meta.generatedAt ?? now,
      lastSuccessAt: existing?.meta.lastSuccessAt ?? null,
      runCount: existing?.meta.runCount ?? 0,
      successCount: existing?.meta.successCount ?? 0,
    });
    return { success: true, data: { profile, savedAt: now, overwrote: !!existing } };
  },
});

register({
  name: 'scraper_script_delete',
  destructive: true,
  description:
    'Remove a saved scrape script for a profile. After this, the next stealth-scrape run will ' +
    'either fall through to the playbook path or re-author a new script (if `goal` is set on the node).',
  parameters: {
    type: 'object',
    properties: {
      profile: { type: 'string' },
    },
    required: ['profile'],
  },
  category: 'Scraper',
  toolset: 'scraper',
  handler: async (args) => {
    const { deleteScript } = await import('$lib/workflows/scraper/script-store');
    const removed = await deleteScript(args.profile as string);
    return { success: true, data: { profile: args.profile, removed } };
  },
});

register({
  name: 'scraper_script_test',
  description:
    'Execute a saved scrape script end-to-end against its site. Returns `{ itemCount, items[0..2], ' +
    'landedUrl, error }` — items are truncated to 3 for context safety. Use after editing a script ' +
    'to verify it still extracts correctly before the user triggers a live canvas run. Only runs on ' +
    'homeserv (residential IP); will fail on the VPS unless SCRAPER_ALLOW_NON_HOMESERV is set.',
  parameters: {
    type: 'object',
    properties: {
      profile: { type: 'string' },
      searchQuery: { type: 'string', description: 'Plain-English query the decomposer turns into declaredVars.' },
      vars: {
        type: 'object',
        description: 'Pre-resolved vars; bypass the decomposer. Overrides anything from searchQuery.',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['profile'],
  },
  category: 'Scraper',
  toolset: 'scraper',
  handler: async (args, ctx) => {
    const { runScript } = await import('$lib/workflows/scraper/script-runner');
    const r = await runScript({
      profile: args.profile as string,
      searchQuery: args.searchQuery as string | undefined,
      vars: args.vars as Record<string, string> | undefined,
      onProgress: (ev) => {
        if (!ctx?.emit) return;
        const t = ev.t as string | undefined;
        if (t === 'script.decompose.start') ctx.emit(`Decomposing query into vars…`);
        else if (t === 'script.decompose.done') ctx.emit(`Query decomposed — launching browser…`);
        else if (t === 'script.exec.start') ctx.emit(`Browser running script for "${args.profile as string}"…`);
        else if (t === 'script.exec.done') {
          const count = ev.itemCount as number | undefined;
          if (ev.success) ctx.emit(`Script finished — ${count ?? 0} item(s) extracted`);
          else ctx.emit(`Script finished with error: ${ev.error ?? 'unknown'}`);
        }
      },
    });
    return {
      success: r.success,
      data: {
        itemCount: r.items.length,
        sampleItems: r.items.slice(0, 3),
        landedUrl: r.landedUrl,
        error: r.error,
        stderrTail: r.stderr?.slice(-500),
      },
    };
  },
});

register({
  name: 'scraper_target_knowledge_lookup',
  description:
    'Look up what we know about one or more domains before planning a scraper workflow. ' +
    'Returns knowledge including whether each domain requires an interactive-step upstream ' +
    '(for CAPTCHAs, login walls, cookie consent), verified CSS selectors, and free-form notes. ' +
    'ALWAYS call this before planning any stealth-scrape node for the given URLs.',
  parameters: {
    type: 'object',
    properties: {
      domains: {
        type: 'array',
        items: { type: 'string' },
        description: 'URLs or hostnames to look up',
      },
    },
    required: ['domains'],
  },
  category: 'Scraper',
  toolset: 'scraper',
  handler: async (args) => {
    const { lookupByDomains } = await import('$lib/workflows/scraper/target-knowledge');
    const domains = args.domains as string[];
    const results = await lookupByDomains(domains);
    return { success: true, data: results };
  },
});
