/**
 * A cron expression in plain English — ONE wording for every surface that
 * shows a schedule: the canvas ScheduleBuilder's preview and the iPhone's
 * trigger card (`/api/native/workflows`). Client-safe: no imports.
 *
 * Covers what the ScheduleBuilder writes ("Every day at 08:00", "Every 15
 * minutes") and the shapes the generator also emits. Anything else is quoted
 * verbatim rather than guessed at.
 */

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function hhmm(h: string, m: string): string {
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return `On the schedule "${expr.trim()}"`;
  const [m, h, dom, mon, dow] = parts;
  const num = /^\d+$/;

  if (dom === '*' && mon === '*' && dow === '*') {
    if (m === '*' && h === '*') return 'Every minute';
    const everyMin = /^\*\/(\d+)$/.exec(m);
    if (everyMin && h === '*') {
      const n = Number(everyMin[1]);
      return n === 1 ? 'Every minute' : `Every ${n} minutes`;
    }
    const everyHr = /^\*\/(\d+)$/.exec(h);
    if (num.test(m) && everyHr) {
      const n = Number(everyHr[1]);
      const at = m === '0' ? '' : ` at ${m.padStart(2, '0')} past`;
      return n === 1 ? `Every hour${at}` : `Every ${n} hours${at}`;
    }
    if (num.test(m) && h === '*') {
      return m === '0' ? 'Every hour, on the hour' : `Every hour at ${m.padStart(2, '0')} past`;
    }
  }

  if (!num.test(m) || !/^\d+(,\d+)*$/.test(h)) return `On the schedule "${expr.trim()}"`;
  const times = h.split(',').map((hour) => hhmm(hour, m));
  const at = times.length === 1 ? times[0] : `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;

  if (mon !== '*') return `On the schedule "${expr.trim()}"`;
  if (dom !== '*') {
    if (dow !== '*' || !num.test(dom)) return `On the schedule "${expr.trim()}"`;
    return `On day ${dom} of every month at ${at}`;
  }
  if (dow === '*') return `Every day at ${at}`;
  if (dow === '1-5') return `Every weekday at ${at}`;
  if (dow === '0,6' || dow === '6,0' || dow === '6,7') return `Every weekend at ${at}`;
  if (/^\d(,\d)*$/.test(dow)) {
    const unique = [...new Set(dow.split(',').map((d) => Number(d) % 7))].sort((a, b) => a - b);
    if (unique.length === 7) return `Every day at ${at}`;
    const days = unique.map((d) => DOW[d]);
    return `Every ${days.join(', ')} at ${at}`;
  }
  return `On the schedule "${expr.trim()}"`;
}
