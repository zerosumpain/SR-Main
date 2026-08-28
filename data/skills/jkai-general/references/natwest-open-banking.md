# NatWest Open Banking — API Setup Reference

## Overview

NatWest provides Open Banking APIs via their [Bank of APIs](https://www.bankofapis.com/) portal and via third-party aggregators. All data access requires OAuth 2.0 consent with PSD2 strong customer authentication.

## Core APIs Available (direct NatWest)

| API | Purpose |
|-----|---------|
| Account and Transaction API | Balances, transaction history, account holder info |
| Payment Initiation API | Initiate payments programmatically |
| Confirmation of Funds API | Verify sufficient funds |

**Note:** The direct NatWest portal (bankofapis.com) requires onboarding as a regulated Third Party Provider with transport and signing certificates — not suitable for personal use.

## Aggregator Options (for personal use)

### TrueLayer ⚡ **Tested & worked**

[TrueLayer](https://truelayer.com/) is a UK Open Banking aggregator. Covers 98% of UK banks including NatWest. Pay-as-you-go, developer-friendly console.

**TrueLayer OAuth flow (tested live 2026-08-01):**

```
Step 1 — Generate auth URL:
  # For debit/current/savings accounts only:
  https://auth.truelayer.com/
    ?response_type=code
    &client_id={client_id}
    &scope=accounts%20balance%20transactions%20offline_access
    &redirect_uri=https://console.truelayer.com/redirect-page
    &providers=ob-natwest

  # For credit cards too — add 'cards' to scope (separate API, see Step 4b):
  https://auth.truelayer.com/
    ?response_type=code
    &client_id={client_id}
    &scope=accounts%20balance%20transactions%20cards%20offline_access
    &redirect_uri=https://console.truelayer.com/redirect-page
    &providers=ob-natwest

Step 2 — User clicks, logs into NatWest via TrueLayer-hosted consent page.
          Gets redirected to console.truelayer.com/redirect-page?code={auth_code}

Step 3 — Exchange auth code for tokens:
  POST https://auth.truelayer.com/connect/token
  Content-Type: application/x-www-form-urlencoded
  Body: grant_type=authorization_code
        &code={auth_code}
        &client_id={client_id}
        &client_secret={client_secret}
        &redirect_uri=https://console.truelayer.com/redirect-page

  Response: { access_token, refresh_token, expires_in, token_type: "Bearer", scope }

Step 4a — Debit accounts (accounts scope):
  GET https://api.truelayer.com/data/v1/accounts
  Authorization: Bearer ***  Response: { results: [{ account_id, account_type, display_name, provider: { provider_id } }] }
  account_type values: TRANSACTION | SAVINGS | BUSINESS_TRANSACTION | BUSINESS_SAVINGS

  GET https://api.truelayer.com/data/v1/accounts/{account_id}/balance
  Authorization: Bearer ***  Response: { results: [{ currency, available, current, overdraft }] }

Step 4b — Credit cards (cards scope — DIFFERENT ENDPOINT):
  GET https://api.truelayer.com/data/v1/cards
  Authorization: Bearer ***  Response: { results: [{ account_id, card_network, partial_card_number, card_type, display_name }] }

  GET https://api.truelayer.com/data/v1/cards/{account_id}/balance
  Authorization: Bearer ***  Response: { results: [{ currency, available, credit_limit, last_statement_balance, payment_due, payment_due_date }] }
  Note: negative available = credit limit exceeded

  GET https://api.truelayer.com/data/v1/cards/{account_id}/transactions?from={YYYY-MM-DD}&to={YYYY-MM-DD}
  Authorization: Bearer ***  Response: { results: [{ transaction_id, amount, currency, description, transaction_date }] }
```
  **⚠️ CRITICAL PITFALLS:**

- **Auth codes are SINGLE-USE.** If the token exchange succeeds but the output is truncated (common with long JWT tokens in terminal output), you MUST get a new auth code — the old one is consumed. Use shell variable capture (`TOKEN=$(curl ...) && echo "$TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])"`) rather than relying on the terminal tool's output truncation.
- **`offline_access` scope is essential** — without it, no `refresh_token` is returned and the access token expires in ~15 minutes.
- **`providers=ob-natwest`** pre-selects NatWest on the consent page so the user doesn't have to search for it. Use this rather than `uk-cma9-all:natwest_personal` (see next bullet).
- **`natwest_personal` only returns the Current Account.** The provider ID `natwest_personal` (in `uk-cma9-all:natwest_personal`) restricts consent to TRANSACTION-type accounts only — credit cards are excluded even if the user selects "all accounts" on NatWest's consent page. The correct provider ID is `ob-natwest` (the actual provider_id returned by the API). This covers all account types including credit cards.
- **CREDIT CARDS need the `cards` scope and a SEPARATE API endpoint.** TrueLayer has two completely separate APIs: `/accounts` (debit/current/savings — supports TRANSACTION, SAVINGS account types) and `/cards` (credit/charge cards). If you only request `accounts` scope, credit cards will never appear — even if the user selects "all accounts" on the NatWest consent page. You MUST:
    1. Include `cards` in the OAuth scope: `scope=accounts%20balance%20transactions%20cards%20offline_access`
    2. Call `/data/v1/cards` endpoint (not `/accounts`) for credit card data
    3. Use `/data/v1/cards/{id}/balance` (the response has `credit_limit`, `last_statement_balance`, `payment_due` fields)
- **Live vs sandbox URLs:** Live uses `api.truelayer.com` / `auth.truelayer.com`; sandbox uses `api.truelayer-sandbox.com` / `auth.truelayer-sandbox.com`.
- **Token expiry:** `access_expires` is typically 549–3600 seconds. `refresh_token` is long-lived if `offline_access` was granted.
- **Rate limiting:** Banks may impose 4 calls/day per account. TrueLayer enforces its own rate limits too.

### BankSync (MCP server)

[BankSync](https://banksync.io/) has a hosted MCP server (`mcp.banksync.io/sse`) with API key auth. Covers NatWest (confirmed on their [UK page](https://banksync.io/uk/excel)). 11k+ institutions globally.

```
{
  "mcpServers": {
    "banksync": {
      "url": "https://mcp.banksync.io/sse",
      "headers": { "X-API-Key": "bsk_<your_key>" }
    }
  }
}
```

**Setup:** sign up → connect bank via Open Banking → generate API key at Workspace → Developers → add at /admin/ai/apis.

**Verdict:** Simplest to integrate (no OAuth token management), but John rejected this option in a prior conversation (2026-08-01). Present as alternative but don't over-recommend.

### Other Aggregators

| Aggregator | Coverage | Notes |
|------------|----------|-------|
| GoCardless (former Nordigen) | 63 UK banks incl. NatWest | ❌ **CLOSED to new sign-ups** (standalone AIS product) |
| Teller | Limited UK coverage | US-focused, ACH/wire routing — may not support NatWest |
| Plaid | 95% across 20 countries | Has MCP server; US-centric but supports UK Open Banking |
| Salt Edge | 73 UK banks | Developer-friendly, global reach; likely B2B priced |
| Yapily | 47 UK banks | Infrastructure-only, no consumer UI |
| Tink (Visa) | 6k+ EU institutions | Enterprise-focused |

## Auth Flow (All Pathways)

```
User → Agent calls API → Bank: "No consent, redirect user"
  → User logs into NatWest, grants consent (2 min, one-time)
  → Bank issues tokens
  → Agent calls API → Returns balance
```

All aggregators require the same OAuth consent step from the user. The difference is what happens after — aggregators manage token refresh and response standardisation so you don't have to.

### OAuth2 Token Persistence Pattern

When using an OAuth2 REST API (like TrueLayer) that the static `api_call`/`api_integration_call` tools don't support natively (they expect a simple bearer token, not a refresh flow):

1. **Register the API** in jkai's catalogue via `api_register` (for discoverability).
2. **Add the client_secret** as a secret handle at `/admin/ai/apis` (for future programmatic use).
3. **Write a wrapper script** to `~/.hermes-jkai/scripts/` that:
   - Reads stored `client_id` + `client_secret` + `refresh_token` from a JSON file
   - Calls the OAuth2 `/token` endpoint with `grant_type=refresh_token`
   - Rotates the `refresh_token` on each call (most providers issue a new one)
   - Performs the data API call (accounts, balance, etc.)
   - Returns structured JSON
4. **Store the credential set in the secret registry, never in a file.** Step 4 used to say the opposite — "put the OAuth2 metadata in a JSON file, the registry is for static keys only". That was true until 2026-08-02 and is now wrong: the registry does OAuth2 itself. Call `request_credential` (provider `truelayer` / `paypal`), which writes two rows — `<provider>-oauth` holding the credential set, and `<provider>` which mints a fresh access token from it on every request.
5. For future queries use `api_call`, never a script.

**Why the file approach was retired.** A plaintext creds file is a *second* copy of a rotating credential. TrueLayer issues a new refresh token on every exchange, so whichever path ran last invalidated the other one. With a nightly cron on the file and a canvas on the registry, the connection broke roughly every day and looked like an auth problem. One credential, one path.

**TrueLayer usage** (verified live 2026-08-02):
- `api_call(api='truelayer', path='/data/v1/accounts')` — current accounts
- `api_call(api='truelayer', path='/data/v1/cards')` — credit cards
- `api_call(api='truelayer', path='/data/v1/accounts/{id}/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD')` — transactions; `/cards/{id}/transactions` for cards
- `to` must not be a future date — TrueLayer answers HTTP 400, not an empty list
- **Settlement lag:** weekend card transactions typically don't post until Monday or Tuesday. Daily spend queries need a wider lookback window (e.g. 3 days) to capture weekend spend.
- Registry handles: `truelayer` (reference this) + `truelayer-oauth` (the stored credential set; unreadable by anything but the server's token exchange)
- The daily summary is `canvas:daily-spend-summary`, not a script or a Hermes cron job
- John's NatWest account ID: `f774836e25c9679d4c60fb5e43df9d53`
- John's two credit cards: ending **8936** (£4,400 limit, light use — direct debits + interest only) and **6878** (£8,000 limit, active spender — the Reward Credit Card, ~166 txns/60 days)
- **When answering any finance question, consider ALL accounts:** Current Account (outgoings = negative amounts on `/accounts`) + both credit cards (spending = positive amounts on `/cards`). Skip internal transfers (card DD payments from Current Account, savings xfers) to avoid double-counting.

## What John Would Need To Do (One-time)

### TrueLayer (preferred — actively accepting sign-ups)
1. Sign up at [console.truelayer.com](https://console.truelayer.com/) → create an app (5 min)
2. Share the `client_id` and `client_secret` with the agent
3. Click the auth link the agent generates → log into NatWest → grant consent (2 min)
4. Copy the auth code from the redirect page back to the agent

### BankSync (alternative)
1. Sign up at [banksync.io](https://banksync.io/) — free trial
2. Connect NatWest via their interface
3. Generate API key at Workspace → Developers
4. Add the key at /admin/ai/apis on strangeramblings.com

## Sources

- [Open Banking Tracker — NatWest](https://www.openbankingtracker.com/provider/natwest)
- [Bank of APIs Developer Portal](https://www.bankofapis.com/)
- [TrueLayer Data API Docs](https://docs.truelayer.com/docs/data-api-basics)
- [TrueLayer API Reference](https://docs.truelayer.com/reference/getaccounts)
- [BankSync MCP Server](https://banksync.io/product/mcp)
## Moved here from jkai-general/SKILL.md (2026-08-02)

These were carried in the always-loaded skill on every turn. They belong with the
rest of the banking detail.

- **The local Python scripts are GONE (retired 2026-08-02):** `natwest_balance.py`,
  `natwest_cards.py`, `natwest_spend.py`, `analyse_outgoings.py`. Do not look for
  them and do not recreate them. Read bank data with `api_call` against the
  catalogued `truelayer` API — the credential is injected server-side and you never
  see it.
- **The daily spend summary is a CANVAS, not a cron script** —
  `canvas:daily-spend-summary`. A duplicate Hermes cron job of the same name is a
  bug, not a backup: it double-sends.
- **Never fabricate example figures.** When showing what a summary or WhatsApp
  message will look like, use obvious placeholders (`£X.XX`) or real fetched
  numbers — never plausible-looking invented amounts. A made-up balance reads as a
  real one.
- **John's finance preference:** when he asks about incoming or outgoing money,
  consider ALL accounts — current account plus both credit cards — not just the
  current account.
