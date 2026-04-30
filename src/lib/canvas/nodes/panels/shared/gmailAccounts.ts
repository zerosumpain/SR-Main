// Shared Gmail accounts fetcher for all Gmail panels.
// Module-scoped cache so re-mounting any Gmail panel doesn't re-fetch the
// accounts list on every drawer open. The cache survives across panel
// types (send / fetch / reply / search / label / trigger) for one session.

export type GmailAccount = {
  id: number;
  email: string;
  status?: string | null;
};

export type GmailAccountOption = {
  value: string;
  label: string;
  meta?: string;
};

let accountsPromise: Promise<GmailAccount[]> | null = null;

export function loadGmailAccounts(): Promise<GmailAccount[]> {
  if (!accountsPromise) {
    accountsPromise = fetch('/api/gmail/accounts')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((rows): GmailAccount[] => {
        if (!Array.isArray(rows)) return [];
        return rows
          .filter((r) => r && typeof r === 'object')
          .map((r) => ({
            id: Number((r as Record<string, unknown>).id ?? 0),
            email: String((r as Record<string, unknown>).email ?? ''),
            status: (r as Record<string, unknown>).status as string | null | undefined,
          }))
          .filter((r) => r.id > 0);
      })
      .catch((err) => {
        // Reset so the next mount can retry.
        accountsPromise = null;
        throw err instanceof Error ? err : new Error(String(err));
      });
  }
  return accountsPromise;
}

// ResourcePicker-shaped fetcher. The picker stores `value` as a string;
// callers convert back to number before writing to the node config.
export async function fetchGmailAccountOptions(): Promise<GmailAccountOption[]> {
  const rows = await loadGmailAccounts();
  return rows.map((a) => ({
    value: String(a.id),
    label: a.email || `account #${a.id}`,
    meta: a.status ? `${a.status} · #${a.id}` : `#${a.id}`,
  }));
}
