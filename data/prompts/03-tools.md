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
