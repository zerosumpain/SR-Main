# JKAI grounding implementation

Authorized: implement review items 1–10 in order, including both directions of Daydream memory, build and deploy through CI.

Working branch: feat/jkai-grounded-toolchains, based on master 73afd647. Existing local news/Sources work remains in its checkouts.

1. Shared behavioural policy and prompt identity — in progress.
2. Shared capability resolver and policy delivery.
3. Typed discovery and central schema validation.
4. Relevant, provenance-aware memory retrieval.
5. Transactional memory service and Daydream producers/consumers.
6. Evidence envelopes and activity retrieval.
7. Continuous history and task/evidence state.
8. Enforced execution scopes and isolated authored handlers.
9. Answer coverage/grounding contract.
10. Quality-gated evaluation and rollout.

Validation: focused tests per stage, isolated database integration tests, repository validation, CI production build, deployment identity verification.
