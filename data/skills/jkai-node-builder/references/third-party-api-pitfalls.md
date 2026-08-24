# Third-Party Library API Pitfalls

When codegen generates executor code importing external npm packages, the subagent
frequently hallucinates API names, type exports, and parameter shapes. Always verify
real exports before hand-fixing TypeScript errors.

## How to verify

```bash
# Dump real exports
node -e "const t = require('libname'); console.log(Object.keys(t).filter(k => !k.startsWith('_')).join('\n'))"

# Check type definitions
cat node_modules/<lib>/dist/types/*.d.ts | grep 'export'
```

## Known pitfalls

### tsdav (CalDAV/CardDAV client)

| Codegen hallucinated | Correct API |
|---|---|
| `tsdav.createCalendarAccount(...)` | `createAccount({ account: { serverUrl, credentials, accountType: 'caldav' } })` |
| `tsdav.fetchEvents(...)` | `fetchCalendarObjects({ calendar, timeRange, expand, headers })` |
| `import type { CalendarObject }` | `import type { DAVCalendarObject }` — but `fetchCalendarObjects` returns untyped objects, use `any` |
| `timeRange: { start: Date, end: Date }` | `timeRange: { start: string, end: string }` — expects ISO strings |
| Missing `accountType` in account object | `accountType: 'caldav'` is required on `DAVAccount` |
| `import * as tsdav from 'tsdav'` | Named imports: `import { createAccount, fetchCalendars, fetchCalendarObjects, getBasicAuthHeaders } from 'tsdav'` |

To parse iCal objects returned by `fetchCalendarObjects`, use `ical.js` (see below).

### ical.js (iCal/ICS parser)

| Codegen hallucinated | Correct API |
|---|---|
| `import * as ical from 'ical.js'` | `import ical from 'ical.js'` (default import) |
| `new ical.Event(jcalData[2])` | `new ical.Component(jcalData[2])` then `new ical.Event(component)` |
| `ical.parse()` returns parsed event | Returns jcal format: `[type, props, components]` — `components` is the array for `ical.Component` |

```ts
import ical from 'ical.js';
const jcalData = ical.parse(obj.ical);          // [type, props, components]
const vcomp = new ical.Component(jcalData[2]);   // wrap components array
const vevent = new ical.Event(vcomp);
const title = vevent.summary;
const start = vevent.startDate?.toJSDate();
```
