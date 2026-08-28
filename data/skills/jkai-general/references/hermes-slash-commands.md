# Hermes slash commands (the /jkai composer palette)

The chat UI exposes a command palette (type `/` to see it). These are processed
by the Hermes gateway, not the SvelteKit app.

| Command | Mode | What it does |
|---------|------|-------------|
| `/usage` | send (silent) | Token usage & cost for this session |
| `/status` | send (silent) | Session status |
| `/compress` | send (silent) | Summarise & compress the context |
| `/goal` | insert | Drops `/goal ` into the composer for you to type after |

## `/goal` — Ralph-style autonomous loop

After typing `/goal <your goal text>` and sending:

1. The goal is stored with a turn budget (default 20, configurable via
   `goals.max_turns` in `~/.hermes-jkai/config.yaml`).
2. The goal text is sent as the kickoff prompt.
3. After every turn, an evaluator checks whether the goal is met.
4. If not done and budget remains, the agent automatically continues — no
   manual "keep going" needed.
5. Stops when the evaluator declares the goal done, the budget is exhausted, or
   the user intervenes.

Subcommands:

- `/goal <text>` — set a new goal (replaces active one)
- `/goal status` — show current goal
- `/goal pause` — pause auto-continuation
- `/goal resume` — resume a paused goal
- `/goal clear` — clear the active goal

Source: `hermes-agent/tui_gateway/server.py` (slash dispatch) +
`hermes_cli.goals.GoalManager`.
