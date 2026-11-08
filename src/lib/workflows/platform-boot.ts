// Hook compatibility shim (2026-10-02). `src/hooks.server.ts` is protected and
// still imports this path; the boot moved to `$lib/integrations/platform-boot`.
// Delete this directory once the hook imports the new paths.
import '$lib/integrations/platform-boot';
