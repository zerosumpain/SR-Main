// The estate endpoint catalogue: every URL across the estate that a human or a
// service can actually call, and what stands in front of it.
//
// Shaped after $lib/architecture/topology.ts — this is *data*, and the page is
// generated from it. Adding a service means adding one entry here; there is no
// layout or probe code to touch. The architecture map answers "how does this
// connect"; this answers "what can I open, and who else can".
//
// Exposure is the load-bearing field. It is not decoration: `public` means
// reachable from the open internet, and the page flags any public entry whose
// auth is `none`. That combination is the exact shape of the 2026-07-24
// incident, where AUTH_BYPASS=1 reached production and every request arrived
// from 127.0.0.1 via cloudflared, so "loopback only" silently meant "everyone".

/** Where the thing runs. */
export type EstateHost =
  | 'cloudflare'
  | 'vps'
  | 'homeserv'
  | 'porkserv'
  | 'external';

/** Who can reach it at the network layer, before any auth. */
export type Exposure =
  /** Open internet. */
  | 'public'
  /** Tailnet peers only (bound to a 100.x address). */
  | 'tailnet'
  /** Home LAN only (bound to a 192.168.x address). */
  | 'lan'
  /** 127.0.0.1 only — reachable from the box itself, or via a tunnel that
   *  terminates on it. See the header note: on the VPS this is NOT a security
   *  boundary for HTTP, because cloudflared makes every visitor look local. */
  | 'loopback';

/** What must be presented to get past the front door. */
export type AuthKind =
  /** Google sign-in, owner email. */
  | 'owner-session'
  /** Cloudflare Access in front of the origin. */
  | 'cf-access'
  /** Service-to-service bearer token or shared secret. */
  | 'service-token'
  /** The service's own username/password login. */
  | 'app-login'
  /** HTTP Basic. */
  | 'basic'
  /** SSH keys. */
  | 'ssh-key'
  /** Nothing. Fine on a loopback/LAN bind; a finding on a public one. */
  | 'none';

export interface EstateEndpoint {
  id: string;
  label: string;
  /** Clickable URL. Omit for things that are not HTTP (SSH, DNS, SMB). */
  url?: string;
  /** Shown when `url` is absent or differs from how you'd reach it locally. */
  address?: string;
  host: EstateHost;
  exposure: Exposure;
  auth: AuthKind;
  /** One line: what it is, and why it exists. */
  note: string;
  /** Where the thing is configured — the file you edit when it breaks. */
  configuredIn: string;
  /** Probe key in the /api/admin/estate/probe response. Absent = not probed. */
  probeId?: string;
  /** True when ~/bin/uptime-monitor.sh actually watches this URL. */
  monitored?: boolean;
  /** Set when an entry is deliberately exempt from the public+none finding. */
  exposureNote?: string;
}

export const HOST_LABELS: Record<EstateHost, string> = {
  cloudflare: 'Cloudflare',
  vps: 'Hetzner VPS · strangeserv · 157.180.19.38',
  homeserv: 'homeserv · 100.72.165.45',
  porkserv: 'porkserv · 100.83.68.108',
  external: 'External services',
};

/** Tailnet addresses, so the catalogue never hard-codes a DHCP LAN IP.
 *  porkserv's LAN address moves on a lease change; its tailnet address does not. */
export const TAILNET = {
  homeserv: '100.72.165.45',
  porkserv: '100.83.68.108',
  vps: '100.73.237.117',
} as const;

export const ENDPOINTS: EstateEndpoint[] = [
  // ---------------------------------------------------------------- public
  {
    id: 'site',
    label: 'strangeramblings.com',
    url: 'https://strangeramblings.com/',
    host: 'cloudflare',
    exposure: 'public',
    auth: 'none',
    note: 'The public site. Anonymous visitors see public pages; everything else redirects to sign-in.',
    configuredIn: 'Cloudflare tunnel → VPS :4173',
    probeId: 'site',
    monitored: true,
    exposureNote: 'Public by design — it is the website.',
  },
  {
    id: 'site-vitals',
    label: 'Landing vitals API',
    url: 'https://strangeramblings.com/api/landing/vitals',
    host: 'cloudflare',
    exposure: 'public',
    auth: 'owner-session',
    note: 'DB-backed, so it proves the database is reachable — not just that a warm process is serving HTML.',
    configuredIn: 'src/routes/api/landing/vitals/+server.ts',
    probeId: 'site-vitals',
    monitored: true,
  },
  {
    id: 'docs',
    label: 'sr-docs',
    url: 'https://docs.strangeramblings.com/',
    host: 'cloudflare',
    exposure: 'public',
    auth: 'cf-access',
    note: 'Documentation site behind Cloudflare Access.',
    configuredIn: 'sr-docs-site.service on the VPS',
    probeId: 'docs',
  },
  {
    id: 'library',
    label: 'sr-library',
    url: 'https://library.strangeramblings.com/',
    host: 'cloudflare',
    exposure: 'public',
    auth: 'cf-access',
    note: 'Library site behind Cloudflare Access.',
    configuredIn: 'sr-library.service on the VPS',
    probeId: 'library',
  },
  {
    id: 'dav',
    label: 'WebDAV mount',
    url: 'https://strangeramblings.com/dav/',
    host: 'cloudflare',
    exposure: 'public',
    auth: 'basic',
    note: 'Drive over WebDAV for Finder/Explorer. HTTP Basic against webdav_credentials — federated auth is not an option for OS mounts.',
    configuredIn: 'src/hooks.server.ts + $lib/webdav/auth',
  },

  // ------------------------------------------------------------------- VPS
  {
    id: 'vps-app',
    label: 'SvelteKit app',
    address: '127.0.0.1:4173',
    host: 'vps',
    exposure: 'loopback',
    auth: 'owner-session',
    note: 'The production origin. Only cloudflared talks to it directly.',
    configuredIn: 'strange-rambling-svelte.service',
    exposureNote: 'Loopback is not a boundary here — cloudflared makes every public visitor appear as 127.0.0.1.',
  },
  {
    id: 'vps-db',
    label: 'PostgreSQL 16',
    address: '127.0.0.1:5432',
    host: 'vps',
    exposure: 'loopback',
    auth: 'app-login',
    note: 'Production database, pgvector. Docker-published on loopback only.',
    configuredIn: 'docker compose · strange-rambling-app-db-1',
    probeId: 'database',
  },
  {
    id: 'vps-caddy',
    label: 'Caddy',
    address: '127.0.0.1:3000',
    host: 'vps',
    exposure: 'loopback',
    auth: 'none',
    note: 'Reverse proxy in front of the container services.',
    configuredIn: 'docker compose · strange-rambling-caddy-1',
  },
  {
    id: 'vps-umami',
    label: 'Umami analytics',
    address: '127.0.0.1:3002',
    host: 'vps',
    exposure: 'loopback',
    auth: 'app-login',
    note: 'Self-hosted analytics. Instrumented on /blog only — it is not sitewide.',
    configuredIn: 'docker compose · strange-rambling-umami-1',
  },
  {
    id: 'vps-preview',
    label: 'Dev preview',
    address: '127.0.0.1:3001',
    host: 'vps',
    exposure: 'loopback',
    auth: 'owner-session',
    note: 'Preview build served alongside production.',
    configuredIn: 'docker compose · strange-rambling-dev-preview-1',
  },
  {
    id: 'vps-wa',
    label: 'WhatsApp bridge',
    address: '127.0.0.1:3110',
    host: 'vps',
    exposure: 'loopback',
    auth: 'service-token',
    note: 'Moved here from homeserv with the WhatsApp session. Every owner alert, including backup failures, goes through it.',
    configuredIn: 'jkai-wa-worker.service',
    probeId: 'whatsapp-bridge',
  },
  {
    id: 'vps-builder',
    label: 'jkai-builder',
    address: 'unix socket',
    host: 'vps',
    exposure: 'loopback',
    auth: 'service-token',
    note: 'Autonomous build sidecar. Talks to the app over a unix socket, not a port.',
    configuredIn: 'jkai-builder.service',
  },
  {
    id: 'vps-codex',
    label: 'Codex bridge',
    address: '127.0.0.1:5207',
    host: 'vps',
    exposure: 'loopback',
    auth: 'service-token',
    note: 'Codex provider bridge, now speaking the raw Responses API.',
    configuredIn: 'jkai-codex-bridge.service',
  },
  {
    id: 'vps-webframe',
    label: 'webframe',
    address: '127.0.0.1:3303',
    host: 'vps',
    exposure: 'loopback',
    auth: 'none',
    note: 'Containerised frame renderer.',
    configuredIn: 'docker compose · webframe',
  },
  {
    id: 'vps-ssh',
    label: 'SSH',
    address: '157.180.19.38:22',
    host: 'vps',
    exposure: 'public',
    auth: 'ssh-key',
    note: 'Key-only, fail2ban in front. The one internet-facing shell in the estate.',
    configuredIn: '/etc/ssh/sshd_config · fail2ban',
    exposureNote: 'Public by necessity — it is how the box is administered. Password auth is off.',
  },

  // -------------------------------------------------------------- homeserv
  {
    id: 'hs-site',
    label: 'SvelteKit (homeserv)',
    url: `http://${TAILNET.homeserv}:5173/`,
    host: 'homeserv',
    exposure: 'lan',
    auth: 'none',
    note: 'Serves the scrape proxy and the local admin surface. Runs from ~/sr-homeserv-site, NOT the dev checkout.',
    configuredIn: 'systemd user unit · ~/sr-homeserv-site',
    probeId: 'homeserv',
  },
  {
    id: 'hs-ha',
    label: 'Home Assistant',
    url: 'http://homeserv.tail668b8c.ts.net:8123/',
    host: 'homeserv',
    exposure: 'lan',
    auth: 'app-login',
    note: 'Home automation. Its address lives in the database, not an env var — that is where to look when jkai loses it.',
    configuredIn: 'Docker on homeserv · address in the app DB',
    probeId: 'home-assistant',
  },
  {
    id: 'hs-vitals',
    label: 'Vitals agent',
    url: `http://${TAILNET.homeserv}:9101/vitals`,
    host: 'homeserv',
    exposure: 'tailnet',
    auth: 'none',
    note: 'Read-only host vitals (uptime, load, memory, swap, disk, temperature) for the /admin status strip. This is the box where memory pressure, not service failure, is what actually goes wrong.',
    configuredIn: '~/bin/vitals-agent.mjs · systemd --user homelab-vitals',
    probeId: 'homeserv-vitals',
    exposureNote: 'Binds 0.0.0.0 and gates in the handler to 100.64.0.0/10 + loopback, rather than binding to its own 100.x address: that bind loses a boot race against tailscaled and then restart-loops in silence. Serves load averages and nothing sensitive.',
  },
  {
    id: 'hs-ttyd',
    label: 'ttyd web terminal',
    url: 'http://homeserv.tail668b8c.ts.net:3010/',
    host: 'homeserv',
    exposure: 'lan',
    auth: 'none',
    note: 'Browser shell on homeserv. Bound to 0.0.0.0, so anything on the LAN can open a terminal.',
    configuredIn: 'ttyd (systemd)',
    probeId: 'ttyd',
    exposureNote: 'Not internet-facing, but unauthenticated on the LAN — the weakest link inside the house.',
  },
  {
    id: 'hs-mqtt',
    label: 'MQTT broker',
    address: '127.0.0.1:1883',
    host: 'homeserv',
    exposure: 'loopback',
    auth: 'none',
    note: 'Message bus for Home Assistant.',
    configuredIn: 'Mosquitto on homeserv',
  },
  {
    id: 'hs-smb',
    label: 'Samba shares',
    address: '0.0.0.0:445',
    host: 'homeserv',
    exposure: 'lan',
    auth: 'app-login',
    note: 'File shares for the LAN.',
    configuredIn: '/etc/samba/smb.conf',
  },
  {
    id: 'hs-db',
    label: 'PostgreSQL (local)',
    address: '127.0.0.1:5432',
    host: 'homeserv',
    exposure: 'loopback',
    auth: 'app-login',
    note: 'Development database. Refreshed from the production DB pull at 02:30.',
    configuredIn: 'Docker on homeserv',
  },
  {
    id: 'hs-ssh',
    label: 'SSH',
    address: '0.0.0.0:22',
    host: 'homeserv',
    exposure: 'lan',
    auth: 'ssh-key',
    note: 'Control node for the estate. Not port-forwarded — reachable from the LAN and the tailnet only.',
    configuredIn: '/etc/ssh/sshd_config',
    probeId: 'homeserv-ssh',
  },

  // -------------------------------------------------------------- porkserv
  {
    id: 'pork-adguard',
    label: 'AdGuard Home',
    url: `http://${TAILNET.porkserv}:8080/`,
    host: 'porkserv',
    exposure: 'lan',
    auth: 'app-login',
    note: 'Network-wide DNS filtering. The admin UI is :8080 — :3000 is the first-run setup wizard and closes once configured.',
    configuredIn: '~/porkserv/ (Ansible) · docker adguardhome',
    probeId: 'adguard',
  },
  {
    id: 'pork-adguard-dns',
    label: 'AdGuard DNS',
    address: `${TAILNET.porkserv}:53`,
    host: 'porkserv',
    exposure: 'lan',
    auth: 'none',
    note: 'The resolver itself. If this stops, LAN name resolution stops with it — a bigger blast radius than the UI suggests.',
    configuredIn: '~/porkserv/ (Ansible) · docker adguardhome',
    probeId: 'adguard-dns',
  },
  {
    id: 'pork-portainer',
    label: 'Portainer',
    url: `https://${TAILNET.porkserv}:9443/`,
    host: 'porkserv',
    exposure: 'lan',
    auth: 'app-login',
    note: 'Container management for porkserv. Self-signed certificate, so the browser will warn.',
    configuredIn: '~/porkserv/ (Ansible) · docker portainer',
    probeId: 'portainer',
  },
  {
    id: 'pork-runner',
    label: 'CI build runner',
    address: 'porkserv-builder (label: builder)',
    host: 'porkserv',
    exposure: 'lan',
    auth: 'service-token',
    note: 'Self-hosted GitHub Actions runner. Only runs jobs guarded by refs/heads/master — SR-Main is public, so a pull_request job here would let a stranger execute code on the box.',
    configuredIn: '~/porkserv/runner.yml',
  },
  {
    id: 'pork-vitals',
    label: 'Vitals agent',
    url: `http://${TAILNET.porkserv}:9101/vitals`,
    host: 'porkserv',
    exposure: 'tailnet',
    auth: 'none',
    note: 'Read-only host vitals for the /admin status strip. The same script homeserv runs, copied here by Ansible so there is one source of truth for both boxes.',
    configuredIn: '~/porkserv/vitals.yml · /usr/local/bin/vitals-agent.mjs',
    probeId: 'porkserv-vitals',
    exposureNote: 'Binds 0.0.0.0 and gates in the handler to 100.64.0.0/10 + loopback — see the homeserv entry. Runs under DynamicUser with ProtectSystem=strict; it can read /proc and write nothing.',
  },
  {
    id: 'pork-ssh',
    label: 'SSH',
    address: 'porkserv.Home:22',
    host: 'porkserv',
    exposure: 'lan',
    auth: 'ssh-key',
    note: 'Passwordless sudo is live, so SSH access as john is root. Use the name — the LAN address is DHCP.',
    configuredIn: '~/.ssh/config · /etc/sudoers.d/john-nopasswd',
    probeId: 'porkserv-ssh',
  },

  // -------------------------------------------------------------- external
  {
    id: 'github',
    label: 'GitHub · SR-Main',
    url: 'https://github.com/zerosumpain/SR-Main',
    host: 'external',
    exposure: 'public',
    auth: 'app-login',
    note: 'PUBLIC repository. Merging to master auto-deploys — never run deploy.sh by hand.',
    configuredIn: '.github/workflows/',
  },
  {
    id: 'cf-dash',
    label: 'Cloudflare dashboard',
    url: 'https://dash.cloudflare.com/',
    host: 'external',
    exposure: 'public',
    auth: 'app-login',
    note: 'DNS, tunnel and Access policies. A cache purge needs both an API token and the zone ID.',
    configuredIn: 'cloudflared on the VPS',
  },
  {
    id: 'hetzner',
    label: 'Hetzner console',
    url: 'https://console.hetzner.cloud/',
    host: 'external',
    exposure: 'public',
    auth: 'app-login',
    note: 'The VPS itself. Disk pressure here is what surfaces in CI as "runner lost communication".',
    configuredIn: 'n/a',
  },
  {
    id: 'azure',
    label: 'Azure Blob Storage',
    url: 'https://portal.azure.com/',
    host: 'external',
    exposure: 'public',
    auth: 'app-login',
    note: 'srdrive4bbb12aa — drive, media and blog containers, plus Terraform state.',
    configuredIn: 'Terraform · $lib/storage/azure-blob',
    probeId: 'azure',
  },
  {
    id: 'b2',
    label: 'Backblaze B2',
    url: 'https://secure.backblaze.com/',
    host: 'external',
    exposure: 'public',
    auth: 'app-login',
    note: 'Offsite restic target, 03:00 daily. It failed 25 consecutive nights unnoticed before alerting existed.',
    configuredIn: 'restic · ~/bin/ backup scripts',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    url: 'https://openrouter.ai/activity',
    host: 'external',
    exposure: 'public',
    auth: 'app-login',
    note: 'Every LLM call in the estate. Two live keys — the VPS bills its own, so one dashboard never shows the whole spend.',
    configuredIn: '$lib/llm/client',
    probeId: 'openrouter',
  },
  {
    id: 'tailscale',
    label: 'Tailscale admin',
    url: 'https://login.tailscale.com/admin/machines',
    host: 'external',
    exposure: 'public',
    auth: 'app-login',
    note: 'The tailnet that lets the VPS reach homeserv and porkserv. Five machines.',
    configuredIn: 'tailscaled on each host',
  },
];

/** Endpoints reachable from the open internet with nothing in front of them. */
export function publicUnauthenticated(list: EstateEndpoint[] = ENDPOINTS): EstateEndpoint[] {
  return list.filter((e) => e.exposure === 'public' && e.auth === 'none' && !e.exposureNote);
}

/** Endpoints the uptime monitor does not watch. Everything here fails silently. */
export function unmonitored(list: EstateEndpoint[] = ENDPOINTS): EstateEndpoint[] {
  return list.filter((e) => !e.monitored);
}

export function byHost(list: EstateEndpoint[] = ENDPOINTS): Array<[EstateHost, EstateEndpoint[]]> {
  const order: EstateHost[] = ['cloudflare', 'vps', 'homeserv', 'porkserv', 'external'];
  return order
    .map((h) => [h, list.filter((e) => e.host === h)] as [EstateHost, EstateEndpoint[]])
    .filter(([, items]) => items.length > 0);
}
