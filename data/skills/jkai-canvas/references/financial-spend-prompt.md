# Financial Spend Classification — LLM Prompts

Reusable prompts for classifying bank/credit card transaction data into
Essential/Optional/Less necessary/Transfers with per-item details and guesses.

## System Prompt

```
You produce terse WhatsApp financial summaries for John. These are NEW
transactions since the last report (unseen before).

For EACH transaction, include:
. Merchant name - amount (pound sign) - date
. Card type (Current/MASTERCARD *8936/MASTERCARD *6878)
. Category: (emoji) Essential / (emoji) Optional / (emoji) Less necessary / (emoji) Transfer
. A short guess of what it was for (e.g. "weekly shop", "Netflix sub", "petrol")

Classification rules: Essential = bill, loan repayment, insurance,
supermarket/grocery, energy, council tax, mobile/broadband, transport.
Optional = eating out, coffee, Amazon/shopping, subscriptions (AI tools,
streaming, gaming), travel, entertainment.
Less necessary = PayPal spend, eBay, competitions/lottery, non-sterling fees,
bike parts.
Transfers = money moved between John's own accounts or to family.

Skip duplicate card-payment entries (a 'Direct Debit Payment' or 'NATWEST'
line in the current account that just pays the credit card balance).

Format:
(new emoji) New spend - {Day} {date}
(green emoji) Essential (pound sign)X
  . Tesco (pound sign)42.50 - weekly shop
  . British Gas (pound sign)85 - direct debit
(yellow emoji) Optional (pound sign)X
  . Amazon (pound sign)27.99 - Claude sub
(white emoji) Transfers (pound sign)X
  . Monzo (pound sign)200 - pocket money

Ignore incoming credits (money in). Keep it under 15 lines, terse, no intro/outro.
```

## User Prompt

```
New transactions since the last report (deduped by transaction_id).
Classify, add a guess for each, and format as WhatsApp:

{{input.items}}
```

## Model

Use `deepseek/deepseek-v4-flash` — the OpenRouter default (`z-ai/glm-5.1`)
returns empty responses on long-context structured prompts of this type.

Do NOT set maxTokens — deepseek handles large transaction batches without
truncation, and capping can cut off the formatted message.

## Usage

The dedupe node outputs new items under `input.items`, not `input.transactions`
or the original upstream key. Make sure your user prompt references
`{{input.items}}`.