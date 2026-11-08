import { CAPABILITY_DOMAINS, CAPABILITY_HOSTS, CAPABILITY_STATUSES, CUSTOM_TOOLSET_PREFIX, type CapabilityEntry } from './types';

/**
 * The drift guards, as a PURE function over the rows and a registry snapshot,
 * so the test can prove each one bites by feeding it a renamed tool or a
 * toolset with no row (`manifest.test.ts`).
 *
 * Returns one sentence per problem; empty means the manifest and the registry
 * agree.
 */
export interface RegistryTool {
  name: string;
  toolset: string;
  /** Tier from `tierOf`; only read-tier, never-confirm tools may be member-safe. */
  effect: string;
  confirm: string;
}

const TIME_WORDS = /\b(currently|nowadays|tonight|yesterday|tomorrow|this (?:week|month|year)|as of|coming soon)\b/i;
// Lower case only: "Today" is also the name of a page.
const TODAY = /\btoday\b/;
const DATE_LIKE = /\b(?:19|20)\d\d\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const COUNT_LIKE = /\b\d+\s+(?:tools?|toolsets?|calls?|rows?|records?|items?|entities|turns?|days?)\b/i;

export function manifestDrift(
  rows: readonly CapabilityEntry[],
  registry: readonly RegistryTool[],
  memberSafeTools: readonly string[],
): string[] {
  const problems: string[] = [];
  const byName = new Map(registry.map((t) => [t.name, t]));
  const toolsets = new Set(registry.map((t) => t.toolset));
  const ids = new Set<string>();
  const owner = new Map<string, string>();

  for (const row of rows) {
    if (ids.has(row.id)) problems.push(`${row.id}: duplicate id`);
    ids.add(row.id);
    if (!/^[a-z][a-z0-9-]*$/.test(row.id)) problems.push(`${row.id}: id is not kebab-case`);
    if (!(CAPABILITY_STATUSES as readonly string[]).includes(row.status)) problems.push(`${row.id}: unknown status ${row.status}`);
    if (row.host && !(CAPABILITY_HOSTS as readonly string[]).includes(row.host)) problems.push(`${row.id}: unknown host ${row.host}`);
    if (row.domain && !(CAPABILITY_DOMAINS as readonly string[]).includes(row.domain)) problems.push(`${row.id}: unknown domain ${row.domain}`);
    if (!row.pages.every((p) => p.startsWith('/'))) problems.push(`${row.id}: a page is not a site path`);
    for (const field of [row.blurb, row.notes ?? '']) {
      if (TIME_WORDS.test(field) || TODAY.test(field) || DATE_LIKE.test(field) || COUNT_LIKE.test(field)) {
        problems.push(`${row.id}: blurb or notes carry time-varying text ("${field.slice(0, 60)}…"); the catalogue is cached per release`);
      }
    }
    for (const source of row.keywords ?? []) {
      try {
        new RegExp(source, 'i');
      } catch {
        problems.push(`${row.id}: keyword pattern does not compile`);
      }
    }

    if (row.status === 'planned') {
      if (row.toolsets.length) problems.push(`${row.id}: a planned row has no toolsets until its tools ship`);
      if (row.alwaysOn?.length) problems.push(`${row.id}: a planned row is never always-on`);
      for (const name of row.tools) {
        if (byName.has(name)) problems.push(`${row.id}: planned, but ${name} is registered — flip it to live in this PR`);
      }
      if (!row.pages.length) problems.push(`${row.id}: a planned row links the page that does it today`);
      continue;
    }

    for (const ts of row.toolsets) {
      if (ts.startsWith(CUSTOM_TOOLSET_PREFIX)) problems.push(`${row.id}: ${ts} is under the reserved custom prefix`);
      if (owner.has(ts)) problems.push(`${ts}: described by both ${owner.get(ts)} and ${row.id}`);
      owner.set(ts, row.id);
      if (!toolsets.has(ts)) problems.push(`${row.id}: toolset ${ts} is not registered`);
    }
    for (const name of row.tools) {
      const tool = byName.get(name);
      if (!tool) problems.push(`${row.id}: names ${name}, which is not registered`);
      else if (!row.toolsets.includes(tool.toolset)) problems.push(`${row.id}: names ${name}, which is in toolset ${tool.toolset}`);
    }
    for (const name of row.alwaysOn ?? []) {
      if (!row.tools.includes(name)) problems.push(`${row.id}: always-on ${name} is not one of its tools`);
    }
    if (row.memberSafe) {
      if (row.status !== 'live') problems.push(`${row.id}: member-safe rows must be live`);
      for (const name of row.tools) {
        const tool = byName.get(name);
        if (!memberSafeTools.includes(name)) problems.push(`${row.id}: member-safe, but ${name} is not on MEMBER_SAFE_TOOLS`);
        if (tool && (tool.effect !== 'read' || tool.confirm !== 'never')) problems.push(`${row.id}: member-safe, but ${name} is not read-only`);
      }
    }
  }

  // The reverse: everything registered is described.
  for (const tool of registry) {
    if (tool.toolset.startsWith(CUSTOM_TOOLSET_PREFIX)) continue;
    const row = rows.find((r) => r.status !== 'planned' && r.toolsets.includes(tool.toolset));
    if (!row) problems.push(`toolset ${tool.toolset} (${tool.name}) has no capability row`);
    else if (!row.tools.includes(tool.name)) problems.push(`${row.id}: registered tool ${tool.name} is not named in its row`);
  }
  return [...new Set(problems)];
}
