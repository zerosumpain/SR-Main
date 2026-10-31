<script lang="ts">
  // The TV board for a family game. The shell (pairing code, stream, wake
  // lock) is game-agnostic; each game with a `toScreen` adds its board here.
  import TableScreen from '$lib/components/games/screen/TableScreen.svelte';
  import AzulTable from '$lib/components/games/azul/AzulTable.svelte';
  import type { AzulRoom } from '$lib/components/games/azul/motion';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

{#if data.game === 'azul'}
  <TableScreen game="azul" title={data.title}>
    {#snippet board(room: AzulRoom, skewMs: number)}
      <AzulTable {room} {skewMs} />
    {/snippet}
  </TableScreen>
{/if}
