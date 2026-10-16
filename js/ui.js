import { esc, todayISO } from './format.js';
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

// ---------------------------------------------------------------- entry form
export function entryFieldsHTML(e = {}, { showMonth = false, defaultDate = todayISO() } = {}) {
  const date = e.date || defaultDate;
  return `
    <div class="grid-form">
      <label class="f-date">Date<input type="date" name="date" value="${esc(date)}" required></label>
      <label class="f-start">Start<input type="time" name="start" value="${esc(e.start || '')}"></label>
      <label class="f-finish">Finish<input type="time" name="finish" value="${esc(e.finish || '')}"></label>
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
  const start = form.elements.start;
  const finish = form.elements.finish;
  const minutes = form.elements.minutes;
  const date = form.elements.date;
  const month = form.elements.month;
  let manual = minutes.value !== '' && minutesBetween(start.value, finish.value) !== Number(minutes.value);
  const recalc = () => {
    if (manual) return;
    const m = minutesBetween(start.value, finish.value);
    minutes.value = m === null ? '' : m;
  };
  start.addEventListener('input', recalc);
  finish.addEventListener('input', recalc);
  minutes.addEventListener('input', () => { manual = minutes.value !== ''; });
  if (month) {
    let lastDateMonth = monthOf(date.value);
    date.addEventListener('change', () => {
      if (month.value === lastDateMonth) month.value = monthOf(date.value);
      lastDateMonth = monthOf(date.value);
    });
  }
}

export function readEntryForm(form, original = {}) {
  const f = form.elements;
  const date = f.date.value;
  let minutes = f.minutes.value === '' ? minutesBetween(f.start.value, f.finish.value) : Number(f.minutes.value);
  if (minutes === null || !Number.isFinite(minutes)) throw new Error('Enter start and finish, or the minutes.');
  if (!date) throw new Error('Pick a date.');
  minutes = Math.round(minutes * 100) / 100;
  const flag = f.clearFlag && f.clearFlag.checked ? '' : (original.flag || '');
  return {
    date,
    month: f.month ? f.month.value : monthOf(date),
    task: f.task.value.trim(),
    start: f.start.value,
    finish: f.finish.value,
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
