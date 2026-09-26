# SR-Main documentation

Keep current operating instructions and active contracts here. Historical
implementation plans and superseded designs live in the owner's site Drive.
Runtime prompts, skill assets, and the Field Study System remain with the code
that consumes them.

## Operating and development guides

- [Deployment](deployment-runbook.md)
- [Extracted application ownership](extracted-app-ownership.md)
- [Navigation](design/navigation.md)
- [Hero background](hero-background.md)
- [Voice corpus](voice-corpus.md)
- [Generated module ownership](module-ownership.json)
- [Workflow evaluation output](evals/workflow-eval.json)

## Active design records

These describe recent work and contracts; check the implementation and current
application ownership before treating a plan's task list as remaining work.

- [CI/CD hardening](superpowers/specs/2026-09-16-cicd-pipeline-hardening.md)
- [JKAI tool invocation](superpowers/specs/2026-09-17-jkai-tool-invoke-contract.md)
- [iPhone app](superpowers/specs/2026-09-22-iphone-app-mobile-first.md)
- [Intel spaces design](superpowers/specs/2026-09-24-intel-spaces-and-domains-design.md),
  [implementation](superpowers/plans/2026-09-24-intel-spaces-and-domains.md), and
  [members](superpowers/plans/2026-09-25-intel-spaces-pr-b-members.md)
- [Daydream simplification](superpowers/specs/2026-09-25-daydream-simplify.md) and [build centralisation](superpowers/specs/2026-09-26-daydream-build-centralisation.md)
- [Access groups design](superpowers/specs/2026-09-26-access-groups-design.md),
  [foundation](superpowers/plans/2026-09-26-access-groups-p1.md),
  [Research and News](superpowers/plans/2026-09-26-access-groups-p3-research-news.md),
  and [chat](superpowers/plans/2026-09-26-access-groups-p5-chat.md)
- [Household movement design](superpowers/specs/household-movement.md) and
  [implementation](superpowers/plans/2026-09-26-household-movement.md)
- [Apple app breakout](superpowers/specs/2026-09-26-apple-app-breakout.md)

## Historical archive

On 26 September 2026, 249 historical files were moved to
`Architecture/SR-Main historical docs/2026-09-26.zip` in the owner's `/drive`.
The ZIP preserves the original paths and contains `MANIFEST.json` with source
checksums and the archive/retain decisions. Source comments that cite an archived
filename refer to this ZIP.

[Download the archive](https://strangeramblings.com/api/files/111b9d4b-a7ee-493b-9fb8-41323e1bfc1e/download)
(owner sign-in required).

SHA-256: `a7f01f2939fb15cd2e14cf1fd92d70358cbb556db6ebfa8abe0b7ca67d5cd13e`.
The uploaded archive was downloaded and checked before the repository copies
were removed.

The previous root documents were also preserved before refreshing them:
[README](https://strangeramblings.com/api/files/ce561ce4-02a1-4a97-8382-c8d4280cf1e6/download)
and [CLAUDE](https://strangeramblings.com/api/files/b08e9002-05cf-403b-be66-0eec9600a69e/download).

For future imports from the development machine, use
`sr-drive-put <local-file> Architecture/<name>`. It uses the existing service
authentication and verifies the stored bytes. Its implementation and setup are
documented in SR-Drive's `scripts/drive-put.py` and README. Add `--move` only when
the local source is meant to be removed.
