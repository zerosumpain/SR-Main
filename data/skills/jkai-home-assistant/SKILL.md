---
name: jkai-home-assistant
description: "Inspect current home entities and histories and apply authorized actions through saved Home Assistant connections."
---

# jkai-home-assistant

Discover current home tools with `tool_search` and read their argument schemas
with `tool_describe`. Resolve real entity IDs before querying or acting; do not
guess IDs from friendly names. Use saved connections and server-side credentials.

Report observations with their timestamps. An unavailable sensor is not a zero
reading. Check the device's units before calculating distances or speed; the
Life360 speed attribute is km/h. Distinguish current state from stale history.

Only change devices within the requested scope. A status question is read-only.
Verify the returned state after a change and explain any unavailable device.
Avoid exposing family location or routines in public output.
