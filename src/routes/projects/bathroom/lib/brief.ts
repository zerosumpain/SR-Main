// Turns the layout and the spec into the thing you actually send to three
// fitters. The point is that all three price the same words, which is what
// makes their quotes comparable — and is the step almost nobody takes.

import { FIX, WALL_NAME, foot, type Plan } from './fixtures';
import type { Stats } from './checks';
import { COST, COVER, TIERS, daysOnSite, money, quantities, totals, type CostState } from './cost';

export interface BriefInput {
  plan: Plan;
  stats: Stats;
  cost: CostState;
  address: string;
  start: string;
}

export function briefText({ plan, stats, cost, address, start }: BriefInput): string {
  const T = totals(cost, stats);
  const q = quantities(stats, cost.cover);
  const L: string[] = [];

  L.push('BATHROOM REFURBISHMENT — REQUEST FOR QUOTATION');
  L.push(address.trim() || '[your address]');
  L.push('');
  L.push('THE ROOM');
  L.push('Upstairs bathroom in a solid-walled period terrace. Suspended timber floor.');
  L.push(
    `Internal size ${plan.W} x ${plan.D} mm (${stats.area.toFixed(2)} m2). Assume 2.4 m floor to ceiling unless measured otherwise.`,
  );
  L.push(
    `Door: ${plan.door.w} mm on the ${WALL_NAME[plan.door.wall]} wall, ${plan.door.pos} mm from the corner, ${
      plan.door.swing === 'out' ? 'opens outward' : plan.door.swing === 'slide' ? 'sliding' : 'opens inward'
    }.`,
  );
  if (plan.win.on) L.push(`Window: ${plan.win.w} mm wide on the ${WALL_NAME[plan.win.wall]} wall.`);
  L.push(`Soil stack: on the ${WALL_NAME[plan.stack.wall]} wall, ${plan.stack.pos} mm from the corner.`);
  if (plan.notch.on)
    L.push(`Chimney breast / bulkhead: ${plan.notch.w} x ${plan.notch.d} mm in the ${plan.notch.corner} corner.`);
  L.push('');

  L.push('PROPOSED LAYOUT');
  if (!plan.items.length) L.push('Open to your suggestions — please propose a layout.');
  else
    for (const it of plan.items) {
      const f = FIX[it.t];
      const b = foot(it);
      L.push(`- ${f.n} (${f.w} x ${f.d} mm), ${b.x} mm from the left wall, ${b.y} mm from the top wall.`);
    }
  if (stats.stackDist != null)
    L.push(`WC sits about ${(stats.stackDist / 1000).toFixed(1)} m from the stack.`);
  L.push('');

  L.push('SCOPE OF WORKS');
  L.push('Full strip-out of the existing bathroom, waste removed from site.');
  L.push(
    'First and second fix plumbing. Electrical work by a Part P registered electrician, certificate provided.',
  );
  L.push(
    `Tiling: ${COVER[cost.cover].n.toLowerCase()} — approximately ${q.wall.toFixed(1)} m2 of wall and ${q.floor.toFixed(1)} m2 of floor.`,
  );
  L.push('Boarding and plastering as required, ceiling made good, room left decorated.');
  L.push('Mechanical extract to Part F (minimum 15 l/s), ducted to outside in rigid duct.');

  // Reconcile the two halves: if the layout has a bath but the costing does
  // not, the layout wins — otherwise the brief contradicts itself.
  const planHas = (k: string) => plan.items.some((i) => FIX[i.t].k === k);
  const specOn: Record<string, boolean> = {};
  for (const line of COST) specOn[line.id] = cost.items[line.id].on;
  if (planHas('bath')) specOn.bath = true;
  if (planHas('shower')) {
    specOn.tray = true;
    specOn.valve = true;
  }
  if (planHas('store')) specOn.store = true;

  const extras: string[] = [];
  if (specOn.ufh) extras.push('electric underfloor heating with thermostat');
  if (specOn.backer) extras.push('insulated backer board to the external walls');
  if (specOn.store) extras.push('fitted storage / mirrored cabinet');
  if (specOn.movewc) extras.push('relocation of the WC and associated waste');
  if (specOn.water) extras.push('review of hot water pressure and any pump or valve required');
  if (extras.length) L.push('Also include: ' + extras.join('; ') + '.');
  L.push('');

  L.push('SPECIFICATION LEVEL');
  for (const line of COST)
    if (specOn[line.id] && line.cat !== 'labour')
      L.push(`- ${line.n}: ${TIERS[cost.items[line.id].tier].toLowerCase()} range`);
  L.push('');

  L.push('BUDGET AND PROGRAMME');
  L.push(`Working budget of around ${money(T.total)} all in, including a ${cost.cont}% contingency.`);
  let startTxt = 'flexible';
  if (start) {
    const d = new Date(start + 'T12:00:00');
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    startTxt = d.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  L.push(`We expect roughly ${daysOnSite(cost)} working days on site. Preferred start: ${startTxt}.`);
  L.push('');

  L.push('PLEASE INCLUDE IN YOUR QUOTATION');
  L.push('1. A fixed total, with VAT shown separately or confirmed as included.');
  L.push('2. A materials list with make and model numbers, and who supplies each item.');
  L.push('3. Days on site and the proposed sequence.');
  L.push(
    '4. Your payment stages. We work to a 10% deposit, stage payments against completed work, and 5% retained for two weeks after handover against the snag list.',
  );
  L.push('5. Confirmation that the electrical work is certified under Part P, and by whom.');
  L.push(
    '6. Skip / waste removal, dust protection and making good — please confirm these are included.',
  );
  L.push('7. Your public liability insurance cover and your guarantee.');
  L.push('8. Two recent customers we can speak to.');
  L.push('');
  L.push('Any changes to this scope to be priced in writing before the work is carried out.');
  return L.join('\n');
}
