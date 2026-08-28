# PayPal Transaction Search API Reference

## Auth (OAuth2 Client Credentials)

PayPal uses the `client_credentials` grant (NOT authorization code flow). No user consent redirect is needed — the API key IS the app authentication.

### Get Access Token

```
POST https://api-m.paypal.com/v1/oauth2/token
Authorization: Basic {base64(client_id:client_secret)}
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
```

Base64 encode `{client_id}:{client_secret}` with no trailing newline.

Response:
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 32400,
  "scope": "https://uri.paypal.com/services/invoicing ..."
}
```

### Prerequisites

- PayPal **Business** account (can be created free from a personal account)
- REST API app created at [developer.paypal.com/dashboard](https://developer.paypal.com/dashboard) → Apps & Credentials
- **Transaction Search** feature enabled under the app's settings
- Live endpoints: `api-m.paypal.com`
- Sandbox: `api-m.sandbox.paypal.com`

## Transaction Search API

### Endpoint

```
GET https://api-m.paypal.com/v1/reporting/transactions
Authorization: Bearer {access_token}
Content-Type: application/json
```

### Required Parameters

| Parameter | Description | Format |
|---|---|---|
| `start_date` | Start of date range | ISO 8601: `2026-07-01T00:00:00Z` |
| `end_date` | End of date range | ISO 8601: `2026-08-01T00:00:00Z` |
| `fields` | Always set to `all` | `all` |
| `page_size` | Max 100 per page | 100 |
| `page` | Page number | 1 |

### Critical limits

- **Max 31 days** per single query. Split larger ranges into 31-day windows.
- Takes up to **3 hours** for new transactions to appear.
- Only returns **last 3 years** of data.

### Response shape

```json
{
  "transaction_details": [{
    "transaction_info": {
      "paypal_account_id": "NY77PUTNYVUGA",
      "transaction_id": "31T11785BP216062L",
      "transaction_event_code": "T0003",
      "transaction_initiation_date": "2026-07-03T18:01:07Z",
      "transaction_amount": {
        "currency_code": "GBP",
        "value": "-31.49"
      },
      "transaction_status": "S",
      "invoice_id": "BD310818895",
      "protection_eligibility": "02",
      "instrument_type": "PayPal",
      "instrument_sub_type": "PayPal Wallet"
    },
    "payer_info": {
      "account_id": "NY77PUTNYVUGA",
      "email_address": "paypal_noe@nintendo.co.jp",
      "payer_name": {
        "alternate_full_name": "Nintendo"
      },
      "country_code": "JP"
    },
    "cart_info": {
      "item_details": [{
        "item_name": "5000 HEAT-COINS",
        "item_description": "5000 HEAT-COINS",
        "item_quantity": "1",
        "item_unit_price": {
          "currency_code": "GBP",
          "value": "35.99"
        },
        "item_amount": {
          "currency_code": "GBP",
          "value": "35.99"
        },
        "total_item_amount": {
          "currency_code": "GBP",
          "value": "35.99"
        },
        "invoice_number": "..."
      }]
    }
  }]
}
```

### Transaction event codes

| Code | Meaning | Use |
|---|---|---|
| `T0003` | Payment sent (debit from your account) | ✅ Main — filter for these |
| `T0000` | Generic/general transfer | ✅ Includes PayPal balance top-ups and credit repayments |
| `T0300` | Fee | ❌ Skip — mirror entry of payments |
| `T1603` | Other adjustment | Could be refunds |
| `T0200` | Payment reversal | Used for refunds |

Each debit (T0003) is typically paired with a T0300 fee entry of the same amount (mirrored). Filter to T0003 to avoid double-counting.

### Key fields for identification

| Field | Path in response | What it tells you |
|---|---|---|
| Merchant name | `payer_info.payer_name.alternate_full_name` | e.g. "Nintendo", "DPS GAMES LIMITED" |
| Merchant email | `payer_info.email_address` | e.g. "steamgameseu@steampowered.com" |
| Item name | `cart_info.item_details[0].item_name` | e.g. "2500 HEAT-Coins" |
| Item description | `cart_info.item_details[0].item_description` | Often same as item_name |
| Invoice ID | `transaction_info.invoice_id` | Merchant's internal reference |
| Custom field | `transaction_info.custom_field` | Sometimes contains user email |
| Amount | `transaction_info.transaction_amount.value` | Negative = debit, positive = credit |
| Currency | `transaction_info.transaction_amount.currency_code` | Usually GBP |

### Known merchants (from John's account)

| Email | Name | Item | Category |
|---|---|---|---|
| steamgameseu@steampowered.com | www.steampowered.com | Various games | Gaming |
| a_leafe@wargaming.net | DPS GAMES LIMITED | HEAT-Coins, WoT Plus Core | Gaming (World of Tanks) |
| paypal_noe@nintendo.co.jp | Nintendo | Nintendo eShop | Gaming |
| paypal@postcodelottery.co.uk | Postcode Lottery Ltd | Lottery subscription | Gambling |
| hpiinstantinkuk@hp.com | HP Inc UK Limited | HP Instant Ink | Subscription |
| microsoftpayin.donotreply.1890.piemgbp2@microsoft.com | Microsoft Payments | Xbox Game Pass | Gaming |
| canvauk.paypalrevenue@canva.com | Canva UK Operations Ltd | Canva Pro subscription | Subscription |
| payments@humblebundle.com | Humble Bundle, Inc. | Humble Choice | Gaming |
| paypal@1and1.co.uk | IONOS CLOUD LIMITED | Domain/hosting | Hosting |

## Cross-referencing with bank transactions

When a bank transaction shows as "PAYPAL PAYMENT":

1. Note the exact amount and date from TrueLayer
2. Query PayPal transactions for the surrounding 31-day window
3. Match by amount (±£0.02 tolerance)
4. If no match in the current window, the payment may be older than 31 days — query previous windows
5. T0000 event code with merchant "PayPal UK" = balance top-up or credit repayment (not a merchant payment)

### Example Python snippet

```python
# Get PayPal transactions for matching
import base64, urllib.request, urllib.parse, json

auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
req = urllib.request.Request(
    "https://api-m.paypal.com/v1/oauth2/token",
    data=urllib.parse.urlencode({"grant_type": "client_credentials"}).encode(),
    headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"}
)
with urllib.request.urlopen(req) as resp:
    at = json.loads(resp.read())["access_token"]

# Query last 31 days
url = f"https://api-m.paypal.com/v1/reporting/transactions?start_date={start}&end_date={end}&fields=all&page_size=100&page=1"
req2 = urllib.request.Request(url, headers={"Authorization": f"Bearer {at}"})
with urllib.request.urlopen(req2) as resp2:
    data = json.loads(resp2.read())

# Filter to only debit payments
for t in data.get("transaction_details", []):
    if t["transaction_info"]["transaction_event_code"] == "T0003":
        amount = abs(float(t["transaction_info"]["transaction_amount"]["value"]))
        merchant = t["payer_info"]["payer_name"].get("alternate_full_name", "")
        item = t["cart_info"]["item_details"][0].get("item_name", "")
        print(f"£{amount:.2f} → {merchant} — {item}")
```