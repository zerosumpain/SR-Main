// Auth is now handled centrally by hooks.server.ts
// This file is kept for backward compatibility but authorize() always returns true
// since the hooks middleware already rejected unauthenticated requests before they reach here.

export function authorize(): boolean {
  return true;
}
