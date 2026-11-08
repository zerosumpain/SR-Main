// The wish list's storage: two datastore collections, the house pattern for
// feature state (no table, so no migration and no hand GRANT). Items are keyed
// by id; offers by `offerKey` and filtered by `itemId`.
//
// Every item carries `principalId`. Phase 1 is owner-only and writes 'owner';
// the field is there from the start so phase 2's per-person lists are a filter,
// not a backfill.

import { ensureCollection, upsertRecord, queryRecords, deleteRecord, getRecordByKey, DatastoreError } from '$lib/datastore';
import { WISHLIST_ITEMS, WISHLIST_OFFERS } from '$lib/constants/wishlist';
import type { WishItem, WishOffer } from './types';

const ACTOR = 'system';
const PERMS = { read: ['owner', 'jkai', 'system'], write: ['owner', 'jkai', 'system'], delete: ['owner', 'system'] };

let ensured = false;
export async function ensureWishlistCollections(): Promise<void> {
  if (ensured) return;
  await ensureCollection(
    WISHLIST_ITEMS,
    { name: 'Wish list', description: 'Things to buy, watched for price or hunted for by criteria', isSystem: true, defaultPermissions: PERMS },
    ACTOR,
  );
  await ensureCollection(
    WISHLIST_OFFERS,
    { name: 'Wish list offers', description: 'Listings the wish list sweep has seen, with price history', isSystem: true, defaultPermissions: PERMS },
    ACTOR,
  );
  ensured = true;
}

export function newItemId(): string {
  return `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export async function listItems(principalId = 'owner'): Promise<WishItem[]> {
  await ensureWishlistCollections();
  const { records } = await queryRecords(
    WISHLIST_ITEMS,
    { filters: [{ path: 'principalId', op: 'eq', value: principalId }], sort: { field: 'createdAt', dir: 'desc' }, limit: 200 },
    ACTOR,
  );
  return records.map((r) => r.data as unknown as WishItem);
}

export async function getItem(id: string): Promise<WishItem | null> {
  await ensureWishlistCollections();
  try {
    return (await getRecordByKey(WISHLIST_ITEMS, id, ACTOR)).data as unknown as WishItem;
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return null;
    throw err;
  }
}

export async function saveItem(item: WishItem): Promise<void> {
  await ensureWishlistCollections();
  await upsertRecord(WISHLIST_ITEMS, { key: item.id, data: item as unknown as Record<string, unknown> }, ACTOR);
}

export async function listOffers(itemId: string): Promise<WishOffer[]> {
  await ensureWishlistCollections();
  const { records } = await queryRecords(
    WISHLIST_OFFERS,
    { filters: [{ path: 'itemId', op: 'eq', value: itemId }], limit: 500 },
    ACTOR,
  );
  return records.map((r) => r.data as unknown as WishOffer);
}

export async function saveOffer(offer: WishOffer): Promise<void> {
  await upsertRecord(WISHLIST_OFFERS, { key: offer.key, data: offer as unknown as Record<string, unknown> }, ACTOR);
}

export async function deleteItem(id: string): Promise<boolean> {
  await ensureWishlistCollections();
  for (const o of await listOffers(id)) {
    await deleteRecord(WISHLIST_OFFERS, { key: o.key }, ACTOR).catch(() => {});
  }
  try {
    await deleteRecord(WISHLIST_ITEMS, { key: id }, ACTOR);
    return true;
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return false;
    throw err;
  }
}
