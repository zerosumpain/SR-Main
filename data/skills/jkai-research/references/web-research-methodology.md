# Web Research Methodology

Patterns and reliable sources discovered during multi-source product research sessions. Focuses on UK retail/product research, but the general approach applies broadly.

## Site accessibility (current as of 2026-07)

### ⛔ Blocked / inaccessible
| Site | Issue |
|---|---|
| Google Search | CAPTCHA loop from server IPs — no search results |
| Bing Search | Same CAPTCHA wall as Google from server IPs |
| DuckDuckGo | Privacy redirect, empty results in headless |
| emtbforums.com | Cloudflare bot detection |
| pinkbike.com | Cloudflare bot detection |
| singletrackworld.com | 403 Forbidden to fetch_url (browser may work) |
| ENDURO Mountainbike | Paywall on articles |
| Tavily API | Not configured on Hermes instance |
| Most manufacturer sites (Amflow, BH, Commencal, Mondraker, Orange, Atherton, Whyte) | JS-rendered SPAs — fetch_url gets empty/redirected content |

**Fallback when all search engines are CAPTCHA-blocked:** use the `research_web_search` MCP tool (Tavily-backed) — it always works from server IPs and returns ranked results with snippets. Use `fetch_url` (MCP) to pull article bodies server-side when the browser is overkill.

### ✅ Reliable sources (scrapable via browser or fetch_url)
| Source | What it's good for | Access method |
|---|---|---|
| **electricmtbuk.co.uk** | Best consolidated buyer guides, specs panels, price comparisons | Browser (headless renders OK) |
| **e-bikeshop.co.uk** | Product pages with per-size stock, prices, full C2W scheme list (7+ schemes) | Browser |
| **theelectricbikeshop.co.uk** | Product pages with sizes, C2W acceptance (10 schemes), specs | Browser |
| **leisurelakesbikes.com** | Product pages work for brands they actually carry (Specialized, Cube, Whyte, Trek, Mondraker, Santa Cruz). They stock the Whyte Karve Evo RS (Avinox M2S) — see ⚠️ below re: Amflow collection page as marketing copy | Browser |
| **mtbmonster.com** | Amflow stockist with per-size radio buttons, stock levels, dedicated "Cycle To Work Reservation" button and footer C2W link. Clean BigCommerce-based product pages. ✅ always works | Browser |
| **sunsetmtb.co.uk** | Amflow, Orange (and other brands) — per-size stock status shown per-SKU (Out of Stock / Pre-order), clear model variant tables, 0% APR finance | Browser |
| **cooksoncycles.co.uk** | Amflow stockist with size dropdowns on product pages, dedicated Cycle to Work tab in product details. Pre-order model currently. | Browser |
| **yt-industries.com** | Direct-sales with size buttons, stock, full specs | Browser |
| **orangebikes.com** | Product pages with size dropdowns (some 404s) | Browser |
| **ebike-mtb.com** | Detailed lab tests with standardized range/weight data | fetch_url (server-rendered) |
| **emtb-test.com** | Standardized range tests with elevation gain figures | fetch_url (server-rendered) |
| **propain-bikes.com** | Configurator with claimed weights, sizes, pricing | fetch_url (server-rendered!) |
| **forbiddenbike.com** | Product pages with full spec tables, build tiers, sizing (S1-S4 proportional). Page is large JS — use `browser_console` innerText extraction (see below) | Browser |
| **bike-magazin.de** (/en/) | English server-rendered articles with full spec tables — excellent for brand/model overviews | fetch_url |
| **velduro.com** | Full spec + geometry tables per size (S/M/L/XL), clean server-rendered HTML | fetch_url |
| **commencal.com** | Product pages with FAQ + specs; localized URLs redirect but fetch_url follows them | fetch_url |
| **unno.com** | Full component spec sheets per trim, clean server-rendered | fetch_url |
| **megamo.com** | Full geometry tables (all sizes, flip-chip high/low), kinematics data (anti-squat, progression) | fetch_url |
| **research_web_search** (MCP) | General web search for finding review articles and retailer mentions | Always works |

### Technique: console innerText extraction for large JS product pages

When a manufacturer page (e.g. forbiddenbike.com) loads via JS and the snapshot truncates before reaching the spec tables, don't scroll — extract the full text via `browser_console`:

```js
// Get the full page text (spec tables included) in 8KB chunks
JSON.stringify({ allText: document.body.innerText.slice(0, 8000) })
```

Increase the offset (`slice(8000, 16000)`, etc.) for subsequent chunks. This is faster and more complete than scrolling + snapshot, and catches content that lazy-load never triggers in the accessibility tree. Works well on Forbidden, Commencal, and any SPA product page where specs render after initial load.

### ⚠️ Marketing landing pages disguised as collection pages

Some retailers publish SEO/marketing landing pages at URLs that *look* like product collections but contain **zero actual products** — only branded copy about a technology or brand. **Leisure Lakes' `/collection/avinox-ebikes` is the canonical example:** it claims "we stock a full range of Avinox-powered bikes" and calls itself "the UK's biggest stockist of Avinox e-bikes," but the `#productContainer` element is empty (0 bytes) and site search for `amflow`, `commencal`, `forbidden`, `unno` returns "no products match." 

**Important correction (July 2026):** While Leisure Lakes does NOT stock Amflow bikes, they DO stock the **Whyte Karve Evo RS** (Avinox M2S motor, real product page with L/M/XL options and Cycle to Work acceptance). So the collection page is marketing copy for Amflow specifically, not a wholesale rejection of Leisure Lakes as an Avinox retailer. Cross-check individual product pages rather than assuming a landing page represents the full picture.

**Detection pattern — run this in `browser_console` before trusting a collection page:**
```js
JSON.stringify({
  containerLength: document.getElementById('productContainer')?.innerHTML?.length ?? 'no #productContainer',
  productLinks: Array.from(document.querySelectorAll('a[href*="/products/"]')).length,
  searchResultsText: document.body.innerText.match(/no products|don't match|0 results/i)?.[0] ?? 'none'
})
```
If `containerLength` is 0 or `productLinks` is 0, the page is marketing copy — do NOT cite it as a stock source. Cross-check by searching the retailer's site for the specific brand name.

## Strategy: hierarchy of sources

For product comparison research:

1. **Buyer's guides first** (electricmtbuk.co.uk, bikeradar.com) — consolidated prices, specs overview
2. **Retailer product pages** (Leisure Lakes, Electric Bike Shop, MTB Monster, Sunset Cycles) — verified stock, sizes, prices, C2W status
3. **Review articles** (ebike-mtb.com, emtb-test.com) — standardized test data (weights, range tests, elevation)
4. **Manufacturer sites** — last resort, mostly inaccessible via scraping
5. **Forums** (emtbforums.com) — real-world owner reports but Cloudflare-blocked; search snippets via research_web_search can sometimes extract mentions

## Presenting results: tiered table format

When reporting product comparisons with stock/availability criteria, organise into **categorised tiers** rather than one flat list:

| Tier | Definition | Example label |
|------|-----------|---------------|
| **Best Bets** | All criteria confirmed met (in stock in target size, C2W confirmed) | "Best Bets" |
| **Pre-order / Deposit** | Available to order but not shelf-stock (may affect C2W timing) | "Pre-order (C2W offered)" |
| **Out of stock** | Was available, now gone in target size | "Out of stock / unavailable in L" |
| **Needs further check** | Some criteria unconfirmed (UK retailer exists but stock/C2W status unclear) | "Also worth a look" |

This saves the user from mentally filtering through bikes they can't buy right now. Always lead with what's actionable first.

### Stock verification technique: size dropdown interaction

For retailer product pages with size selection:
1. Identify the size dropdown by its `combobox` role in the snapshot
2. Check what options are listed — listed options are generally orderable, but the default state may say "Select an option to see availability"
3. The "Add to Basket" / "Pre-order" / "Pre-order" vs "Notify when in stock" button state reveals the stock reality
4. If the dropdown interaction is unreliable in headless browser, use `grep -i 'instock\|pre-order\|out of stock\|purchasable'` on the raw curl of the page — many retailers embed stock data in JSON (e.g. BigCommerce's `BCData` object has `instock` and `purchasable` booleans)
5. Pre-order bikes are NOT in-stock — flag this separately. C2W voucher expiry windows may not align with pre-order delivery dates.

## Subagent batching

When researching 10+ products simultaneously:

- **3 bikes per subagent max** for browser-based spec extraction — more than that hits iteration/time limits
- **Separate range/weight research from size/stock research** — different sites, different access patterns
- **Confirm disputed facts with dedicated subagents** — e.g., one subagent just to verify "does this model actually exist?"
- **Size checks**: retailer sites with size dropdowns are the gold standard; manufacturer sites often have 404s on product pages
- **Expected yield**: from 10+ products, expect to get confirmed weights for 2-3 (most brands don't publish them) and confirmed sizes for 6-8

### Pattern: split by RETAILER, not by product, for stock+criteria verification

When the task is "find products meeting criteria X at retailers that offer Y" (e.g., "Avinox bikes, size L in stock, retailer offers C2W"), split the work **by retailer group** across 2-3 parallel subagents, not by product. Each subagent owns a slice of the retailer list and reports back a uniform shape: `{ retailer, url, brand, model, price, sizes (esp. target size), stock status, C2W schemes accepted }`.

Why this beats per-product splitting:
- Each subagent builds familiarity with one retailer's site structure (URL patterns, dynamic-load quirks, where the C2W badge lives) and reuses it across multiple products on that site.
- C2W scheme participation is per-retailer, not per-product — verifying it once per retailer is sufficient.
- Stock checks need fresh per-retailer context (their stock widget, their size dropdown selector) — batching by retailer amortises that learning.

Expected tool budget per subagent: ~40-50 browser iterations to thoroughly cover 3-5 retailers with dynamic JS pages. Set expectations accordingly — a subagent checking 13 retailers will run out of iterations before finishing.

## UK-specific: Cycle to Work verification

- Check retailer pages for Cyclescheme/GCI/Bike2Work badges or mentions
- Major UK retailers and their C2W status varies — verify per-retailer, not per-brand (a retailer may accept C2W site-wide, but check they apply it to e-bikes specifically)
- Green Commute Initiative (GCI) is uncapped — preferred for bikes over £3,000
- Commencal is direct-only and currently does NOT support C2W
- Direct-to-consumer brands (Atherton, YT) often have C2W on their own checkout
- **Verification technique:** C2W acceptance is typically a site-wide footer link or a dedicated page ("Cycle to Work", "CycleScheme"), not buried per-product. On a product page, check the footer nav first, then scroll down for C2W badges in the features grid — faster than searching the page content.
- **Pre-order vs in-stock matters for C2W delivery timing** — some C2W providers (Cyclescheme) issue vouchers that expire within a window. If a bike is pre-order only, flag this so the user can time their C2W application accordingly.
- **e-bike >£1,000 C2W cap:** Standard Cyclescheme cap is £1,000. For e-bikes over £1,000, retailers typically offer the **Green Commute Initiative (GCI)** which is uncapped, or they split payments. Always check which specific C2W provider(s) a retailer offers for high-value e-bikes.

## Known data gaps in eMTB/bike research

- Most bike brands do NOT publish complete weights — this is normal, not a research failure
- Range data is sparse for new motor systems (first year) — standardized tests exist from ebike-mtb.com and emtb-test.com
- Manufacturer sites restructure URLs frequently — pages that worked last month may 404 today

## Knowledge bank: Avinox (DJI) e-bike motor system

Verified July 2026. Re-verify stock before citing as current.

### What it is
- **Avinox** is the e-bike drive system made by **DJI** (the drone company). Three variants: **M1** (original), **M2** (entry), **M2S** (flagship). M2 and M2S share mounting points with M1, so frames developed for M1 accept the newer motors.
- **Amflow** is DJI's own bike brand and is by far the most widely stocked Avinox bike in the UK. Other Avinox brands (Commencal, Forbidden, Megamo, Unno, Steppenwolf, Velduro, Crussis, Teewing) are largely Continental/direct-sale and not stocked by UK retailers as of July 2026.

### Avinox M2S headline specs (from Leisure Lakes marketing page — specs are accurate even though their stock claims are not)
- Max continuous torque: 130 N·m (Boost: 150 N·m for 60s)
- Peak power: 1500 W (rated 250 W, max assist 800%)
- Weight: 2.59 kg
- Sound pressure: ≤45 dBA
- Five assist modes: Auto / Eco (46 N·m) / Trail (91 N·m) / Turbo (117 N·m) / Boost (150 N·m)

### UK Avinox stockists (verified July 2026)
| Retailer | Stocks Avinox? | C2W? | Notes |
|---|---|---|---|
| **e-bikeshop.co.uk** | ✅ Yes — Amflow range (PL, PR, PX Carbon variants) | ✅ 7 schemes (Cyclescheme, GCI, Halfords C2W, Vivup, Bike2Work, Cycle Solutions, Caboodle) | Best UK Amflow stockist. Per-size stock shown on product pages. |
| **theelectricbikeshop.co.uk** | ✅ Yes — Amflow range, often on sale | ✅ 10 schemes | Stock varies; PX Carbon Pro L was pre-order only at time of check |
| **trailsurge.co.uk** | ⚠️ Lists Amflow PL Carbon | Has C2W page | Sold out across all sizes at time of check |
| **leisurelakesbikes.com** | ✅ Yes — Whyte Karve Evo RS (Avinox M2S) ONLY | ✅ (Cyclescheme, GCI, Gogeta) | DO stock the Whyte Karve Evo RS (real product page, L/M/XL). Their `/collection/avinox-ebikes` page is Amflow-only marketing copy — ignore it. |
| **mtbmonster.com** | ✅ Yes — Amflow PR Carbon (2027 Moss Green) | ✅ "Cycle To Work Reservation" button + footer C2W link | L in stock as of July 2026. Also available: M, XL, XXL. Add-to-cart enabled. |
| **sunsetmtb.co.uk** | ⚠️ Amflow PR Carbon Pro + Orange Phase Avinox Factory | ⚠️ 0% APR finance shown but C2W not explicitly confirmed | Both models pre-order only. All sizes of Amflow PR Carbon Pro out of stock. Orange Phase Large available for pre-order with £200 deposit. |
| **cooksoncycles.co.uk** | ⚠️ Amflow PR Carbon | ✅ Has dedicated "Cycle to Work" tab + footer C2W page | L available as pre-order with £150 deposit, not in-stock. |
| **uprisebikes.com** | ✅ Forbidden Dreadnought E | ✅ Cyclescheme listed as payment method in config | Dealer for Forbidden. Need to call for Dreadnought E stock. |
| **athertonbikes.com** (direct) | ✅ Atherton S.170E.1 | ✅ "finance options and cycle to work are possible for UK customers" (on-site) | Direct from Atherton. £4,499.50 deposit, balance due 06/08/26. 12 frame sizes. Ships to UK. |

### Brands using Avinox (global, not necessarily UK-stockable)

**First wave (M1/M2S original):** Amflow (DJI own-brand), Commencal (Meta Power SX), Forbidden (Druid E, Dreadnought E), Megamo (Reason, Reason Air), Unno (Mith), Steppenwolf (Tundra), Velduro (Rogue), Crussis (e-Full, e-Hard), Teewing (Flux One), Crestline (RS 181 — frameset only, US).

**Second wave (M2/M2S, added early-mid 2026):** Whyte (Karve Evo RS), BH (iLYNX+ DL), Propain (Ekano AL), Atherton (S.170E), YT (Decoy X), Mondraker (Zendit), Orange (Phase Avinox).

For authoritative brand/model overviews, fetch `electricmtbuk.co.uk` and `bikeradar.com` buyer's guides — they publish server-rendered listicles with full spec panels. The BikeRadar article "Avinox is taking over – here are 20 bikes you can buy" (bikeradar.com/news/bikes-with-avinox-m2-m2s-motors) is the most comprehensive single source for the global M2/M2S lineup.

### Avinox M2S manufacturer comparison (verified July 2026)

All bikes below use the **M2S motor** (150 Nm / 1,500 W peak / 2.59 kg). Differences are frame, suspension, geometry, components, and price. Prices are EUR unless noted; re-verify before citing as current.

| Brand / Model | Origin | Frame | Travel F/R | Wheels | Battery | Weight | Top build price | UK availability |
|---|---|---|---|---|---|---|---|---|
| **Amflow PX Carbon Pro** | China (DJI) | Carbon | 160/150 | Mullet (conv. 29er) | 700 Wh fixed | ~20 kg | £8,999 | ✅ e-bikeshop.co.uk (C2W) |
| **Unno Mith** | Spain | Carbon | 170/160 | Mullet | 800 Wh fixed | ~21.2 kg | €15,095 | ❌ Direct from unno.com only |
| **Commencal Meta Power SX** | Andorra | **Alloy** | 160/160 | Mullet | 800 Wh fixed (600 in S) | — | €10,950 | ⚠️ Direct + bikeandspanner.co.uk (no C2W) |
| **Forbidden Druid E** (T1/T2 only) | Canada | Carbon | 160/150 | Mullet (fixed) | 600 or 800 Wh fixed | — | ~€11,500 (CAD $16,199) | ⚠️ Dealer-only — Uprise Bikes (UK) |
| **Velduro Rogue R** | NZ/China | Carbon | 170/165 (→172) | Mullet (conv. 29er) | 800 Wh fixed | 23.6 kg | €8,625 | ❌ Direct from velduro.com |
| **Teewing Flux One** | China | Carbon | 180/170-178 | Mullet or 29er | 800 Wh fixed | — | from €6,899 | ❌ dripebikes.com / direct |
| **Megamo Reason** (CRB) | Spain | Carbon or alloy | 160/160 (Reason) or 140/140 (Air) | 29er | 800 Wh fixed | from 20.3 kg | ~€9,999 (alloy from €4,999) | ❌ No UK dealer yet |
| **Steppenwolf Tundra** | Germany | Carbon | 160/160 | 29er (not mullet) | 800 Wh fixed | 21.8 kg (M) | €7,999 | ❌ German market only |
| **Crestline RS 181** | USA | Carbon (frameset only) | 161-181 adj. | Mullet or 29er | 800 Wh **removable** | — | $6,999 (frame only) | ❌ US; no battery shipped to EU |
| **Crussis e-Full 12.11-Pro X** | Czech | Alloy or carbon | 160/150 | Mullet | 600 or 800 Wh fixed | <20 kg | €11,990 | ❌ Czech market only |
| **Whyte Karve Evo RS** | UK | Carbon mainframe + alloy rear | 180/180 | Mullet | 800 Wh fixed (service-removable) | ~24 kg | **£5,650** | ✅ Leisure Lakes (C2W) — **most affordable M2S gravity bike** |
| **BH iLYNX+ DL Enduro** | Spain | Alloy or carbon | 170/170 | 29er (not mullet) | 800 Wh fixed | — | **from £4,899** | ⚠️ Patchy UK dealer network — call local shop |
| **Propain Ekano AL Trail / Enduro** | Germany | Alloy | 160/150 (Trail) or 170/160 (Enduro) | Mixed or 29er (configurable) | 600 or 800 Wh, **removable** | — | **from £4,999** | ⚠️ Direct-sales from Germany. C2W unlikely. Highly configurable (M2 or M2S motor choice). |
| **Atherton S.170E.1** | UK/Wales | 7075 Aluminium (lug+tube bonded) | 170/170 | Mullet | 700 Wh fixed | ~22 kg | **£8,999** | ✅ Direct from athertonbikes.com (C2W confirmed). 12 frame sizes (no S/M/L). £4,499.50 deposit. |
| **YT Decoy X** | Germany | Carbon | 170/165 | Mullet | — | — | **£8,499** | ⚠️ YT exited administration in 2026. Launch Edition limited. Direct-sales only. |
| **Mondraker Zendit RR** | Spain | Carbon (Stealth Air) | 170/160 | Mullet | 700 or 800 Wh | — | **£7,399** | ❌ UK dealer-dependent (Mondraker has UK distributors). |
| **Orange Phase Avinox RS / Factory** | UK | Alloy (6061 T6) | 160/160 | Mullet | 800 Wh fixed | — | **from £8,250** | ⚠️ Sunset MTB (pre-order with deposit). Orange Bikes UK — direct via orangebikes.com or dealers. |

**Suspension design split:**
- **High-pivot with idler** (rearward axle path, less pedal kickback): Forbidden (Trifecta V3), Velduro (i-Track), Teewing, Crestline — the descendy ones
- **Four-bar linkage** (conventional): Amflow, Megamo, Steppenwolf, Commencal (VCS)

**Notable build details:**
- **Forbidden Druid E:** 4 tiers. Only T1 ($16,199 CAD) and T2 ($13,199) get M2S; T3/T4 use lesser M2 motor (110 Nm/1100W). Proportional sizing S1-S4 (not S/M/L/XL) — "One Ride Geometry" with size-specific front-centre. Trifecta V3 high-pivot with idler. Dealer-only sales model (not direct).
- **Unno Mith:** 4 trims (Factory €15,095 / Pro Podium €13,095 / Pro €12,095 / Race €9,995). Pro Podium has a Fox DHX2 SLS **coil shock** option. Lifetime frame + EnduroMAX bearing warranty to original owner. Founder rode prototype 12,250 km / 460,000 m elevation — zero frame/bearing fatigue. Only 3 sizes (no XL).
- **Commencal:** Only alloy M2S bike (deliberate — durability/cost). VCS suspension proven across their e-bike range. Direct-to-consumer from Andorra. Fast charger included.
- **Velduro Rogue R:** i-Track licensed high-pivot with 16T idler. Travel adjustable 165→172mm via shock flip chip. Rear wheel swaps 27.5/29. 5-year frame + wheel warranty, 2-year motor. Available as frameset (€4,999).
- **Megamo Reason:** Longest reach on test (L=502mm). Progressive kinematics 21% leverage, anti-squat 108%→104%. Two versions: Reason (160mm enduro) and Reason Air (140mm trail, from 17.9 kg). Cheapest M2S entry via alloy frame (€4,999).
- **Amflow PX Carbon Pro:** 40 geometry configurations (head angle ±1°, BB height, 4-pos chainstay, mullet/29er swap). Press consensus benchmark — "the benchmark motor" (Velomotion, E-Mountainbike, MBR). Only M2S bike in UK stock with C2W.

**UK buyer reality (July 2026):** Of the expanded M2S lineup (20+ models across 17 brands), confirmed in-stock (size L) with Cycle to Work at a UK retailer are:
1. **Amflow PR Carbon** (£3,999) — MTB Monster (C2W), or e-bikeshop.co.uk
2. **Whyte Karve Evo RS** (£5,650) — Leisure Lakes Bikes (C2W)
3. **Atherton S.170E.1** (£8,999) — Direct from Atherton (C2W), deposit required
The remaining brands are pre-order (Amflow PX, Orange Phase), dealer-dependent (Forbidden, BH, Mondraker), or direct-sales without C2W (Propain, Commencal, YT). The "second wave" of UK-brand Avinox bikes (Whyte, Orange, Atherton) significantly broadened UK availability mid-2026.

## Spare / replacement parts research

A distinct subclass of product research: the user already owns a product and needs a service/replacement part. The approach differs from new-product shopping because the goal is finding the **manufacturer's own spare parts channel**, not comparing retailers.

### Pattern: manufacturer accessories/spares sections

Manufacturer e-commerce sites (Amflow, DJI, etc.) often use JS-rendered SPAs where `web_extract` returns empty or 404. The part *exists* in their catalogue but isn't surfaced on product pages — it lives in an **Accessories** or **Spare Parts** section of the site.

**Source hierarchy for spare parts:**

1. **Manufacturer's own store accessories/spares page** — the most reliable source for exact OEM part numbers and compatibility. Example: Amflow UK store (`amflowbikes.com/uk/pages/after-sales-accessories`) has tabbed sections for PX, PR, and PL model lines.
2. **Specialist spare parts retailers** — eBike24 (`ebike24.com/amflow-spare-parts`), ridewill.com, Albera Bike. These list drive components, chargers, cables, displays, and fasteners, but may not stock large items like batteries (which tend to be manufacturer-direct).
3. **Forums with user reports** — emtbforums.com, reddit. Often surface pricing (e.g. "€1/Wh for Avinox RS800") and compatibility notes that the manufacturer doesn't publish.
4. **General web search for the specific part number** — e.g. "Avinox RS800 Battery" or "Amflow PR Carbon spare battery" to catch third-party listings and secondary market.

### Technique: tabbed SPA accessories pages

Modern manufacturer stores (Amflow, Unno, Specialized) use a **tabbed card layout** for accessories — clicking a model tab (e.g. "Amflow PR Accessories") dynamically swaps the product cards below with that model's compatible parts. These tabs are JavaScript-driven and may not register in browser_snapshot's accessibility tree, making the relevant section invisible even after clicking.

**Detection — check if the page has tabs for other models:**

```javascript
// Check how many model/type tabs exist
Array.from(document.querySelectorAll('button')).filter(b =>
  /accessor/i.test(b.textContent) || /[A-Z][A-Z] Accessor/i.test(b.textContent)
).map(b => b.textContent)
```

**Extraction pattern for tabbed card layouts with lazy-loaded prices:**

1. Click each tab via `browser_click` (e.g. @e426 for "Amflow PR Accessories").
2. The cards render but the accessibility tree snapshot may show stale content from the previously-active tab (React state updates). Use `browser_console` JS to query the DOM directly:
   ```javascript
   // Find all product card headings (h3) and their prices
   Array.from(document.querySelectorAll('h3')).map(e => ({
     name: e.textContent,
     // Walk up to container then search for price
     price: (() => {
       let el = e;
       while (el && el !== document.body) {
         const m = el.textContent.match(/£[\d,]+\.?\d*/);
         if (m) return m[0];
         el = el.parentElement;
       }
       return '?';
     })()
   }))
   ```
3. The button/tab click succeeds even if the snapshot doesn't visibly change — the DOM updates are real, just not reflected in the accessibility tree. Trust `browser_console` JS queries, not the snapshot, for data extraction after tab changes.

### Specific findings: Amflow PR Carbon Pro battery replacement

- **Manufacturer store:** Amflow UK Accessories → "Amflow PR Accessories" tab → **Avinox RS800 Battery** (800Wh removable) — **£699**
- **For comparison:** Avinox FP700 Battery (700Wh fixed, for PX models) — **£949** (more expensive despite lower capacity — the FP700 is the higher-density integrated battery)
- **Secondary battery:** Avinox RS600 Battery (600Wh) available separately for external downtube mounting — compatible with L/XL/XXL PR frames, supports dual-battery setup up to 1280Wh (800+480) or 1400Wh (800+600)
- **Installation note:** The Amflow FAQ states "primary battery installation/replacement requires removing the Drive Unit" and recommends an authorized Amflow store. However, the PR line's **removable/swappable** battery design means the RS800 can be routinely removed and reinserted for charging — the "remove drive unit" note likely refers to the initial installation or the fixed-battery PX models.
- **Cross-generational compatibility:** Avinox M2S batteries (RS800, RS600, FP700) are interoperable across M2 and M2S motors per DJI's interoperability claims — a spare battery will carry forward to a future Avinox bike.
- **Where NOT to look:** eBike24's Amflow spare parts catalogue lists cables, controllers, displays, chargers, and frame components but does NOT stock batteries — those are manufacturer-direct only.

### Verifying spare part availability through the purchase flow

After finding the part in the accessories section, add it to the cart to verify:
- It's actually in stock (not "Notify Me" or greyed out)
- It's the correct SKU/variant for the user's model
- Shipping is available to the user's region (some batteries have shipping restrictions — lithium batteries are often ground-shipped only within the same country)

## Battery range estimation for route planning

A common question once the user owns (or is considering) an e-MTB: "can a single charge cover route X?" This requires comparing route data (distance + cumulative climbing) against published range test results.

### Step 1: Get the route data

For UK long-distance routes, use Wikipedia + AllTrails/Where2Walk for the canonical numbers:

- **Distance** — in km (convert from miles by ×1.609)
- **Cumulative elevation gain** — total climbing, not net elevation difference
- **Terrain type** — surfaced fire road vs technical singletrack vs moorland bog (affects rolling resistance, hence efficiency)

### Step 2: Find published range data for the specific bike/motor

The most reliable published range tests come from:

| Source | What they test | Format |
|--------|--------------|--------|
| **ebike-mtb.com** (E-MOUNTAINBIKE Magazine) | Standardised loop with known elevation, range in Turbo/Auto/Eco | km + m climbing per mode |
| **emtb-test.com** | Standardised range tests, elevation gain figures | m climbing, km distance |
| **MBR (Mountain Bike Rider)** | Real-world range tests, often in Turbo mode on cold/wet trails | km + m climbing per charge |
| **Retailer descriptions** (Leisure Wheels, etc.) | Manufacturer-claimed or estimated range in Auto mode | Usually loose estimates (e.g. "~60km mountain biking") |

### Step 3: Apply the range estimate

Key variables that affect real-world range vs published tests:

| Variable | Effect on range | Notes |
|----------|----------------|-------|
| **Rider weight** | Heavy rider ≈ less range | Published tests typically use ~75kg riders |
| **Bike weight** | +3kg ≈ noticeably less range | PR Carbon Pro (24.2kg) vs PL Carbon (21kg) — 3kg+ difference matters |
| **Motor power** | More powerful = more draw | M2S (1500W) draws more than M1 (1000W) at same assistance level |
| **Terrain** | Technical / soft ground = more draw | Fire roads glide; moorland bog drags; loose climbs waste energy |
| **Assistance mode** | Biggest single variable | Eco can triple range vs Turbo |
| **Temperature** | Cold = reduced battery capacity | MBR test at 8°C saw noticeable reduction |

### Rule of thumb for Amflow 800Wh bikes

Based on published tests (MBR, Leisure Wheels) — re-verify for specific model:

| Assistance mode | Climbing capacity | Distance capacity | Source |
|----------------|-------------------|-------------------|--------|
| **Turbo/Boost** | ~1,400 m climbing | ~36 km | MBR range test (PL Carbon, 800Wh, cold/muddy) |
| **Auto** | ~2,000 m climbing | ~60 km | MBR estimate (same bike, Eco mode) |
| **Eco** | ~2,000+ m climbing | ~60-70 km | Extrapolated from Auto-mode data |

### Worked example: Lyke Wake Walk on an Amflow PR Carbon Pro

**Route data:**
- Distance: 40 miles (64 km) — Osmotherley to Ravenscar (Robin Hood's Bay is ~2 miles further)
- Total climbing: 2,034 m (6,673 ft) — from AllTrails
- Terrain: North York Moors — moorland tracks, steady gradients, exposed

**Bike:**
- Amflow PR Carbon Pro — 24.2 kg, M2S motor (1500W), 800Wh RS800 battery
- Note: this is **3-4 kg heavier** than the PL Carbon used in the MBR range test (21kg), and the M2S is more powerful than the M1 — both factors reduce real-world range vs the published numbers

**Assessment:**
- Distance (64 km) exceeds the ~60 km Auto-mode estimate
- Climbing (2,034 m) is at the ceiling of the ~2,000 m Auto-mode estimate
- The heavier bike + hungrier motor means the published estimates are optimistic
- **One battery: very tight, would be cutting it fine.** Would likely arrive on single-digit percentage or be walking the last few km.
- **Two batteries: comfortable.** 1,600 Wh total (2 × RS800) easily covers the route with reserve. The PR's removable battery makes swapping trivial.

**Takeaway for other routes:**
- Cross-check BOTH distance AND climbing against published figures — either one alone can be misleading
- If the route exceeds either metric by >10%, budget for a second battery or a top-up charge midpoint
- Removable-battery bikes (Amflow PR, Propain Ekano) are the only viable option for these edge cases — fixed-battery bikes (most PX/PL models) can't be recharged on the route
