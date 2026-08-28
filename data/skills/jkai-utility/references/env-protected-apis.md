# Using Credentials Held in the API Secret Store

## Prefer the MCP API Catalogue First

OpenRouter is now **catalogued and secret-backed** in the jkai API catalogue
(key: `openrouter`). Before falling back to `.env` parsing:

1. `api_search(query="OpenRouter credit balance")` — find the API
2. `api_secrets_list()` — confirm the `openrouter` handle exists
3. `api_call(api="openrouter", url="https://openrouter.ai/api/v1/credits")`
4. Save as integration: `api_integration_save(...)`
5. Verify: `api_integration_test(key="openrouter-credits")`

The saved integration (`openrouter-credits`) returns `{remaining, total_credits, total_usage}`
as named outputs — call it anytime with `api_integration_call(key="openrouter-credits")`.

For APIs NOT yet catalogued, use the `.env` fallback below.

---

## No `.env` fallback on the chat loop

There used to be a Python snippet here that parsed `~/.hermes-jkai/.env` inside
`execute_code` or `terminal`. Neither tool exists on the
in-process chat loop — it has no shell and no code sandbox — so that route is
gone, not merely discouraged.

For an API that is not catalogued yet, register it: `api_register` puts the
credential in the secret store behind a handle you can use but never read, and
`api_call` then makes the request. That is the supported path and it works
unattended; scraping a dotfile never did.

## OpenRouter Account API (raw, for `.env` fallback)

All endpoints require `Authorization: Bearer <key>` header.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/auth/key` | Usage stats (total, daily, weekly, monthly), key metadata |
| `GET /api/v1/credits` | `{ total_credits, total_usage }` — remaining = total - usage |