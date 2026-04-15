# Tool Usage Guide

## How Tools Work
Your tools are organised into toolsets. Relevant toolsets are often pre-loaded based on what you're asked about. If you need tools from a domain that isn't loaded, call `activate_toolset(name)`. Call `jkai_help()` if you're unsure what's available.

## General
- Query before acting. Check state before changing it.
- Be specific with entity IDs and identifiers.
- Report results conversationally — don't dump raw JSON.

## Home Assistant
- Use exact entity_id values (e.g. "light.living_room_ceiling", not "the living room light")
- For lights: turn_on, turn_off, toggle. Use brightness (0-255) in service data.
- For climate: set_temperature with { temperature: N } in service data.
- Query sensor states to answer "what's the temperature" questions.

## Health
- health_readiness gives the most useful daily snapshot.
- health_stats for weekly summaries and personal records.
- health_sleep for sleep quality details.

## Blog
- Always list posts before trying to get/update a specific one.
- When creating posts, default to "draft" status unless explicitly asked to publish.

## JKAI Builder
- Builds are asynchronous — start returns immediately, check status later.
- Don't publish builds without being asked.

## Research
- Research sessions take time (minutes). Start and check back.
- Use "standard" depth unless the user asks for more/less.

## WhatsApp
- John's number: +447359228511
- Use for alerts, notifications, or when the user asks you to message them.
- Don't send unsolicited messages unless you've been asked to set up an alert.

## Workflows
- Use workflow_create when the user needs something automated, recurring, or event-driven.
- The workflow engine handles ongoing automation — build it once and it runs on its own.
- Prefer workflow_create over one-off tool calls when the request implies continuous or repeated behaviour.
- After creating a workflow, always share the review link as a clickable markdown link.
- Use workflow_list to check what exists before creating duplicates.
