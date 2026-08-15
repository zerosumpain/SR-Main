<script lang="ts">
  // A static provenance diagram: raw returns → DfE collections → public surfaces → this page.
  const stages: { title: string; items: string[] }[] = [
    {
      title: 'Schools & bodies submit',
      items: ['Termly School Census', 'School Workforce Census', 'CFR / Academies Accounts Return', 'Exam & awarding bodies', 'Job & course adverts']
    },
    {
      title: 'DfE collects & curates',
      items: ['National Pupil Database', 'School register (GIAS)', 'Statistical collections', 'Financial returns']
    },
    {
      title: 'DfE publishes',
      items: ['EES API + data catalogue', 'GIAS bulk extracts', 'Performance tables', 'Teaching Vacancies / ITT APIs', 'data.gov.uk']
    },
    {
      title: 'This page reads',
      items: ['6 live API calls', '16-service catalogue', 'cached 30 min, server-side']
    }
  ];
</script>

<div class="flow">
  {#each stages as stage, i (stage.title)}
    <div class="stage">
      <span class="step">0{i + 1}</span>
      <h4>{stage.title}</h4>
      <ul>
        {#each stage.items as item (item)}<li>{item}</li>{/each}
      </ul>
    </div>
    {#if i < stages.length - 1}<div class="arrow" aria-hidden="true">→</div>{/if}
  {/each}
</div>

<style>
  .flow {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr auto 1fr;
    align-items: stretch;
    gap: 6px;
  }
  .stage {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 13px;
    background: rgba(255, 255, 255, 0.4);
    border: 1px solid rgba(28, 22, 17, 0.13);
    border-radius: var(--radius-sharp);
    min-width: 0;
  }
  .step {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    color: var(--accent);
  }
  h4 {
    margin: 0;
    font-family: var(--fs-serif);
    font-weight: 600;
    font-size: var(--fs-label);
    line-height: 1.15;
    color: var(--ink);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  li {
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    color: rgba(28, 22, 17, 0.66);
    padding-left: 10px;
    position: relative;
  }
  li::before {
    content: '·';
    position: absolute;
    left: 2px;
    color: rgba(28, 22, 17, 0.4);
  }
  .arrow {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(28, 22, 17, 0.35);
    font-size: var(--fs-body);
  }
  @media (max-width: 880px) {
    .flow {
      grid-template-columns: 1fr;
    }
    .arrow {
      transform: rotate(90deg);
      padding: 2px 0;
    }
  }
</style>
