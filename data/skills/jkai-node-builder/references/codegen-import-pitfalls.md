# Codegen Import Pitfalls (emitter-level)

The executor and adapter emitters generate wrong import styles for many packages.
This is separate from library API hallucinations (see `third-party-api-pitfalls.md`) —
the emitter template itself is wrong even when the library name is correct.

## Executor emitter

Produces `import * as X from 'package'` for every dep. Many packages need named or default imports.

| Package | Emitter generates | Correct import |
|---------|-------------------|----------------|
| `tsdav` | `import * as tsdav from 'tsdav'` | `import { createDAVClient, fetchCalendars, fetchCalendarObjects } from 'tsdav'` |
| `ical.js` | `import * as icalJs from 'ical.js'` | `import ical from 'ical.js'` (default import) |

## Adapter emitter

Does NOT emit any dep-based imports for `optionsResolvers` / `testCredentialBody` bodies.
Even when those bodies reference external packages, no import line is generated.

**Missing imports you must add manually to the adapter file:**
- `import { getCredential } from '$lib/integrations/credentials'` (always needed for optionsResolvers and testCredentialBody)
- Any dep imports the resolver/credential body references (e.g. `import { createDAVClient } from 'tsdav'`)

## Post-codegen checklist

After `node_builder_write_files`, before `node_builder_validate`:

1. Read `src/lib/workflows/nodes/<type>.ts` — fix dep imports if they need named/default style
2. Read `src/lib/integrations/adapters/<integrationType>.ts` — add `getCredential` import + any dep imports
3. Then run `node_builder_validate`

Skipping this step is the #1 cause of post-codegen TypeScript errors.
