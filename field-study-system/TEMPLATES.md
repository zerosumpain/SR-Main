# The nine templates

Every beat is one of these. Pick from the beat's verb; if two verbs apply, it is
two beats. Slots are listed in render order — fill every required one, omit
optional ones rather than padding them.

Live reference: `Field Study Templates.dc.html` renders all nine at full page size.

---

## T0 · Front matter — *declaring*

The study landing page. Once per study.

```
kicker            FIELD STUDY №n · ABSTRACT          mono, .22em, accent
title             the study's question                serif 600, 56px, fills
thesis            one paragraph, fills                serif 400, 21px
statusCard        headline + detail + chip            right column, 300px
findingsLedger    3 rows: label | finding | chip      2px rule above
whatThisAnswers   3–4 numbered questions              left of a 1px divider
contents          7 beats, name + read time           right of the divider
instrumentLinks   the instruments, as outline buttons
startCta          "Start at beat 01 →" + a jump link
disclaimer        personal-capacity note, right-aligned
```

**Never** a teaser instead of findings. Never a hero image. Never more than four findings.

---

## T1 · Argument — *reasoning*

Prose carries the beat. Two figures at most.

```
beatHeader        numeral in margin, name + progress
questionClaim     ClaimTable
marginNotes       one aside + cited-here + terms      margin column
dropCapOpening    .fs-dropcap, one column, fills it
body              2–3 further paragraphs
figure            Fig n.1 in .fs-figure
pullQuote         one, fills, on 2px rules
secondMovement    the complication, 1–2 paragraphs
figure2           Fig n.2 (optional)
soWhat + openQuestion + pagination
```

**Never** two columns of prose. Never a third figure — that is a Survey. Never levers.

---

## T2 · Survey — *accounting*

A landscape accounted for. Every row has identical fields and its own basis.

```
beatHeader
questionClaim
standfirst        serif, right of the title
totalsBand        4–5 cells, .fs-cells
primaryTable      .fs-table — name | kind | count | share | basis
sigmaRow          tr.sigma, reconciles to the total
estimateBand      tr.estimate, dashed rule, excluded from Σ
provenanceStrip   source + asOf + drift caveat
secondarySurvey   related stores, 4 cells (optional)
cannotTellYou     .fs-warn — what this survey cannot answer
soWhat + openQuestion + pagination
```

**Never** a total that does not reconcile to its rows. Never estimates inside a
total. Never an undated count.

---

## T3 · Position — *recommending*

One recommendation, defended. Once per study.

```
beatHeader
positionDisplay   serif 600, 60px, fills — the call itself
elaboration       one paragraph, fills
confidenceNote    3px accent left border, states the confidence honestly
becauseBand       3 cells, full-bleed, background var(--accent-tint-08)
andNotTheOthers   one row per rejected option: name | why, stated fairly
conditions        outline panel — what it depends on
whatWouldSinkIt   .fs-warn
sequencing        4 phase cells, what to build first
soWhat + openQuestion + pagination
```

**Never** unnamed alternatives. Never a strawman. Never no conditions.
This is the only page where the accent runs as a filled band — use it once.

---

## T4 · Ledger — *weighing*

Two sides, re-lensed through many actors.

```
beatHeader
questionClaim
lensLever         actor chips; selecting RE-RANKS, never filters
benefitColumn     2px petrol rule, numbered rows, chip each
riskColumn        2px claret rule, same structure
balanceLine       serif, the honest net position
byActorTable      actor | gains | loses | net | their own words
soWhat + openQuestion + pagination
```

**Never** a risk column shorter than the benefit column — if it is, the study has
not looked hard enough. Never hide a row on lens change.

---

## T5 · Instrument — *operating*

A control surface. The one template that is **not** editorial.

```
commandBar        back-to-beat · instrument name · live state · share · fullscreen
stage             full bleed, inset below the bar
leverHud          top-left, collapsible, max 5 levers, each with a baseline
readoutHud        top-right, query contract, tabular figures
exchangeLog       right, above the transport — use .fs-above-transport
transport         play · step · reset · scenario · catalogue · limits
limitsNote        always visible: what it does not show, where numbers came from
```

**Never** serif, drop caps, margin notes or pull quotes. Never page scroll. Never
autoplay when embedded in a beat. Lever positions live in the URL.

Stack anything above the transport with `.fs-above-transport`, which computes its
offset from the bar height — a hardcoded `bottom` collides when the bar's content
changes.

---

## T6 · Anatomy — *decomposing*

One thing, N layers. Section-scale: normally sits inside a T1 or T2.

```
beatHeader        "Beat n · section m"
claim
stackDiagram      margin column, stacked layer blocks in categorical hues
layerRows         layer | today | with it | the fight
leastDesignedNote which layer is least designed, and where it is dealt with
soWhat + openQuestion
```

Each layer needs: `no`, `name`, `question`, `today`, `withIt`, `theFight`.

**Never** more than six layers. Never a layer with no named fight.
The stack diagram is one of only two licensed homes for categorical hues.

---

## T7 · Chronicle — *narrating time*

Time with an argument. Section-scale.

```
beatHeader
twoThreadsNamed   two columns either side of a 1px divider — what each thread is
legend            the categorical hues, directly above the timeline
timeline          date | dot | title + detail | tag, on a 2px spine
youAreHere        the present entry, accent, labelled
balanceOfAccounts why the two threads do not net off
soWhat + openQuestion
```

**Never** one undifferentiated thread. A chronology with no argument is a
Wikipedia table. The two threads usually are: capability built, trust spent.

---

## T8 · Precedent — *judging cases*

N cases, each with a fate and a transferable lesson. Section-scale.

```
beatHeader
questionClaim
archetypeKey      square swatches — the archetype each case belongs to
caseCards         3–8 cells: place/year · name · what · fate · lesson
thePattern        2–3 columns — what holds across the cases
soWhat + openQuestion
```

Each case needs: `place`, `year`, `name`, `what`, `archetype`, `fate`, `lesson`.
The lesson sits below a hairline, in italic serif, and must be one sentence.

**Never** a case with no fate. Never a lesson that is not transferable — if it only
describes that case, it is trivia.

---

## Shared, on all of them

`beatHeader` · `questionClaim` · `soWhat` · `openQuestion` + falsifier ·
`pagination`. T0 has no questionClaim (the findings ledger does that job); T5
replaces the close with its limits note.

Figures are numbered `Fig. n.m` with an italic serif caption. Text is a single
column and FILLS it — no `ch` cap on anything, display type included; to shorten
a line, narrow the column. Radii 0 / 2px / 100px. No shadows inside a page. No
emoji.
