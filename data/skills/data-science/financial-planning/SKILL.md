---
name: financial-planning
title: Financial Planning
description: UK personal finance — Open Banking data collection, spend analysis, subscription audits, merchant mappings, UK tax bands, SIPP math, ISA strategy, self-assessment, and cron workflow deployment. Combines data plumbing (TrueLayer/PayPal) with planning (tax/pension/ISA).
tags: [finance, banking, open-banking, truelayer, paypal, expense-analysis, subscription-audit, uk-tax, sipp, isa, self-assessment, pension, financial-planning]
---

# Financial Planning

Class-level umbrella for UK personal finance — from getting the data (Open Banking, PayPal API) through spend analysis (categorization, subscriptions, merchant mappings) to financial planning (tax, pensions, SIPP, ISA, self-assessment).

## When to use

- "What's my bank balance" / "Review my spending"
- "Categorize my expenses" / "Forensic spend analysis"
- "Cross-reference payments with invoices"
- "Find duplicates" / "What are my biggest expenses"
- "Connect to PayPal" to identify mystery payments
- Questions about pension, SIPP, ISA, tax, savings, investments
- "What's coming up for renewal" / "When does my insurance expire"
- "Check my email for renewal dates" / "Find my policy dates"
- Salary >£100k or the personal allowance taper
- Self-assessment requirements
- Tax relief on pension contributions
- "Deploy a monthly financial report workflow"
- "Proactively find renewal/expiry dates from Gmail"

## Section A — Data Collection (TrueLayer + PayPal)

> **Auth setup**: TrueLayer (authorization code) and PayPal (client credentials) both use OAuth2. See `oauth2-api-setup` skill for the generic patterns. This section covers the finance-specific endpoints, response shapes, and quirks.

### TrueLayer (UK Open Banking)

**Credentials**: Stored in the site's secret registry via `request_credential` (provider `truelayer`). Never write to a file — this caused a credential rotation conflict on 2026-08-02.

**API reference**: `references/truelayer-api.md` — full endpoint list, response shapes, transaction categories, known issues.

**Key quirks**:
- `TL-IP-Address: 127.0.0.1` header required for some banks (rate-limit bypass)
- Access tokens expire ~600s; refresh tokens rotate on every exchange (registry handles this)
- Cards are separate from accounts: `GET /data/v1/cards` for credit card data
- NatWest restricts credit card feeds — card 8936 only shows interest/direct debits, card 6878 shows full itemised spend

**Access via MCP tools** (preferred over raw curl):
- `mcp_jkai_api_integration_call(key="truelayer-accounts")` — list accounts
- `mcp_jkai_api_call(api="truelayer", url="https://api.truelayer.com/data/v1/cards", ...)` — card list
- Raw `api_call` for card transactions

### PayPal Transaction Search API

**Credentials**: Stored via `request_credential` (provider `paypal`). Client_credentials grant — no refresh token, just re-auth every ~9 hours.

**API reference**: `references/paypal-api.md` — endpoint, parameters, response shape, merchant mappings.

**Key quirks**:
- 31-day max query window — split larger ranges
- Filter to event code `T0003` (payments sent) to avoid double-counting with T0300 fee entries
- T0000 with merchant "PayPal UK" = balance top-up / credit repayment, not a merchant payment
- Takes up to 3 hours for new transactions to appear

### Use execute_code for multi-step API workflows

When building financial API queries, prefer `execute_code` (Python with `urllib`) over `terminal` for:
- Multi-step auth + query workflows where tokens must persist between calls
- API responses with long JWTs (terminal truncates them)
- Pagination loops

Reserve `terminal` for one-shot curl calls or file writes via redirect.

### Payment-execution boundaries and failed subscription recovery

Treat all payments as high-impact actions: do not create a payment, amend funding details, or cancel a billing agreement without explicit confirmation that identifies the merchant and amount.

- The configured PayPal access supports reporting and billing-subscription management; it is not a general consumer checkout capability.
- A failed Stripe subscription charge is usually a **payment-method recovery** task, not an invoice that can be paid through PayPal. Search Gmail for the most recent Stripe/merchant failure notice and read it to establish the amount, cadence, and recovery route.
- If the email provides a Stripe Billing Portal / “Update payment method” link, the owner must complete sensitive card entry and any bank/3DS approval. Do not request card data in chat or attempt unattended payment initiation.
- Report the verified merchant, amount, what failed, and the owner action needed. For SecondSim, the known pattern is a £5.99 monthly rolling eSIM charge; its recovery email directs the owner to update billing details in Stripe.
- A future automation may safely prepare a payment candidate (invoice matching, merchant allow-list, hard amount cap, and owner approval), but not bypass provider authentication or make open-ended purchases.

## Section B — Spend Analysis

### Categorization approach

Group transactions by pattern using description matching:

- **Fixed bills**: Mortgage, loans, car finance, energy, insurance, subscriptions — monthly, similar amounts
- **Credit cards**: MBNA, Halifax, M&S, NewDay/Pulse, Very, AmEx — varying amounts, monthly
- **Subscriptions**: PayPal payments — check patterns by amount and date. Double amounts on same day suspicious
- **Transfers**: "From dad", "To Monzo", "To A/C" — savings/internal
- **One-off purchases**: Shopping, food, transport — irregular

### Known UK merchant mappings (bank → what it is)

See `references/truelayer-api.md` for the transaction description format. Key mappings discovered from John's NatWest account:

| Bank description | Actual service | Notes |
|---|---|---|
| CoverMy | Pet insurance (Nuala & Otto) | CoverMy.co.uk |
| DBC Collection | Darlington Borough Council — Garden Waste | NOT debt collection |
| Shop Direct | Very.co.uk credit account | Monthly statement |
| NewDay Ltd | Pulse Card | Credit account |
| Omaze | Monthly prize draw | £15/mo |
| CA AUTO FINANCE | Car PCP/HP finance | £766/mo |
| HETZNER | VPS hosting | ~£13.50/mo |
| OPENROUTER, INC | OpenRouter.ai credits | Pay-as-you-go, ~£18/mo |
| ANTHROPIC* CLAUDE SUB | Claude Pro by Anthropic | **£90/mo** — largest AI sub |
| Amazon Music | Amazon Music Unlimited | **£21.99/mo** — large discretionary |
| D&G APPLIANCE CARE | Domestic & General appliance insurance | Two payments: £5.75 + £6.94/mo |

Full list in the SKILL.md of the archived `financial-analysis` skill's original content — extract from the archive if needed.

### Known PayPal merchant mappings

| Amount | Merchant | Item | Frequency |
|---|---|---|---|
| £12.50 ×2 | Postcode Lottery Ltd | Two subscriptions | Monthly (14th) |
| £6.93 | Wargaming/DPS Games | WoT Plus Core | Monthly |
| £6.99 | Microsoft | Xbox Game Pass Essential | Monthly |
| £6.98 | HP Inc UK | HP Instant Ink | Monthly |
| £14.99 | Humble Bundle | Humble Choice | Monthly |
| £13.00 | Canva | Canva Pro | Monthly |

Full list: see `references/paypal-api.md` known merchants table.

### Duplicate detection signals

- Same amount, same day, same description → possible duplicate
- **False duplicate found**: Two £12.50 on 14th = two Postcode Lottery subs, not double-charge
- **True duplicate found**: Two £34.35 "Polished" Wargaming purchases on same day (May 31)
- **D&G Appliance Care**: two payments (£5.75 + £6.94) — check if promo rate expired

### Tri-source cross-referencing (Bank → Gmail → PayPal)

1. **Bank (TrueLayer)** — Pull all debits, note amount + date + description
2. **Gmail** — Search by merchant keyword + date window: `gmail_search(query="Canva after:2026-07-01 before:2026-08-01")`
3. **PayPal API** — For remaining mystery PayPal debits: query 31-day window, match by amount (±£0.02), filter T0003

## Section C — Subscription Audit

The most reliable way to identify ALL subscriptions is **frequency analysis on 90 days of transaction data**, not keyword matching.

### Technique

1. Pull 90 days of all transactions (current account + credit cards)
2. Normalise descriptions — strip card suffixes, trailing locations, transaction codes
3. Group by normalised description, count occurrences
4. Filter to 2+ occurrences in 90 days → recurring patterns

See `references/subscription-audit-patterns.md` for:
- Gmail query patterns (broad sweep, renewal confirmations, merchant-specific)
- Card description normalisation examples
- Category breakout template

### Evidence standard for newly discovered subscriptions

Treat a subscription as **new** only when at least two sources support it:

1. **Email evidence** — activation, new-plan confirmation, or an invoice whose first billing period begins recently.
2. **Spend evidence** — matching card/current-account merchant transaction, or a PayPal `T0003` payment.

Record the activation date, amount, billing cadence, funding source, and whether the first charge is delayed by a free trial. Do **not** count promotional emails, price-change notices, generic receipts without an activation date, or one-off purchases as new subscriptions.

For a precise confirmation, query the card/current-account API in a narrow window around the email date; this keeps results legible and distinguishes the merchant charge from FX fees. If an integration returns HTTP 200 but no extracted transaction list, fall back to a direct `api_call` against the same TrueLayer endpoint and use the raw JSON response.

PayPal responses contain paired entries: include only payment-sent `T0003` entries in spend totals; `T0300` is the funding leg and must not be double-counted.

### Output format

```
## SUMMARY
Total recurring: £X,XXX/mo | Cancellable: £XXX/mo | Annual saving: £X,XXX

## ESSENTIAL (cannot cancel)
| Service | Amount | Frequency | Account |

## DISCRETIONARY — could cancel
| Service | Amount | Annual | Account | Source |

## CANCELLABLE — pure waste
| Service | Amount | Annual | Account | Notes |
```

### Categories to always break out

- Home & utilities, Car, TV/broadband/mobile, Credit cards
- Insurance (car, pet, home, appliance, life)
- Subscriptions (gaming, software, AI, streaming)
- Competitions/gambling, Family transfers, Savings

## Section D — UK Financial Planning

### Income Tax Bands (2025/26)

| Band | Threshold | Rate |
|------|-----------|------|
| Personal allowance | £0 – £12,570 | 0% |
| Basic rate | £12,571 – £50,270 | 20% |
| Higher rate | £50,271 – £125,140 | 40% |
| Additional rate | £125,141+ | 45% |

### Personal Allowance Taper (the £100k trap)

- PA reduces by **£1 for every £2** earned above **£100,000**
- Fully lost at **£125,140**
- Effective **60% marginal rate** between £100k and £125,140
- Triggers self-assessment filing requirement

### SIPP Tax Relief Mechanics

- **Basic rate (20%)**: provider claims automatically — contribute £800, SIPP gets £1,000
- **Higher rate (40%)**: claim extra 20% via self-assessment or HMRC tax code adjustment
- **Additional rate (45%)**: claim extra 25% via self-assessment
- **£100k taper zone**: effective 60%+ relief because pension contributions restore personal allowance
- Annual allowance: **£60,000** (or 100% of earnings, whichever is lower)
- Can carry forward unused AA from previous 3 tax years
- MPAA: **£10,000** if flexibly accessed

### Civil Service / Alpha Pension Context

- **Alpha**: defined-benefit, career-average, **2.32% accrual rate** per year, CPI-linked
- SCS2 Director contribution rate: typically **7.35%** of pensionable salary
- DB pension accrual counts towards AA via the **16× multiplier**
  - At £135k: annual Alpha benefit ≈ £3,132 → pension input amount ≈ **£50k+**
  - Remaining AA headroom ≈ **£10k** for SIPP contributions
- Alpha is a **guaranteed, inflation-linked income floor** — SIPP can afford to be equity-heavy

### Self-Assessment Triggers

Mandatory if ANY of:
- Income > **£100,000** (personal allowance taper)
- Self-employed or partnership income
- Savings interest > **£10,000** (or > £500 for higher-rate taxpayers)
- Dividend income > **£10,000** (or > £500 allowance exceeded)
- Capital gains above annual exempt amount
- High Income Child Benefit Charge applicable
- Need to claim higher-rate pension tax relief (>£600 total contributions not covered by PAYE)
- Received any untaxed income

### Pitfalls

- **Not filing SA at >£100k**: HMRC expects it, and you're leaving higher-rate relief unclaimed
- **Confusing take-home with gross**: Always work from gross when discussing tax relief
- **Alpha AA impact**: DB pension input eats a big chunk of the £60k AA. A SIPP contribution pushing total >£60k triggers a tax charge
- **SIPP vs ISA trade-off**: SIPP has tax relief but lock-in until 57; ISA has post-tax money but tax-free access
- **Credit card interest**: clear high-interest card balances before maxing pension (guaranteed 20%+ return vs uncertain investment returns)
- **The £100k cliff edge**: small SIPP contributions that *nearly* restore the PA can leave you worse off. Cross the threshold cleanly

## Section E — John's Financial Profile

See `references/john-financial-profile.md` for the detailed profile: salary (£135k DfE SCS2), Alpha pension, NatWest current account, known monthly outgoings (~£3,567/mo), credit cards in use, and key planning notes (AA headroom, SIPP strategy).

Key numbers at a glance:
- **Salary**: £135,000 (net ~£6,490/mo via DfE PAYROLL)
- **Pension**: Alpha DB (SCS2, ~7.35% contribution)
- **Current balance**: ~£4,696 available (~£7,161 with £2,500 overdraft)
- **Identified outgoings**: ~£3,567/mo (car £766, energy £219, Sky bundle ~£209, various credit cards ~£259, insurance ~£116, lottery £20, daughter transfer £20, internal transfer ~£1,937)
- **Annual Allowance headroom**: ~£10k (after Alpha eats ~£50k of the £60k AA)

## Section F — Workflow Deployment

### CRITICAL: Never put a credential in a workflow node config

**A credential must never appear in `workflow_nodes.config`** — node config is stored unencrypted in the production DB, rendered in the canvas UI, echoed into healing prompts, and shipped to a third-party LLM on every build. On 2026-08-01 this leaked a live TrueLayer `client_secret` + bank `refresh_token` and a PayPal `client_secret` into seven production tables. Everything had to be rotated.

If you find yourself about to write a credential literal into a node, **stop and use `api-integration` instead.**

### Pattern: `api-integration` → `transform` → `whatsapp`

1. **Trigger**: `cron` with 5-field expression (e.g., `0 9 1 * *` = 9am on the 1st)
2. **Node 1 — `api-integration`**: pick a recorded integration by key. Auth resolved server-side from the secret registry — credential never enters the node.
3. **Node 2 — `transform`**: categorisation, grouping, formatting. No credentials needed, safe in node config.
4. **Node 3 — `whatsapp`**: sends the formatted output.

### Token exchange is the registry's job

Refresh-token and client-credentials flows are handled by the secret registry's ref-source, which mints a fresh access token per request and caches it until expiry. You configure a handle; you never perform the exchange. TrueLayer refresh tokens rotate on every exchange — the registry persists the new one automatically.

### Workflows built

| Workflow | Schedule | What it does |
|---|---|---|
| `monthly-burn-report` | 1st at 9am | Pulls last month's TrueLayer debits, categorises, sends WhatsApp breakdown |
| `monthly-subscription-audit` | 1st at 10am | Pulls bank DDs (3 months) + PayPal subs (60 days), merges, annualises costs |

## Section G — Renewal & Expiry Date Tracking

> **Trigger**: When John mentions insurance, car finance, mobile/contract renewals, or any financial commitment with an expiry date, capture the date and save it.

John wants you to proactively know when his financial commitments are up for renewal — not just the current balance, but what's coming due. This applies to:

- **Insurance**: Car (Elephant), pet (CoverMy — Nuala & Otto), home, appliance (D&G), life
- **Car finance**: CA Auto Finance PCP — final payment date
- **TV & broadband**: Sky TV+Mobile — contract end date
- **Mobile**: Tesco Mobile — contract end date
- **Energy**: Ecotricity — fixed tariff end date
- **Credit cards**: MBNA, Halifax, M&S, NewDay, Very, NatWest — 0% promo end dates, annual fee dates
- **Subscriptions**: Any that are annual rather than monthly

### Workflow

1. **Proactive Gmail search** (when no dates are known yet): Search John's inbox for renewal/policy emails using `gmail_search` with queries like `"renewal OR renew OR policy newer_than:2y"`, `"insurance subject:(policy OR renewal OR quote)"`, or provider-specific queries (`"elephant"`, `"covermy"`, `"ecotricity"`, `"sky"`, `"tesco mobile"`). Drill into individual messages with `gmail_get_message` to extract exact dates from the body text. Look for: policy renewal dates, start dates, "auto-renew on" text, and contract end dates.

2. When John provides a renewal/expiry date (or you find one via Gmail), save it to `references/renewal-dates.md` AND to user profile memory.

3. When asked about upcoming renewals, check the reference file and memory. Use the current date (via `date` command) to compute how far away each renewal is.

4. For short-term flags (within 30 days), offer to create a canvas workflow reminder.

5. Dates go in ISO format (`YYYY-MM-DD`) in the reference file for easy sorting. Also log the **source** of the date (e.g. "Gmail search 2026-08-08" or "John said").

### Reference file

`references/renewal-dates.md` — tabular list of all known renewal/expiry dates, sorted by upcoming date. Populated as John provides each date.

## Reference files

| File | Content |
|------|---------|
| `references/truelayer-api.md` | TrueLayer API endpoints, response shapes, transaction categories, known issues |
| `references/paypal-api.md` | PayPal Transaction Search API — auth, query params, response, known merchants |
| `references/subscription-audit-patterns.md` | Frequency analysis technique, Gmail query patterns, card normalisation |
| `references/john-financial-profile.md` | John's salary, pension, accounts, outgoings, and planning notes |
| `references/renewal-dates.md` | Known renewal/expiry dates for insurance, finance, contracts, and subscriptions. Populated from Gmail search (2026-08-08) |