// The household form, read into a patch. Was inline in /home/people/settings;
// the person page at /admin/access/[person] now owns the form and this is the
// same validation, moved. PURE — no database, so the rules are testable alone.

import { MEMBER_SOURCES, type HouseholdMember, type MemberPatch, type MemberSource } from './members';

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
export function normaliseWhatsApp(typed: string): string | null {
  let n = typed.replace(/[\s().-]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0')) n = `44${n.slice(1)}`;
  return E164.test(n) ? n : null;
}

function isSource(v: string): v is MemberSource {
  return (MEMBER_SOURCES as readonly string[]).includes(v);
}

/**
 * The patch a submitted household form asks for, or the error to show.
 * `others` are the other people in the household: follow and guardian-of
 * lists keep only those, so a stale or forged subject never lands.
 */
export function readMemberForm(
  form: FormData,
  others: readonly HouseholdMember[],
): { patch: MemberPatch } | { error: string } {
  const displayName = String(form.get('displayName') ?? '').trim();
  if (!displayName || displayName.length > 60) return { error: 'A name of 1–60 characters.' };
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (email && !EMAIL.test(email)) return { error: 'That email does not look right.' };
  const source = String(form.get('source') ?? '');
  if (!isSource(source)) return { error: 'Pick where their location comes from.' };
  if (source === 'companion' && !email) return { error: 'Someone on the app needs the email they sign in with.' };
  const typed = String(form.get('whatsapp') ?? '').trim();
  const number = typed ? normaliseWhatsApp(typed) : null;
  if (typed && !number) {
    return { error: 'That WhatsApp number does not look right. Use 07… for a UK mobile, or + and the country code.' };
  }
  const haEntity = String(form.get('haPersonEntity') ?? '').trim();
  if (haEntity && !/^person\.[a-z0-9_]+$/.test(haEntity)) {
    return { error: 'A Home Assistant person looks like person.name.' };
  }

  const known = new Set(others.map((m) => m.subject));
  const follow = form.getAll('follow').map(String).filter((s) => known.has(s));
  const guardianOf = form.getAll('guardianOf').map(String).filter((s) => known.has(s));
  const patch: MemberPatch = {
    displayName,
    email: email || null,
    source,
    whatsapp: number || null,
    guardianOf,
    alerts: {
      // Absent means everyone, including anyone added later.
      ...(form.get('followAll') === 'on' ? {} : { follow }),
      whatsapp: form.get('whatsappOn') === 'on',
    },
  };
  // Only a form that shows the field may change it: the old settings page
  // never had one, and clearing a Life360 link by omission would stop polling.
  if (form.has('haPersonEntity')) patch.haPersonEntity = haEntity || null;
  return { patch };
}
