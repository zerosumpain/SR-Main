<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const langIcons: Record<string, string> = {
    javascript: 'JS',
    python: 'PY',
    bash: 'SH',
  };
  let langLabel = $derived(langIcons[data.config?.language as string] || 'JS');
</script>

<BaseNode
  id={id}
  description={data.config?.description || ""}
  label={data.label}
  nodeType="code · {langLabel}"
  status={data.status}
  icon="⟩_"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
