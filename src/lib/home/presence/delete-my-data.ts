// src/lib/home/presence/delete-my-data.ts
//
// "Delete my uploaded data" on /welcome (spec Contract G). Two stores hold
// what the iPhone app uploaded for a person, and the button empties both:
//
//  1. The pilot (SR-AppleApp): health records, deletion tombstones, locations,
//     alerts, the phone's device and pair credentials; sharing turns off.
//     (`household/data/delete`, Contract F.)
//  2. This site's copy of their movement: `daydream_trail` rows with
//     `source = 'companion'` for their household subject — the trail
//     /home/people draws, which the household ingest copied from the pilot.
//
// What stays, and the confirm text says so: Apple Health on the phone itself,
// trail rows from Life360 / Home Assistant (a different source the owner set
// up), their named places, and their account on both.
//
// The pilot goes FIRST, and a pilot failure stops before the site is touched:
// "deleted" must mean both, and a retry then does both. A 404 from the pilot
// is a failure too — it is also what a pilot without Contract F answers.

import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamTrail } from '$lib/db/schema';
import { deletePilotData, pilotFailureText, type PilotDeleted, type PilotResult } from './companion-accounts';
import { memberByEmail } from './members';

/** The confirm field must hold exactly this word. */
export const DELETE_CONFIRM_WORD = 'delete';

export interface DeleteDeps {
  pilotDelete: (email: string) => Promise<PilotResult<PilotDeleted>>;
  /** The household subject whose trail this email's phone wrote, or null. */
  subjectFor: (email: string) => Promise<string | null>;
  /** Remove that subject's companion-sourced trail rows; the number removed. */
  deleteCompanionTrail: (subject: string) => Promise<number>;
}

export type DeleteOutcome =
  | { ok: true; pilot: Record<string, number>; trailRows: number }
  | { ok: false; status: number; error: string };

export const defaultDeleteDeps: DeleteDeps = {
  pilotDelete: (email) => deletePilotData(email),
  subjectFor: async (email) => (await memberByEmail(email))?.subject ?? null,
  deleteCompanionTrail: async (subject) => {
    const rows = await db
      .delete(daydreamTrail)
      .where(and(eq(daydreamTrail.subject, subject), eq(daydreamTrail.source, 'companion')))
      .returning({ id: daydreamTrail.id });
    return rows.length;
  },
};

export async function deleteMyUploadedData(
  email: string,
  confirm: unknown,
  deps: DeleteDeps = defaultDeleteDeps,
): Promise<DeleteOutcome> {
  const e = email.trim().toLowerCase();
  if (!e) return { ok: false, status: 401, error: 'Sign in first.' };
  if (typeof confirm !== 'string' || confirm.trim().toLowerCase() !== DELETE_CONFIRM_WORD) {
    return { ok: false, status: 400, error: `Type “${DELETE_CONFIRM_WORD}” to confirm.` };
  }

  const pilot = await deps.pilotDelete(e);
  if (!pilot.ok) {
    return { ok: false, status: 502, error: `Nothing was deleted. ${pilotFailureText(pilot.reason)}` };
  }

  let trailRows = 0;
  try {
    const subject = await deps.subjectFor(e);
    if (subject) trailRows = await deps.deleteCompanionTrail(subject);
  } catch (err) {
    console.error('[welcome] companion trail delete failed:', err);
    return {
      ok: false,
      status: 500,
      error: 'The app’s copy was deleted, but this site’s copy of your movement could not be. Try again in a minute.',
    };
  }
  return { ok: true, pilot: pilot.value.counts, trailRows };
}
