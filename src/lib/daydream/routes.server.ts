// src/lib/daydream/routes.server.ts
//
// The owner's route overrides, in `app_settings`. One JSON map, keyed by
// family id or kind, values from `ROUTE_OPTIONS`. Anything else in the stored
// value is dropped on read rather than trusted — a stale key from a renamed
// kind must not become a route nobody can see.

import { getSetting, setSetting } from '$lib/server/models/settings';
import { isRoute, type Route, type RouteOverrides } from './routes';

export const SETTINGS_ROUTES_KEY = 'daydream.routes';

export async function loadRoutes(): Promise<RouteOverrides> {
  const raw = await getSetting<Record<string, unknown>>(SETTINGS_ROUTES_KEY);
  const out: Record<string, Route> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) if (k && isRoute(v)) out[k] = v;
  }
  return out;
}

/** Set one override, or clear it with `null`. Returns the whole map. */
export async function setRoute(key: string, route: Route | null): Promise<RouteOverrides> {
  const clean = key.trim();
  if (!clean || clean.length > 80) throw new Error('a route needs a family or kind');
  if (route != null && !isRoute(route)) throw new Error(`unknown route: ${String(route)}`);
  const current = { ...(await loadRoutes()) } as Record<string, Route>;
  if (route == null) delete current[clean];
  else current[clean] = route;
  await setSetting(SETTINGS_ROUTES_KEY, current);
  return current;
}
