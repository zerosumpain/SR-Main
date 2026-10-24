// The Build menu (spec §9.3 step 1): ten trays, each item with its cost and
// upkeep, and locked items with a padlock and the reason. Built from the
// engine's catalogue, so a new building or a retuned price shows up here
// without a page change. The app draws these trays in SwiftUI from the wire's
// affordances; harness mode draws them from this list.

import { BUILDINGS, RAIL_DEF, ROAD_DEFS, TIER_DEFS, TIER_NAMES, ZONE_DEFS, formatPounds, type BuildingGroup, type TownState } from '../engine';
import type { Tool } from './plan';

export const TRAYS = ['Roads', 'Zones', 'Power & Water', 'Safety', 'Learning', 'Health', 'Fun', 'Culture & Visitors', 'Transport', 'Landmarks'] as const;
export type TrayName = (typeof TRAYS)[number];

const TRAY_OF_GROUP: Record<BuildingGroup, TrayName | null> = {
  civic: null,
  power: 'Power & Water',
  water: 'Power & Water',
  police: 'Safety',
  fire: 'Safety',
  primary: 'Learning',
  secondary: 'Learning',
  library: 'Learning',
  university: 'Learning',
  health: 'Health',
  park: 'Fun',
  fun: 'Fun',
  youth: 'Fun',
  culture: 'Culture & Visitors',
  attraction: 'Culture & Visitors',
  transit: 'Transport',
  freight: 'Transport',
  gateway: 'Transport',
  landmark: 'Landmarks',
};

export interface TrayItem {
  tray: TrayName;
  label: string;
  tool: Tool;
  /** £ to build (per tile for roads and zones). */
  cost: number;
  /** £ a month at Normal funding. */
  upkeep: number;
  /** Why it cannot be used yet, or null. */
  locked: string | null;
}

const titled = (s: string) => s[0].toUpperCase() + s.slice(1);

/** "Unlocks at Town: 2,000 people" (§9.3). */
export function unlockReason(tier: number): string {
  const def = TIER_DEFS[tier];
  const name = titled(TIER_NAMES[tier] ?? 'later');
  return def && def.population > 0 ? `Unlocks at ${name}: ${formatPounds(def.population).slice(1)} people` : `Unlocks at ${name}`;
}

/** Every Build item for this town, tray by tray. */
export function trayItems(t: TownState): TrayItem[] {
  const out: TrayItem[] = [];
  for (const r of [...ROAD_DEFS.filter((d) => d.id !== 'county'), RAIL_DEF]) {
    out.push({ tray: 'Roads', label: titled(r.id), tool: { kind: 'road', variant: r.id }, cost: r.build, upkeep: r.upkeep, locked: t.tier < r.unlock ? unlockReason(r.unlock) : null });
  }
  for (const r of ROAD_DEFS.filter((d) => d.id === 'street' || d.id === 'avenue')) {
    out.push({ tray: 'Roads', label: `Upgrade to ${r.id}`, tool: { kind: 'upgrade', variant: r.id }, cost: r.build, upkeep: r.upkeep, locked: t.tier < r.unlock ? unlockReason(r.unlock) : null });
  }
  out.push({ tray: 'Roads', label: 'Bulldoze', tool: { kind: 'bulldoze' }, cost: 0, upkeep: 0, locked: null });
  for (const z of ZONE_DEFS) {
    let locked: string | null = null;
    if (t.tier < z.unlock) locked = unlockReason(z.unlock);
    else if (t.tier > z.zoneUntil) locked = `New ${z.id} zones stop at ${titled(TIER_NAMES[z.zoneUntil])}`;
    out.push({ tray: 'Zones', label: titled(z.id), tool: { kind: 'zone', variant: z.id }, cost: 0, upkeep: 0, locked });
  }
  out.push({ tray: 'Zones', label: 'Clear zoning', tool: { kind: 'dezone' }, cost: 0, upkeep: 0, locked: null });
  if (t.parcelRights > 0) out.push({ tray: 'Zones', label: `Open new land (${t.parcelRights} left)`, tool: { kind: 'parcel' }, cost: 0, upkeep: 0, locked: null });
  for (const b of BUILDINGS) {
    const tray = TRAY_OF_GROUP[b.group];
    if (!tray || b.free) continue;
    out.push({ tray, label: b.name, tool: { kind: 'place', id: b.id, rot: 0 }, cost: b.build, upkeep: b.upkeep, locked: t.tier < b.tier ? unlockReason(b.tier) : null });
  }
  return out;
}
