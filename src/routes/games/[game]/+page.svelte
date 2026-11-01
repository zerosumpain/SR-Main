<script lang="ts">
  // The TV board for a family game. The shell (pairing code, stream, wake
  // lock) is game-agnostic; each game with a `toScreen` adds its board here.
  import TableScreen from '$lib/components/games/screen/TableScreen.svelte';
  import AzulTable from '$lib/components/games/azul/AzulTable.svelte';
  import QuizTable from '$lib/components/games/quiz/QuizTable.svelte';
  import CodenamesTable from '$lib/components/games/codenames/CodenamesTable.svelte';
  import type { AzulRoom } from '$lib/components/games/azul/motion';
  import type { WireRoom as QuizRoom } from '$lib/games/quiz-night';
  import type { WireRoom as CodenamesRoom } from '$lib/games/codenames';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

{#if data.game === 'azul'}
  <TableScreen game="azul" title={data.title}>
    {#snippet board(room: AzulRoom, skewMs: number)}
      <AzulTable {room} {skewMs} />
    {/snippet}
  </TableScreen>
{:else if data.game === 'quiz-night'}
  <TableScreen game="quiz-night" title={data.title}>
    {#snippet board(room: QuizRoom, skewMs: number)}
      <QuizTable {room} {skewMs} />
    {/snippet}
  </TableScreen>
{:else if data.game === 'codenames'}
  <TableScreen game="codenames" title={data.title}>
    {#snippet board(room: CodenamesRoom, skewMs: number)}
      <CodenamesTable {room} {skewMs} />
    {/snippet}
  </TableScreen>
{/if}
