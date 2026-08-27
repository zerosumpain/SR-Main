---
name: solution-design
description: "Route design tasks to the right specialist; carries the known-misdiagnosis table. Load before building anything non-trivial."
version: 1.0.0
metadata:
  routing:
    tags: [design, discipline, precedent, debugging, routing]
    related_skills:
      - jkai-general
      - jkai-canvas
      - jkai-node-builder
---

# Solution design — precedent first, invention last

Weak designs come from inventing what the estate already answers. John's systems are large, consistent, and opinionated — for almost any task, 2+ working examples of the right shape already exist. **Copying their shape is the design.**

## The procedure (do all 5, in order)

1. **Route to the domain skill first** — `jkai-general` holds the capability map. Workflows → `jkai-canvas`; new/changed engine nodes → `jkai-node-builder`; blog/site content → `jkai-blog`; files → `jkai-files`; the rest per the router.
2. **Find 2 precedents before proposing anything.** Designing a workflow? List existing workflows and read the two closest in shape. Authoring a node? Copy the structure of a recent similar node (the node-builder skill names templates). Writing site code? Read two components/routes of the same family and match their layout, naming, and error handling. If your draft introduces a pattern, dependency, or style no precedent uses — justify it in one sentence or drop it.
3. **Size it before designing it.** Small and clear → build it directly, no design ceremony. Multi-part → state options considered and the chosen one, in one short block, then build.
4. **List what you will create/change BEFORE creating it** — every workflow/node/file, one line each with why. A surprising list (10 artifacts for a "small" ask) means the design is wrong — find the precedent that does it in fewer.
5. **Name the verification step before building.** A concrete proof: a test-run of the workflow with real input, the node parity tests, a curl of the live page. If you cannot name one, you do not understand the task yet — re-read the precedents.

### Interactive graphics and game builds

When a request says **3D**, resolve the implementation meaning before building: it means an actual 3D renderer and simulation (for web games, a WebGL engine such as Three.js), a perspective camera, volumetric/mesh world geometry, and physics in three spatial axes. Do **not** substitute a 2D canvas game with perspective-inspired art, a parallax effect, or a 2D physics model merely because the wording includes “3D style.”

Before implementation, state the concrete artifacts in scope: renderer, terrain representation, vehicle representation, control mapping, collision/landing model, HUD, and reset/regeneration control. Verify both the rendering path (a WebGL canvas plus mesh scene) and the gameplay path (terrain contact / landing criteria), not just that the page returns HTTP 200.

### Autonomous build iterations and exhausted budgets

A build marked `completed` after a targeted continuation is not proof that the requested change ran. Before reporting an iteration as done, inspect its iteration history and confirm there is a **new implementation iteration** with a verification result specific to the new requirement. A continuation on a build that has already consumed its iteration allowance can be accepted yet complete immediately without applying code changes.

For an exhausted build, create a fresh build with the complete functional specification plus the targeted revision, rather than repeatedly injecting tweaks. Carry forward concrete acceptance checks into the new prompt — for camera framing, verify the projected vehicle position across representative simulation updates and resize events rather than relying on a canvas/page-centering check.

### Small Hermes capability additions

For a narrowly scoped, deterministic capability that belongs in the agent toolkit (for example, live date/time awareness), prefer a self-registering standard-library tool over memory or prompt-only instructions:

1. Inspect the existing tool registry, auto-discovery convention, core tool list, and two nearby tool implementations before writing code.
2. Register the tool in the existing always-available/core toolkit when every platform should have it; do not invent a new toolset unless there is a real gating or configuration boundary.
3. Keep changing system state out of persistent memory. Memory is for durable facts; live values must be queried at call time.
4. Make the schema explicitly instruct the model to call the tool rather than guess, and return structured JSON with enough context to detect timezone mistakes.
5. Add focused tests for schema, output shape, deterministic mocked output, registry discovery, and actual dispatch. Verify the tool is present in the core list.
6. Leave unrelated dirty or untracked files untouched; report them separately rather than cleaning, stashing, or claiming a clean tree.

## Known misdiagnoses — check BEFORE "fixing"

| Symptom / tempting theory | Check this actual cause first |
|---|---|
| glm output truncated or empty | reasoning tokens eating `max_tokens` — disable thinking (`thinking:{type:'disabled'}`) or size `max_tokens` ≥ 3000 |
| Health data 100× too big/small | storage scaling (×100 seen on steps/strain) + SUM vs MAX aggregation — not display logic |
| LLM slow → "prompt too long" | model reasoning latency; also max_tokens vs cache-key churn |
| Scraper/homeserv proxy 500s after a build | always-on `strange-rambling-svelte` service holding old chunk hashes — `systemctl --user restart strange-rambling-svelte` |
| HR/biome data missing → "Whoop is down" | data comes from the Apple device webhook, not Whoop — don't gate on `sources.whoop` |

## Red flags — stop and restart the procedure

- Designing from memory of "how this is usually done" instead of reading precedents
- No list of artifacts-to-create, or creating one that isn't on it
- Cannot name the verification step
- The words "I'll create a new helper/pattern/framework for this"
