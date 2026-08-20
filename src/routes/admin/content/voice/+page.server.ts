import type { PageServerLoad } from './$types';
import { getVoiceCard, getExemplars } from '$lib/voice/card';
import { voiceBlock } from '$lib/voice/block';
import { REGISTERS } from '$lib/voice/types';

export const load: PageServerLoad = async () => {
  const card = getVoiceCard();
  return {
    card,
    exemplars: getExemplars(),
    // The rendered blocks, exactly as the surfaces receive them. Showing the
    // card's fields alone would let this page drift from what the models are
    // actually told, which is the whole failure the card exists to end.
    blocks: card
      ? REGISTERS.map((r) => ({
          register: r,
          text: voiceBlock(r, { exemplars: r === 'public-prose' ? 2 : 0 }),
        }))
      : [],
  };
};
