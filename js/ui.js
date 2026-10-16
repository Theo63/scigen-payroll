import { esc, todayISO, dateLabel, parseDMY, parseTime24 } from './format.js';
import { minutesBetween, monthOf } from './calc.js';

// ---------------------------------------------------------------- toast
let toastTimer;
export function toast(message, kind = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 6000 : 2800);
}

/** Runs an async action, shows a toast on failure, disables the button meanwhile. */
export async function busy(button, fn, okMessage) {
  if (button) button.disabled = true;
  try {
    const r = await fn();
    if (okMessage) toast(okMessage);
    return r;
  } catch (err) {
    console.error(err);
    toast(friendlyError(err), 'error');
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

export function friendlyError(err) {
  if (err instanceof TypeError && /fetch/i.test(err.message)) return 'No connection to GitHub. Check your internet connection and try again.';
  return (err && err.message) || 'Something went wrong.';
}

// ---------------------------------------------------------------- dialog
/**
 * Opens the shared <dialog>. `body` is HTML for the form contents.
 * onSubmit(form) may return false to keep the dialog open.
 */
export function openDialog({ title, body, submitLabel = 'Save', danger = null, onSubmit, onOpen }) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = `
    <form method="dialog" class="dlg-form">
      <header class="dlg-head"><h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
      <div class="dlg-body">${body}</div>
      <footer class="dlg-foot">
        ${danger ? `<button type="button" class="btn danger ghost" data-danger>${esc(danger.label)}</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-close>Cancel</button>
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </footer>
    </form>`;
  const form = dlg.querySelector('form');
  const close = () => dlg.close();
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  if (danger) {
    dlg.querySelector('[data-danger]').addEventListener('click', async (ev) => {
      if (!confirm(danger.confirm || 'Are you sure?')) return;
      const ok = await busy(ev.currentTarget, async () => (await danger.onClick()) !== false);
      if (ok === true) close();
    });
  }
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const ok = await busy(btn, async () => (await onSubmit(form)) !== false);
    if (ok === true) close();
  });
  dlg.showModal();
  if (onOpen) onOpen(form);
  const first = form.querySelector('input, textarea, select');
  if (first) first.focus();
  return dlg;
}

// ---------------------------------------------------------------- date / time fields
// Typed fields so the format never depends on the computer's region settings:
// dates are always dd/mm/yyyy and times always 24-hour HH:MM.
const CAL_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg>';

/** Date field showing dd/mm/yyyy; `iso` is "YYYY-MM-DD". */
export function dateFieldHTML(name, iso, { required = true } = {}) {
  return `
    <span class="date-wrap">
      <input type="text" name="${name}" value="${esc(iso ? dateLabel(iso) : '')}" placeholder="dd/mm/yyyy"
        inputmode="numeric" autocomplete="off" maxlength="10" data-date ${required ? 'required' : ''}>
      <button type="button" class="cal-btn" data-cal aria-label="Pick a date">${CAL_ICON}</button>
      <input type="date" class="native-picker" tabindex="-1" aria-hidden="true">
    </span>`;
}

export function timeFieldHTML(name, value) {
  return `<input type="text" name="${name}" value="${esc(value || '')}" placeholder="HH:MM" inputmode="numeric"
    autocomplete="off" data-time>`;
}

/** Normalises typed dates/times on blur and wires the calendar buttons. */
export function wireDateTime(form) {
  form.querySelectorAll('input[data-date]').forEach((input) => {
    const fix = () => {
      const iso = parseDMY(input.value);
      if (iso) input.value = dateLabel(iso);
      const bad = input.value.trim() !== '' && !iso;
      input.setCustomValidity(bad ? 'Write the date as dd/mm/yyyy' : '');
      input.classList.toggle('invalid', bad);
    };
    input.addEventListener('blur', fix);
    input.addEventListener('input', () => { input.classList.remove('invalid'); input.setCustomValidity(''); });
    const wrap = input.closest('.date-wrap');
    const picker = wrap.querySelector('.native-picker');
    wrap.querySelector('[data-cal]').addEventListener('click', () => {
      picker.value = parseDMY(input.value) || todayISO();
      try {
        if (picker.showPicker) picker.showPicker(); else picker.click();
      } catch { picker.click(); }
    });
    picker.addEventListener('change', () => {
      if (!picker.value) return;
      input.value = dateLabel(picker.value);
      fix();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  form.querySelectorAll('input[data-time]').forEach((input) => {
    input.addEventListener('blur', () => {
      const t = parseTime24(input.value);
      if (t) input.value = t;
      const bad = t === null;
      input.setCustomValidity(bad ? 'Write the time as HH:MM (24-hour)' : '');
      input.classList.toggle('invalid', bad);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    input.addEventListener('input', (ev) => {
      if (!ev.isTrusted) return;
      input.classList.remove('invalid');
      input.setCustomValidity('');
    });
  });
}

/** Reads a date field; throws a readable error when it is not dd/mm/yyyy. */
export function readDate(input) {
  const iso = parseDMY(input.value);
  if (!iso) throw new Error(input.value.trim() ? `“${input.value}” is not a date. Write it as dd/mm/yyyy.` : 'Enter a date (dd/mm/yyyy).');
  return iso;
}

function readTime(input, label) {
  const t = parseTime24(input.value);
  if (t === null) throw new Error(`${label} “${input.value}” is not a time. Write it as HH:MM in 24-hour format, e.g. 14:30.`);
  return t;
}

// ---------------------------------------------------------------- entry form
export function entryFieldsHTML(e = {}, { showMonth = false, defaultDate = todayISO() } = {}) {
  const date = e.date || defaultDate;
  return `
    <div class="grid-form">
      <label class="f-date">Date${dateFieldHTML('date', date)}</label>
      <label class="f-start">Start${timeFieldHTML('start', e.start)}</label>
      <label class="f-finish">Finish${timeFieldHTML('finish', e.finish)}</label>
      <label class="f-min">Minutes<input type="number" name="minutes" min="0" max="4320" step="any" inputmode="decimal"
        value="${e.minutes ?? ''}" placeholder="auto" required></label>
      <label class="f-task">Task<textarea name="task" rows="${e.task && e.task.length > 160 ? 5 : 2}" placeholder="What did you work on?">${esc(e.task || '')}</textarea></label>
      ${showMonth ? `
      <label class="f-month">Counted in month<input type="month" name="month" value="${esc(e.month || monthOf(date))}" required>
        <small>Normally the month of the date.</small></label>` : ''}
      ${e.flag ? `
      <div class="f-flag flag-box"><strong>⚠ Flag:</strong> ${esc(e.flag)}
        <label class="check"><input type="checkbox" name="clearFlag"> Clear this flag</label></div>` : ''}
    </div>`;
}

/** Keeps minutes in sync with start/finish until the user types minutes by hand. */
export function wireEntryForm(form) {
  wireDateTime(form);
  const start = form.elements.start;
  const finish = form.elements.finish;
  const minutes = form.elements.minutes;
  const date = form.elements.date;
  const month = form.elements.month;
  const span = () => minutesBetween(parseTime24(start.value) || '', parseTime24(finish.value) || '');
  let manual = minutes.value !== '' && span() !== Number(minutes.value);
  const recalc = () => {
    if (manual) return;
    const m = span();
    minutes.value = m === null ? '' : m;
  };
  start.addEventListener('input', recalc);
  finish.addEventListener('input', recalc);
  minutes.addEventListener('input', () => { manual = minutes.value !== ''; });
  if (month) {
    let lastDateMonth = monthOf(parseDMY(date.value) || '');
    const sync = () => {
      const iso = parseDMY(date.value);
      if (!iso) return;
      if (month.value === lastDateMonth) month.value = monthOf(iso);
      lastDateMonth = monthOf(iso);
    };
    date.addEventListener('change', sync);
    date.addEventListener('blur', sync);
  }
}

export function readEntryForm(form, original = {}) {
  const f = form.elements;
  const date = readDate(f.date);
  const start = readTime(f.start, 'Start');
  const finish = readTime(f.finish, 'Finish');
  let minutes = f.minutes.value === '' ? minutesBetween(start, finish) : Number(f.minutes.value);
  if (minutes === null || !Number.isFinite(minutes)) throw new Error('Enter start and finish (HH:MM), or the minutes.');
  minutes = Math.round(minutes * 100) / 100;
  const flag = f.clearFlag && f.clearFlag.checked ? '' : (original.flag || '');
  return {
    date,
    month: f.month ? f.month.value : monthOf(date),
    task: f.task.value.trim(),
    start,
    finish,
    minutes,
    flag,
  };
}

// ---------------------------------------------------------------- misc
export function download(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

export function toCSV(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\n');
}

export const $ = (root, sel) => root.querySelector(sel);
