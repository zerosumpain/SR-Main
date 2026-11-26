/**
 * Which platform services THIS process is responsible for.
 *
 * The site's long-running services — the WhatsApp socket, Home Assistant, the
 * workflow scheduler, the stale-run reaper, memory review — must run in exactly
 * one process. They used to be gated by a single boolean:
 *
 *     const RUN_PLATFORM_SERVICES = process.env.JKAI_BUILDER_PROCESS !== '1';
 *
 * which answers one question ("am I the builder?") and is therefore all-or-
 * nothing. A process that wants to own the WhatsApp socket and nothing else has
 * no way to say so: it would also start the scheduler and the reaper, and two
 * schedulers on one database means every cron fires twice.
 *
 * That is the blocker to moving WhatsApp off homeserv, so the flag becomes a
 * ROLE.
 *
 *   web       every service. The SvelteKit web app — the default, and exactly
 *             what the old boolean did when it was true.
 *   builder   none. The jkai-builder sidecar imports this module transitively
 *             and must own nothing.
 *   whatsapp  the WhatsApp socket only. A dedicated worker, so a web deploy
 *             does not drop the session every time it restarts.
 *   http      the production web app once the worker below runs beside it:
 *             requests, and the in-memory game rooms they hold, but no
 *             scheduler and no background engines.
 *   worker    the production background process (strange-rambling-worker on
 *             the VPS): the heartbeat, scheduled and forge engines, the
 *             pollers and the watches, and none of the request-bound state.
 *             It took them off the web process, where a 39 s daydream-think or
 *             the 30 s household-live tick shared one event loop with every
 *             page (2.5–4.4 s stalls every six hours; review 2026-11-25).
 *
 * `web` stays "everything" for homeserv and any host that runs one process.
 * An unknown role also reads as `web`, which is why a rollback to a release
 * that predates `http`/`worker` must stop the worker first (ci-release.sh and
 * scripts/rollback.sh do): otherwise both processes run every engine.
 *
 * `JKAI_BUILDER_PROCESS=1` still means `builder`: that variable is set in a
 * systemd unit on two hosts, and breaking it would silently hand the builder a
 * second scheduler.
 */

export type ServiceRole = 'web' | 'builder' | 'whatsapp' | 'http' | 'worker';

export type PlatformService =
  | 'whatsapp'
  | 'homeassistant'
  | 'scheduler'
  | 'background'
  /** The durable game-room sweep: rooms live in the memory of the process that serves them. */
  | 'rooms'
  /**
   * "Tell me when" event monitors. The platform bus is in-process, so every
   * process that emits events listens for its own; the ledger's dedupe keys
   * and intervals keep two listeners from notifying twice.
   */
  | 'events'
  /** Re-reads the trail when another process says it wrote to it ($lib/home/presence/peer-signals.server). */
  | 'peers';

const ROLE_SERVICES: Record<ServiceRole, PlatformService[]> = {
  web: ['whatsapp', 'homeassistant', 'scheduler', 'background', 'rooms', 'events', 'peers'],
  builder: [],
  whatsapp: ['whatsapp'],
  // Both keep the WhatsApp and Home Assistant clients: on the VPS neither holds
  // a socket (WhatsApp delegates to jkai-wa-worker, Home Assistant is REST),
  // and each process sends through them.
  http: ['whatsapp', 'homeassistant', 'rooms', 'events', 'peers'],
  worker: ['whatsapp', 'homeassistant', 'scheduler', 'background', 'events', 'peers'],
};

const ROLES = Object.keys(ROLE_SERVICES) as ServiceRole[];

export function resolveServiceRole(env: NodeJS.ProcessEnv = process.env): ServiceRole {
  const explicit = (env.JKAI_SERVICE_ROLE ?? '').trim().toLowerCase();
  if ((ROLES as string[]).includes(explicit)) return explicit as ServiceRole;
  // Legacy: the builder's unit sets this on both hosts.
  if (env.JKAI_BUILDER_PROCESS === '1') return 'builder';
  return 'web';
}

/** Does this process run the named service? */
export function runsService(
  service: PlatformService,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return ROLE_SERVICES[resolveServiceRole(env)].includes(service);
}

/**
 * Is this process the one that HOLDS the WhatsApp session?
 *
 * Separate from `runsService('whatsapp')` in intent, and the reason the
 * delegation switch cannot simply read an environment variable: a WhatsApp
 * worker deployed alongside the web app reads the SAME EnvironmentFile, so it
 * would see the bridge URL set and conclude that it should
 * forward its sends — to itself.
 */
export function ownsWhatsAppSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveServiceRole(env) === 'whatsapp';
}

/** Does this process serve the site's own pages and tools (not a sidecar)? */
export function servesSite(env: NodeJS.ProcessEnv = process.env): boolean {
  const role = resolveServiceRole(env);
  return role === 'web' || role === 'http' || role === 'worker';
}
