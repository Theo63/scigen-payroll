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

const pad2 = (n) => String(n).padStart(2, '0');

/** "2026-10-16" -> "16/10/2026" (every date on the site is shown as dd/mm/yyyy). */
export function dateLabel(date) {
  const dt = parseISO(date);
  if (!dt) return date || '';
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}
export const isoToDMY = dateLabel;

/** "Fri" for an ISO date. */
export function weekdayLabel(date) {
  const dt = parseISO(date);
  return dt ? DAYS[dt.getDay()] : '';
}

/**
 * Typed date -> "YYYY-MM-DD", or null when it is not a real date.
 * Accepts 16/10/2026, 16/10/26, 16/10 (current year), with / . or - as separator.
 */
export function parseDMY(text, now = new Date()) {
  const m = /^\s*(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2}|\d{4}))?\s*$/.exec(String(text || ''));
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : now.getFullYear();
  if (y < 100) y += 2000;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/**
 * Typed time -> "HH:MM" (24-hour), "" when empty, or null when invalid.
 * Accepts 9:05, 09:05, 0905, 905, 9.05, 9 (→ 09:00).
 */
export function parseTime24(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  let h;
  let mi;
  let m = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  if (m) { h = Number(m[1]); mi = Number(m[2]); }
  else if ((m = /^(\d{3,4})$/.exec(s))) { h = Number(s.slice(0, -2)); mi = Number(s.slice(-2)); }
  else if ((m = /^(\d{1,2})$/.exec(s))) { h = Number(s); mi = 0; }
  else return null;
  if (h === 24 && mi === 0) h = 0;
  if (h > 23 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

export const todayDMY = (now = new Date()) => dateLabel(todayISO(now));

/** ISO timestamp -> "16/10/2026 18:42" in local time (24-hour). */
export function dateTimeLabel(isoTime) {
  const dt = new Date(isoTime);
  if (!isoTime || Number.isNaN(dt.getTime())) return '';
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
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
