# Infrastructure review runbook

Closes #246.

`infrastructure-status` is a read-only workflow node. Configure `scope: all` for the weekly review; it records the structured report under the workflow's durable `infrastructure-audit-history` key. Each collector names its source and reports `unavailable` when no bounded server-side integration is configured. It does not infer a healthy state or run updates.

Create `canvas:infrastructure-review` with a manual trigger and a Sunday `0 9 * * 0` Europe/London schedule. Wire the status node to an inspector/full-report destination and the existing WhatsApp sender for a concise summary. Run it with dry-run first: no update node belongs on the audit path.

`infrastructure-update` is deliberately constrained: it requires an upstream approval node plus `approved: true` and an exact `{ "action": "verify_only" }` or `{ "action": "home_assistant_check" }` manifest. It rejects command, package, host and service fields. The available actions perform verification only; a failed Home Assistant verification sets `rollbackNeeded: true`. Add any future install operation only after implementing a server-side bounded operation, compatibility checks, post-update verification and focused tests.
