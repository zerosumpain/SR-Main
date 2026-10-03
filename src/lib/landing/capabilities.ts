// The shape of the landing page's capability facts. Kept apart from
// capabilities.server.ts so components can name the type without touching a
// server module.

export interface CapabilityFacts {
  daydream: {
    cadenceMinutes: number;
    activeHours: { start: number; end: number };
    /** Share of rated notes marked useful over `windowDays`, 0..1. */
    hitRate: number | null;
    windowDays: number;
  };
  app: { nativeEndpoints: number };
}
