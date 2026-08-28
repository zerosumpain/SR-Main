# UK Organisation & Charity Research

Patterns for researching UK organisations (companies, charities, academy trusts, public bodies) from authoritative primary sources. Developed during a United Learning Multi Academy Trust investigation, but the source hierarchy applies to any UK org/charity/MAT research request.

## Source hierarchy for UK org research

| Source | What it gives you | URL pattern | Access method |
|---|---|---|---|
| **Companies House** | Company number, incorporation date, registered office, SIC codes, filing history (accounts PDFs), officers (directors/secretaries, appointments, DOB, resignations), persons with significant control, charges | `find-and-update.company-information.service.gov.uk/company/<number>` | Browser — server-rendered, reliable. Tabs: Overview, Filing history, People (officers), Charges |
| **Get Information About Schools (GIAS)** | Academy trust UID, URN per establishment, establishment list (downloadable), school phase/type, address, governance | `get-information-schools.service.gov.uk/Groups/Group/Details/<uid>` (trusts) · `/Establishments/Establishment/Details/<urn>` (individual schools) | Browser — but can intermittently block with "The request is blocked." Use search `site:get-information-schools.service.gov.uk "<trust name>"` to find the UID |
| **Charity Commission** | Charity registration, trustees, annual returns, financial history | `register-of-charities.charitycommission.gov.uk/` | Browser |
| **Press / trade press** | Analysis, financial commentary, inspection outcomes, growth/controversy | Tes (`tes.com`), Schools Week (`schoolsweek.co.uk`), local press (BBC, Lancs Live, etc.) | Tes often paywalled on full articles but the free portion + headings carry the key figures |
| **Official org website** | Self-reported stats, ethos, performance tables, news, accounts PDFs | `unitedlearning.org.uk` etc. | Browser. `/about-us` pages often carry headline performance stats and self-reported figures |

### Companies House — extraction technique

Companies House pages are server-rendered and the snapshot truncates on long officer/filing lists. Use `browser_console` to pull the full text:

```js
// Full officer/filing table as plain text
document.querySelector('main').innerText.substring(0, 9000)
```

For filing history, the table rows each link to a PDF — the accounts PDF (often 80-90 pages) is the primary financial source. The filing-history tab lists date, description ("Full accounts made up to 31 August 2025"), and page count.

### GIAS — finding the UID

GIAS trust pages can block direct navigation. To find a trust's UID:
1. `web_search` with `site:get-information-schools.service.gov.uk "<Trust Name>"`
2. The result description includes the UID and academy count ("Academies (96)")
3. Navigate to `/Groups/Group/Details/<uid>` — if blocked, extract the academy count and trust address from the search snippet instead

### web_extract ddgs backend pitfall

`web_extract` may be configured with the DuckDuckGo (ddgs) backend, which is **search-only and cannot extract URL content**. The error reads:

> DuckDuckGo (ddgs) is a search-only backend and cannot extract URL content. Set web.extract_backend to firecrawl, tavily, exa, or parallel.

**Fix:** don't try to reconfigure the backend mid-session. Fall back immediately to `browser_navigate` + `browser_console` (`document.querySelector('main').innerText`) to extract page content. This works on Companies House, Wikipedia, Tes, and most JS-rendered sites. For Wikipedia specifically, the article text is fully in `#mw-content-text` innerText.

## Presentation pattern: "rich list of data"

When the user asks for "everything" or a "rich list of data" about an organisation, default to **dense, multi-source structured tables**, not prose summaries. The structure that worked for a MAT:

1. **Entity & registration** — company number, charity, incorporation date, registered office, SIC codes, PSC (two-column: ULT vs UCST when an org operates under multiple legal entities)
2. **Scale** — schools/pupils/staff counts, geographic spread
3. **Finances** — reserves, income, year-on-year change, staff salary bands, CEO pay
4. **Performance/inspection** — Ofsted rating counts (outstanding/good/RI/inadequate)
5. **Workforce** — diversity, retention, internal promotion rates
6. **Governance** — full current board table (name, role, DOB, appointed date) from Companies House, plus notable past officers
7. **Full establishment list** — organised by phase (primary/secondary/all-through) with locations
8. **Recent events** — dated timeline
9. **Key links** — Companies House, GIAS, official site, latest accounts PDF

Every figure carries its source inline. Cite Companies House, GIAS, Tes, and the official site by name — don't blend them into "sources say." The user wants to see *which* registry a number came from.

## Trust-specific data points to capture

For a multi-academy trust research request, these are the high-value data points worth pulling from the accounts PDF and press analysis:

- Total reserves and free reserves (year-on-year change)
- Reserves as % of recurrent operating income
- Number of staff on £100k+ (and year-on-year change)
- CEO pay band (note: for United Learning, CEO is paid by UCST not ULT — check which entity pays the CEO)
- Schools taken on / handed back in the year
- Community hub / outreach programme metrics
- Ofsted inspection cohort breakdown
- Workforce diversity percentages and internal promotion rates
- Teacher pay relative to national scales
