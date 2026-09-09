<script lang="ts">
  import { FIRST_LOOK_GROUPS, type FirstLook } from '$lib/policy-incentives-lab/first-look';
  let { report, base }: { report: FirstLook; base: string } = $props();
</script>
<section aria-label="First-look red-team dashboard">
  <div class="masthead"><p>FIRST LOOK · UNREVIEWED</p><h2>People, responses and questions worth testing</h2><p>{report.notice}</p><p>{report.method === 'model-assisted' ? 'Model-assisted review' : 'Basic source scan'} · {new Date(report.generated_at).toLocaleString()} · {report.version}</p></div>
  <p><strong>This report does not approve a model or run a simulation.</strong> A quoted passage supports the topic being discussed. It does not prove the suggested response will happen.</p>
  <p><a href={`${base}/first-look-report?format=markdown`}>Download first look (Markdown)</a> · <a href={`${base}/first-look-report?format=json`}>Download first look (JSON)</a></p>
  {#each FIRST_LOOK_GROUPS as [key, label]}<section class="group"><h2>{label}</h2>
    {#each report.content[key] as card}<article><h3>{card.title}</h3><p><strong>Hypothesis to check:</strong> {card.hypothesis}</p><blockquote><p>{card.quotation}</p><footer>Source passage · {card.location}</footer></blockquote><p><strong>Ask next:</strong> {card.question}</p></article>{:else}<p>Not identified in this pass. This does not mean there are none; check the original policy and add what is missing.</p>{/each}
  </section>{/each}
  <h2>Before you build a model</h2><ul>{#each report.content.questions as question}<li>{question}</li>{/each}</ul>
  <p>Next: <a href="?step=evidence">check the policy evidence</a>, then <a href="?step=actors">review the people and organisations</a>.</p>
</section>
<style>.masthead { background: var(--text-primary); color: var(--bg); padding: 20px; } .masthead h2 { color: inherit; } p, li { line-height: 1.6; max-width: 85ch; } .group { margin-top: 28px; } article { padding: 12px 0; border-top: 1px solid var(--line); } blockquote { margin: 12px 0; border-left: 2px solid var(--accent-ink); padding: 0 16px; } footer { font-size: var(--fs-label); color: var(--text-muted); }</style>
