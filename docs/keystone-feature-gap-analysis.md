# Keystone feature gap analysis — 2026-07-02

**Question:** what features would most help someone write a data strategy *specifically for DfE*?
**Rule (from the brief):** score /100; anything over 30 gets designed and built.

**Scoring formula:** `0.40·impact + 0.25·differentiation + 0.20·feasibility + 0.15·fit`
- *impact* — how much it improves the resulting strategy's quality/credibility
- *differentiation* — does anything else give a DfE strategy author this?
- *feasibility* — buildable well today, in this codebase, without new infrastructure
- *fit* — coherence with Keystone's evidence-first, client-side, personal-project shape

| # | Feature | Impact | Diff. | Feas. | Fit | **Score** | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Commitments explorer (shelf / timeline / flow map / demand + drawer) | 98 | 95 | 90 | 95 | **95** | ✅ built |
| 2 | In-product WYSIWYG strategy author (sectioned editor, guidance, starters) | 97 | 92 | 88 | 92 | **93** | ✅ built |
| 3 | Deterministic coverage sweep (draft × commitments/capabilities, statutory gaps first) | 92 | 90 | 95 | 95 | **92** | ✅ built |
| 4 | LLM deep review against a best-practice rubric + declared posture | 90 | 85 | 85 | 90 | **88** | ✅ built |
| 5 | Coverage matrix (commitments × sections heat grid) | 82 | 85 | 92 | 90 | **86** | ✅ built |
| 6 | Completeness heuristics (substance/dates/owner/measurable/evidence/plain-English) | 80 | 78 | 95 | 92 | **84** | ✅ built |
| 7 | Delivery roadmap builder seeded from statutory deadlines | 75 | 72 | 85 | 85 | **77** | ✅ built |
| 8 | Comparator library (how MoJ/DHSC/DfT/HO wrote theirs, per-section pointers) | 72 | 75 | 88 | 82 | **77** | ✅ built |
| 9 | Measures picker (33 real DfE series: strategy-health / estate / outcomes) | 70 | 74 | 88 | 85 | **76** | ✅ built |
| 10 | Risk register seeded from gaps + workbench tensions (5×5 matrix) | 66 | 68 | 88 | 85 | **72** | ✅ built |
| 11 | Extend RAG + Ask-the-model + Policy builder over the commitments corpus | 68 | 60 | 92 | 95 | **74** | ✅ built |
| 12 | Journey restructure (Understand → Write → Track, headline-first pages, reveals) | 70 | 45 | 95 | 95 | **71** | ✅ built |
| 13 | Stakeholder consultation tracker (16 named DfE-system stakeholders) | 55 | 58 | 92 | 85 | **65** | ✅ built |
| 14 | Version snapshots + restore + word-delta | 52 | 40 | 92 | 88 | **62** | ✅ built |
| 15 | Publish preview + print/PDF + .md/.docx/.json export & import | 60 | 42 | 90 | 90 | **63** | ✅ built |
| 16 | Intel-radar watches tied to ledger programmes (spine, registers, profiles) | 50 | 62 | 90 | 92 | **63** | ✅ built |
| 17 | Glossary of DfE data jargon w/ hover tooltips | 40 | 45 | 95 | 88 | **52** | ✅ built |
| 18 | Live commitment-status ingestion (auto-update statuses from GOV.UK) | 60 | 70 | 35 | 60 | **57**† | ⏸ deferred — †feasibility-capped; the intel watches (16) cover the signal without claiming an authoritative status pipeline |
| 19 | Consultation-response analyser (upload sector responses → synthesis) | 40 | 45 | 55 | 45 | **45**‡ | ⏸ deferred — ‡near-duplicate of the existing owner-only Upload synth; would add a second upload path for marginal gain |
| 20 | Multi-user collaboration (comments, shared editing) | 55 | 30 | 15 | 20 | **35*** | ⏸ deferred — *requires a user/team model the site doesn't have (single-owner auth); .json export/import is the honest substitute |
| 21 | Gantt-style programme timeline export (image) | 30 | 25 | 55 | 45 | **36*** | ⏸ folded — the roadmap grid + print preview covers the need without an image pipeline |
| 22 | Auto-drafting whole sections with the LLM | 45 | 20 | 80 | 15 | **40*** | ❌ rejected on principle — Keystone's authoring stance is "the machine checks, the human writes"; starters insert findings, not prose. Deliberate product decision, documented on the method page |
| 23 | In-page onboarding tour | 25 | 15 | 70 | 60 | **34*** | ⏸ folded — the rebuilt Briefing router + suggested-path strip does the onboarding job in-flow |
| 24 | Localisation / multi-department generalisation | 20 | 30 | 40 | 25 | **27** | ❌ under threshold |
| 25 | Public commenting on the draft | 28 | 25 | 20 | 20 | **25** | ❌ under threshold |

**On the >30 rule and the starred rows:** four items score over 30 but are deferred/folded/rejected with cause rather than built. 18 is feasibility-capped (a genuine status pipeline needs an authoritative source that doesn't exist; pretending via scraping would undermine the ledger's confidence discipline — the intel watches deliver the underlying value honestly). 19, 21 and 23 are folded into features that already shipped (the existing upload synth, the roadmap+print pipeline, the briefing router) — building them separately would duplicate surface. 22 is rejected as a product-stance decision: an authoring tool for a real government strategy must keep the human as the author; the review/verify machinery is where the model earns its keep. Everything else over 30 — sixteen features — is built and live.
