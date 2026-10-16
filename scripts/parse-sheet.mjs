#!/usr/bin/env node
// Converts the Google Sheets "Download → Web page (.html, zipped)" export of
// "Scigen Time Records" into data/seed.json for Settings → Import JSON.
//
// Usage: npm run parse-sheet [-- <export folder>] [--today YYYY-MM]
// Default folder: ~/Downloads/Scigen Time Records 2nd year

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'node-html-parser';
import { DEFAULT_SETTINGS, aggregateMonths, totals, addMonths, currentMonth, round2 } from '../js/calc.js';

const args = process.argv.slice(2);
const todayIdx = args.indexOf('--today');
const today = todayIdx >= 0 ? args.splice(todayIdx, 2)[1] : currentMonth();
const folder = args[0] || path.join(os.homedir(), 'Downloads', 'Scigen Time Records 2nd year');

// Each tab and the month its first block belongs to.
const TABS = [
  { file: '1st year.html', firstMonth: '2025-05' },
  { file: '2nd year.html', firstMonth: '2026-05' },
];

// Column indexes in the sheet (A = 0).
const C = { date: 0, task: 1, start: 2, finish: 3, duration: 4, hours: 5, monthTotal: 6, toBePaid: 7, pay: 8, paid: 10, expDate: 12, expItem: 13 };

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** Builds a rectangular grid from the export, honouring rowspan/colspan. */
function readGrid(file) {
  const root = parse(fs.readFileSync(file, 'utf8'));
  const rows = [];
  const carry = []; // col -> { left, text }
  for (const tr of root.querySelectorAll('tbody tr')) {
    const th = tr.querySelector('th');
    if (!th || th.classList.contains('freezebar-cell') || /freezebar/.test(th.getAttribute('class') || '')) continue;
    const sheetRow = Number(th.text.trim());
    const cells = [];
    const merged = new Set();
    let col = 0;
    const fillCarry = () => {
      while (carry[col] && carry[col].left > 0) {
        cells[col] = carry[col].text;
        merged.add(col);
        carry[col].left -= 1;
        col += 1;
      }
    };
    for (const td of tr.querySelectorAll('td')) {
      fillCarry();
      const text = decode(td.innerText || '').replace(/\s+\n/g, '\n').trim();
      const cs = Number(td.getAttribute('colspan') || 1);
      const rs = Number(td.getAttribute('rowspan') || 1);
      for (let k = 0; k < cs; k++) {
        cells[col] = k === 0 ? text : '';
        if (rs > 1) carry[col] = { left: rs - 1, text: k === 0 ? text : '' };
        col += 1;
      }
    }
    fillCarry();
    rows.push({ sheetRow, cells: Array.from({ length: 14 }, (_, i) => cells[i] ?? ''), merged });
  }
  return rows;
}

const isNum = (s) => /^-?\d+(\.\d+)?$/.test(String(s).trim());

/** "2:30:00" or "1:30" (h:mm[:ss]) -> hours. */
function hmsToHours(s) {
  const m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(String(s).trim());
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60 + Number(m[3] || 0) / 3600;
}

/** Normalises start/finish cells: "6/1 22:00", "11:00:00 PM", "1:45 AM", "23;00", "23:0". */
function normTime(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^\d{1,2}\/\d{1,2}\s+/, '').replace(';', ':');
  if (/^\d{3,4}$/.test(s)) s = `${s.slice(0, -2)}:${s.slice(-2)}`; // "1800" -> "18:00"
  const m = /^(\d{1,2}):(\d{1,2})(?::\d{1,2})?\s*(AM|PM)?$/i.exec(s);
  if (!m) return '';
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  if (h > 23 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * Parses a date cell typed in the sheet. Returns { date, flags } or null.
 * The block month decides the year when the cell has none.
 */
function parseDate(raw, blockMonth) {
  const flags = [];
  let s = String(raw || '').trim();
  if (!s || s === '-//-') return null;
  const [by, bm] = blockMonth.split('-').map(Number);
  let m = /^(\d{1,2})-(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s); // "19-20/7"
  if (m) {
    flags.push(`sheet date "${s}" was a range; first day used`);
    s = `${m[1]}/${m[3]}${m[4] ? '/' + m[4] : ''}`;
  }
  m = /^(\d{1,2})\?(\d{1,2})$/.exec(s); // "25?9"
  if (m) {
    flags.push(`sheet date "${s}" had a typo`);
    s = `${m[1]}/${m[2]}`;
  }
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (!m) return { date: null, flags: [`unreadable sheet date "${raw}"`] };
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y;
  // Year closest to the block month.
  const cands = [by - 1, by, by + 1];
  y = cands.reduce((best, cy) => (Math.abs((cy * 12 + mo) - (by * 12 + bm)) < Math.abs((best * 12 + mo) - (by * 12 + bm)) ? cy : best), by);
  if (m[3]) {
    let ty = Number(m[3]);
    if (ty < 100) ty += 2000;
    if (ty !== y) flags.push(`sheet date "${raw}" had year ${ty}; ${y} used`);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { date: null, flags: [`unreadable sheet date "${raw}"`] };
  return { date: iso(y, mo, d), flags };
}

function parseTab(file, firstMonth) {
  const rows = readGrid(file);
  const entries = [];
  const expenses = [];
  const blocks = [];
  let block = null;
  let prevDate = null;
  let expYear = Number(firstMonth.slice(0, 4));
  let expPrevMonth = 0;

  for (const { sheetRow, cells, merged } of rows) {
    if (sheetRow === 1) continue; // header
    const c = (k) => cells[k].trim();

    // Expenses live in columns K (amount), M (date), N (item). Row 2 holds the column total.
    if (sheetRow > 2 && c(C.expItem) && isNum(c(C.paid)) && !merged.has(C.paid)) {
      const em = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(c(C.expDate));
      let date = null;
      if (em) {
        const mo = Number(em[2]);
        if (em[3]) {
          expYear = Number(em[3]) < 100 ? 2000 + Number(em[3]) : Number(em[3]);
        } else if (mo < expPrevMonth) {
          expYear += 1;
        }
        expPrevMonth = mo;
        date = iso(expYear, mo, Number(em[1]));
      }
      expenses.push({ date, amount: Number(c(C.paid)), description: c(C.expItem), source: `${path.basename(file)} row ${sheetRow}` });
    }

    // A new month block starts where both "Total Time" and "Hours to be Paid" hold a number.
    const tbp = c(C.toBePaid);
    const total = c(C.monthTotal);
    if (!merged.has(C.toBePaid) && tbp && (isNum(tbp) || hmsToHours(tbp) !== null) && total && (isNum(total) || hmsToHours(total) !== null)) {
      block = {
        month: addMonths(firstMonth, blocks.length),
        sheetTotal: isNum(total) ? Number(total) : hmsToHours(total),
        sheetToBePaid: Number(tbp),
        sheetPay: Number(c(C.pay)),
        firstRow: sheetRow,
        rows: 0,
        hours: 0,
      };
      blocks.push(block);
    }
    if (!block) continue;

    const task = c(C.task);
    const dateCell = c(C.date);
    if (/happy birthday/i.test(dateCell) || /happy birthday/i.test(task)) continue;

    // Hours: column F if numeric, else E as h:mm[:ss], else E as minutes.
    let hours = null;
    if (!merged.has(C.hours) && isNum(c(C.hours))) hours = Number(c(C.hours));
    else if (hmsToHours(c(C.duration)) !== null) hours = hmsToHours(c(C.duration));
    else if (isNum(c(C.duration))) hours = Number(c(C.duration)) / 60;

    const hasContent = task || (dateCell && dateCell !== '-//-') || (hours && hours > 0);
    if (!hasContent) continue;
    if (!task && !(hours > 0)) continue;

    const flags = [];
    let parsed = parseDate(dateCell, block.month);
    let date;
    if (parsed && parsed.date) {
      date = parsed.date;
      flags.push(...parsed.flags);
    } else {
      if (parsed) flags.push(...parsed.flags);
      date = prevDate || `${block.month}-01`;
    }
    if (date.slice(0, 7) !== block.month) {
      flags.push(`date is in ${date.slice(0, 7)} but the sheet counted it in ${block.month}`);
    }
    if (!(hours > 0)) flags.push('no duration in the sheet');
    prevDate = date;

    const minutes = Math.round((hours || 0) * 60 * 100) / 100;
    block.rows += 1;
    block.hours += hours || 0;
    entries.push({
      date,
      month: block.month,
      task,
      start: normTime(c(C.start)),
      finish: normTime(c(C.finish)),
      minutes,
      flag: flags.join('; '),
      source: `${path.basename(file)} row ${sheetRow}`,
    });
  }
  return { entries, expenses, blocks };
}

// ---------------------------------------------------------------- run
const all = { entries: [], expenses: [], blocks: [] };
for (const tab of TABS) {
  const file = path.join(folder, tab.file);
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}`);
    process.exit(1);
  }
  const r = parseTab(file, tab.firstMonth);
  all.entries.push(...r.entries);
  all.expenses.push(...r.expenses);
  all.blocks.push(...r.blocks);
}

// Freeze closed months exactly as they were paid: store a manual "hours to be paid"
// wherever the sheet paid something other than the sum of the rows.
const months = {};
for (const b of all.blocks) {
  const rowsHours = Math.round(b.hours * 10000) / 10000;
  if (b.month >= today) continue;
  if (Math.abs(rowsHours - b.sheetToBePaid) > 0.0005) {
    const doc = { hoursToBePaid: b.sheetToBePaid };
    if (Math.abs(rowsHours - b.sheetTotal) > 0.0005) {
      doc.note = `Sheet total ${b.sheetTotal} h but the rows add up to ${round2(rowsHours)} h – check`;
    } else {
      doc.note = `Sheet paid ${b.sheetToBePaid} h of ${round2(rowsHours)} h worked`;
    }
    months[b.month] = doc;
  }
}

const settings = structuredClone(DEFAULT_SETTINGS);
const seed = {
  format: 'scigen-payroll-seed',
  version: 1,
  generatedAt: new Date().toISOString(),
  settings,
  months,
  entries: all.entries,
  expenses: all.expenses,
};

const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'seed.json');
fs.writeFileSync(outFile, JSON.stringify(seed, null, 2));

// ---------------------------------------------------------------- report
const agg = aggregateMonths(seed.entries, seed.months, settings);
const t = totals(agg, seed.expenses, settings);
const lines = [];
lines.push('Month     rows  sheet-total  rows-total  to-be-paid  pay       sheet-pay  status');
for (const b of all.blocks) {
  const a = agg.find((x) => x.month === b.month);
  const ok = Math.abs(a.pay - b.sheetPay) < 0.005 ? 'ok' : `PAY DIFFERS`;
  const hoursNote = Math.abs(a.totalHours - b.sheetTotal) > 0.0005 ? ' (hours differ from sheet)' : '';
  lines.push(
    `${b.month}  ${String(a.entries).padStart(4)}  ${String(round2(b.sheetTotal)).padStart(11)}  ${String(round2(a.totalHours)).padStart(10)}  ${String(a.hoursToBePaid).padStart(10)}${a.hoursManual ? '*' : ' '} ${String(a.pay).padStart(8)}  ${String(b.sheetPay).padStart(9)}  ${ok}${hoursNote}`,
  );
}
lines.push('* = manual value stored in the month (closed month paid differently from the rows)');
lines.push('');
lines.push(`Entries: ${seed.entries.length}   Expenses: ${seed.expenses.length}   Months with manual values: ${Object.keys(months).length}`);
lines.push('');
lines.push('Flagged rows (fix them later in the Work log → "Flagged" filter):');
for (const e of seed.entries.filter((x) => x.flag)) lines.push(`  ${e.source.padEnd(22)} ${e.date}  ${e.flag}`);
lines.push('');
lines.push('Expenses:');
for (const x of seed.expenses) lines.push(`  ${x.date ?? '????-??-??'}  ${String(x.amount).padStart(8)}  ${x.description}`);
lines.push('');
lines.push(`Total ${t.earned} / Paid ${t.paid} / Remaining ${t.remaining}`);
const report = lines.join('\n');
fs.writeFileSync(path.join(outDir, 'seed.report.txt'), report + '\n');
console.log(report);
console.log(`\nWrote ${outFile}`);
