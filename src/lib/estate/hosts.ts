// Host-level health for the two boxes on the LAN, and the rules that decide
// what counts as trouble.
//
// This is the half /admin/estate could never see. That page probes SERVICES —
// is :5173 answering, is AdGuard answering — which is a different question from
// how the machine underneath them is doing. On homeserv the gap is the whole
// story: 7.6GB of RAM, earlyoom SIGTERMed node seventeen times in the fortnight
// to 2026-08-29, and :5173 answered throughout. Every service tile was green
// while the box was being strangled.
//
// Pure module, no imports from anything server-side, so the thresholds below
// are unit-testable without standing a box up.
import { TAILNET } from './endpoints';

/** What ~/bin/vitals-agent.mjs serves on :9101. */
export interface HostVitals {
  host: string;
  at: string;
  uptimeSec: number;
  kernel: string;
  cpus: number;
  /** 1, 5 and 15-minute load averages. */
  load: number[];
  mem: { totalMb: number; availableMb: number; usedPct: number } | null;
  swap: { totalMb: number; usedMb: number; usedPct: number } | null;
  disk: { mount: string; totalGb: number; freeGb: number; usedPct: number | null } | null;
  /** Null where the box exposes no thermal zone — never 0, which would read as healthy. */
  tempC: number | null;
  agent: number;
}

/** The boxes that get a tile. Deliberately just the two John asked about: the
 *  VPS is a different kind of thing (it is where this code is running, and its
 *  pressure surfaces in CI as "runner lost communication"), and giving it a
 *  tile here would imply this page could tell you it had died. */
export interface HostTile {
  id: 'homeserv' | 'porkserv';
  label: string;
  /** Tailnet address, never the DHCP LAN one — porkserv's moves on a lease change. */
  address: string;
  vitalsUrl: string;
  /** One line on what the box is for, so the tile explains itself. */
  role: string;
}

export const HOST_TILES: HostTile[] = [
  {
    id: 'homeserv',
    label: 'homeserv',
    address: TAILNET.homeserv,
    vitalsUrl: `http://${TAILNET.homeserv}:9101/vitals`,
    role: 'Control node · Home Assistant, scrape proxy, backups, uptime monitor',
  },
  {
    id: 'porkserv',
    label: 'porkserv',
    address: TAILNET.porkserv,
    vitalsUrl: `http://${TAILNET.porkserv}:9101/vitals`,
    role: 'AdGuard DNS, CI builds, the gate lane',
  },
];

/** Thresholds. Each one is a number that has actually meant something here,
 *  not a round figure picked because it looked tidy. */
export const THRESHOLDS = {
  /** Disk. The VPS filling up is what CI reports as "runner lost
   *  communication"; porkserv now carries gate workspaces and node_modules. */
  diskPct: 85,
  /** Memory USED (i.e. under 10% of MemAvailable left). earlyoom starts killing
   *  well before 100%, so waiting for 95% would alert after the damage. */
  memPct: 90,
  /** Swap. homeserv habitually sits with 1-2GB swapped and is fine; sustained
   *  heavy swap is the shape that precedes an OOM kill, not light swap. */
  swapPct: 50,
  /** Load average per core, 5-minute. 2x means every core has a runnable
   *  process waiting behind the one it is executing. */
  loadPerCpu: 2,
  /** Temperature. Both boxes idle around 38-42C. */
  tempC: 80,
} as const;

/** Narrower than architecture/topology's HealthStatus on purpose: that union
 *  carries 'static' for catalogue entries nothing probes, which cannot apply to
 *  a machine. A host is up, struggling, gone, or unobserved. */
export type HostState = 'up' | 'degraded' | 'down' | 'unknown';

/** Everything currently wrong with a box, in plain words, worst first.
 *  Empty array means nothing is wrong — which is a different thing from
 *  "we could not tell", and the caller must keep them apart. */
export function vitalsConcerns(v: HostVitals | null): string[] {
  if (!v) return [];
  const out: string[] = [];

  if (v.disk?.usedPct != null && v.disk.usedPct >= THRESHOLDS.diskPct) {
    out.push(`disk ${v.disk.usedPct}% full · ${v.disk.freeGb}GB left`);
  }
  if (v.mem && v.mem.usedPct >= THRESHOLDS.memPct) {
    out.push(`memory ${v.mem.usedPct}% used · ${v.mem.availableMb}MB available`);
  }
  if (v.swap && v.swap.totalMb > 0 && v.swap.usedPct >= THRESHOLDS.swapPct) {
    out.push(`swap ${v.swap.usedPct}% used · ${v.swap.usedMb}MB`);
  }
  // The 5-minute figure, not the 1-minute: a single npm ci spikes the 1-minute
  // average past any threshold worth setting and would make the tile flicker
  // amber every time the gate ran, which is exactly when it is working.
  const load5 = v.load?.[1];
  if (load5 != null && v.cpus > 0 && load5 / v.cpus >= THRESHOLDS.loadPerCpu) {
    out.push(`load ${load5.toFixed(2)} on ${v.cpus} cores`);
  }
  if (v.tempC != null && v.tempC >= THRESHOLDS.tempC) {
    out.push(`${v.tempC}C`);
  }
  return out;
}

export interface HostCard {
  id: string;
  label: string;
  address: string;
  role: string;
  state: HostState;
  vitals: HostVitals | null;
  concerns: string[];
  services: { up: number; total: number; down: string[] };
  /** Why the state is what it is, when it is not simply 'up'. */
  reason: string | null;
}

/**
 * Fold vitals and service probes into one state.
 *
 * The ordering matters and is not arbitrary. A box whose services all answer
 * but whose agent does not is NOT down — it is a box we have partially lost
 * sight of, which is 'degraded'. Reporting that as 'down' next to a working
 * AdGuard is the false alarm that teaches you to ignore the tile, and this
 * estate has already learned that lesson twice (the WhatsApp bridge probe bound
 * to VPS loopback, and the Hermes probe asking the wrong path for months).
 */
export function hostState(opts: {
  vitals: HostVitals | null;
  servicesUp: number;
  servicesTotal: number;
  /** Labels of the services that did not answer, for the reason line. */
  servicesDown: string[];
  concerns: string[];
}): { state: HostState; reason: string | null } {
  const { vitals, servicesUp, servicesTotal, servicesDown, concerns } = opts;

  // Nothing answered at all — not the agent, not a single service.
  if (!vitals && servicesTotal > 0 && servicesUp === 0) {
    return { state: 'down', reason: 'nothing on this host is answering' };
  }
  // No agent, no services catalogued: we genuinely do not know.
  if (!vitals && servicesTotal === 0) {
    return { state: 'unknown', reason: 'no vitals agent and nothing probed' };
  }
  if (!vitals) {
    // The vitals agent is itself a catalogued service, so it is always in
    // servicesDown here. Naming it twice ("vitals agent not answering — Vitals
    // agent") is noise; anything ELSE that is down is the news.
    const others = servicesDown.filter((l) => !/vitals/i.test(l));
    const also = others.length ? ` · also ${others.join(', ')}` : '';
    return { state: 'degraded', reason: `vitals agent not answering${also}` };
  }
  if (servicesDown.length > 0) {
    return { state: 'degraded', reason: `not answering: ${servicesDown.join(', ')}` };
  }
  if (concerns.length > 0) {
    return { state: 'degraded', reason: concerns[0] };
  }
  return { state: 'up', reason: null };
}

/** Human-readable uptime. Days once past one, because "112 hours" is not a
 *  figure anyone reads at a glance. */
export function formatUptime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
