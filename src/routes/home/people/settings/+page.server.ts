import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { setSetting } from '$lib/server/models/settings';
import { errMsg } from '$lib/home/presence/types';
import { COMPANION_CURSOR_KEY } from '$lib/home/presence/companion';
import {
  MEMBER_SOURCES,
  listMembers,
  updateMember,
  type HouseholdMember,
  type MemberPatch,
  type MemberSource,
} from '$lib/home/presence/members';

// The owner's household settings: who each person is, where their trail comes
// from, their WhatsApp number, and whose movements alert them. Owner only —
// the load and EVERY action check, belt and braces behind the hook.
//
// A WhatsApp number reaches the browser only as the value of its own input on
// this owner-only page; everywhere else it is masked.

export const load: PageServerLoad = async (event) => {
  if (!(await isOwnerRequest(event))) error(403, 'Forbidden');
  event.setHeaders({ 'cache-control': 'private, no-store' });
  try {
    return { members: await listMembers(), sources: [...MEMBER_SOURCES], loadError: null as string | null };
  } catch (err) {
    console.error('[home/people/settings] load failed:', errMsg(err));
    return { members: [] as HouseholdMember[], sources: [...MEMBER_SOURCES], loadError: errMsg(err) };
  }
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164 without the `+`: a country code (never 0) and 8–15 digits in all. */
const E164 = /^[1-9][0-9]{7,14}$/;

/**
 * A typed WhatsApp number as the digits WhatsApp addresses, or null when it
 * cannot be one. The household is in the UK, so a national `07…` becomes
 * `447…`; `+` and the `00` international prefix are dropped. Stored this way
 * because the send turns the digits straight into a JID, and a JID built from
 * `07…` is a number that does not exist: WhatsApp drops it without an error.
 */
function normaliseWhatsApp(typed: string): string | null {
  let n = typed.replace(/[\s().-]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0')) n = `44${n.slice(1)}`;
  return E164.test(n) ? n : null;
}

function isSource(v: string): v is MemberSource {
  return (MEMBER_SOURCES as readonly string[]).includes(v);
}

export const actions: Actions = {
  save: async (event) => {
    if (!(await isOwnerRequest(event))) return fail(403, { error: 'Owner access required.', subject: null });
    const form = await event.request.formData();
    const subject = String(form.get('subject') ?? '').trim();

    const members = await listMembers();
    const current = members.find((m) => m.subject === subject);
    if (!current) return fail(404, { error: 'No such person.', subject: subject || null });

    const displayName = String(form.get('displayName') ?? '').trim();
    if (!displayName || displayName.length > 60) {
      return fail(400, { error: 'A name of 1–60 characters.', subject });
    }
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    if (email && !EMAIL.test(email)) return fail(400, { error: 'That email does not look right.', subject });
    const source = String(form.get('source') ?? '');
    if (!isSource(source)) return fail(400, { error: 'Pick where their location comes from.', subject });
    if (source === 'companion' && !email) {
      return fail(400, { error: 'Someone on the app needs the email they sign in with.', subject });
    }
    const typed = String(form.get('whatsapp') ?? '').trim();
    const number = typed ? normaliseWhatsApp(typed) : null;
    if (typed && !number) {
      return fail(400, {
        error: 'That WhatsApp number does not look right. Use 07… for a UK mobile, or + and the country code.',
        subject,
      });
    }

    const others = new Set(members.filter((m) => m.subject !== subject).map((m) => m.subject));
    const followAll = form.get('followAll') === 'on';
    const follow = form
      .getAll('follow')
      .map(String)
      .filter((s) => others.has(s));

    const guardianOf = form
      .getAll('guardianOf')
      .map(String)
      .filter((s) => others.has(s));

    const patch: MemberPatch = {
      guardianOf,
      displayName,
      email: email || null,
      source,
      whatsapp: number || null,
      alerts: {
        // Absent means everyone, including anyone added later.
        ...(followAll ? {} : { follow }),
        whatsapp: form.get('whatsappOn') === 'on',
      },
    };

    let memberSaved = false;
    try {
      await updateMember(subject, patch);
      memberSaved = true;
      // The companion pull steps its cursor past fixes it could not map to a
      // person on the app, so someone switched to the app now would never get
      // the history the pilot already holds. Re-read the pilot's window from
      // the start; the pull's per-person newest-fix check keeps it idempotent.
      if (source === 'companion' && current.source !== 'companion') {
        await setSetting(COMPANION_CURSOR_KEY, '');
      }
    } catch (err) {
      const msg = errMsg(err);
      console.error('[home/people/settings] save failed:', msg.replace(/\+?\d{7,}/g, '[number]'));
      if (/household_member_email_idx|duplicate key/i.test(msg)) {
        return fail(400, { error: 'Someone else already has that email.', subject });
      }
      if (memberSaved) {
        // The member row is saved; only the cursor reset failed. Say so,
        // rather than "did not save" over a change that did.
        return fail(500, {
          error: 'Saved, but the app’s earlier fixes for them will not be re-read. Set them back to Life360 and to the app again to retry.',
          subject,
        });
      }
      return fail(500, { error: 'That did not save. Try again.', subject });
    }

    return { saved: subject };
  },
};
