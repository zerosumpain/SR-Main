# Modelling method

Engine version: `1.0.0`. A behavioural change to algorithms, tie handling, sampling, parameter resolution or result serialization requires a version bump and reproducibility tests.

## Payoffs and feasibility

For actor a at strategy profile s, payoff is the sum over configured components of `approved_weight(a,m) × approved_outcome(s,m)`. The result retains each value, weight and product as calculation terms. Numbers must be finite, bounded numerical assumptions with user-approved provenance. Null is unknown; it is never coerced to zero. Parameter overrides may only choose an approved point or lie within an approved interval.

The finite payoff table explicitly enumerates all joint profiles. Actor-specific strategy membership and outcome coverage are validated. Qualitative causal statements, constraints and preconditions are reviewed explanatory material, not executable free text. In this representation every listed strategy must be feasible in every enumerated profile. State-dependent feasibility requires a revised explicit model; the engine does not infer conditional mechanics from prose.

## Normal-form game

Enumerate every profile and retain it as a pure Nash equilibrium when no actor can improve its own payoff by changing only its strategy. Ties are retained. Return all pure equilibria, explicitly report none, and do not invent mixed equilibria or predict equilibrium selection.

## Sequential game

Backward induction applies to a finite observable order in which each actor moves once. Terminal payoffs use the same approved table. Tied continuation outcomes are retained when they can be optimal under an equilibrium continuation in every alternative branch. The output is possible terminal profiles, not a complete contingent strategy certificate. Hidden-information games, multiple interaction sequences and incomplete orders produce an unsupported message and no calculated sequential outcomes. No Bayesian or mixed-strategy solver is claimed.

## Repeated and agent-based exploration

Both modes share the deterministic round runner and configured per-actor rules. Initial strategies and exact payoff ties use the existing Mulberry32 RNG with a stored unsigned 32-bit seed. Each round updates actors simultaneously against the previous profile:

- Maximise: best response to the previous profile as a point expectation.
- Satisfice: first stable-ID-ordered strategy meeting an approved threshold, otherwise best response.
- Risk-averse: maximise worst-case payoff across other actors' strategy combinations.
- Imitate: repeat this actor's best historically observed strategy; initially use best response. Strategies belonging to different actors are not interchangeable.
- Rule-based: a reviewed ordered schedule chooses a strategy through a specified round. An uncovered round is an error.

Artificial agents do not reproduce real human behaviour. These simple rules omit institutions, cognition, changing preferences and unobserved environments.

## Sensitivity and uncertainty

One-at-a-time inclusive evenly spaced samples vary approved uncertain assumptions. All remaining values stay at configured baseline values. Return every sampled result, outcome ranges and whether terminal profiles change. Numeric shifts are shown directly; there is no unexplained materiality score or red/amber/green rating. Interactions among uncertain parameters and joint/global sensitivity are not estimated. A range is not a probability distribution or confidence interval. Distribution charts show counts of calculated rounds/profiles, not real-world frequencies.

## Reproducibility

The deterministic payload excludes clock time, run ID and reviewer execution metadata. Canonical JSON orders object keys; array order is intentional. Runs retain the source hash, complete approved snapshot, effective parameter values, seed, type, engine version and result hash. The test suite compares result bytes for repeated and agent-based runs. Metadata timestamps differ between executions by design. Results are reproducible within the same engine/runtime arithmetic contract; no promise of identical floating point output across arbitrary future runtimes is made.
