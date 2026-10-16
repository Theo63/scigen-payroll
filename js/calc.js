// Pure payroll math. No Firebase, no DOM: shared by the browser app, the
// import script and the tests.

export const DEFAULT_SETTINGS = Object.freeze({
  currency: { symbol: '€', position: 'before', decimals: 2 },
  durationDisplay: 'minutes+hours', // 'minutes' | 'hours' | 'hmm' | 'minutes+hours'
  yearStartMonth: 5, // contract year starts in May
  opening: { total: 0, paid: 0, label: '' },
  subtractExpenses: true,
  showYearAverage: true,
  showYearCards: true,
  rates: [{ from: '2025-05', rate: 8 }],
});

export function withDefaults(settings = {}) {
  const s = settings || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    currency: { ...DEFAULT_SETTINGS.currency, ...(s.currency || {}) },
    opening: { ...DEFAULT_SETTINGS.opening, ...(s.opening || {}) },
    rates: Array.isArray(s.rates) && s.rates.length ? s.rates : DEFAULT_SETTINGS.rates,
  };
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "HH:mm" -> minutes since midnight, or null. */
export function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minutes worked between two "HH:mm" times. Finish before start means it crossed midnight. */
export function minutesBetween(start, finish) {
  const a = parseTime(start);
  const b = parseTime(finish);
  if (a === null || b === null) return null;
  let d = b - a;
  if (d < 0) d += 24 * 60;
  return d;
}

/** "YYYY-MM-DD" -> "YYYY-MM". */
export const monthOf = (date) => String(date || '').slice(0, 7);

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function monthDiff(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by * 12 + bm) - (ay * 12 + am);
}

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Hourly rate in force for a month: the latest rate row whose `from` <= month. */
export function rateFor(month, rates) {
  const sorted = [...(rates || [])]
    .filter((r) => r && r.from && num(r.rate) !== null)
    .sort((a, b) => a.from.localeCompare(b.from));
  let rate = sorted.length ? Number(sorted[0].rate) : 0;
  for (const r of sorted) if (r.from <= month) rate = Number(r.rate);
  return rate;
}

export const entryHours = (e) => (num(e.minutes) ?? 0) / 60;

/**
 * One row per month that has entries or a month doc.
 * monthDocs: { 'YYYY-MM': { hoursToBePaid?, rate?, note? } }
 */
export function aggregateMonths(entries, monthDocs = {}, settings = DEFAULT_SETTINGS, extraMonths = []) {
  const s = withDefaults(settings);
  const byMonth = new Map();
  const ensure = (m) => {
    if (!byMonth.has(m)) byMonth.set(m, { month: m, entries: 0, minutes: 0 });
    return byMonth.get(m);
  };
  for (const e of entries || []) {
    const m = e.month || monthOf(e.date);
    if (!m) continue;
    const row = ensure(m);
    row.entries += 1;
    row.minutes += num(e.minutes) ?? 0;
  }
  for (const m of Object.keys(monthDocs || {})) ensure(m);
  for (const m of extraMonths) if (m) ensure(m);

  return [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => {
      const doc = (monthDocs || {})[row.month] || {};
      const totalHours = round4(row.minutes / 60);
      const manualHours = num(doc.hoursToBePaid);
      const manualRate = num(doc.rate);
      const hoursToBePaid = manualHours ?? totalHours;
      const rate = manualRate ?? rateFor(row.month, s.rates);
      return {
        month: row.month,
        entries: row.entries,
        totalHours,
        hoursToBePaid,
        hoursManual: manualHours !== null,
        rate,
        rateManual: manualRate !== null,
        pay: round2(hoursToBePaid * rate),
        note: doc.note || '',
      };
    });
}

const round4 = (n) => Math.round(n * 10000) / 10000;

/** Grand totals: what has been earned, what has been paid out (expenses), and what is left. */
export function totals(monthRows, expenses, settings = DEFAULT_SETTINGS) {
  const s = withDefaults(settings);
  const earnedMonths = (monthRows || []).reduce((a, r) => a + r.pay, 0);
  const expensesSum = (expenses || []).reduce((a, x) => a + (num(x.amount) ?? 0), 0);
  const earned = round2((num(s.opening.total) ?? 0) + earnedMonths);
  const paid = round2((num(s.opening.paid) ?? 0) + expensesSum);
  const remaining = round2(s.subtractExpenses ? earned - paid : earned);
  const hours = round4((monthRows || []).reduce((a, r) => a + r.totalHours, 0));
  return { earned, paid, remaining, hours };
}

/** First month ("YYYY-MM") of the contract year that contains `month`. */
export function contractYearStart(month, yearStartMonth = 5) {
  const [y, m] = month.split('-').map(Number);
  const startYear = m >= yearStartMonth ? y : y - 1;
  return `${startYear}-${String(yearStartMonth).padStart(2, '0')}`;
}

/**
 * Per contract year: hours, pay, expenses and the average monthly pay
 * (the sheet's "1 y avg" = year pay / months elapsed in that year).
 */
export function contractYears(monthRows, expenses, settings = DEFAULT_SETTINGS, today = currentMonth()) {
  const s = withDefaults(settings);
  const years = new Map();
  const ensure = (start) => {
    if (!years.has(start)) {
      years.set(start, { start, end: addMonths(start, 11), hours: 0, pay: 0, expenses: 0 });
    }
    return years.get(start);
  };
  for (const r of monthRows || []) {
    const y = ensure(contractYearStart(r.month, s.yearStartMonth));
    y.hours += r.totalHours;
    y.pay += r.pay;
  }
  for (const x of expenses || []) {
    if (!x.date) continue;
    const y = ensure(contractYearStart(monthOf(x.date), s.yearStartMonth));
    y.expenses += num(x.amount) ?? 0;
  }
  const list = [...years.values()].sort((a, b) => a.start.localeCompare(b.start));
  return list.map((y, i) => {
    const lastMonth = today < y.end ? today : y.end;
    const monthsElapsed = Math.max(1, Math.min(12, monthDiff(y.start, lastMonth) + 1));
    return {
      index: i + 1,
      start: y.start,
      end: y.end,
      hours: round4(y.hours),
      pay: round2(y.pay),
      expenses: round2(y.expenses),
      monthsElapsed,
      avgMonthlyPay: round2(y.pay / monthsElapsed),
    };
  });
}

/** Convenience: everything the dashboard needs in one call. */
export function summarize({ entries, monthDocs, expenses, settings, today = currentMonth() }) {
  const monthRows = aggregateMonths(entries, monthDocs, settings);
  return {
    months: monthRows,
    totals: totals(monthRows, expenses, settings),
    years: contractYears(monthRows, expenses, settings, today),
  };
}
