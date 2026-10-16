import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  minutesBetween, rateFor, aggregateMonths, totals, contractYears, contractYearStart,
  addMonths, monthDiff, withDefaults, DEFAULT_SETTINGS, summarize,
} from '../js/calc.js';

test('minutesBetween handles normal spans, midnight crossing and bad input', () => {
  assert.equal(minutesBetween('10:00', '12:00'), 120);
  assert.equal(minutesBetween('23:00', '00:00'), 60);
  assert.equal(minutesBetween('21:10', '00:40'), 210);
  assert.equal(minutesBetween('22:00', '22:00'), 0);
  assert.equal(minutesBetween('', '12:00'), null);
  assert.equal(minutesBetween('25:00', '12:00'), null);
});

test('month helpers', () => {
  assert.equal(addMonths('2025-12', 1), '2026-01');
  assert.equal(addMonths('2025-05', 12), '2026-05');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(monthDiff('2025-05', '2026-04'), 11);
  assert.equal(contractYearStart('2026-04', 5), '2025-05');
  assert.equal(contractYearStart('2026-05', 5), '2026-05');
});

test('rateFor picks the latest rate row that has started', () => {
  const rates = [{ from: '2026-11', rate: 10 }, { from: '2025-05', rate: 8 }];
  assert.equal(rateFor('2025-05', rates), 8);
  assert.equal(rateFor('2026-10', rates), 8);
  assert.equal(rateFor('2026-11', rates), 10);
  assert.equal(rateFor('2027-03', rates), 10);
  assert.equal(rateFor('2024-01', rates), 8, 'months before the first row use the first rate');
});

const e = (month, minutes) => ({ date: `${month}-10`, month, minutes });

test('a month without manual values pays the full hours (no cap)', () => {
  const entries = [e('2026-05', 60 * 40), e('2026-05', 60 * 25)];
  const [m] = aggregateMonths(entries, {}, DEFAULT_SETTINGS);
  assert.equal(m.totalHours, 65);
  assert.equal(m.hoursToBePaid, 65);
  assert.equal(m.hoursManual, false);
  assert.equal(m.pay, 520);
});

test('manual hours and manual rate win', () => {
  const entries = [e('2025-06', 64 * 60)];
  const [m] = aggregateMonths(entries, { '2025-06': { hoursToBePaid: 50 } }, DEFAULT_SETTINGS);
  assert.equal(m.totalHours, 64);
  assert.equal(m.hoursToBePaid, 50);
  assert.equal(m.pay, 400);
  const [m2] = aggregateMonths(entries, { '2025-06': { rate: 10 } }, DEFAULT_SETTINGS);
  assert.equal(m2.pay, 640);
  assert.equal(m2.rateManual, true);
});

test('fractional hours keep cents exact (July 2026: 51.835 h → 414.68)', () => {
  const entries = [e('2026-07', 110.1), e('2026-07', 50 * 60)];
  const [m] = aggregateMonths(entries, {}, DEFAULT_SETTINGS);
  assert.equal(m.totalHours, 51.835);
  assert.equal(m.pay, 414.68);
});

test('a later rate row only changes months from then on', () => {
  const s = withDefaults({ rates: [{ from: '2025-05', rate: 8 }, { from: '2026-11', rate: 10 }] });
  const rows = aggregateMonths([e('2026-10', 600), e('2026-11', 600)], {}, s);
  assert.deepEqual(rows.map((r) => r.pay), [80, 100]);
});

test('totals: opening balance, expenses subtraction toggle', () => {
  const rows = aggregateMonths([e('2026-05', 600)], {}, DEFAULT_SETTINGS); // 80
  const ex = [{ date: '2026-05-14', amount: 30 }];
  assert.deepEqual(totals(rows, ex, DEFAULT_SETTINGS), { earned: 80, paid: 30, remaining: 50, hours: 10 });
  const s = withDefaults({ opening: { total: 100, paid: 20 } });
  assert.deepEqual(totals(rows, ex, s), { earned: 180, paid: 50, remaining: 130, hours: 10 });
  const s2 = withDefaults({ subtractExpenses: false });
  assert.equal(totals(rows, ex, s2).remaining, 80);
});

test('contract years and average monthly pay', () => {
  const rows = aggregateMonths([e('2025-05', 600), e('2026-04', 600), e('2026-05', 1200)], {}, DEFAULT_SETTINGS);
  const years = contractYears(rows, [{ date: '2026-05-01', amount: 5 }], DEFAULT_SETTINGS, '2026-10');
  assert.equal(years.length, 2);
  assert.equal(years[0].start, '2025-05');
  assert.equal(years[0].pay, 160);
  assert.equal(years[0].monthsElapsed, 12);
  assert.equal(years[1].monthsElapsed, 6); // May..Oct 2026
  assert.equal(years[1].pay, 160);
  assert.equal(years[1].expenses, 5);
});

const seedPath = new URL('../data/seed.json', import.meta.url);
test('imported sheet reproduces the sheet totals', { skip: !fs.existsSync(seedPath) && 'run npm run parse-sheet first' }, () => {
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const { totals: t, years } = summarize({ entries: seed.entries, monthDocs: seed.months, expenses: seed.expenses, settings: seed.settings, today: '2026-10' });
  assert.equal(t.earned, 7355.48);
  assert.equal(t.paid, 6960);
  assert.equal(t.remaining, 395.48);
  assert.equal(years[0].pay, 4474.8);
  assert.equal(years[0].expenses, 3254);
  assert.equal(years[0].avgMonthlyPay, 372.9);
  assert.equal(years[1].pay, 2880.68);
});
