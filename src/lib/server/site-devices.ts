// Every phone paired to the SITE (chat & news lane), whoever paired it.
//
// `native-auth.listDevices` answers for one owner — the viewer — which is what
// the pairing endpoint needs. /admin/access/devices is the owner's view of the
// whole household, so it reads across owners here, read-only. Revoking still
// goes through `native-auth.revokeDevice(ownerEmail, id)`, which re-checks the
// pairing belongs to that person.
//
// Never selects `token_hash`: this is a list for a page, not a credential store.

import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { nativeCredentials } from '$lib/db/schema';

export interface SiteDevice {
  id: string;
  ownerEmail: string;
  label: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  useCount: number;
}

export async function listAllSiteDevices(): Promise<SiteDevice[]> {
  return db
    .select({
      id: nativeCredentials.id,
      ownerEmail: nativeCredentials.ownerEmail,
      label: nativeCredentials.label,
      createdAt: nativeCredentials.createdAt,
      expiresAt: nativeCredentials.expiresAt,
      revokedAt: nativeCredentials.revokedAt,
      lastUsedAt: nativeCredentials.lastUsedAt,
      useCount: nativeCredentials.useCount,
    })
    .from(nativeCredentials)
    .where(eq(nativeCredentials.kind, 'device'))
    .orderBy(desc(nativeCredentials.createdAt));
}
