import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateLabel, parseDMY, parseTime24, weekdayLabel, todayDMY } from '../js/format.js';

test('dates are always shown as dd/mm/yyyy', () => {
  assert.equal(dateLabel('2026-10-16'), '16/10/2026');
  assert.equal(dateLabel('2025-05-01'), '01/05/2025');
  assert.equal(weekdayLabel('2026-10-16'), 'Fri');
  assert.match(todayDMY(), /^\d{2}\/\d{2}\/\d{4}$/);
});

test('typed dates are read as day/month/year', () => {
  const now = new Date(2026, 9, 16);
  assert.equal(parseDMY('16/10/2026', now), '2026-10-16');
  assert.equal(parseDMY('3/2/2026', now), '2026-02-03', 'day first, not month first');
  assert.equal(parseDMY('03.02.26', now), '2026-02-03');
  assert.equal(parseDMY('3-2-2026', now), '2026-02-03');
  assert.equal(parseDMY('16/10', now), '2026-10-16');
  assert.equal(parseDMY('31/02/2026', now), null);
  assert.equal(parseDMY('13/13/2026', now), null);
  assert.equal(parseDMY('2026-10-16', now), null);
  assert.equal(parseDMY('', now), null);
});

test('typed times are 24-hour HH:MM', () => {
  assert.equal(parseTime24('14:30'), '14:30');
  assert.equal(parseTime24('9:05'), '09:05');
  assert.equal(parseTime24('0905'), '09:05');
  assert.equal(parseTime24('1430'), '14:30');
  assert.equal(parseTime24('9.30'), '09:30');
  assert.equal(parseTime24('9'), '09:00');
  assert.equal(parseTime24('00:00'), '00:00');
  assert.equal(parseTime24('24:00'), '00:00');
  assert.equal(parseTime24(''), '');
  assert.equal(parseTime24('2:30 PM'), null, 'no AM/PM');
  assert.equal(parseTime24('25:00'), null);
  assert.equal(parseTime24('12:60'), null);
});
