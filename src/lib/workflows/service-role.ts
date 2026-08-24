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
 *
 * `JKAI_BUILDER_PROCESS=1` still means `builder`: that variable is set in a
 * systemd unit on two hosts, and breaking it would silently hand the builder a
 * second scheduler.
 */

export type ServiceRole = 'web' | 'builder' | 'whatsapp';

export type PlatformService =
  | 'whatsapp'
  | 'homeassistant'
  | 'scheduler'
  | 'background';

const ROLE_SERVICES: Record<ServiceRole, PlatformService[]> = {
  web: ['whatsapp', 'homeassistant', 'scheduler', 'background'],
  builder: [],
  whatsapp: ['whatsapp'],
};

export function resolveServiceRole(env: NodeJS.ProcessEnv = process.env): ServiceRole {
  const explicit = (env.JKAI_SERVICE_ROLE ?? '').trim().toLowerCase();
  if (explicit === 'web' || explicit === 'builder' || explicit === 'whatsapp') return explicit;
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
 * would see `WHATSAPP_HERMES_BRIDGE_URL` set and conclude that it should
 * forward its sends — to itself.
 */
export function ownsWhatsAppSession(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveServiceRole(env) === 'whatsapp';
}
