import type { PageServerLoad } from "./$types";
import { errMsg } from "$lib/daydream/types";
import { loadMoney } from "$lib/daydream/ledger";
import {
  emptySpendRollup,
  loadSpendRollup,
} from "$lib/daydream/rooms/money.server";

// Evidenced spend, and nothing else. The old tab paid for sixteen ledger
// loaders on arrival; this room reads the spend ledger and its own grouped
// rollup, which is the whole point of the rooms being routes.
export const load: PageServerLoad = async () => {
  try {
    const [money, rollup] = await Promise.all([loadMoney(), loadSpendRollup()]);
    return { money, rollup, loadError: null as string | null };
  } catch (err) {
    console.error("[daydream] money load failed:", errMsg(err));
    return {
      money: null as Awaited<ReturnType<typeof loadMoney>> | null,
      rollup: emptySpendRollup(),
      loadError: errMsg(err),
    };
  }
};
