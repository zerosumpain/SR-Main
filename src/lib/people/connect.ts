// Connect a phone to a person — the one way the owner does it, from that
// person's page. It used to be spread over /welcome, two panels on
// /admin/access/devices and an API route, each minting its own way; the
// rules are a table here, and the test drives the table.
//
// Two channels, one card:
//
//   testflight — a ten-minute pairing code shown as a QR. "Identity" on means
//                a `scan` code: the phone must be signed in as this person to
//                redeem it (what /welcome gives people). Off means the owner
//                vouches — a plain `pair` code, redeemed with no sign-in, for
//                someone who cannot sign in on the phone (Apple will not let an
//                under-13 account use Sign in with Apple for a new app). The
//                owner's own code is always a scan code.
//   adhoc      — a week's join link (`$lib/server/adhoc-install`): on their
//                iPhone it reads the UDID, starts a copy built for it and
//                installs it. For phones that cannot use TestFlight.
//
// Someone on the household map with no account yet is admitted on the way
// (`admitToAllowList`, Family Circle) and their household row gets the
// address — by SUBJECT, never by matching a name.

import { env } from '$env/dynamic/private';
import { isOwnerEmail } from '$lib/server/access';
import { admitToAllowList } from '$lib/server/admission';
import { JOIN_DAYS, joinSlug, mintJoinCode } from '$lib/server/adhoc-install';
import { pairingCode } from '$lib/server/pair-codes';
import { scanPairPayload } from '$lib/server/pair-payload';
import { qrDataUrl } from '$lib/server/qr';
import { PRE_REGISTERED_GROUP } from '$lib/server/registration';
import { updateMember } from '$lib/home/presence/members';

export type Channel = 'testflight' | 'adhoc';

export interface ConnectPerson {
  kind: 'owner' | 'account' | 'household';
  name: string;
  email: string | null;
  /** Their household row, when they have one. */
  householdSubject: string | null;
}

export interface ConnectInput {
  person: ConnectPerson;
  channel: Channel;
  /** The phone must sign in as them. Ignored for the owner (always) and for ad-hoc. */
  identity: boolean;
  /** For someone with no account yet: the address their phone signs in with. */
  email?: string | null;
  origin: string;
  /** "New code": retire the held one. */
  fresh?: boolean;
  addedBy: string | null;
}

export type Connection =
  | {
      channel: 'testflight';
      kind: 'scan' | 'pair';
      code: string;
      qr: string;
      expiresAt: string;
      reused: boolean;
      admitted: boolean;
    }
  | {
      channel: 'adhoc';
      kind: 'join';
      link: string;
      qr: string;
      days: number;
      expiresAt: string;
      reused: false;
      admitted: boolean;
    };

export type ConnectRefusal = { error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function connect(input: ConnectInput): Promise<Connection | ConnectRefusal> {
  const { person } = input;
  const email = (person.email ?? input.email ?? '').trim().toLowerCase();
  if (!person.email) {
    if (!EMAIL.test(email)) return { error: 'Give the address their phone signs in with — their Apple ID’s will do.' };
    if (isOwnerEmail(email)) return { error: 'That is your own address.' };
  }

  let admitted = false;
  if (person.kind === 'household') {
    if (person.householdSubject) {
      try {
        await updateMember(person.householdSubject, { email });
      } catch {
        return { error: 'Someone else in the household already has that email.' };
      }
    }
    await admitToAllowList({ email, name: person.name, groups: [PRE_REGISTERED_GROUP], addedBy: input.addedBy });
    admitted = true;
  }

  if (input.channel === 'adhoc') {
    const slug = joinSlug(person.name);
    if (!slug) return { error: 'Their name needs a letter in it to make a link from.' };
    const link = `${input.origin}/app/${mintJoinCode(slug, env.AUTH_SECRET)}`;
    return {
      channel: 'adhoc',
      kind: 'join',
      link,
      qr: await qrDataUrl(link),
      days: JOIN_DAYS,
      expiresAt: new Date(Date.now() + JOIN_DAYS * 86_400_000).toISOString(),
      reused: false,
      admitted,
    };
  }

  const kind = person.kind === 'owner' || input.identity ? 'scan' : 'pair';
  const { code, expiresAt, reused } = await pairingCode(email, kind, { fresh: input.fresh });
  return {
    channel: 'testflight',
    kind,
    code,
    qr: await qrDataUrl(scanPairPayload(input.origin, code)),
    expiresAt: expiresAt.toISOString(),
    reused,
    admitted,
  };
}
