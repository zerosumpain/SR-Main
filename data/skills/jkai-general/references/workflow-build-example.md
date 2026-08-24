# Worked example — building a canvas from chat, design-first

The two-turn shape in full. Turn 1 is prose only; the tool call is turn 2, after
the user says yes.

**John:** Build me a simple workflow that checks the weather and the temp in my
house, and sends a WhatsApp when the difference is greater than 8 degrees.

## Turn 1 — design only, no tool call

> **temp-gap-alert** — every 15 min, alert when indoor/outdoor temp diverge by ≥ 8 °C.
>
> **Trigger:** `cron */15 * * * *`
>
> **Nodes:**
> 1. `fetch_url` **Outdoor weather** — `url=https://api.openweathermap.org/...`
> 2. `ha_query_state` **Indoor sensor** — `entityId=sensor.living_room_temp`
> 3. `transform` **Compute gap** — `expression=Math.abs(input.outdoor - input.indoor)`
> 4. `conditional` **Gap ≥ 8°?** — `expression=input.gap >= 8`
> 5. `whatsapp` **Alert John** — `to=+<JOHN_WHATSAPP_MSISDN>`, `message=Indoor/outdoor gap is {{input.gap}}°C right now`
>
> **Wiring:** 1 + 2 → 3 → 4 → (true) 5
>
> Look good? Say "build it" and I'll ship it.

## Turn 2 — after the user confirms

On "build it" / "yes" / "ship":

```
workflow_build_from_spec({
  name: "temp-gap-alert",
  trigger: { type: "cron", config: { expression: "*/15 * * * *" } },
  nodes: [
    { id: "n1", type: "fetch_url", label: "Outdoor weather", config: { url: "https://api.openweathermap.org/..." } },
    { id: "n2", type: "ha_query_state", label: "Indoor sensor", config: { entityId: "sensor.living_room_temp" } },
    { id: "n3", type: "transform", label: "Compute gap", config: { expression: "Math.abs(input.outdoor - input.indoor)" } },
    { id: "n4", type: "conditional", label: "Gap ≥ 8°?", config: { expression: "input.gap >= 8" } },
    { id: "n5", type: "whatsapp", label: "Alert John", config: { to: "+<JOHN_WHATSAPP_MSISDN>", message: "Indoor/outdoor gap is {{input.gap}}°C right now" } }
  ],
  edges: [
    { from: "trigger", to: "n1" },
    { from: "n1", to: "n3" },
    { from: "n2", to: "n3" },
    { from: "n3", to: "n4" },
    { from: "n4", to: "n5", sourceHandle: "true" }
  ]
})
```

Then paste `data.summaryMarkdown` verbatim as your reply.

Notes that hold regardless of this example:

- `workflow_build_from_spec` does the whole build in ONE call. Don't chain
  `workflow_add_node` / `workflow_add_edge` to build a canvas.
- To AMEND a canvas that already exists, use `workflow_amend` — it is one
  transaction, so a four-part rewire cannot half-land.
- Edge ids are per-canvas. Never carry ids over from an earlier chat; read them
  with `workflow_inspect`.
