# UK Open Banking Provider Research

Research notes from connecting personal UK bank accounts (NatWest) to jkai via API. Last researched: August 2026.

## The regulatory reality

All UK banks operate under **Open Banking (PSD2)**. Accessing account data (AIS — Account Information Service) requires:

1. An **aggregator** (licensed AISP) that handles the OAuth consent flow
2. **End-user consent** — you authenticate directly with your bank via the aggregator's hosted page
3. A **redirect URI** for the OAuth callback — can use the aggregator's own console redirect page

No provider offers a simple API key for read-only balance access. Every path requires at least one OAuth consent flow where you log into your bank.

## Provider comparison

### ✅ Accepts individual signups

| Provider | UK Coverage | Pricing | MCP? | Signup Barrier | Notes |
|---|---|---|---|---|---|
| **TrueLayer** | 98% UK banks (incl. NatWest) | Pay-as-you-go; free sandbox | No | Low — individual developer signup works | Best UK coverage. OAuth flow: hosted auth page → redirect to console.truelayer.com/redirect-page with auth code. Need client_id + client_secret (tlcs_ prefix). |
| **BankSync** | 11,000+ institutions globally incl. UK/NatWest | $4/mo after free trial | ✅ **Yes** — MCP server at mcp.banksync.io/sse, API key auth | Low — individual signup works | Covers UK (Barclays, HSBC, Lloyds, NatWest, Santander, Starling, Revolut). MCP server gives 36 tools (list_accounts, list_balances, get_transactions). `bsk_` API key from Workspace → Developers. |

### ❌ Closed to new signups / business only

| Provider | Reason |
|---|---|
| **GoCardless (formerly Nordigen)** | Killed their free AIS tier. No new signups accepted. |
| **NatWest Bank of APIs (direct)** | Requires business onboarding as a regulated Third Party Provider. Dynamic Client Registration with transport/signing certificates. Not for individuals. |
| **Plaid** | Primarily B2B. Developer tier exists but UK coverage is secondary to their US focus. |
| **Teller.io** | US/AU focused. Does not support UK banks. |
| **Yapily** | B2B infrastructure provider. Business only. |
| **Tink (Visa)** | Enterprise. Business only. |
| **Salt Edge** | Global reach but B2B priced. |
| **Moneyhub** | Enterprise. Business only. |
| **TrueLayer** (mentioned above) | Does accept individual signups — see above. |

## TrueLayer setup flow (most practical for UK personal use)

1. **Sign up** at [console.truelayer.com](https://console.truelayer.com/) and create an app
2. Get **client_id** and **client_secret** (`tlcs_live_...`)
3. Add the secret to jkai at **/admin/ai/apis**
4. I construct the auth URL:
   `https://auth.truelayer.com/?response_type=code&client_id={client_id}&scope=accounts%20balance%20transactions%20offline_access&redirect_uri=https://console.truelayer.com/redirect-page`
5. **You click it** → select NatWest → log into NatWest → grant consent
6. You're redirected to `console.truelayer.com/redirect-page?code={auth_code}`
7. You copy the `code` param back to me
8. I exchange it for access + refresh tokens: `POST https://auth.truelayer.com/connect/token` with `grant_type=authorization_code`, `code=...`, `client_id=...`, `client_secret=...`, `redirect_uri=...`
9. Then fetch data via `GET https://api.truelayer.com/data/v1/accounts` + `GET .../accounts/{id}/balance`

### Key API endpoints (live)

| Endpoint | Method | Description |
|---|---|---|
| `https://auth.truelayer.com/connect/token` | POST | Exchange auth code for tokens / refresh tokens |
| `https://api.truelayer.com/data/v1/accounts` | GET | List all accounts (id, name, type, currency) |
| `https://api.truelayer.com/data/v1/accounts/{id}/balance` | GET | Current and available balance |
| `https://api.truelayer.com/data/v1/accounts/{id}/transactions` | GET | Transaction history |

### OAuth details

- **Scopes needed:** `accounts`, `balance`, `transactions`, `offline_access` (for refresh tokens)
- **Redirect URI:** TrueLayer Console's `https://console.truelayer.com/redirect-page` works — shows the auth code in the URL and on screen
- **Refresh token lifetime:** 90 days for most banks (PSD2 regulation). Can re-extend before expiry.
- **Rate limits:** Banks impose limits as low as 4 API calls/day per account. TrueLayer handles this with async responses.

## BankSync MCP approach (simplest long-term)

If the user prefers MCP-native integration:

1. **Sign up** at [banksync.io](https://banksync.io) — free trial, no card
2. **Connect NatWest** via their hosted Open Banking flow
3. **Generate API key** at Workspace → Developers (starts with `bsk_`)
4. **Add to jkai** — the MCP server connects at `https://mcp.banksync.io/sse` with header `X-API-Key`
5. After that, MCP tools like `banksync_list_accounts`, `banksync_get_balance` are available

**Pricing:** Free trial → $4/month. 11,000+ institutions. Read-only, no payment initiation.

## Key lessons from this research session

- **Don't recommend a single provider without verifying ALL constraints first** — geography, signup eligibility, pricing, and current signup status. GoCardless looked perfect on paper but was closed to new signups.
- **Redirect URI can be the aggregator's own console page** — no need to set up a custom endpoint on the jkai site for the OAuth callback. TrueLayer and most providers have a simple redirect page that shows the auth code.
- **Refresh tokens extend for 90 days** — the user only needs to re-authenticate every ~3 months. This can be automated with a cron job that uses the refresh token before expiry.
- **Rate limits are at the bank level, not the aggregator level** — some UK banks allow as few as 4 API calls per day. For a simple balance check, this is fine. For transaction history syncing, use async batch endpoints.