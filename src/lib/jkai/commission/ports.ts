/**
 * What commissioning needs from two domains that already depend on `$lib/jkai`
 * (daydream's quota reader, the improvement backlog's intake). Each registers
 * its half at boot (`registerCommissionQuota`, `registerCommissionIntake`,
 * called from `src/hooks.server.ts`), so `$lib/jkai` never imports them back:
 * a `jkai -> daydream` or `jkai -> selfimprove` import would put a cycle in
 * front of `check-module-boundaries`.
 *
 * Unregistered (a script, a test that does not set them), the quota reads as
 * unknown and intake is skipped, which is what a failed read already did.
 */

export interface CommissionIdea {
  title: string;
  detail: string;
  kind: 'feature';
  priority: number;
  source: string;
  ref: string;
}

export interface CommissionPorts {
  /** The ChatGPT windows now, or null when they cannot be read. */
  quotaMark: () => Promise<{ fiveHourPct: number; weeklyPct: number } | null>;
  /** File the ask on the backlog; the slug it landed under, if any. */
  intake: (idea: CommissionIdea) => Promise<{ slug?: string }>;
}

const UNSET: CommissionPorts = {
  quotaMark: async () => null,
  intake: async () => ({}),
};

let ports: CommissionPorts = { ...UNSET };

export function setCommissionPorts(next: Partial<CommissionPorts>): void {
  ports = { ...ports, ...next };
}

/** Back to unregistered — for tests. */
export function resetCommissionPorts(): void {
  ports = { ...UNSET };
}

export function commissionPorts(): CommissionPorts {
  return ports;
}
