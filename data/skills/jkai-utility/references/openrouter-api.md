# OpenRouter API — per-key vs account-wide data

## Endpoints available via the `openrouter` secret handle

| Endpoint | Path | Scope | Response fields (relevant) |
|----------|------|-------|---------------------------|
| **Credits** | `/api/v1/credits` | **Account-wide** — totals across ALL keys | `total_credits`, `total_usage` |
| **Key info** | `/api/v1/key` | **Per-key only** — just the authenticated key | `usage` (all-time), `usage_daily`, `usage_weekly`, `usage_monthly`, `limit`, `limit_remaining` |
| **Auth key** | `/api/v1/auth/key` | Same data as `/key`, different path | Same fields |
| **Activity** | `/api/v1/activity` | Account-level daily activity | **Not accessible** with non-management keys — needs a management key (`is_management_key: true`) |

## The gap that catches people

The credits and key endpoints return **different totals** on the same account:

| Source | What it reports |
|--------|----------------|
| `/credits` total_usage | All-time spend across the whole account |
| `/key` usage | All-time spend for this one key |

When these disagree (and they often do if there are multiple keys on the account), the gap is the spend attributed to other keys (e.g. the Hermes agent key vs the jkai platform key).

## What you can't do without a management key

- List all API keys on the account
- Get per-key breakdowns of other keys
- Access the `/activity` endpoint for daily time series
- Get management-level billing info

If the user wants full account-level burn rate, they need to:
1. Create a management key at openrouter.ai/keys
2. Register it as a new secret handle with `/api/v1/activity` in its allowed paths
3. Then call the activity endpoint for day-by-day data

## Fallback: tracking going forward

Without a management key, the best you can do is snapshot the `credits` total_usage periodically and compute deltas. This gives account-wide burn rate but only from the point you start tracking.