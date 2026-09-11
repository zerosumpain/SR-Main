/**
 * The offline pack's entry point — the only script in the file.
 *
 * It reads the assessment out of the JSON island the HTML carries rather than
 * fetching it, because a `file://` page has an opaque origin and cannot fetch
 * its own siblings. See `html.ts` for why the whole pack is one file.
 *
 * Compiled by `vite.config.offline.ts` into a single IIFE with no imports, no
 * dynamic chunks and no module graph, so it runs from a `<script>` tag with no
 * `type="module"` — which is what a double-clicked file needs.
 */
import { mount } from 'svelte';
import OfflineApp from './OfflineApp.svelte';
import { PAYLOAD_ELEMENT_ID, ROOT_ELEMENT_ID } from './html';
import type { OfflinePayload } from './payload';
import '../../../app.css';

function fail(message: string): void {
  const root = document.getElementById(ROOT_ELEMENT_ID) ?? document.body;
  root.textContent = message;
  root.setAttribute('style', 'font-family:system-ui,sans-serif;padding:2rem;max-width:60ch;line-height:1.6');
}

function start(): void {
  const target = document.getElementById(ROOT_ELEMENT_ID);
  const island = document.getElementById(PAYLOAD_ELEMENT_ID);
  if (!target || !island?.textContent) {
    fail('This pack is missing its assessment data and cannot be displayed. The Word and markdown copies in the same folder are unaffected.');
    return;
  }
  let payload: OfflinePayload;
  try {
    payload = JSON.parse(island.textContent) as OfflinePayload;
  } catch {
    fail('This pack’s assessment data could not be read — the file may have been truncated in transit. The Word and markdown copies in the same folder are unaffected.');
    return;
  }
  mount(OfflineApp, { target, props: { payload } });
}

// The script tag sits after the root element and after the island, so the DOM it
// needs already exists. `DOMContentLoaded` is still checked because a reader who
// saves the page from the browser can end up with the script moved into <head>.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
