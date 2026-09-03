<script lang="ts">
  // The one card a room shows when its own load failed. Every figure below it
  // is then a zero for a reason that has nothing to do with what the engine
  // has been noticing, and the card says so — in one place, in one shape.
  interface Props {
    kicker: string;
    message: string;
    note?: string | null;
  }
  let { kicker, message, note = 'Everything below is therefore empty for a reason that has nothing to do with what the engine has been noticing. Reload; if it keeps failing, the server log carries the query error.' }: Props = $props();
</script>

<div class="card t-urgent">
  <p class="card-kicker">{kicker}</p>
  <p class="card-body">{message}</p>
  {#if note}<p class="note">{note}</p>{/if}
</div>
