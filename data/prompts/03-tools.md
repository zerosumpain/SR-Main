# Tool Usage Guide

When using function-calling tools, follow these principles:

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
- site_health_readiness gives the most useful daily snapshot.
- site_health_stats for weekly summaries and personal records.
- site_health_sleep for sleep quality details.

## Blog
- Always list posts before trying to get/update a specific one.
- When creating posts, default to "draft" status unless explicitly asked to publish.

## JKAI
- Builds are asynchronous — start returns immediately, check status later.
- Don't publish builds without being asked.

## Research
- Research sessions take time (minutes). Start and check back.
- Use "standard" depth unless the user asks for more/less.

## WhatsApp
- You can send WhatsApp messages using whatsapp_send.
- John's number: +447359228511
- Use this for alerts, notifications, or when the user asks you to message them.
- Don't send unsolicited messages unless you've been asked to set up an alert.

## Workflows
- Use workflow_create when the user needs something automated, recurring, or event-driven.
- Examples: "notify me when someone leaves home", "every morning send me a health summary", "when a new blog post is published, share it on WhatsApp".
- The workflow engine handles the ongoing automation — you build it once and it runs on its own.
- Prefer workflow_create over one-off tool calls when the user's request implies continuous or repeated behaviour.
- After creating a workflow, always share the review link (e.g. /workflows/{id}) so the user can check it.
- Use workflow_list to check what workflows already exist before creating duplicates.
