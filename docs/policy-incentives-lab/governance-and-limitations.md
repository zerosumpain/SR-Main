# Governance and limitations

Exploratory scenarios, not forecasts. Outputs require policy, analytical, legal, financial and operational review. Artificial agents do not reproduce real human behaviour.

Only public or synthetic material may be used. Do not upload departmental internal documents, drafts, personal data or operationally sensitive information. Source URLs are publication metadata only; they are not fetched. The Lantern example, test fixtures and sample report are explicitly synthetic and represent no real policy, organisation or population.

Every material model item has evidence references or explicit assumption references. Exact quotations are checked against their stored source section and location. Explicit and inferred evidence remain distinct. Extraction confidence is a qualitative model judgement, not a calibrated probability. An approval means the user accepts an input for exploration; it does not turn an assumption into evidence.

Objectives, strategies, constraints, resources, information, outcome metrics, causal statements, interactions, numerical assumptions, payoff rows and decision rules receive stored item-level approval. All approvals are invalidated on draft edits to avoid stale dependencies. The server refuses incomplete/unapproved runs, including direct API attempts.

Fiscal/resource, distributional and operational consequences are only calculated where approved metrics represent them. Everything else is unknown. Suggested safeguards and gaming opportunities are hypotheses/review prompts; they require separate evidence and an approved revised model before comparison. Contradictory source statements are retained rather than automatically reconciled. Users must resolve their model implications explicitly.

Reports separate original evidence, assumptions, deterministic calculations, hypotheses and recommendations. Existing run snapshots remain immutable. Raw LLM output is audited and displayed as text, never rendered as executable HTML or used as a simulation program.

The lab has no public sharing mode, project publication toggle, public navigation card or public cache. It requires an Auth.js owner session, excluding authenticated guests and share-token visitors. Local preview uses isolated data. The LAN gateway deliberately does not mint a lab session; the user's preview must already have a valid local owner session.

Known limits: finite complete payoff tables; no mixed equilibria; restricted sequential information structure; simple artificial decision rules; one-at-a-time sensitivity; no PDF OCR for scanned documents; DOCX page positions are not available, so extracted-text locations are used honestly; heuristic instruction detection cannot recognise every injection. Human review remains necessary even when schema and reference validation pass.
