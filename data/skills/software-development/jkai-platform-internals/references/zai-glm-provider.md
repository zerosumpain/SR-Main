# Zhipu AI / GLM Provider Reference (zai provider)

Provider used for GLM-5, GLM-5.1, GLM-4.7 models on the jkai platform.

## Thinking Behaviour

**GLM-5, GLM-5.1, GLM-4.7 have thinking ON by default.** This is a hard default — the model generates hidden reasoning tokens before producing visible output. This differs from GLM-4.6 which used "mixed thinking" (auto-trigger).

To disable thinking entirely:
```json
"thinking": { "type": "disabled" }
```

### Thinking Modes (from docs.bigmodel.cn/cn/guide/capabilities/thinking-mode)

| Mode | Description | Since |
|------|-------------|-------|
| **Interleaved thinking** | Model thinks between tool calls and after receiving tool results. Enables multi-step reasoning across tool boundaries. | GLM-4.5 |
| **Preserved thinking** | Thinking content is preserved in the response payload. | GLM-5+ |
| **Turn-level thinking** | Per-turn thinking control. | GLM-5+ |

### Implications for jkai

- When using `glm-5-turbo` or `glm-5-plus` via the `zai` provider, the model is a **thinking model** — similar to Claude extended thinking or OpenAI o-series.
- Token usage includes thinking tokens unless explicitly disabled.
- For tool-heavy workflows (canvas, builds), interleaved thinking means the model reasons between sequential tool calls automatically.

## Docs Site Navigation

- **Base URL**: `https://docs.bigmodel.cn`
- **Index**: `https://docs.bigmodel.cn/llms.txt` — plain-text listing of all doc pages with titles and URLs. Use this for discovery.
- **Thinking mode docs**: `/cn/guide/capabilities/thinking-mode`
- **Deep thinking docs**: `/cn/guide/capabilities/thinking` (separate page from thinking-mode)
- **Model overview**: `/cn/guide/start/model-overview`
- The site is a **JS-rendered SPA** (Next.js/Mintlify). `curl` returns JS boilerplate, not content. Use browser tools or the `llms.txt` index to find the right page URL, then navigate directly.

## Model Naming Convention

| Model ID | Series | Thinking Default |
|----------|--------|-----------------|
| `glm-5-turbo` | GLM-5 | On (opt-out) |
| `glm-5-plus` | GLM-5 | On (opt-out) |
| `glm-5.1` | GLM-5.1 | On (opt-out) |
| `glm-4.7` | GLM-4.7 | On (opt-out) |
| `glm-4.6` | GLM-4.6 | Mixed (auto-trigger) |
| `glm-4-flash` | GLM-4 | Off |
