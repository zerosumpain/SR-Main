// Where a file's bytes live, read off its disk_path. Pure — no database, no
// SDKs — so the browser-facing row presenters and the tests can use it.
//
//   <root>/<uuid>/<name>                  the primary (server) store
//   <root>/@store/<storeId>/<uuid>/<name>  connected store <storeId>
//
// See ./backends for what a connected store is.

export const PRIMARY_STORE = 'primary';
export const STORE_SEGMENT = '@store';

export const STORE_ID = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** The store a disk_path lives in, from its `@store/<id>/` segment. */
export function storeIdOf(diskPath: string): string {
  const m = /[\\/]@store[\\/]([^\\/]+)[\\/]/.exec(diskPath);
  return m ? m[1] : PRIMARY_STORE;
}

/**
 * Split a path relative to the store root into its store and the key inside
 * that store. `rel` is posix-style and already traversal-checked.
 */
export function splitRelative(rel: string): { store: string; key: string } {
  const parts = rel.split('/');
  if (parts[0] === STORE_SEGMENT && parts.length >= 3) {
    return { store: parts[1], key: parts.slice(2).join('/') };
  }
  return { store: PRIMARY_STORE, key: rel };
}

/** The relative path (under the store root) of `key` in `store`. */
export function joinRelative(store: string, key: string): string {
  return store === PRIMARY_STORE ? key : `${STORE_SEGMENT}/${store}/${key}`;
}

/** A store's prefix joined to a key, with no leading or doubled slashes. */
export function objectKey(prefix: string | undefined, key: string): string {
  const p = (prefix ?? '').replace(/^\/+|\/+$/g, '');
  return p ? `${p}/${key}` : key;
}
