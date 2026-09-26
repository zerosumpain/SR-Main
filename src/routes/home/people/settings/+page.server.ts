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
const NUMBER = /^\+?[0-9]{7,15}$/;

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
    const number = String(form.get('whatsapp') ?? '').replace(/[\s()-]/g, '');
    if (number && !NUMBER.test(number)) return fail(400, { error: 'A WhatsApp number is 7–15 digits, with an optional +.', subject });

    const others = new Set(members.filter((m) => m.subject !== subject).map((m) => m.subject));
    const followAll = form.get('followAll') === 'on';
    const follow = form
      .getAll('follow')
      .map(String)
      .filter((s) => others.has(s));

    const patch: MemberPatch = {
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

    try {
      await updateMember(subject, patch);
    } catch (err) {
      const msg = errMsg(err);
      console.error('[home/people/settings] save failed:', msg.replace(/\+?\d{7,}/g, '[number]'));
      if (/household_member_email_idx|duplicate key/i.test(msg)) {
        return fail(400, { error: 'Someone else already has that email.', subject });
      }
      return fail(500, { error: 'That did not save. Try again.', subject });
    }

    // The companion pull steps its cursor past fixes it could not map to a
    // person on the app, so someone switched to the app now would never get
    // the history the pilot already holds. Re-read the pilot's window from
    // the start; the pull's per-person newest-fix check keeps it idempotent.
    if (source === 'companion' && current.source !== 'companion') {
      await setSetting(COMPANION_CURSOR_KEY, '');
    }
    return { saved: subject };
  },
};
