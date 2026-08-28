<script lang="ts">
  // What a thought was actually looking at.
  //
  // The old rendering was `<kind> <uuid>` per row, which recorded the reasoning
  // without making it readable. This fetches the resolved sources on demand —
  // the email's subject and sender, the place's rhythm, the transaction, the
  // tested question — with a link where a real page exists, and the graph
  // entities each source touches.
  //
  // Fetched on expand, not with the page: most cards are never opened, and
  // resolving one costs up to nine queries.

  export interface ResolvedEvidence {
    kind: string;
    id: string;
    note: string | null;
    title: string;
    lines: string[];
    at: string | null;
    href: string | null;
    entities: Array<{ id: string; name: string; type: string | null; href: string }>;
    symbolic: boolean;
    missing: boolean;
  }

  let {
    thoughtId,
    count,
  }: { thoughtId: string; count: number } = $props();

  let items = $state<ResolvedEvidence[] | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // A plain let, not $state: a request handle read and written by the same
  // path would subscribe an effect to its own write.
  let requestedFor: string | null = null;

  async function load() {
    if (loading) return;
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/daydream/thoughts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'evidence', id: thoughtId }),
      });
      const out = (await res.json().catch(() => ({}))) as {
        evidence?: ResolvedEvidence[];
        error?: string;
      };
      if (out.error) throw new Error(out.error);
      items = out.evidence ?? [];
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      items = null;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const id = thoughtId;
    if (id === requestedFor) return;
    requestedFor = id;
    items = null;
    void load();
  });

  function when(at: string | null): string {
    if (!at) return '';
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric',
    }).format(d);
  }
</script>

<div class="ev-wrap">
  {#if loading && items === null}
    <p class="ev-loading">Reading the {count} source{count === 1 ? '' : 's'}…</p>
  {:else if error}
    <p class="ev-err">Could not read the sources: {error}</p>
  {:else if items && items.length === 0}
    <p class="ev-loading">This one cited nothing, which is unusual — every detector is supposed to.</p>
  {:else if items}
    <ul class="ev-list">
      {#each items as e, i (`${e.kind}-${e.id}-${i}`)}
        <li class="ev-item" class:missing={e.missing}>
          <div class="ev-hd">
            <span class="ev-kind">{e.kind}</span>
            {#if e.href}
              <a class="ev-title link" href={e.href}>{e.title}</a>
            {:else}
              <span class="ev-title">{e.title}</span>
            {/if}
            {#if e.at}<span class="ev-when">{when(e.at)}</span>{/if}
          </div>

          {#each e.lines as line, li (li)}
            <p class="ev-line">{line}</p>
          {/each}

          <!-- The wire back into the graph. The intel bridge already turns
               graph findings into thoughts; this turns a thought's own sources
               back into entities you can open. -->
          {#if e.entities.length}
            <div class="ev-ents">
              <span class="ev-ents-label">In the graph</span>
              {#each e.entities as ent (ent.id)}
                <a class="ev-ent" href={ent.href} title={ent.type ?? 'entity'}>{ent.name}</a>
              {/each}
            </div>
          {/if}

          {#if e.missing}
            <p class="ev-line warn">Cited when the thought was formed; the record has since gone, so this part of the reasoning can no longer be checked.</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ev-wrap { margin-top: 0.35rem; }
  .ev-loading, .ev-err { margin: 0.3rem 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); font-style: italic; }
  .ev-err { color: var(--error, #c44); font-style: normal; }

  .ev-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.55rem; }
  .ev-item { border-left: 2px solid var(--line-strong); padding-left: 0.6rem; }
  .ev-item.missing { border-left-color: var(--warn, #b0892a); opacity: 0.85; }

  .ev-hd { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.45rem; }
  .ev-kind { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); flex: none; }
  .ev-title { font-size: var(--fs-label); color: var(--text-primary); line-height: 1.4; }
  a.ev-title.link { color: var(--accent); text-decoration: none; }
  a.ev-title.link:hover { text-decoration: underline; }
  .ev-when { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); flex: none; }

  .ev-line { margin: 0.15rem 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: var(--text-muted); }
  .ev-line.warn { color: var(--warn, #b0892a); }

  .ev-ents { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem; margin-top: 0.3rem; }
  .ev-ents-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); }
  .ev-ent { font-size: var(--fs-label-xs); color: var(--accent); text-decoration: none; border: 1px solid var(--line-strong); padding: 0.05rem 0.35rem; }
  .ev-ent:hover { text-decoration: underline; }
</style>
