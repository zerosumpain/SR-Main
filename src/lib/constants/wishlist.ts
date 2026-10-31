/**
 * The datastore collections the wish list lives in, on their own — the same
 * reason `MONITORS_COLLECTION` sits apart from the code that operates on it: a
 * value that names something must not drag the machinery onto every reader.
 */
export const WISHLIST_ITEMS = 'wishlist_items';
export const WISHLIST_OFFERS = 'wishlist_offers';
