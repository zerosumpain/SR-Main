# WhatsApp Node Config UI — Design Spec

## Overview

Add a tabbed configuration panel to the WhatsApp workflow node that enables QR code linking, connection management, settings (allowlist + soul.md), and message sending — all from within the node config modal.

## Architecture

A new `WhatsAppConfigPanel.svelte` component replaces the standard `BasicConfigRenderer` when the selected node in the config modal is type `whatsapp`. The main page's modal code checks `modalNode.data.nodeType === 'whatsapp'` and renders the custom panel instead.

The component manages its own tab state and API interactions internally. It polls `/api/workflows/whatsapp/status` while the Connection tab is visible. QR codes are rendered client-side using the `qrcode` npm package (generates a data URI from the QR string provided by Baileys).

## Tabs

### Connection Tab

Three visual states based on `WhatsAppServiceStatus`:

**Disconnected:**
- Grey status indicator with "Disconnected" label
- "Connect WhatsApp" button (calls `POST /api/workflows/whatsapp/connect`)

**QR Pending (connecting):**
- Amber status indicator with "Waiting for QR scan" label
- QR code image rendered from the `qrCode` string via `qrcode` library
- "Open WhatsApp > Linked Devices > Link a Device" instruction text
- "Cancel" button (calls `DELETE /api/workflows/whatsapp/connect`)
- Polls status every 2 seconds to detect connection or new QR code

**Connected:**
- Green status indicator with "Connected" label
- Connected phone number displayed (e.g. "+44 7359 228511")
- "Disconnect" button (calls `DELETE /api/workflows/whatsapp/connect`)

### Settings Tab

- **Allowed Numbers** — List of E.164 phone numbers. Each shown as a pill with a remove button. Text input + "Add" button to add new numbers. Empty list means all numbers allowed (with a note explaining this).
- **Soul.md** — Textarea editor for the personality prompt. Label explains this shapes the orchestrator's personality for WhatsApp conversations.
- **Save Settings** button (calls `PUT /api/workflows/whatsapp/config`)

Settings are loaded on mount via `GET /api/workflows/whatsapp/config`.

### Send Tab

Standard `BasicConfigRenderer` with the existing `to` and `message` fields from `whatsappDef.basicConfig`. Plus the upstream variables panel and Save Configuration button — same as any other node. This tab only handles the workflow send config, not the connection.

## Integration Point

In `src/routes/workflows/[id]/+page.svelte`, the modal's Configuration section (around line 808) currently renders `BasicConfigRendererComponent` for nodes with `basicConfig`. Add a check before that:

```
if modalNode.data.nodeType === 'whatsapp' → render WhatsAppConfigPanel
else → render BasicConfigRenderer (existing behavior)
```

The `WhatsAppConfigPanel` receives the same props as `BasicConfigRenderer` (`config`, `variables`, `onConfigChange`) so the Send tab can reuse the existing save flow.

## Dependencies

- `qrcode` npm package — generates QR code as data URI from the string Baileys provides

## Files

| File | Action |
|------|--------|
| `src/lib/components/workflows/WhatsAppConfigPanel.svelte` | Create |
| `src/routes/workflows/[id]/+page.svelte` | Modify (add whatsapp type check in modal) |
| `package.json` | Modify (add qrcode dependency) |
