# Subscription Audit Patterns

## Frequency analysis technique

The core technique for identifying all subscriptions is:

1. Pull 90 days of transactions from ALL sources (current account + credit cards)
2. Normalise descriptions by stripping suffixes: trailing card numbers (` 6878`), location codes (` GBR LND`), transaction IDs
3. Group by normalised description, count occurrences
4. Any description appearing 2+ times in 90 days = likely recurring

## Gmail query patterns

| Purpose | Query |
|---------|-------|
| Broad subscription sweep | `"subscription" OR "receipt" OR "invoice" newer_than:90d` |
| Renewal confirmations | `"renewal" OR "renewed" OR "auto-renew" newer_than:90d` |
| Merchant-specific check | `from:anthropic OR from:claude.com newer_than:90d` |
| Annual billing warnings | `renew OR expires OR "will be charged" newer_than:90d` |

## Common card description normalisations

Raw bank description → normalised key:
```
ANTHROPIC* CLAUDE SUB SAN FRANCISCO CA USA 6878  →  ANTHROPIC* CLAUDE SUB
APPLE.COM/BILL CORK IRL IRL 6878                 →  APPLE.COM/BILL CORK
Microsoft*PC Game Pass Reading, Berk GBR          →  Microsoft*PC Game Pass
AMZNMktplace*HA8S60ND5 LONDON GBR                 →  AMZNMktplace (Amazon Marketplace)
```

## Spending categories to always break out

- Loan repayments (NatWest, Virgin, MBNA, Halifax, M&S, NewDay, Shop Direct)
- Car (CA Auto Finance, Elephant insurance, DVLA tax)
- Sky (TV + Digital + Mobile — separate DDs often sum to £207/mo)
- Insurances (L&G, CSSC, CoverMy, Lemonade, D&G — check for overlap)
- AI subscriptions (Claude £90, OpenRouter ~£18, ElevenLabs ~£4.50)
- Streaming (Apple, Prime Video, Amazon Music, Microsoft 365 — check for unused services)
- Gaming (PC Game Pass £10.99, SecondSim £5.99, EA Play £35.99/yr)
- Competitions (National Lottery ~£20, Omaze £15, Best of the Best £19.99)
- Phone (Sky Mobile £115/mo — check if you actually need this plan)
