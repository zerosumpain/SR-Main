# TrueLayer API Reference

## Auth

- Auth base: `https://auth.truelayer.com`
- Token endpoint: `POST /connect/token`
- Auth URL format: `https://auth.truelayer.com/?response_type=code&client_id={client_id}&scope=accounts%20balance%20transactions%20offline_access&redirect_uri={redirect_uri}&providers={provider_filter}`
- Redirect URI default: `https://console.truelayer.com/redirect-page`

### Grant flows

Authorization code exchange:
```
POST https://auth.truelayer.com/connect/token
Content-Type: application/x-www-form-urlencoded
grant_type=authorization_code&code={code}&client_id={id}&client_secret={secret}&redirect_uri={uri}
```

Refresh token:
```
POST https://auth.truelayer.com/connect/token
Content-Type: application/x-www-form-urlencoded
grant_type=refresh_token&refresh_token={token}&client_id={id}&client_secret={secret}
```

## Data API v1 (Live)

- Base: `https://api.truelayer.com`
- Sandbox: `https://api.truelayer-sandbox.com`

### Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/data/v1/accounts` | GET | List all accounts |
| `/data/v1/accounts/{id}/balance` | GET | Get account balance |
| `/data/v1/accounts/{id}/transactions` | GET | List transactions (use `from` & `to` query params) |
| `/data/v1/accounts/{id}/transactions/pending` | GET | Pending transactions |
| `/data/v1/cards` | GET | List credit cards |
| `/data/v1/cards/{id}/balance` | GET | Card balance |
| `/data/v1/cards/{id}/transactions` | GET | Card transactions |
| `/api/providers` | GET | List supported banks |
| `/data/v1/batch/transactions` | POST | Batch transaction fetch |
| `/data/v1/batch/balances` | POST | Batch balance fetch |

### Headers

```python
req.add_header('Authorization', f'Bearer {access_token}')
req.add_header('TL-IP-Address', '127.0.0.1')  # Needed for some banks (rate limit bypass)
```

### Response shape

Accounts:
```json
{
  "results": [{
    "account_id": "...",
    "account_type": "TRANSACTION",
    "display_name": "Current Account",
    "currency": "GBP",
    "account_number": {"iban": "...", "sort_code": "...", "number": "..."},
    "provider": {"display_name": "NatWest"}
  }]
}
```

Balance:
```json
{
  "results": [{
    "currency": "GBP",
    "available": 7161.01,
    "current": 4696.01,
    "overdraft": 2500.0,
    "update_timestamp": "..."
  }],
  "status": "Succeeded"
}
```

Transactions:
```json
{
  "results": [{
    "transaction_id": "...",
    "timestamp": "2026-07-27T00:00:00Z",
    "description": "7888 24JUL26 D EBAY O*05-1 ...",
    "amount": "-577.27",
    "currency": "GBP",
    "transaction_category": "PURCHASE",
    "merchant_name": "",
    "reference": ""
  }]
}
```

### Transaction categories

| Category | Meaning |
|---|---|
| DEBIT | Standard debit card purchase |
| PURCHASE | Contactless / chip & PIN |
| DIRECT_DEBIT | Direct debit or standing order |
| TRANSFER | Bank transfer (FPS) |
| CREDIT | Incoming payment |
| CASH | Cash withdrawal |
| ATM | ATM fee |
| DEBIT_CARD | Debit card transaction |

## Known issues

- Access tokens expire in ~550-600 seconds (~10 min)
- Refresh tokens are long-lived hex strings (~64 chars)
- Token display in terminal/read_file may truncate — write to file and verify byte count
- Some banks limit to 4 API calls/day per account (use TL-IP-Address header)
- Transaction descriptions can be cryptic — cross-reference with Gmail for clarity