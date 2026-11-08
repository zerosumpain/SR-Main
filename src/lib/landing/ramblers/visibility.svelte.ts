// Whether this visitor has tucked the rambler away. Kept in the browser only:
// it is a per-visitor preference, not something the site needs to know.

const KEY = 'sr-rambler-hidden';

function read() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const rambler = $state({ hidden: false });

export function loadRamblerPreference() {
  rambler.hidden = read();
}

export function toggleRambler() {
  rambler.hidden = !rambler.hidden;
  try {
    if (rambler.hidden) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the choice lasts for this page view.
  }
}
