/**
 * The name a downloaded file should be saved under.
 *
 * Every download on these pages is a `fetch` into a blob rather than a
 * navigation — a navigation to an endpoint that can 404 replaces the page with
 * SvelteKit's error document and the reader loses the tab they were on. The cost
 * is that the browser never sees `content-disposition`, so the page has to name
 * the file itself.
 *
 * It used to guess: slug plus the format it asked for. That is right for a
 * document and wrong for the offline pack, whose name carries the date the pack
 * was made so two packs of the same paper do not overwrite one another. Reading
 * the header the server already set is both simpler and always correct.
 */
export function filenameFromDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  // RFC 5987 first: a policy title is prose, so this is the form the server
  // sends — quotes, em dashes and non-ASCII do not survive plain `filename=`.
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      const name = decodeURIComponent(encoded[1]).trim();
      if (name) return sanitise(name);
    } catch {
      // A malformed header is not worth failing a download over; fall through.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  const name = plain?.[1]?.trim();
  return name ? sanitise(name) : null;
}

/**
 * A server we control sets this header, but `a.download` is still a filesystem
 * write: a path separator would put the file somewhere the reader did not
 * choose, so the name is reduced to its last segment either way.
 */
function sanitise(name: string): string | null {
  const base = name.split(/[\\/]/).pop()?.replace(/^\.+/, '').trim();
  return base || null;
}
