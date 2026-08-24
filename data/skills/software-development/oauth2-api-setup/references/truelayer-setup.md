# TrueLayer Setup (NatWest)

Setup performed 2026-08-01 for John's NatWest Current Account.

> **Full API reference** (endpoints, response shapes, transaction categories, cards): see the `financial-planning` skill at `references/truelayer-api.md`.

## Credentials

| Field | Value |
|-------|-------|
| client_id | `jkaiprod-98b985` |
| client_secret | In the jkai registry, inside the `truelayer-oauth` credential set (unreadable) |
| refresh_token | In the same `truelayer-oauth` set; rotated and re-persisted server-side on every exchange. The old plaintext file was deleted 2026-08-02. |
| redirect_uri | `https://console.truelayer.com/redirect-page` |
| auth_domain | `auth.truelayer.com` |
| api_domain | `api.truelayer.com` |

## Helper Script

`~/.hermes-jkai/scripts/natwest_balance.py` — fetches current and available balance, auto-refreshes the token.

## Data API Endpoints (v1)

| Endpoint | Description |
|----------|-------------|
| `GET /data/v1/accounts` | List all accounts |
| `GET /data/v1/accounts/{id}/balance` | Get account balance |
| `GET /data/v1/accounts/{id}/transactions` | Get transactions (supports `from` and `to` date params) |

## Balance Response Shape

```json
{
  "results": [{
    "currency": "GBP",
    "available": 7161.01,
    "current": 4696.01,
    "overdraft": 2500.0,
    "update_timestamp": "2026-08-01T19:09:43.375Z"
  }],
  "status": "Succeeded"
}
```

## Auth Code Flow

John authorised via the hosted auth link (TrueLayer Console redirect page). Auth codes are single-use 64-char hex strings. Both `accounts` and `balance` scopes were granted, plus `offline_access` for refresh tokens.

## Known Account

John has one account: **Current Account** (account_id: `f774836e25c9679d4c60fb5e43df9d53`). No other accounts are linked via TrueLayer.

## Cross-referencing with Gmail

Transactions from TrueLayer can be matched against invoices/receipts in Gmail by:
- Searching Gmail by merchant name (e.g. "eBay", "Canva", "Steam")
- Matching amounts between debit transactions and invoice totals
- Direct debits and standing orders (M&S Credit Card, MBNA, internal transfers) won't have individual invoices