---
name: solution-design
description: "Choose the smallest supported site change by inspecting existing capabilities, ownership and acceptance criteria."
---

# solution-design

Start with the user's intended behavior and a concrete acceptance example.
Inspect existing tools, saved workflows and application ownership before adding
new machinery. Reuse a supported capability when it meets the request.

For an implementation, name the owning application, affected data and external
effects. Keep changes scoped and reversible, preserving unrelated work. Validate
the behavior with appropriate tests and a local preview, and report gaps between
the preview and production. Do not confuse a generated artifact with a deployed
or successfully executed feature.
