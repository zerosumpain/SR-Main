---
name: jkai-platform-internals
description: "Locate current Chat, Canvas, Health, Drive and Main owners when diagnosing site behavior and service contracts."
---

# jkai-platform-internals

JKAI Core owns Chat and Intel; Workflows owns Canvas and workflow execution.
Main owns the remaining site surfaces and shared schema migrations. Health and
Drive are separate applications. Use the current estate registry and each app's
deployment contract to confirm ownership before editing.

Trace a problem from its HTTP route through the owning handler and service
contract. Inspect returned events, persisted IDs and current tool schemas; do not
assume a copied module owns the deployed behavior. Preserve signed gateway
identity and server-side credential boundaries.

Changes to shared types, tables or storage need checks across every consumer.
Run focused tests, type checks, the build and relevant local contract probes.
Read current source for chat events, model selection and message delivery.
Historical implementation notes are not a substitute for the running contract.
