import { withDefaults } from './calc.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthLabel(month, short = false) {
  if (!month) return '';
  const [y, m] = month.split('-').map(Number);
  const name = MONTHS[m - 1] || '?';
  return `${short ? name.slice(0, 3) : name} ${y}`;
}

function parseISO(date) {
  const [y, m, d] = String(date || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** "Fri 16 Oct" (inside a month view) or "16 Oct 2026". */
export function dateLabel(date, withYear = false) {
  const dt = parseISO(date);
  if (!dt) return date || '';
  const base = `${dt.getDate()} ${MONTHS[dt.getMonth()].slice(0, 3)}`;
  return withYear ? `${base} ${dt.getFullYear()}` : `${DAYS[dt.getDay()]} ${base}`;
}

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const trim = (n, max) => new Intl.NumberFormat('en-US', { maximumFractionDigits: max }).format(n);

export function makeFmt(settings) {
  const s = withDefaults(settings);
  const decimals = Number.isInteger(Number(s.currency.decimals)) ? Number(s.currency.decimals) : 2;
  const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const money = (n) => {
    const v = Number(n) || 0;
    const body = nf.format(Math.abs(v));
    const sign = v < 0 ? '−' : '';
    return s.currency.position === 'after' ? `${sign}${body} ${s.currency.symbol}` : `${sign}${s.currency.symbol}${body}`;
  };

  const hours = (h) => `${trim(Number(h) || 0, 3)} h`;
  const hoursRound = (h) => `${trim(Number(h) || 0, 1)} h`;
  const hoursPlain = (h) => trim(Number(h) || 0, 3);

  const hmm = (minutes) => {
    const total = Math.round(Number(minutes) || 0);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  /** Duration of one entry according to Settings → Duration display. */
  const duration = (minutes) => {
    const m = Number(minutes) || 0;
    switch (s.durationDisplay) {
      case 'minutes': return `${trim(m, 2)} min`;
      case 'hours': return `${trim(m / 60, 3)} h`;
      case 'hmm': return hmm(m);
      default: return `${trim(m, 2)} min · ${trim(m / 60, 3)} h`;
    }
  };

  return { money, hours, hoursRound, hoursPlain, duration, hmm, settings: s };
}
