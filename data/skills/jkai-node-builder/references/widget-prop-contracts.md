# Shared Widget Prop Contracts

Exact prop interfaces for the reusable widgets under `src/lib/canvas/nodes/panels/shared/` and `widgets/`. When hand-editing a specialized panel after codegen, always verify against these — passing wrong prop names silently breaks the widget (no build error, no runtime error — just a degraded UI).

## ResourcePicker

**Path:** `src/lib/canvas/nodes/panels/shared/ResourcePicker.svelte`

Fetches a list of `{value, label, meta?}` entries on mount and renders a dropdown. Falls back to free-text on error, empty list, templated values, or user's "type custom" click.

```typescript
interface Props {
  value: string;                          // current selected value
  fetcher: () => Promise<ResourceEntry[]>; // REQUIRED — async function returning options
  onChange: (next: string) => void;        // callback when selection changes
  placeholder?: string;                    // default: 'pick one'
  label?: string;                          // uppercase label rendered above the select
  allowCustom?: boolean;                  // default: true — show "+ Custom value…" option
  emptyHint?: string;                      // hint when list is empty (default: "Nothing available — type a value.")
}

interface ResourceEntry { value: string; label: string; meta?: string }
```

**⚠ WRONG (will silently break — shows free-text fallback):**
```svelte
<ResourcePicker integrationType="apple-calendar" fieldName="calendar"
  credentialId={credId} value={...} onChange={...} />
```

**✓ CORRECT:**
```svelte
<ResourcePicker
  placeholder="pick a calendar"
  emptyHint="No calendars found — check your credential."
  value={config.calendar as string | undefined}
  onChange={(v) => set('calendar', v)}
  fetcher={async () => {
    const res = await fetch(
      `/api/integrations/options/apple-calendar/calendar?credentialId=${encodeURIComponent(config.credentialId as string)}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.options ?? []).map((o: any) => ({
      value: o.value, label: o.label, meta: o.meta
    }));
  }}
/>
```

**Pattern for conditional rendering** (hide until credential is selected):
```svelte
{#if config.credentialId}
  <ResourcePicker ... fetcher={...} />
{:else}
  <input disabled placeholder="Select a credential first" />
  <span class="hint">Pick a credential above to load options.</span>
{/if}
```

## CredentialPicker

**Path:** `src/lib/canvas/nodes/panels/widgets/CredentialPicker.svelte`

Fetches credentials from `/api/admin/integrations/list?integrationType=<type>` on mount and renders a dropdown.

```typescript
interface Props {
  integrationType: string;                 // filter credentials by this type
  value: string | undefined;               // currently selected credential ID
  onChange: (id: string | undefined) => void;
  label?: string;                          // default: 'Credential'
  hint?: string;                           // extra hint text
}
```

**States it renders:**
- Loading → disabled select with "Loading…"
- Error → disabled select + retry button
- Empty → disabled select with link to `/admin/integrations`
- Has options → working dropdown with selected value
- No selection → shows "⚠ pick a credential" warning

## TemplatedInput

**Path:** `src/lib/canvas/nodes/panels/shared/TemplatedInput.svelte`

Free-text input that supports `{{input.X}}` template references. Used for config fields that should accept upstream data interpolation.

```typescript
interface Props {
  value: string;
  placeholder?: string;
  upstreamFields?: string[];                // available upstream field names for autocomplete
  onChange: (v: string) => void;
}
```

## CredentialStatusBanner

**Path:** `src/lib/canvas/nodes/panels/widgets/CredentialStatusBanner.svelte`

Shows credential health status (last test result, expiry warnings).

```typescript
interface Props {
  credentialId: string | undefined;        // pass undefined to hide
}
```

## TestConnectionAction

**Path:** `src/lib/canvas/nodes/panels/widgets/TestConnectionAction.svelte`

Button that tests a credential's connection to the remote service.

```typescript
interface Props {
  integrationType: string;
  credentialId: string | undefined;         // disabled when undefined
}
```
