// Display formatting helpers. Units toggle between imperial (default, what the
// Broads signage uses) and metric.
export type Units = 'imperial' | 'metric';

export function fmtDist(m: number, units: Units = 'imperial'): string {
  if (units === 'metric') return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
  const miles = m / 1609.344;
  return miles >= 0.1 ? `${miles.toFixed(1)} mi` : `${Math.round(m / 0.9144)} yd`;
}

export function fmtTime(s: number): string {
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtMoney(n: number): string {
  return `£${n.toFixed(2)}`;
}

/** Metres → feet'inches" (for boat air drafts / clearances). */
export function mToFtIn(m: number): string {
  const totalIn = m / 0.0254;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn - ft * 12);
  return inch === 12 ? `${ft + 1}'0"` : `${ft}'${inch}"`;
}

export function fmtClearance(m: number, units: Units = 'imperial'): string {
  return units === 'metric' ? `${m.toFixed(2)} m` : `${mToFtIn(m)} (${m.toFixed(2)} m)`;
}

export function fmtSpeed(mph: number): string {
  return `${mph} mph`;
}

export function fmtRate(rate: { amount: number; unit: string }, waivedWithMeal: boolean): string {
  if (rate.unit === 'free' || (rate.amount === 0 && rate.unit !== 'metre_night')) return 'Free';
  if (rate.amount === 0) return 'Charge applies';
  const unit = rate.unit === 'metre_night' ? '/m/night' : rate.unit === 'night' ? '/night' : `/${rate.unit}`;
  return `£${rate.amount}${unit}${waivedWithMeal ? ' (often waived with a meal)' : ''}`;
}
