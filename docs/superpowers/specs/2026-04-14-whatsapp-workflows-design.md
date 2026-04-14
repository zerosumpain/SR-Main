# WhatsApp Integration for Workflows Engine

## Overview

Add WhatsApp as a first-class endpoint to the workflows engine, enabling conversational interaction with the orchestrator via WhatsApp and workflow-driven message sending. This is the first step toward replacing OpenClaw — WhatsApp becomes a direct frontend to the orchestrator, which can run workflows on demand and return results conversationally.

## Connection Approach

Baileys (`@whiskeysockets/baileys`) — the same library OpenClaw uses. QR code linking via WhatsApp Web protocol, multi-file auth state persistence, no Meta Business API dependency. The existing WhatsApp Business account and number currently associated with OpenClaw will be migrated to this system.

## Architecture

### WhatsApp Service (Singleton)

`src/lib/workflows/whatsapp/service.ts`

A singleton class managing the Baileys connection lifecycle, independent of workflow node execution. Starts on app boot when enabled.

**Responsibilities:**
- Baileys socket creation and management
- Multi-file auth state (default: `data/whatsapp-auth/`)
- QR code generation, exposed via API for the node config UI
- Connection lifecycle (connect, disconnect, auto-reconnect on non-logout disconnects)
- Credential backup/recovery (async write queue, chmod 600, same pattern as OpenClaw)
- Outbound message sending with template interpolation
- Inbound message routing to orchestrator bridge
- Allowlist enforcement — only approved numbers are processed
- Browser identifier: `["strange-rambling", "workflows", "1.0"]`

**Exposed state:**
- `status`: `'disconnected' | 'connecting' | 'qr_pending' | 'connected'`
- `qrCode`: current QR data string (when `qr_pending`)
- `connectedNumber`: linked phone number once connected

### WhatsApp Node

`src/lib/workflows/nodes/whatsapp.ts`

A standard workflow node (executor + definition) in the `integration` category.

**Node modes (via config):**
- **send** — Send a message to a specified number. Config: `to` (phone number, templatable), `message` (text, templatable). Output: `{ sent: boolean, messageId: string }`.
- **manage** — Connection management mode. Used in the node config panel to display QR code, connection status, allowlist, and soul.md configuration. Not executed in workflows — purely a config surface.

**Config schema:**
- `mode`: `'send' | 'manage'`
- `to`: string (E.164 phone number, template-interpolatable)
- `message`: string (template-interpolatable)

**Node definition includes:**
- `basicConfig` fields for the config panel UI
- `llmDescription` so the orchestrator knows how to use it
- `llmExamples` for common send patterns

### Orchestrator Bridge

`src/lib/workflows/whatsapp/orchestrator-bridge.ts`

Routes inbound WhatsApp messages to the orchestrator and sends responses back.

**Flow:**
1. WhatsApp service receives message from an allowed number
2. Bridge checks for commands: `/clear` or `/new` resets conversation context
3. Bridge loads or creates a conversation session for that phone number
4. Message is passed to the orchestrator (same as web chat — `generateWorkflow` / `modifyWorkflow` or plain conversation)
5. Orchestrator response (including any workflow execution results) is sent back via WhatsApp
6. All messages persisted to conversation store

**Orchestrator integration:**
- Reuses existing orchestrator functions from `src/lib/workflows/orchestrator/`
- Appends `soul.md` content to the system prompt for WhatsApp conversations
- The orchestrator can invoke workflows, wait for results, and include them in the response

### Conversation Store

New DB table: `whatsappConversations`

```
whatsappConversations {
  id: text (PK)
  phoneNumber: text (E.164)
  role: 'user' | 'assistant' | 'system'
  content: text
  metadata: jsonb (optional)
  createdAt: timestamp
}
```

- Per-phone-number conversation threads
- `/clear` or `/new` command archives (or deletes) the conversation history for that number and starts fresh
- Conversation history loaded as context for each orchestrator call

### WhatsApp Config

New DB table: `whatsappConfig`

```
whatsappConfig {
  id: text (PK, singleton — always 'default')
  enabled: boolean (default false)
  allowedNumbers: jsonb (string[], E.164)
  soulMd: text (personality prompt content)
  authDir: text (default 'data/whatsapp-auth')
  updatedAt: timestamp
}
```

### Soul.md Integration

- `soul.md` content is stored in the `whatsappConfig.soulMd` field
- Editable from the WhatsApp node's manage config panel
- Appended to the orchestrator system prompt for all WhatsApp conversations
- Initial content can be seeded from OpenClaw's existing soul.md during migration

## API Endpoints

All under `/api/workflows/whatsapp/`:

- `GET /api/workflows/whatsapp/status` — Connection status, QR code (if pending), connected number
- `POST /api/workflows/whatsapp/connect` — Start Baileys connection (generates QR)
- `POST /api/workflows/whatsapp/disconnect` — Disconnect and optionally clear auth state
- `GET /api/workflows/whatsapp/config` — Get current config (enabled, allowlist, soulMd)
- `PUT /api/workflows/whatsapp/config` — Update config (enable/disable, manage allowlist, update soulMd)
- `GET /api/workflows/whatsapp/conversations` — List conversation threads
- `GET /api/workflows/whatsapp/conversations/[phoneNumber]` — Get conversation history for a number
- `DELETE /api/workflows/whatsapp/conversations/[phoneNumber]` — Clear conversation history

## Node Config UI

The WhatsApp node's config panel (in manage mode) renders:

1. **Connection section** — QR code display (when linking), connection status indicator, connect/disconnect buttons
2. **Allowlist section** — Add/remove phone numbers (E.164 input with validation)
3. **Soul.md section** — Textarea editor for personality prompt content
4. **Status section** — Connected number, uptime, message counts

In send mode, the config panel shows standard fields: `to` and `message` with template interpolation hints.

## Inbound Message Flow

```
WhatsApp message received
  → WhatsAppService.onMessage()
  → Allowlist check (reject if not allowed)
  → OrchestratorBridge.handleMessage(phoneNumber, text)
    → Check for /clear or /new command
    → Load conversation history for phoneNumber
    → Append soul.md to system prompt
    → Call orchestrator with conversation context
    → If orchestrator triggers a workflow:
      → Run workflow, collect results
      → Include results in orchestrator response
    → Send response back via WhatsApp
    → Persist both messages to whatsappConversations
```

## Outbound Message Flow (Workflow Node)

```
Workflow engine executes WhatsApp node (send mode)
  → Interpolate templates in `to` and `message`
  → WhatsAppService.sendMessage(to, message)
  → Return { sent: true, messageId } or { sent: false, error }
```

## Startup & Lifecycle

- On SvelteKit server startup, if `whatsappConfig.enabled` is true, the WhatsApp service auto-connects using persisted auth state
- If auth state is missing or invalid, service enters `disconnected` state (user must link via QR from the UI)
- Auto-reconnect on transient disconnects (non-logout)
- On logout disconnect, service enters `disconnected` and clears auth state

## Error Handling

- **Connection failures**: Exponential backoff reconnect (max 5 attempts, then stay disconnected)
- **Send failures**: Node returns `{ sent: false, error: string }` — downstream nodes can handle via conditional
- **Orchestrator failures**: Send a brief error message back to WhatsApp ("Something went wrong, try again")
- **Auth corruption**: Backup-based recovery (same as OpenClaw pattern)

## Testing

- Unit tests for WhatsAppService (mocked Baileys socket)
- Unit tests for OrchestratorBridge message routing and command handling
- Unit tests for WhatsApp node executor (send mode)
- Integration test for conversation persistence and `/clear` command
- Manual testing for QR linking and end-to-end messaging
