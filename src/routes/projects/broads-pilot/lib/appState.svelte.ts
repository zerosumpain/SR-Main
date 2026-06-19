// Central rune-store for the Broads Pilot planner. Holds the loaded datasets,
// the user's boat/origin/itinerary, map + layer UI state, and derives the route,
// reachability and daylight budget from the engine. Instantiated once.
import type { Datasets, Boat, Mooring, Poi, RouteLeg, PoiKind, LatLng, GraphEdge } from './types';
import { loadDatasets } from './data';
import { buildAdjacency, nearestNode } from './graph';
import { route as computeRoute, reachable as computeReachable } from './router';
import { daylightHours } from './daylight';
import { routeFuel } from './fuel';
import { haversine, distToSegment } from './geo';
import type { Units } from './format';

export interface UserPosition { lat: number; lng: number; speed: number | null; heading: number | null; accuracy: number }
export interface NearbyItem { id: string; sel: Selection; kind: 'mooring' | PoiKind; name: string; lat: number; lng: number; dist_m: number; dog: boolean | null }

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
  layers = $state({ restrictions: true, moorings: true, pubs: true, walks: true, attractions: false, speed: false, services: false });
  dogOnly = $state(false);
  showRangeRings = $state(false);
  mapTheme = $state<'warm' | 'nautical' | 'schematic'>('warm');
  units = $state<Units>('imperial');
  sheetPx = $state(142); // current mobile sheet height — so the FABs can ride with it
  date = $state<Date>(new Date());
  onboarded = $state(false);

  // ---- live "cruise" mode ----
  cruiseActive = $state(false);
  userPosition = $state<UserPosition | null>(null);
  followUser = $state(true);
  geoError = $state<string | null>(null);
  _lastFix: { lat: number; lng: number; t: number } | null = null; // plain (not reactive)

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

  // The node a new stop would continue FROM: the last stop in the trip, or the
  // origin when the trip is empty. Drives "add another stop from my last
  // location" — reachability, candidate legs and labels are all measured here.
  lastStopNodeId = $derived(this.itinerary.length ? this.itinerary[this.itinerary.length - 1] : (this.origin?.nodeId ?? null));
  lastStopLabel = $derived(
    this.itinerary.length ? this.nodeLabel(this.itinerary[this.itinerary.length - 1]) : (this.origin?.label ?? 'Start'),
  );

  // Reachability from the END of the trip (so range rings / exploration answer
  // "where can I get to next?"). Falls back to origin reachability when empty.
  reachableFromLast = $derived.by(() => {
    if (!this.data || !this.boat) return null;
    const from = this.lastStopNodeId;
    if (!from) return null;
    if (!this.itinerary.length) return this.reachable;
    return computeReachable(this.data.graph, this.data.restrictions, this.boat, from, this.daylightSeconds);
  });
  // What the map's range rings should show: from the last stop while building a
  // trip, otherwise from the origin.
  reachableActive = $derived(this.itinerary.length ? this.reachableFromLast : this.reachable);

  /** Compute the leg a node would add to the trip — from the current last stop. */
  legFromLast(toNode: string): RouteLeg | null {
    const from = this.lastStopNodeId;
    if (!this.data || !this.boat || !from || from === toNode) return null;
    return computeRoute(this.data.graph, this.data.restrictions, this.boat, from, toNode);
  }

  // ---- live cruise derivations ----
  speedMph = $derived(this.userPosition?.speed != null && this.userPosition.speed >= 0 ? this.userPosition.speed * 2.236936 : 0);

  // On the Broads = within the area bbox AND within ~800 m of the navigable channel.
  onBroads = $derived.by(() => {
    const u = this.userPosition;
    if (!u || !this.data) return false;
    if (u.lat < 52.26 || u.lat > 52.9 || u.lng < 1.22 || u.lng > 1.86) return false;
    return this.distToNetwork(u.lat, u.lng) <= 800;
  });

  moving = $derived(this.speedMph >= 1.3); // ~1.3 mph — under way, not just GPS jitter
  cruising = $derived(this.cruiseActive && this.onBroads && this.moving);

  // Nearest navigable edge to the live position (≤120 m) → its speed limit. Used
  // for the live "you're in an X mph zone" readout. Only computed while on the
  // Broads to keep the per-fix cost down.
  currentEdge = $derived.by((): GraphEdge | null => {
    const u = this.userPosition;
    if (!u || !this.data || !this.onBroads) return null;
    const e = this.nearestEdge(u.lat, u.lng, 120);
    return e?.edge ?? null;
  });
  currentLimitMph = $derived(this.currentEdge?.limit_mph ?? null);
  // Over the posted limit (with a 0.8 mph GPS-noise tolerance), and actually under way.
  overLimit = $derived(
    this.currentLimitMph != null && this.moving && this.speedMph > this.currentLimitMph + 0.8,
  );

  // The one mode that drives the single info sheet (explore → route → trip → live).
  mode = $derived<'live' | 'trip' | 'route' | 'explore'>(
    this.cruiseActive ? 'live'
      : this.itinerary.length > 0 ? 'trip'
        : this.destinationNode ? 'route'
          : 'explore',
  );

  // Notable things within ~600 m of the live position, nearest first.
  nearby = $derived.by((): NearbyItem[] => {
    const u = this.userPosition;
    if (!u || !this.data) return [];
    const here: LatLng = [u.lat, u.lng];
    const items: NearbyItem[] = [];
    for (const m of this.data.moorings)
      items.push({ id: m.id, sel: { kind: 'mooring', id: m.id }, kind: 'mooring', name: m.name, lat: m.lat, lng: m.lng, dist_m: haversine(here, [m.lat, m.lng]), dog: null });
    for (const p of this.data.pois)
      items.push({ id: p.id, sel: { kind: 'poi', id: p.id }, kind: p.kind, name: p.name, lat: p.lat, lng: p.lng, dist_m: haversine(here, [p.lat, p.lng]), dog: p.dog_friendly ?? null });
    return items.filter((i) => i.dist_m <= 600).sort((a, b) => a.dist_m - b.dist_m).slice(0, 6);
  });

  // ---- actions ----
  async load() {
    try {
      this.data = await loadDatasets(fetch);
      this.boat = this.data.fleet.find((b) => b.class === 'generic') ?? this.data.fleet[0] ?? null;
      // Default the start to the Richardsons hire base at Stalham (most common
      // trip origin). Restored URL/localStorage state overrides this afterwards.
      if (!this.origin && this.data.graph.nodes.some((n) => n.id === 'staithe-stalham'))
        this.setOriginNode('staithe-stalham', 'Stalham (Richardsons)');
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

  /** Nearest navigable edge to a point, within `maxDist` metres (null if none). */
  nearestEdge(lat: number, lng: number, maxDist = 150): { edge: GraphEdge; dist_m: number } | null {
    if (!this.data) return null;
    const p: LatLng = [lat, lng];
    let best: GraphEdge | null = null;
    let bd = maxDist;
    for (const e of this.data.graph.edges)
      for (let i = 1; i < e.geometry.length; i++) {
        const d = distToSegment(p, e.geometry[i - 1], e.geometry[i]);
        if (d < bd) { bd = d; best = e; if (d < 8) return { edge: e, dist_m: d }; }
      }
    return best ? { edge: best, dist_m: bd } : null;
  }

  /** Min distance (m) from a point to the navigable channel (early-exits when close). */
  distToNetwork(lat: number, lng: number): number {
    if (!this.data) return Infinity;
    const p: LatLng = [lat, lng];
    let best = Infinity;
    for (const e of this.data.graph.edges)
      for (let i = 1; i < e.geometry.length; i++) {
        const d = distToSegment(p, e.geometry[i - 1], e.geometry[i]);
        if (d < 25) return d;
        if (d < best) best = d;
      }
    return best;
  }

  setUserPosition(c: { latitude: number; longitude: number; speed: number | null; heading: number | null; accuracy: number | null }) {
    let speed = c.speed;
    const now = Date.now();
    if ((speed == null || speed < 0) && this._lastFix) {
      const dt = (now - this._lastFix.t) / 1000;
      if (dt > 0.25) speed = haversine([this._lastFix.lat, this._lastFix.lng], [c.latitude, c.longitude]) / dt;
    }
    this._lastFix = { lat: c.latitude, lng: c.longitude, t: now };
    this.userPosition = { lat: c.latitude, lng: c.longitude, speed: speed ?? null, heading: c.heading, accuracy: c.accuracy ?? 9999 };
  }

  startCruise() { this.cruiseActive = true; this.followUser = true; this.geoError = null; }
  stopCruise() { this.cruiseActive = false; this.userPosition = null; this._lastFix = null; }

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
