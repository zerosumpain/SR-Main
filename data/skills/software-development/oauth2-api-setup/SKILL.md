---
name: oauth2-api-setup
description: Set up external APIs via OAuth2 — register, authenticate, store tokens, create helper scripts for recurring calls.
category: software-development
trigger: When John asks to connect an external service or API that uses OAuth2 (especially Open Banking, Google APIs, or any service providing client_id + client_secret rather than a single API key). Also when you need to call an API where the auth is not a simple bearer token.
---

# OAuth2 API Integration Setup

Many external APIs use OAuth2 rather than a simple API key. Two main grant types are encountered:

1. **Authorization code flow** (user consent needed): TrueLayer, Google APIs — requires clicking an auth URL, user logging in, and returning an auth code.
2. **Client credentials flow** (app-only): PayPal Transaction Search API — app authenticates directly with its client_id + client_secret, no user consent step.

This skill covers both patterns from registration through persistent usage.

## Architecture

### Authorization code flow (user consent required)
```
Auth URL → User logs into provider → Provider redirects to callback URL with auth code
Agent exchanges auth code + client_secret → gets access_token + refresh_token
Recurring: Refresh token → new access_token → call API endpoint → parse response
```

### Client credentials flow (app-only)
```
Basic auth (client_id:client_secret) → POST to token endpoint → access_token
No refresh token needed (tokens last ~9 hours, just re-auth)
Recurring: If token expired → POST again → new token → call endpoint
```

## Step-by-Step

### 1. Registration (user does this)
- User registers on the provider's developer portal
- Gets **client_id** and **client_secret**
- Configures an allowed **redirect_uri** (use provider's own console redirect page if available, e.g. TrueLayer's `https://console.truelayer.com/redirect-page`)
- User provides the credentials in chat

### 2. Generate the auth URL
- Construct: `https://{auth-domain}/?response_type=code&client_id={id}&scope={scopes}&redirect_uri={redirect}`
- Include `offline_access` scope when available (enables refresh tokens)
- Optionally pre-select provider: `&providers=uk-cma9-all%3Anatwest_personal`
- Send the URL for the user to click and authorise

### 3. Exchange auth code for tokens
- POST to the token endpoint: `POST https://{auth-domain}/connect/token`
- Body (form-encoded): `grant_type=authorization_code`, `code`, `client_id`, `client_secret`, `redirect_uri`
- Response contains: `access_token` (short-lived JWT), `refresh_token` (long-lived), `expires_in`

### 4. Fetch data
- Call the API endpoint with `Authorization: Bearer {access_token}`
- Examples: `GET /data/v1/accounts`, `GET /data/v1/accounts/{id}/balance`, `GET /data/v1/accounts/{id}/transactions`

### 5. Store credentials in the secret registry — NEVER in a file
- Call `request_credential` with the provider key. The registry writes two rows:
  `<provider>-oauth` holds the encrypted credential set, and `<provider>` mints a
  fresh access token from it on every request. Token refresh and rotation are
  handled server-side.
- Then just call `api_call(api='<provider>', path='...')`. You never see a value.
- **Do not write a helper script that reads a credential from disk.** This
  section said to do exactly that until 2026-08-02, which is how TrueLayer and
  PayPal ended up with a plaintext file AND a registry entry. Providers that
  rotate the refresh token (TrueLayer does, on every exchange) make that actively
  destructive: whichever path runs last invalidates the other, so the connection
  appears to break at random. One credential, one path.

### 6. Deploy as a recurring workflow (optional)

For scheduled recurring API calls (e.g. monthly reports, daily data collection), deploy as a jkai canvas workflow using the `api-integration` node type:

```
api-integration node → transform node → delivery node (whatsapp / slack / email)
```

**Pattern**:
- **Trigger**: `cron` with 5-field expression (e.g., `0 9 1 * *` = 9am on the 1st)
- **Node 1 — `api-integration`**: pick a recorded integration by key. Auth is resolved server-side from the secret registry — the credential never enters the node config, the run log, or the LLM context. If no integration exists yet, create one: `api_register` → `api_integration_save` → `api_integration_test`.
- **Node 2 — `transform`**: categorisation, formatting. No credentials needed, safe in node config.
- **Node 3 — Delivery**: WhatsApp, Slack, email, or webhook.

**Never use `code-execute` for credentialled I/O.** The `code-execute` sandbox only injects `TAVILY_API_KEY`, `OPENROUTER_API_KEY` and `ELEVENLABS_API_KEY` — anything else must go through `api-integration`. Token exchange (refresh, client-credentials) is the registry's job, not yours.

For finance-specific workflow examples (monthly burn report, subscription audit), see the `financial-planning` skill.

## Case study: TrueLayer (authorization code)

TrueLayer is a UK Open Banking provider. Completed setup for John's NatWest account.

> **Full API reference** (endpoints, response shapes, known issues): see the `financial-planning` skill at `references/truelayer-api.md`.

**Additional headers required:** Some TrueLayer Data API endpoints (particularly the balance endpoint) require a `TL-IP-Address` header set to `127.0.0.1` to satisfy bank rate-limiting requirements. Without it, some banks return generic errors.

## Case study: PayPal (client credentials)

PayPal's Transaction Search API uses the simpler client_credentials grant:

> **Full API reference** (endpoints, query parameters, response shape, known merchant mappings): see the `financial-planning` skill at `references/paypal-api.md`.

1. User provides `client_id` + `client_secret` from developer.paypal.com
2. Encode as HTTP Basic Auth: `base64(client_id:client_secret)` 
3. POST to `https://api-m.paypal.com/v1/oauth2/token` with `grant_type=client_credentials`
4. Use resulting `access_token` as Bearer token
5. **No refresh token** needed — just re-auth when expired (~9 hour lifespan)

**Key differences from authorization code flow:**
- No user consent redirect
- No refresh token rotation
- Basic Auth instead of form-encoded client credentials
- 31-day query window limit on Transaction Search API
- Filter to event code `T0003` for payments sent (avoid mirror fee entries)

## Pitfalls

- **Auth codes are single-use.** Once exchanged, the code cannot be reused. If the exchange fails (truncated token, network error), the user must re-authorise and get a new code.
- **Token truncation.** Long JWTs may be visually truncated in tool output (showing `eyJhb...DbmA`) and even in `read_file` content. Always write tokens to a file with a Python script or curl redirect and verify completeness with `wc -c /tmp/file`. Refresh tokens are ~64 hex chars (32 bytes); access tokens (JWTs) are much longer.
- **Use execute_code for multi-step OAuth workflows, not terminal.** *(This applies to INTERACTIVE setup in chat only — never to a saved canvas `code-execute` node, see "Cron workflow credentials" below.)* When exchanging auth codes → tokens → making API calls in sequence, use `execute_code` (Python with `urllib`). The terminal tool truncates long JWTs in its output, making them unusable for subsequent `Authorization` headers. `execute_code` keeps values in Python memory throughout the script. Reserve `terminal` for: one-shot curl calls, file writes via redirect (`> /tmp/file`), or verification commands.
- **Refresh token rotation.** Some providers issue a new refresh token with each refresh. Always save the new one.
- **Bank rate limits.** Banks may impose strict limits (as low as 4 calls/day per account). Design scripts accordingly.
- **PayPal 31-day window.** The Transaction Search API only returns max 31 days per call. Split larger ranges into consecutive 31-day windows.
- **PayPal event code filtering.** Each debit (T0003) has a mirror fee entry (T0300) with the same amount. Always filter to T0003 to avoid double-counting. T0000 events = generic transfers (PayPal balance top-ups, not merchant payments).
- **UK bank coverage.** When evaluating UK Open Banking providers for a personal account:\n  - GoCardless/Nordigen: closed to new signups\n  - BankSync: lists UK banks but primarily US/AU focused\n  - TrueLayer: 98% UK coverage, accepts individual developers, pay-as-you-go\n  - Direct NatWest Bank of APIs: requires business onboarding (TLS certificates)\n  - Verify a provider actually serves UK banks before suggesting — don't assume from a homepage claim.\n- **Cron workflow credentials — NEVER hardcode.** When deploying an OAuth2 API as a jkai cron workflow, the credential goes in the secret registry (`/admin/ai/apis`) and the workflow uses an `api-integration` node that references it by handle. A credential must never be written into `workflow_nodes.config` — node config is unencrypted in the production DB, rendered in the canvas UI, echoed into healing prompts, and sent to a third-party LLM on every build. **This is not theoretical: on 2026-08-01 a live TrueLayer `client_secret` + bank `refresh_token` and a PayPal `client_secret` were leaked into seven production tables, including the Intel graph, where they were extracted as named entities and embedded. Everything had to be rotated.** Refresh-token-rotation APIs (TrueLayer) and client-credentials APIs (PayPal) are both handled by the registry's ref-source, which performs the token exchange server-side per request and persists rotated refresh tokens; `code-execute` cannot and must not do this. If a registry entry does not exist yet, create one (`api_register` → `api_integration_save` → `api_integration_test`) rather than falling back to inline code.

## Helper Script Template

```python
#!/usr/bin/env python3
import json, urllib.request, urllib.parse, os

CREDS_FILE = os.path.expanduser('~/.hermes-jkai/{provider}_creds.json')

with open(CREDS_FILE) as f:
    creds = json.load(f)

# Refresh token
data = urllib.parse.urlencode({
    'grant_type': 'refresh_token',
    'refresh_token': creds['refresh_token'],
    'client_id': creds['client_id'],
    'client_secret': creds['client_secret']
}).encode()

req = urllib.request.Request(f'https://{auth_domain}/connect/token', data=data)
req.add_header('Content-Type', 'application/x-www-form-urlencoded')
with urllib.request.urlopen(req) as resp:
    tokens = json.loads(resp.read())

at = tokens['access_token']
if tokens.get('refresh_token'):
    creds['refresh_token'] = tokens['refresh_token']
    with open(CREDS_FILE, 'w') as f:
        json.dump(creds, f, indent=2)

# Now use 'at' to call the data API
```

## Storing in jkai
After setup, add a memory so future sessions know the helper script path and provider name. The jkai secret registry (`/admin/ai/apis`) can hold client_secrets but NOT refresh tokens (those go in the JSON file).