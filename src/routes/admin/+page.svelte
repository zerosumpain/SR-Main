<svelte:head><title>Admin — Strange Ramblings</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');
  const t = adminToken ? `?token=${adminToken}` : '';

  function fmtDate(unixTs: number | null | undefined): string {
    if (!unixTs) return '—';
    const d = new Date(unixTs * 1000);
    const now = Date.now();
    const ms = now - d.getTime();
    if (ms < 60_000) return 'just now';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Console"
    title="Strange Ramblings Admin"
    sub="At-a-glance status of every connected system. Drill into any tile for the full controls."
  />

  <!-- Top stat strip -->
  <div class="stat-grid">
    <div class="stat-card">
      <div class="stat-card-label">Active Agent Tasks</div>
      <div class="stat-card-value">{data.agent.active}</div>
      <div class="stat-card-meta">{data.agent.todayActions} actions today</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Today's Spend</div>
      <div class="stat-card-value">${data.agent.todayCost.toFixed(4)}</div>
      <div class="stat-card-meta">across {data.agent.todayActions} calls</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Custom Tools</div>
      <div class="stat-card-value">{data.tools.enabled}<span class="muted-suffix">/{data.tools.total}</span></div>
      <div class="stat-card-meta">enabled / total</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Health Backfills</div>
      <div class="stat-card-value">{data.health.activeJobs}</div>
      <div class="stat-card-meta">running / queued</div>
    </div>
  </div>

  <!-- Section grid -->
  <div class="tiles">
    <!-- Content -->
    <div class="tile-group">
      <div class="tile-group-label">Content</div>
      <div class="tile-row">
        <a class="nm-tile" href={`/admin/blog${t}`}>
          <div class="nm-tile-eyebrow">Blog</div>
          <div class="nm-tile-title">Posts</div>
          <div class="nm-tile-sub">Write, edit, publish.</div>
          <div class="nm-tile-foot">
            <span>{data.blog.published} published · {data.blog.draft} drafts</span>
            <span>→</span>
          </div>
        </a>
        <a class="nm-tile" href={`/admin/files${t}`}>
          <div class="nm-tile-eyebrow">Files</div>
          <div class="nm-tile-title">File Store</div>
          <div class="nm-tile-sub">Upload, permissions, extract, convert.</div>
          <div class="nm-tile-foot">
            <span>{data.files} {data.files === 1 ? 'file' : 'files'}</span>
            <span>→</span>
          </div>
        </a>
      </div>
    </div>

    <!-- Health -->
    <div class="tile-group">
      <div class="tile-group-label">Health</div>
      <div class="tile-row">
        <a class="nm-tile" href={`/admin/health${t}`}>
          <div class="nm-tile-eyebrow">Connections</div>
          <div class="nm-tile-title">Strava · Whoop · Apple</div>
          <div class="nm-tile-sub">Sync state, range backfills, on-demand pulls.</div>
          <div class="nm-tile-foot">
            <span class="status-line">
              <span class="nm-pill" data-state={data.health.strava.connected ? 'connected' : 'disconnected'}>Strava</span>
              <span class="nm-pill" data-state={data.health.whoop.connected ? 'connected' : 'disconnected'}>Whoop</span>
              <span class="muted">last sync {fmtDate(data.health.strava.state?.lastSyncAt ?? data.health.whoop.state?.lastSyncAt)}</span>
            </span>
            <span>→</span>
          </div>
        </a>
      </div>
    </div>

    <!-- Channels -->
    <div class="tile-group">
      <div class="tile-group-label">Channels</div>
      <div class="tile-row">
        <a class="nm-tile" href={`/admin/gmail${t}`}>
          <div class="nm-tile-eyebrow">Gmail</div>
          <div class="nm-tile-title">Inbox watches</div>
          <div class="nm-tile-sub">Connect accounts, configure query watches, test fetches.</div>
          <div class="nm-tile-foot">
            <span>{data.gmail} {data.gmail === 1 ? 'account' : 'accounts'}</span>
            <span>→</span>
          </div>
        </a>
        <a class="nm-tile" href={`/admin/scraper${t}`}>
          <div class="nm-tile-eyebrow">Scraper</div>
          <div class="nm-tile-title">Stealth Browsing</div>
          <div class="nm-tile-sub">Credentials, profiles, target knowledge, interactive sessions.</div>
          <div class="nm-tile-foot">
            <span>{data.scraper} {data.scraper === 1 ? 'credential' : 'credentials'}</span>
            <span>→</span>
          </div>
        </a>
      </div>
    </div>

    <!-- Agent -->
    <div class="tile-group">
      <div class="tile-group-label">Agent</div>
      <div class="tile-row">
        <a class="nm-tile" href={`/admin/agent${t}`}>
          <div class="nm-tile-eyebrow">Dashboard</div>
          <div class="nm-tile-title">JKAI Activity</div>
          <div class="nm-tile-sub">Live event feed, active tasks, daily cost.</div>
          <div class="nm-tile-foot">
            <span>{data.agent.active} active · ${data.agent.todayCost.toFixed(2)} today</span>
            <span>→</span>
          </div>
        </a>
        <a class="nm-tile" href={`/admin/agent/tasks${t}`}>
          <div class="nm-tile-eyebrow">Tasks</div>
          <div class="nm-tile-title">Queue</div>
          <div class="nm-tile-sub">Pending, planning, active, completed.</div>
          <div class="nm-tile-foot"><span>open</span><span>→</span></div>
        </a>
        <a class="nm-tile" href={`/admin/agent/costs${t}`}>
          <div class="nm-tile-eyebrow">Costs</div>
          <div class="nm-tile-title">Spend</div>
          <div class="nm-tile-sub">By model, by tool, by day.</div>
          <div class="nm-tile-foot"><span>open</span><span>→</span></div>
        </a>
        <a class="nm-tile" href={`/admin/agent/config${t}`}>
          <div class="nm-tile-eyebrow">Config</div>
          <div class="nm-tile-title">Prompt &amp; Memory</div>
          <div class="nm-tile-sub">System prompt, persistent memory, cron / pulse.</div>
          <div class="nm-tile-foot"><span>open</span><span>→</span></div>
        </a>
      </div>
    </div>

    <!-- AI Config -->
    <div class="tile-group">
      <div class="tile-group-label">AI Config</div>
      <div class="tile-row">
        <a class="nm-tile" href={`/admin/keys${t}`}>
          <div class="nm-tile-eyebrow">API Keys</div>
          <div class="nm-tile-title">Providers</div>
          <div class="nm-tile-sub">Z.AI, OpenRouter, ElevenLabs, Tavily — one place to update them all.</div>
          <div class="nm-tile-foot"><span>open</span><span>→</span></div>
        </a>
        <a class="nm-tile" href={`/admin/models${t}`}>
          <div class="nm-tile-eyebrow">LLM Models</div>
          <div class="nm-tile-title">Defaults &amp; Catalogue</div>
          <div class="nm-tile-sub">Pick chat default + alt OpenRouter model, browse catalogue, refresh.</div>
          <div class="nm-tile-foot"><span>open</span><span>→</span></div>
        </a>
        <a class="nm-tile" href={`/admin/tools${t}`}>
          <div class="nm-tile-eyebrow">Tools</div>
          <div class="nm-tile-title">Primitives, Site, Custom</div>
          <div class="nm-tile-sub">Inspect, disable, or delete tools the assistant has built.</div>
          <div class="nm-tile-foot"><span>{data.tools.enabled} enabled</span><span>→</span></div>
        </a>
      </div>
    </div>

    <!-- Site -->
    <div class="tile-group">
      <div class="tile-group-label">Site</div>
      <div class="tile-row">
        <a class="nm-tile" href={`/admin/biome${t}`}>
          <div class="nm-tile-eyebrow">Biome</div>
          <div class="nm-tile-title">Visual Effects</div>
          <div class="nm-tile-sub">Particle density, fog, weather, blood vessels, shudder, dream mode.</div>
          <div class="nm-tile-foot"><span>open</span><span>→</span></div>
        </a>
      </div>
    </div>
  </div>
</PageWrap>

<style>
  .muted-suffix {
    color: var(--text-ghost);
    font-size: 0.85em;
    font-weight: 500;
    margin-left: 2px;
  }
  .tiles {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .tile-group {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .tile-group-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--text-ghost);
    border-bottom: 1px solid var(--divider);
    padding-bottom: 0.45rem;
  }
  .tile-row {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }
  .status-line {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .muted {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }
</style>
