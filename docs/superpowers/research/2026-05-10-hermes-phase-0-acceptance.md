# Hermes Phase 0 Acceptance Log

This file records the actual commands run and the outputs observed during
Phase 0 verification. Each section is a checklist item from the design
spec's "Phase 0 — Exit criteria."

---

## Hermes install

- **Tag**: v2026.5.7
- **Commit**: 498bfc7bc12a937621b4215312049b1000726df3
- **`hermes --version` output**:

```
Hermes Agent v0.13.0 (2026.5.7)
Project: /home/john/hermes-agent
Python: 3.11.15
OpenAI SDK: 2.33.0
Update available: 339 commits behind — run 'hermes update'
```

**`uv` co-dependency note**: The Hermes venv depends on the CPython
interpreter managed by `uv` at `~/.local/share/uv/python/cpython-3.11-…`.
`uv` and the venv must be treated as a unit — removing or upgrading `uv`'s
Python distribution will break the `hermes` entry-point even though the
package itself is intact. Do not `uv python uninstall 3.11` without
reinstalling Hermes afterwards.

---

## Provider smoke tests

All three tests used the same invocation pattern:

```bash
HERMES_HOME=~/.hermes-jkai hermes \
  --provider <PROVIDER> \
  --model <MODEL> \
  -z "Reply with exactly the word: pong."
```

The `-z` / `--oneshot` flag sends a single prompt and prints only the
model's reply to stdout (no banner, no spinner). `--provider` and `--model`
override the defaults set in `~/.hermes-jkai/config.yaml` for this
invocation only.

---

### z.ai

**Command**:

```bash
HERMES_HOME=~/.hermes-jkai hermes \
  --provider zai \
  --model glm-4.6 \
  -z "Reply with exactly the word: pong."
```

**Date/time (UTC)**: 2026-05-10 20:26:14 → 20:26:37

**Wall-clock time**: ~22 s (`real 0m22.126s`)

**Response**:

```
pong
```

**Result**: PASS

---

### OpenRouter

**Command**:

```bash
HERMES_HOME=~/.hermes-jkai hermes \
  --provider openrouter \
  --model anthropic/claude-haiku-4.5 \
  -z "Reply with exactly the word: pong."
```

**Date/time (UTC)**: 2026-05-10 20:26:40 → 20:26:44

**Wall-clock time**: ~4.5 s (`real 0m4.521s`)

**Response**:

```
pong.
```

**Result**: PASS

---

### Anthropic (direct)

**Command**:

```bash
HERMES_HOME=~/.hermes-jkai hermes \
  --provider anthropic \
  --model claude-haiku-4-5-20251001 \
  -z "Reply with exactly the word: pong."
```

**Date/time (UTC)**: 2026-05-10 20:28:10 → 20:32:14 (includes first cold run;
second timed run: `real 0m15.773s`)

**Wall-clock time**: ~15.8 s

**Response**:

```
pong
```

**Result**: PASS

---

## Summary

| Provider    | Model                        | Result | Wall-clock |
|-------------|------------------------------|--------|------------|
| z.ai        | glm-4.6                      | PASS   | ~22 s      |
| OpenRouter  | anthropic/claude-haiku-4.5   | PASS   | ~4.5 s     |
| Anthropic   | claude-haiku-4-5-20251001    | PASS   | ~15.8 s    |

All three providers completed a round-trip within the 30-second budget.
Phase 0 provider smoke-test criterion: **MET**.

---

## Observations

- `hermes status` confirmed all three API keys were loaded from
  `~/.hermes-jkai/.env` (ZAI_API_KEY / GLM_API_KEY alias, OPENROUTER_API_KEY,
  ANTHROPIC_API_KEY).
- The z.ai GLM call was the slowest (~22 s); this is expected for a
  Chinese-hosted model under normal latency.
- OpenRouter was fastest (~4.5 s), consistent with its role as the default
  provider for day-to-day use.
- Anthropic direct was mid-range (~15.8 s). The `anthropic_messages` API
  path (native SDK, not OpenAI-compat) is confirmed working.
- No `--provider`/`--model` flags are needed in normal operation; the
  `config.yaml` default (`openrouter` / `anthropic/claude-haiku-4.5`) applies
  automatically.
