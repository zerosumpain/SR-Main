# Static app builds — SR design tokens and the publish flow

## The CSS to paste

Copy this block into the `<head>` of the first `index.html` you pass to
`register_chat_build`. Don't ship a raw build and wait to be asked for a
re-skin — that costs a full rebuild round trip and John has called it out.

```html
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #ede4d4;
    --bg-section: rgba(26, 16, 8, 0.04);
    --card-border: rgba(26, 16, 8, 0.18);
    --divider: rgba(26, 16, 8, 0.08);
    --accent: #c4570a;
    --accent-hover: #a84808;
    --text-primary: #1a1008;
    --text-secondary: #3d2e1a;
    --text-muted: rgba(26, 16, 8, 0.65);
    --text-ghost: rgba(26, 16, 8, 0.45);
    --font-display: 'Archivo Black', Impact, sans-serif;
    --font-body: 'DM Sans', system-ui, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  }
  body { background: var(--bg); color: var(--text-primary); font-family: var(--font-body); margin: 0; padding: 2rem 1.25rem; }
  h1, h2, h3 { font-family: var(--font-display); color: var(--text-primary); }
  .sr-monogram { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
  .nm-sec { background: var(--bg-section); border: 1px solid var(--card-border); padding: 1rem 1.1rem 1.15rem; margin-bottom: 1.25rem; }
  .sr-label-tight { font-family: var(--font-mono); font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
  .nm-text-input { width: 100%; font-family: var(--font-mono); font-size: 12px; color: var(--text-primary); background: rgba(26,16,8,0.04); border: 1px solid var(--card-border); padding: 6px 10px; }
  .nm-save-btn { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; background: var(--accent); color: white; border: none; padding: 8px 14px; cursor: pointer; }
  .nm-save-btn:hover { background: var(--accent-hover); }
  a, .row-link { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
</style>
<div class="sr-monogram">sr.</div>
```

Hard rules (these are in the skill file too, and they hold whether or not you
read this page): warm cream background `#ede4d4`, burnt orange accent
`#c4570a`, Archivo Black headings, DM Sans body, JetBrains Mono
labels/inputs/data, `.nm-sec` cards, `.sr-label-tight` small-caps labels, `sr.`
monogram top-left. NO dark backgrounds. NO rounded corners. NO different accent
colours.

For more component patterns — hover states, table styling, edge cases —
`skill_view(name='sr-design-system')`. Most apps need only the tokens above.

## The publish flow

1. Compose the file body (or bodies) inline with the SR tokens baked in. No
   staging, no `write_file`.
2. Call `register_chat_build({title, prompt, files: [{path, content}, …]})` —
   `path` is `"index.html"` (and any others), `content` is the literal body.
   Returns `{id, detailUrl: '/jkai/builds/<id>', publishHint}`. Share
   `detailUrl` with the user.
3. **Reply:** `"Built it — /jkai/builds/<id>. Want me to publish to
   /projects/<slug>/?"` The design system is already applied, so don't ask
   about styling.
4. **On "yes":** `build_control({id, action: 'publish'})`. The slug
   auto-generates from the build title; do not pass your own.
5. **On "no":** stop. The user can still click Publish on the card.

If the user wants further design iteration, `build_tweak({id, instruction:
'<specific change>'})` — this is **async** (status goes to `running`, 1–5 min).
Poll with `build_inspect({id})` when they ask "progress?".

Use `register_chat_build`, not `build_create` — `build_create` triggers the
full autonomous orchestrator, overkill for a 50-line app.
