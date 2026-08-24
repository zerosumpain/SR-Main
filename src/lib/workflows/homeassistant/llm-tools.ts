import type { HAEntity } from './types';

// NOTE: the ha_* LLM tool definitions live in the site-tools registry
// (src/lib/workflows/site-tools/tools/home-assistant.ts, toolset 'home').
// A former HA_TOOL_DEFINITIONS const here duplicated them and was dead
// (zero importers) — removed. This module now only builds the entity-summary
// prompt section, which general-chat injects when the 'home' toolset activates.

export function buildEntitySummary(entities: HAEntity[]): string {
  const byArea = new Map<string, HAEntity[]>();
  for (const e of entities) {
    const area = e.area_name || 'Ungrouped';
    const list = byArea.get(area) || [];
    list.push(e);
    byArea.set(area, list);
  }

  const lines: string[] = [];
  for (const [area, areaEntities] of byArea) {
    const byDomain = new Map<string, string[]>();
    for (const e of areaEntities) {
      const list = byDomain.get(e.domain) || [];
      list.push(e.friendly_name);
      byDomain.set(e.domain, list);
    }

    const parts = Array.from(byDomain.entries())
      .map(([domain, names]) => {
        if (names.length <= 3) return `${names.join(', ')} (${domain})`;
        return `${names.length} ${domain}s`;
      })
      .join(', ');

    lines.push(`${area}: ${parts}`);
  }

  return lines.join('\n');
}

export function buildHASystemPromptSection(entities: HAEntity[]): string {
  if (entities.length === 0) return '';
  const summary = buildEntitySummary(entities);
  return `\n\n--- Home Assistant Smart Home ---
This is an INDEX OF NAMES ONLY. It carries no readings, no states and no values —
a device appearing here says nothing about whether it is on, off, available or
what it currently reads.

To answer anything about a current value or state you MUST call ha_query_state
(or ha_find to locate an entity first). Never infer a reading from this list, and
never report a device as working or unavailable because of how it appears here.

If a queried entity comes back \`unavailable\`, say so plainly and check whether
another entity covers the same thing — several devices often report the same
measurement and only some are alive.

Available areas and devices:

${summary}

Use exact entity_id values when calling functions (e.g. "light.living_room_ceiling", not "living room ceiling light").`;
}
