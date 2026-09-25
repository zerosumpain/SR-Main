import { ownerPhone } from './owner';

/**
 * Whether `number` is the owner's own number — digits compared, so `+44 7700…`,
 * `447700…` and a WhatsApp JID (`447700…@s.whatsapp.net`) all match. False when
 * no owner is configured.
 *
 * Its own file because `owner.ts` is duplicated byte-for-byte into the extracted
 * applications (see shared-with-extracted.json), and this is SR-Main's alone.
 */
export function isOwnerNumber(number: string): boolean {
  const owner = ownerPhone()?.replace(/\D+/g, '');
  return !!owner && (number ?? '').replace(/@.*$/, '').replace(/\D+/g, '') === owner;
}
