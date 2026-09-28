import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { RequestEvent } from '@sveltejs/kit';
import { isOwnerEmail } from '$lib/server/access';
import { isOwnerRequest } from '$lib/server/owner';
import { addToAllowList } from '$lib/server/allow-list';
import { setUserAccess } from '$lib/server/grants';
import { revokeDevice } from '$lib/server/native-auth';
import { loadPerson, removePerson } from '$lib/people/people.server';
import { linkSignInEmail } from '$lib/people/link-email';
import { setSetting } from '$lib/server/models/settings';
import { COMPANION_CURSOR_KEY } from '$lib/home/presence/companion';
import { createMember, listMembers, updateMember } from '$lib/home/presence/members';
import { readMemberForm } from '$lib/home/presence/member-form';
import { errMsg } from '$lib/home/presence/types';
import { pilotFailureText, revokePilotDevice } from '$lib/home/presence/companion-accounts';

// One person, everything about them: access, household, phones. Owner-only —
// /admin is never in the access catalogue, so the hook's default deny covers
// the page and every action. A WhatsApp number reaches the browser only as
// the value of its own input here.
//
// Spec: docs/superpowers/specs/2026-09-28-people-and-app-registration.md

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Belt and braces behind the hook: this page holds WhatsApp numbers and every
 * permission, so the load and each action check the owner themselves.
 */
async function personOr404(event: RequestEvent) {
  if (!(await isOwnerRequest(event))) error(403, 'Forbidden');
  const found = await loadPerson(event.params.person ?? '');
  if (!found) error(404, 'Nobody by that name');
  return found;
}

export const load: PageServerLoad = async (event) => {
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const { person, roles, household, deviceWarnings } = await personOr404(event);
  return { person, roles, household, deviceWarnings };
};

export const actions: Actions = {
  /** role + grants (JSON) — what they may do. The server prunes adds the role gives. */
  access: async (event) => {
    const { request } = event;
    const { person } = await personOr404(event);
    if (person.kind !== 'account' || !person.email) return fail(400, { error: 'Only an account has access to set.' });
    const form = await request.formData();
    const role = String(form.get('role') ?? '');
    let grants: unknown = [];
    try {
      grants = JSON.parse(String(form.get('grants') ?? '[]'));
    } catch {
      return fail(400, { error: 'Those permissions did not read.' });
    }
    if (!Array.isArray(grants)) return fail(400, { error: 'Those permissions did not read.' });
    const saved = await setUserAccess(person.email, { groups: role ? [role] : [], grants });
    if (!saved) return fail(404, { error: 'They are no longer on the allow-list.' });
    return { saved: 'access' };
  },

  /** The household row's details. */
  household: async (event) => {
    const { request } = event;
    const { person } = await personOr404(event);
    const current = person.household;
    if (!current) return fail(400, { error: 'They are not in the household.' });
    const form = await request.formData();
    // An account's household email IS their sign-in: never edited apart from it.
    if (person.kind !== 'household' && person.email) form.set('email', person.email);
    const members = await listMembers();
    const read = readMemberForm(form, members.filter((m) => m.subject !== current.subject));
    if ('error' in read) return fail(400, { error: read.error });
    try {
      await updateMember(current.subject, read.patch);
    } catch (err) {
      const msg = errMsg(err);
      console.error('[admin/access/person] household save failed:', msg.replace(/\+?\d{7,}/g, '[number]'));
      if (/household_member_email_idx|duplicate key/i.test(msg)) return fail(400, { error: 'Someone else already has that email.' });
      return fail(500, { error: 'That did not save. Try again.' });
    }
    // The companion pull steps its cursor past fixes it could not map to a
    // person on the app; switching someone to the app re-reads the pilot's
    // window so their earlier fixes land. The pull is idempotent per person.
    if (read.patch.source === 'companion' && current.source !== 'companion') {
      try {
        await setSetting(COMPANION_CURSOR_KEY, '');
      } catch {
        return fail(500, {
          error: 'Saved, but the app’s earlier fixes for them will not be re-read. Set them back to none and to the app again to retry.',
        });
      }
    }
    return { saved: 'household' };
  },

  /** Put an account in the household: link an existing row with no account, or make a new one. */
  joinHousehold: async (event) => {
    const { request } = event;
    const { person } = await personOr404(event);
    if (person.household || !person.email) return fail(400, { error: 'Already in the household.' });
    const target = String((await request.formData()).get('target') ?? '');
    if (target === 'new') {
      await createMember({ displayName: person.name, email: person.email });
    } else {
      const row = (await listMembers()).find((m) => m.subject === target);
      if (!row) return fail(404, { error: 'No such household person.' });
      if (row.email) return fail(400, { error: `${row.displayName} is already linked to an account.` });
      await updateMember(row.subject, { email: person.email });
    }
    return { saved: 'household' };
  },

  /** Take the household link away; the row, and its trail, stay. */
  leaveHousehold: async (event) => {
    const { person } = await personOr404(event);
    if (!person.household || person.kind === 'household') return fail(400, { error: 'Nothing to unlink.' });
    await updateMember(person.household.subject, {
      email: null,
      ...(person.household.source === 'companion' ? { source: 'none' as const } : {}),
    });
    return { saved: 'household' };
  },

  /** A household-only person gets a sign-in: their Google email onto the allow-list. */
  giveAccount: async (event) => {
    const { request, locals } = event;
    const { person } = await personOr404(event);
    if (person.kind !== 'household' || !person.household) return fail(400, { error: 'They already have an account.' });
    const email = String((await request.formData()).get('email') ?? '').trim().toLowerCase();
    if (!EMAIL.test(email)) return fail(400, { error: 'Enter their Google email.' });
    if (isOwnerEmail(email)) return fail(400, { error: 'That address is the Super Admin.' });
    const owner = ((await locals.auth())?.user?.email ?? '').toLowerCase() || null;
    try {
      await updateMember(person.household.subject, { email });
    } catch {
      return fail(400, { error: 'Someone else in the household already has that email.' });
    }
    await addToAllowList({ email, note: person.name, addedBy: owner });
    return { saved: 'account' };
  },

  /**
   * Their Google address, for the website: the person moves to it and the
   * old address (an Apple relay, usually) stays as an alias for the app.
   * Answers the page's new key — it is the email when they have no
   * household row.
   */
  linkEmail: async (event) => {
    const { person } = await personOr404(event);
    if (person.kind !== 'account' || !person.email) return fail(400, { error: 'Only an account can link an address.' });
    const to = String((await event.request.formData()).get('email') ?? '');
    const r = await linkSignInEmail(person.email, to);
    if (!r.ok) return fail(400, { error: r.error });
    return { linked: person.household?.subject ?? r.email };
  },

  revoke: async (event) => {
    const { request } = event;
    const { person } = await personOr404(event);
    const form = await request.formData();
    const lane = form.get('lane');
    const id = String(form.get('id') ?? '');
    const device = person.devices.find((d) => d.id === id && d.lane === lane);
    if (!device) return fail(404, { error: 'That phone is not theirs, or is already signed out.' });
    if (lane === 'site') {
      return (await revokeDevice(device.email, id)) ? { revoked: id } : fail(404, { error: 'Already revoked.' });
    }
    const r = await revokePilotDevice(id);
    return r.ok ? { revoked: id } : fail(r.reason === 'not-found' ? 404 : 502, { error: pilotFailureText(r.reason) });
  },

  remove: async (event) => {
    const { person } = await personOr404(event);
    if (person.kind !== 'account' || !person.email) return fail(400, { error: 'Only an account can be removed.' });
    const report = await removePerson(person.email);
    // Not a redirect: the page says what could not be undone before leaving.
    return { removed: true, warning: report.appError };
  },
};
