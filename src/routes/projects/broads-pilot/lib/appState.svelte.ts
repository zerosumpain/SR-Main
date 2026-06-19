// Central rune-store for the Broads Pilot planner. Holds the loaded datasets,
// the user's boat/origin/itinerary, map + layer UI state, and derives the route,
// reachability and daylight budget from the engine. Instantiated once.
import type { Datasets, Boat, Mooring, Poi, RouteLeg } from './types';
import { loadDatasets } from './data';
import { buildAdjacency, nearestNode } from './graph';
import { route as computeRoute, reachable as computeReachable } from './router';
import { daylightHours } from './daylight';
import { routeFuel } from './fuel';
import type { Units } from './format';

// Broads centroid for daylight (lat/lng barely affects sun times across the area).
const BROADS_LAT = 52.62;
const BROADS_LNG = 1.5;

export interface Origin { lat: number; lng: number; nodeId: string; label: string }
export type Selection =
  | { kind: 'mooring'; id: string }
  | { kind: 'poi'; id: string }
  | { kind: 'bridge'; id: string }
  | { kind: 'lock'; id: string }
  | null;

export class AppState {
  data = $state<Datasets | null>(null);
  loading = $state(true);
  error = $state<string | null>(null);

  boat = $state<Boat | null>(null);
  origin = $state<Origin | null>(null);
  destinationNode = $state<string | null>(null);
  itinerary = $state<string[]>([]); // ordered node ids (moorings/broads/staithes)

  selected = $state<Selection>(null);
  layers = $state({ restrictions: true, moorings: true, pubs: true, walks: true, attractions: false });
  dogOnly = $state(false);
  showRangeRings = $state(false);
  mapTheme = $state<'warm' | 'nautical'>('warm');
  units = $state<Units>('imperial');
  date = $state<Date>(new Date());
  onboarded = $state(false);

  // ---- derived ----
  adjacency = $derived(this.data ? buildAdjacency(this.data.graph) : null);

  mooringsByNode = $derived.by(() => {
    const map = new Map<string, Mooring[]>();
    if (!this.data) return map;
    for (const m of this.data.moorings) {
      if (!m.node_id) continue;
      (map.get(m.node_id) ?? map.set(m.node_id, []).get(m.node_id)!).push(m);
    }
    return map;
  });

  daylightSeconds = $derived(daylightHours(this.date, BROADS_LAT, BROADS_LNG) * 3600);

  route = $derived.by((): RouteLeg | null => {
    if (!this.data || !this.boat || !this.origin || !this.destinationNode) return null;
    if (this.origin.nodeId === this.destinationNode) return null;
    return computeRoute(this.data.graph, this.data.restrictions, this.boat, this.origin.nodeId, this.destinationNode);
  });

  routeFuelCost = $derived(this.route ? routeFuel(this.route) : null);

  // Multi-stop itinerary: origin → stop0 → stop1 …
  itineraryLegs = $derived.by((): RouteLeg[] => {
    if (!this.data || !this.boat || !this.origin || this.itinerary.length === 0) return [];
    const legs: RouteLeg[] = [];
    let from = this.origin.nodeId;
    for (const to of this.itinerary) {
      if (from === to) continue;
      legs.push(computeRoute(this.data!.graph, this.data!.restrictions, this.boat!, from, to));
      from = to;
    }
    return legs;
  });

  itinerarySummary = $derived.by(() => {
    const legs = this.itineraryLegs;
    if (!legs.length) return null;
    const reachableLegs = legs.filter((l) => l.edges.length > 0);
    const distance_m = reachableLegs.reduce((s, l) => s + l.distance_m, 0);
    const time_s = reachableLegs.reduce((s, l) => s + l.time_s, 0);
    const litres = reachableLegs.reduce((s, l) => s + routeFuel(l).litres, 0);
    const blocked = legs.some((l) => l.edges.length === 0);
    const crossesBreydon = legs.some((l) => l.crossesBreydon);
    const overDaylight = time_s > this.daylightSeconds;
    return { distance_m, time_s, litres, cost: litres * 1.6, blocked, crossesBreydon, overDaylight, legCount: legs.length };
  });

  reachable = $derived.by(() => {
    if (!this.data || !this.boat || !this.origin) return null;
    // budget at a generous full-daylight ceiling; the UI flags legs that won't
    // fit a single day's cruising.
    return computeReachable(this.data.graph, this.data.restrictions, this.boat, this.origin.nodeId, this.daylightSeconds);
  });

  // ---- actions ----
  async load() {
    try {
      this.data = await loadDatasets(fetch);
      this.boat = this.data.fleet.find((b) => b.class === 'generic') ?? this.data.fleet[0] ?? null;
      this.loading = false;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to load data';
      this.loading = false;
    }
  }

  selectBoat(slug: string) {
    this.boat = this.data?.fleet.find((b) => b.slug === slug) ?? this.boat;
  }

  setOrigin(lat: number, lng: number, label = 'Current location') {
    if (!this.data) return;
    const nodeId = nearestNode(this.data.graph, lat, lng);
    const node = this.data.graph.nodes.find((n) => n.id === nodeId)!;
    this.origin = { lat: node.lat, lng: node.lng, nodeId, label };
    this.destinationNode = null;
  }

  setOriginNode(nodeId: string, label: string) {
    const node = this.data?.graph.nodes.find((n) => n.id === nodeId);
    if (node) { this.origin = { lat: node.lat, lng: node.lng, nodeId, label }; this.destinationNode = null; }
  }

  routeTo(nodeId: string) {
    this.destinationNode = nodeId;
  }

  addStop(nodeId: string) {
    if (!this.itinerary.includes(nodeId)) this.itinerary = [...this.itinerary, nodeId];
  }
  removeStop(i: number) {
    this.itinerary = this.itinerary.filter((_, idx) => idx !== i);
  }
  clearItinerary() { this.itinerary = []; }

  select(sel: Selection) { this.selected = sel; }
  closeSelection() { this.selected = null; }

  nodeLabel(nodeId: string): string {
    const m = this.mooringsByNode.get(nodeId)?.[0];
    if (m) return m.name;
    const node = this.data?.graph.nodes.find((n) => n.id === nodeId);
    if (node?.id.startsWith('broad-')) return node.id.replace('broad-', '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (node?.id.startsWith('staithe-')) return node.id.replace('staithe-', '').replace(/-/g, ' ') + ' Staithe';
    return 'Selected point';
  }

  // ---- persistence ----
  snapshot() {
    return {
      boat: this.boat?.slug, origin: this.origin, destinationNode: this.destinationNode,
      itinerary: this.itinerary, mapTheme: this.mapTheme, units: this.units,
      layers: this.layers, dogOnly: this.dogOnly, onboarded: this.onboarded,
    };
  }
  restore(s: Partial<ReturnType<AppState['snapshot']>>) {
    if (s.boat) this.selectBoat(s.boat);
    if (s.origin) this.origin = s.origin;
    if (s.destinationNode) this.destinationNode = s.destinationNode;
    if (s.itinerary) this.itinerary = s.itinerary;
    if (s.mapTheme) this.mapTheme = s.mapTheme;
    if (s.units) this.units = s.units;
    if (s.layers) this.layers = { ...this.layers, ...s.layers };
    if (typeof s.dogOnly === 'boolean') this.dogOnly = s.dogOnly;
    if (typeof s.onboarded === 'boolean') this.onboarded = s.onboarded;
  }
}

export const app = new AppState();
