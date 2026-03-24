import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
  // Auth is handled centrally by hooks.server.ts
  return {};
};
