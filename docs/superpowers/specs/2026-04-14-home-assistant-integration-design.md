# Home Assistant Integration — Design Spec

## Overview

Integrate Home Assistant (running on homeserv at `http://localhost:8123`) into the workflows engine as a first-class integration. Three components: an HA service wrapping the REST API with cached entity registries, a workflow node with a visual entity browser in its config panel, and direct LLM function-calling tools for the WhatsApp conversational AI.

## HA Instance Summary

- **Version**: 2026.2.3 (Docker, host network, port 8123)
- **User**: john (owner/admin)
- **Existing token**: Long-lived access token "JKai" (never expires)
- **13 areas**: Living Room, Kitchen, Bedroom, Study, Jemimas Room, Master Bedroom, Upstairs Hallway, Downstairs Hallway, Fins Room, Outside Study, Dining Room, Rorys Room, Front Door, Downstairs Toilet
- **89 devices**: 38 Philips Hue, 29 Alexa, 4 Tado, 3 Ring, 2 Sony BRAVIA, 2 Tenda mesh, 1 Sky Hub, 1 IKEA
- **475 entities**: 159 Hue (lights/switches/sensors), 100 Alexa Media, 87 Alexa Devices, 37 UPnP, 31 Ring, 21 Tado, 9 Sun, 6 Life360, 4 BRAVIA, 2 OwnTracks, others
- **Key domains**: light, switch, sensor, climate, media_player, camera, binary_sensor, device_tracker, person

## Architecture

### 1. HA Service (Singleton)

`src/lib/workflows/homeassistant/service.ts`

Wraps the Home Assistant REST API. Manages a cached registry of entities, devices, and areas in the database. All methods accept entity IDs and return structured data.

**Operations:**

| Method | HA API | Purpose |
|--------|--------|---------|
| `queryState(entityId)` | `GET /api/states/{entity_id}` | Get current state + attributes for one entity |
| `queryAllStates()` | `GET /api/states` | Fetch all entity states (used for registry sync) |
| `callService(domain, service, entityId?, data?)` | `POST /api/services/{domain}/{service}` | Execute a service (turn_on, set_temperature, etc.) |
| `fireEvent(eventType, data?)` | `POST /api/events/{event_type}` | Trigger HA event |
| `getHistory(entityId, start?, end?)` | `GET /api/history/period/{start}?filter_entity_id={id}&end_time={end}` | Historical state data |
| `renderTemplate(template)` | `POST /api/template` | Evaluate Jinja2 template server-side |
| `syncRegistries()` | `GET /api/states` + parse | Refresh cached entity/device/area registry from HA |
| `getConfig()` | Returns DB config | URL, token status, last sync time |

**Registry cache:** On sync, the service fetches all states and extracts:
- Entity list: `{ entity_id, domain, friendly_name, area_id, device_id, state }`
- Grouped by area and domain for the entity browser and LLM context

**Error handling:** All API calls return `{ success: boolean, data?: any, error?: string }`. Network failures, 401s (bad token), and 404s (unknown entity) are handled gracefully.

### 2. DB Table

```sql
homeAssistantConfig {
  id: text PK default 'default'
  url: text not null default 'http://localhost:8123'
  token: text not null default ''
  entityRegistry: jsonb not null default '[]'
  deviceRegistry: jsonb not null default '[]'
  areaRegistry: jsonb not null default '[]'
  lastSynced: timestamp with time zone
  updatedAt: timestamp with time zone not null default now()
}
```

**entityRegistry** schema (jsonb array):
```json
[
  {
    "entity_id": "light.living_room_ceiling",
    "domain": "light",
    "friendly_name": "Living Room Ceiling",
    "area_id": "living_room",
    "area_name": "Living Room",
    "device_id": "abc123",
    "state": "on"
  }
]
```

**deviceRegistry** schema (jsonb array):
```json
[
  {
    "id": "abc123",
    "name": "Living Room Ceiling",
    "manufacturer": "Signify",
    "model": "Hue White",
    "area_id": "living_room",
    "area_name": "Living Room"
  }
]
```

**areaRegistry** schema (jsonb array):
```json
[
  { "id": "living_room", "name": "Living Room" }
]
```

### 3. HA Workflow Node

`src/lib/workflows/nodes/home-assistant.ts`

Standard executor + definition in the `integration` category.

**Config schema:**
- `operation`: `'query_state' | 'call_service' | 'fire_event' | 'get_history' | 'render_template'`
- `entityId`: string (template-interpolatable)
- `domain`: string (auto-derived from entityId, or set manually for service calls without a specific entity)
- `service`: string (e.g. `turn_on`, `turn_off`, `toggle`, `set_temperature`)
- `serviceData`: JSON object (additional service call parameters, template-interpolatable)
- `eventType`: string (for fire_event)
- `eventData`: JSON object (for fire_event)
- `historyStart`: string ISO date (for get_history, template-interpolatable)
- `historyEnd`: string ISO date (for get_history, template-interpolatable)
- `template`: string (Jinja2 template for render_template)

**Output:** `{ success: boolean, data: any, error?: string }`

- For `query_state`: `data` is `{ state, attributes, last_changed, entity_id }`
- For `call_service`: `data` is the service call response
- For `fire_event`: `data` is `{ message }`
- For `get_history`: `data` is the history array
- For `render_template`: `data` is `{ result: string }`

**Node definition includes:**
- `basicConfig` fields that change dynamically based on selected operation
- `llmDescription` explaining all five operation modes
- `llmExamples` for common operations (turn on light, query temperature, etc.)

### 4. Node Config Panel

`src/lib/components/workflows/HomeAssistantConfigPanel.svelte`

Tabbed panel (same pattern as WhatsAppConfigPanel), rendered when node type is `home-assistant`.

**Connection tab:**
- HA URL input (default `http://localhost:8123`)
- Token input (password field)
- "Test Connection" button — calls HA API root, shows success/error
- Last synced timestamp
- "Refresh Entities" button — triggers registry sync
- Entity count summary (e.g. "475 entities across 13 areas")

**Entity Browser tab:**
- Search/filter input at top
- Domain filter pills (light, climate, sensor, media_player, switch, camera, etc.)
- Tree view: Area → Entities within that area
- Each entity row shows: friendly name, entity_id (monospace), current state, domain icon
- Click entity to auto-fill `entityId` field in the operation config
- Entities without an area grouped under "Ungrouped"

**Operation tab:**
- Operation type dropdown (query_state, call_service, fire_event, get_history, render_template)
- Dynamic fields based on operation:
  - **query_state**: entity_id (pre-filled from browser selection, template-interpolatable)
  - **call_service**: entity_id, domain (auto-derived), service dropdown (common services for the entity's domain), service_data textarea (JSON)
  - **fire_event**: event_type input, event_data textarea (JSON)
  - **get_history**: entity_id, start date, end date
  - **render_template**: template textarea (Jinja2)
- Save Configuration button (standard workflow save flow)

### 5. WhatsApp LLM Tool (Function Calling)

The orchestrator bridge's system prompt gets HA context, and the LLM gets function definitions to call HA directly during conversation.

**System prompt addition:**
```
You have access to Home Assistant for smart home control. Available areas and devices:

Living Room: ceiling light, lamp, TV (Sony BRAVIA), climate (Tado), motion sensor
Kitchen: pendant lights, under-cabinet lights, motion sensor
Bedroom: bedside lamps, ceiling light, climate (Tado)
...
[generated from cached entity registry, grouped by area, summarized by domain]

Use the ha_* functions to control devices or query state. Be specific with entity IDs.
```

**Function definitions (OpenAI function calling format):**

```json
[
  {
    "name": "ha_query_state",
    "description": "Get the current state and attributes of a Home Assistant entity",
    "parameters": {
      "type": "object",
      "properties": {
        "entity_id": { "type": "string", "description": "Entity ID, e.g. light.living_room_ceiling" }
      },
      "required": ["entity_id"]
    }
  },
  {
    "name": "ha_call_service",
    "description": "Call a Home Assistant service to control a device (turn on/off lights, set temperature, play media, etc.)",
    "parameters": {
      "type": "object",
      "properties": {
        "domain": { "type": "string", "description": "Service domain, e.g. light, climate, media_player" },
        "service": { "type": "string", "description": "Service name, e.g. turn_on, turn_off, toggle, set_temperature" },
        "entity_id": { "type": "string", "description": "Target entity ID" },
        "data": { "type": "object", "description": "Additional service data, e.g. { brightness: 128 } or { temperature: 20 }" }
      },
      "required": ["domain", "service"]
    }
  },
  {
    "name": "ha_fire_event",
    "description": "Fire a Home Assistant event to trigger automations",
    "parameters": {
      "type": "object",
      "properties": {
        "event_type": { "type": "string", "description": "Event type name" },
        "data": { "type": "object", "description": "Event data payload" }
      },
      "required": ["event_type"]
    }
  },
  {
    "name": "ha_get_history",
    "description": "Get historical state data for an entity over a time period",
    "parameters": {
      "type": "object",
      "properties": {
        "entity_id": { "type": "string", "description": "Entity ID to get history for" },
        "start": { "type": "string", "description": "ISO 8601 start time (default: 24h ago)" },
        "end": { "type": "string", "description": "ISO 8601 end time (default: now)" }
      },
      "required": ["entity_id"]
    }
  },
  {
    "name": "ha_render_template",
    "description": "Evaluate a Home Assistant Jinja2 template server-side",
    "parameters": {
      "type": "object",
      "properties": {
        "template": { "type": "string", "description": "Jinja2 template string" }
      },
      "required": ["template"]
    }
  }
]
```

**Tool execution:** The bridge intercepts tool calls from the LLM response, executes them against the HA service, and feeds results back into the conversation for the LLM to formulate a natural response.

### 6. API Endpoints

All under `/api/workflows/homeassistant/`:

- `GET /api/workflows/homeassistant/config` — get config (URL, token status, last synced, entity counts)
- `PUT /api/workflows/homeassistant/config` — update URL, token
- `POST /api/workflows/homeassistant/sync` — trigger registry sync
- `GET /api/workflows/homeassistant/entities` — get cached entity registry (with optional domain filter)
- `GET /api/workflows/homeassistant/areas` — get cached area registry
- `POST /api/workflows/homeassistant/test` — test connection (calls HA API root)

### 7. Startup

On SvelteKit server boot (in `src/lib/workflows/index.ts`), if `homeAssistantConfig` has a token:
- Initialize the HA service singleton with URL and token
- If registry cache is older than 1 hour, trigger a background sync

## Files

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/db/schema.ts` | Modify | Add `homeAssistantConfig` table |
| `src/lib/workflows/homeassistant/service.ts` | Create | HA REST API wrapper with registry caching |
| `src/lib/workflows/homeassistant/types.ts` | Create | HA types (entity, device, area, operation result) |
| `src/lib/workflows/homeassistant/llm-tools.ts` | Create | Function definitions + entity summary builder for LLM |
| `src/lib/workflows/nodes/home-assistant.ts` | Create | HA workflow node (executor + definition) |
| `src/lib/workflows/index.ts` | Modify | Register HA node, boot HA service |
| `src/lib/workflows/registry-client.ts` | Modify | Add HA node to client-side registry |
| `src/lib/workflows/whatsapp/orchestrator-bridge.ts` | Modify | Add HA function calling to LLM conversation |
| `src/lib/components/workflows/HomeAssistantConfigPanel.svelte` | Create | Tabbed config panel with entity browser |
| `src/lib/components/workflows/nodes/HomeAssistantNode.svelte` | Create | Canvas node component |
| `src/routes/workflows/[id]/+page.svelte` | Modify | Register HA node component + config panel |
| `src/routes/api/workflows/homeassistant/config/+server.ts` | Create | Config GET/PUT |
| `src/routes/api/workflows/homeassistant/sync/+server.ts` | Create | Registry sync endpoint |
| `src/routes/api/workflows/homeassistant/entities/+server.ts` | Create | Entity registry query |
| `src/routes/api/workflows/homeassistant/areas/+server.ts` | Create | Area registry query |
| `src/routes/api/workflows/homeassistant/test/+server.ts` | Create | Connection test |
| `tests/lib/workflows/homeassistant/service.test.ts` | Create | HA service unit tests |
| `tests/lib/workflows/homeassistant/home-assistant-node.test.ts` | Create | HA node executor tests |
