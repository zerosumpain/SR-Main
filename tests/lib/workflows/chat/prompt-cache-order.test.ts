import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const SRC = readFileSync(resolve(ROOT, 'src/lib/workflows/chat/general-chat.ts'), 'utf8');

/**
 * Prompt caching matches on a PREFIX. The first byte that differs between two
 * turns invalidates everything after it — including the ~5KB of tool schemas
 * and the entire history that follow the system message.
 *
 * `graphSection` is rebuilt per message by `buildKnowledgeContext(userMessage)`
 * and sat seventh of thirteen, so canvas context, pasted URLs, the scraper
 * playbook and the API section were all uncacheable by construction. Measured
 * on production: 224 codex calls at 54.1% cached, first decile 69 calls at 0%
 * while averaging 8,998 input tokens; the first turn measured after the
 * telemetry landed cached 25.4%.
 *
 * These are source assertions because the alternative is standing up a model
 * loop, and the property being protected is an ORDERING — exactly the sort of
 * thing a later edit reshuffles without noticing.
 */

/** Rebuilt from this message, every turn. */
const VOLATILE = ['scraperSection', 'compressionSection'];
/** Identical on the next turn of the same conversation. */
const STABLE = ['basePrompt', 'siteSection', 'skillsSection', 'apiFirstSection'];

/** The two halves of the system prompt, exactly as written in the source. */
function promptHalves(): { prefix: string; suffix: string } {
  const m = SRC.match(/const stablePrefix = `([^`]*)`;[\s\S]*?const perTurnSuffix = `([^`]*)`;/);
  if (!m) throw new Error('could not find the system prompt assembly');
  return { prefix: m[1], suffix: m[2] };
}

/** `${name}` as it appears inside the template literal. */
function slot(name: string): string {
  return '${' + name + '}';
}

describe('system prompt is assembled stable-first, for the cache', () => {
  it('splits the prompt into a stable prefix and a per-turn suffix', () => {
    expect(SRC).toMatch(/const stablePrefix = `/);
    expect(SRC).toMatch(/const perTurnSuffix = `/);
    expect(SRC).toContain('const systemContent = `' + slot('stablePrefix') + slot('perTurnSuffix') + slot('BEHAVIOUR_POLICY') + '${renderGlobalGuidance(capabilityPolicy)}${renderAnswerContract(contract)}`');
  });

  it.each(STABLE)('%s sits in the cacheable prefix', (name) => {
    expect(promptHalves().prefix).toContain(slot(name));
  });

  it.each(VOLATILE)('%s sits after everything stable', (name) => {
    expect(promptHalves().suffix).toContain(slot(name));
  });

  it('puts every stable section before every volatile one', () => {
    // The property that actually matters, asserted across the whole string
    // rather than on which half a name happened to land in.
    const { prefix, suffix } = promptHalves();
    const whole = prefix + suffix;
    const lastStable = Math.max(...STABLE.map((n) => whole.indexOf(slot(n))));
    const firstVolatile = Math.min(
      ...VOLATILE.map((n) => whole.indexOf(slot(n))).filter((i) => i >= 0),
    );
    expect(lastStable).toBeGreaterThanOrEqual(0);
    expect(firstVolatile).toBeGreaterThan(lastStable);
  });

  it('keeps retrieved memory, pages and graph outside the system instructions', () => {
    const { prefix, suffix } = promptHalves();
    for (const name of ['memorySection', 'pastedUrlsSection', 'graphSection']) expect(prefix + suffix).not.toContain(slot(name));
    expect(SRC).toContain('JSON.stringify({ memory: memorySection, graph: graphSection, pages: pastedUrlsSection })');
  });
});

describe('the Home Assistant registry is not read on every turn', () => {
  it('counts entities instead of selecting the row', () => {
    // 91,135 characters across 415 entities in production, fetched
    // sequentially ahead of the first token, to satisfy two `.length` checks.
    expect(SRC).toMatch(/jsonb_array_length/);
    expect(SRC).toMatch(/haEntityCount/);
  });

  it('loads the registry only behind a lazy getter', () => {
    expect(SRC).toMatch(/const loadHaEntities = async/);
    // The one place that genuinely needs the rows.
    expect(SRC).toMatch(/buildHASystemPromptSection\(await loadHaEntities\(\)\)/);
  });

  it('no longer keeps the whole registry in the tool-call context', () => {
    expect(SRC).not.toMatch(/haEntities: any\[\];/);
  });
});

describe('tools the prompt orders are actually handed over', () => {
  it('pushes them by name, not by dragging their toolsets in', () => {
    // `research_web_search` lives in `research`, which also carries nine
    // session-management tools nobody wants on an ordinary turn.
    expect(SRC).toMatch(/ALWAYS_ON_TOOL_NAMES/);
    expect(SRC).toMatch(/getToolDefinitionsByName\(ALWAYS_ON_TOOL_NAMES\)/);
    for (const t of ['api_search', 'api_call', 'datastore_query', 'research_web_search', 'fetch_url']) {
      expect(SRC).toContain(`'${t}'`);
    }
  });

  it('never imports ESSENTIAL_TOOL_NAMES, which it was documented as relying on', () => {
    // That set lives in $lib/mcp/essentials and is read by the tool-policy
    // publisher. This file has never imported it, so the comment claiming those
    // tools stayed reachable through it was describing something that was not
    // happening.
    expect(SRC).not.toMatch(/ESSENTIAL_TOOL_NAMES\s*\}/);
    expect(SRC).not.toMatch(/import .*essentials/);
  });
});
