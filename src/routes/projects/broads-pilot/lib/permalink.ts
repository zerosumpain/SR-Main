// Encode/restore the shareable plan in the URL query (like policy-engine
// permalinks). Origin/destination/stops are graph node ids; boat is a slug.
import type { AppState } from './appState.svelte';

export function encodePlan(app: AppState): string {
  const p = new URLSearchParams();
  if (app.boat) p.set('boat', app.boat.slug);
  if (app.origin) p.set('from', app.origin.nodeId);
  if (app.destinationNode) p.set('to', app.destinationNode);
  if (app.itinerary.length) p.set('stops', app.itinerary.join(','));
  if (app.mapTheme !== 'warm') p.set('theme', app.mapTheme);
  if (app.units !== 'imperial') p.set('units', app.units);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function decodePlan(app: AppState, params: URLSearchParams): void {
  const boat = params.get('boat');
  if (boat) app.selectBoat(boat);
  const from = params.get('from');
  if (from) app.setOriginNode(from, app.nodeLabel(from));
  const to = params.get('to');
  if (to) app.routeTo(to);
  const stops = params.get('stops');
  if (stops) app.itinerary = stops.split(',').filter(Boolean);
  const theme = params.get('theme');
  if (theme === 'nautical') app.mapTheme = 'nautical';
  const units = params.get('units');
  if (units === 'metric') app.units = 'metric';
}
