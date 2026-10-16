import { esc, monthLabel, dateLabel, weekdayLabel, todayISO } from '../format.js';
import { addMonths, monthOf } from '../calc.js';
import { entryFieldsHTML, wireEntryForm, readEntryForm, busy, openDialog, $ } from '../ui.js';

const sortEntries = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.start || '').localeCompare(b.start || '');

function defaultDateFor(month) {
  const today = todayISO();
  return monthOf(today) === month ? today : `${month}-01`;
}

export default {
  mount(el, ctx) {
    const mode = ctx.param === 'flagged' ? 'flagged' : 'month';
    const month = /^\d{4}-\d{2}$/.test(ctx.param || '') ? ctx.param : ctx.today;
    this.state = { mode, month, query: '', summaryDirty: false };

    el.innerHTML = `
      <section class="view worklog">
        <div class="toolbar">
          ${mode === 'month' ? `
            <div class="month-nav">
              <a class="icon-btn" href="#/log/${addMonths(month, -1)}" aria-label="Previous month">‹</a>
              <h1>${monthLabel(month)}</h1>
              <a class="icon-btn" href="#/log/${addMonths(month, 1)}" aria-label="Next month">›</a>
            </div>
            <input type="month" class="month-pick" value="${month}" aria-label="Jump to month">
            ${month !== ctx.today ? `<a class="btn ghost small" href="#/log/${ctx.today}">This month</a>` : ''}
          ` : `
            <div class="month-nav"><a class="icon-btn" href="#/log/${ctx.today}" aria-label="Back">‹</a><h1>Flagged entries</h1></div>
          `}
          <span class="spacer"></span>
          <input type="search" class="search" placeholder="Search all tasks…" aria-label="Search all tasks">
          <a class="chip ${mode === 'flagged' ? 'active' : ''}" data-slot="flag-chip" href="#/log/flagged">⚠ Flagged</a>
        </div>

        ${mode === 'month' ? `
        <article class="card month-summary">
          <form data-slot="summary" autocomplete="off"></form>
        </article>
        <details class="card add-card" ${month === ctx.today ? 'open' : ''}>
          <summary><h2>Add entry</h2></summary>
          <form class="add-form" autocomplete="off">
            ${entryFieldsHTML({}, { defaultDate: defaultDateFor(month) })}
            <div class="form-actions"><button class="btn primary" type="submit">Add entry</button></div>
          </form>
        </details>` : `
        <p class="muted">Rows the import could not read cleanly, or that you flagged. Open one to fix it and tick “Clear this flag”.</p>`}

        <article class="card">
          <div class="table-wrap" data-slot="table"></div>
        </article>
      </section>`;

    const pick = $(el, '.month-pick');
    if (pick) pick.addEventListener('change', () => { if (pick.value) location.hash = `#/log/${pick.value}`; });

    const search = $(el, '.search');
    search.addEventListener('input', () => {
      this.state.query = search.value.trim();
      this.renderTable(el, ctx);
    });

    const add = $(el, '.add-form');
    if (add) {
      wireEntryForm(add);
      add.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        await busy(add.querySelector('[type=submit]'), async () => {
          const entry = readEntryForm(add);
          await ctx.store.addEntry(entry);
          const keepDate = add.elements.date.value;
          add.reset();
          add.elements.date.value = keepDate;
          add.elements.start.focus();
        }, 'Entry added');
      });
    }

    const summary = $(el, '[data-slot=summary]');
    if (summary) {
      summary.addEventListener('input', () => { this.state.summaryDirty = true; });
      summary.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const f = summary.elements;
        await busy(summary.querySelector('[type=submit]'), async () => {
          await ctx.store.saveMonth(this.state.month, { hoursToBePaid: f.hoursToBePaid.value, rate: f.rate.value, note: f.note.value.trim() });
          this.state.summaryDirty = false;
          this.renderSummary(el, this.ctx);
        }, 'Month saved');
      });
      summary.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-action=clear-month]');
        if (!btn) return;
        await busy(btn, async () => {
          await ctx.store.saveMonth(this.state.month, {});
          this.state.summaryDirty = false;
          this.renderSummary(el, this.ctx);
        }, 'Manual values cleared');
      });
    }

    $(el, '[data-slot=table]').addEventListener('click', (ev) => {
      const row = ev.target.closest('tr[data-id]');
      if (row) this.editEntry(row.dataset.id, ctx);
    });

    this.ctx = ctx;
    this.update(el, ctx);
  },

  update(el, ctx) {
    this.ctx = ctx;
    const flagged = ctx.data.entries.filter((e) => e.flag).length;
    $(el, '[data-slot=flag-chip]').textContent = `⚠ Flagged (${flagged})`;
    if (this.state.mode === 'month') this.renderSummary(el, ctx);
    this.renderTable(el, ctx);
  },

  renderSummary(el, ctx) {
    const form = $(el, '[data-slot=summary]');
    if (!form) return;
    if (this.state.summaryDirty) return;
    const { fmt } = ctx;
    const month = this.state.month;
    const doc = ctx.data.months[month] || {};
    const row = ctx.summary.months.find((r) => r.month === month) || {
      totalHours: 0, hoursToBePaid: 0, rate: ctx.rateFor(month), pay: 0, entries: 0,
    };
    const autoRate = ctx.rateFor(month);
    const hasManual = doc.hoursToBePaid !== undefined || doc.rate !== undefined || doc.note;
    form.innerHTML = `
      <div class="summary-grid">
        <div class="stat"><span class="stat-label">Hours worked</span><span class="stat-value">${fmt.hours(row.totalHours)}</span>
          <span class="muted small">${row.entries} entr${row.entries === 1 ? 'y' : 'ies'}</span></div>
        <label class="stat">Hours to be paid
          <input type="number" name="hoursToBePaid" step="any" min="0" inputmode="decimal"
            value="${doc.hoursToBePaid ?? ''}" placeholder="${fmt.hoursPlain(row.totalHours)} (all)">
          <span class="muted small">${doc.hoursToBePaid !== undefined ? 'manual value' : 'empty = all hours worked'}</span></label>
        <label class="stat">Rate / h
          <input type="number" name="rate" step="any" min="0" inputmode="decimal" value="${doc.rate ?? ''}" placeholder="${autoRate}">
          <span class="muted small">${doc.rate !== undefined ? 'manual value' : 'from Settings'}</span></label>
        <div class="stat stat-pay"><span class="stat-label">Pay</span><span class="stat-value">${fmt.money(row.pay)}</span>
          <span class="muted small">${fmt.hoursPlain(row.hoursToBePaid)} h × ${fmt.money(row.rate)}</span></div>
        <label class="stat stat-note">Note<input type="text" name="note" value="${esc(doc.note || '')}" placeholder="Optional"></label>
      </div>
      <div class="form-actions">
        ${hasManual ? '<button type="button" class="btn ghost small" data-action="clear-month">Clear manual values</button>' : ''}
        <button type="submit" class="btn small">Save month</button>
      </div>`;
  },

  renderTable(el, ctx) {
    const { fmt, settings } = ctx;
    const q = this.state.query.toLowerCase();
    let list;
    let crossMonth = false;
    if (q.length >= 2) {
      list = ctx.data.entries.filter((e) => (e.task || '').toLowerCase().includes(q));
      crossMonth = true;
    } else if (this.state.mode === 'flagged') {
      list = ctx.data.entries.filter((e) => e.flag);
      crossMonth = true;
    } else {
      list = ctx.data.entries.filter((e) => (e.month || monthOf(e.date)) === this.state.month);
    }
    list.sort(sortEntries);

    const both = settings.durationDisplay === 'minutes+hours';
    const target = $(el, '[data-slot=table]');
    if (!list.length) {
      target.innerHTML = `<p class="muted empty">${q.length >= 2 ? 'No task matches that search.' : this.state.mode === 'flagged' ? 'Nothing flagged. 🎉' : 'No entries in this month yet.'}</p>`;
      return;
    }
    let lastDate = null;
    const totalMin = list.reduce((a, e) => a + (Number(e.minutes) || 0), 0);
    target.innerHTML = `
      <table class="table log-table">
        <thead><tr>
          <th class="c-date">Date</th><th class="c-task">Task</th><th class="c-time">Start</th><th class="c-time">Finish</th>
          ${both ? '<th class="num">Min</th><th class="num">Hours</th>' : '<th class="num">Duration</th>'}
        </tr></thead>
        <tbody>
          ${list.map((e) => {
            const showDate = crossMonth || e.date !== lastDate;
            lastDate = e.date;
            const otherMonth = (e.month || monthOf(e.date)) !== monthOf(e.date);
            return `
            <tr class="clickable ${showDate ? 'new-day' : ''}" data-id="${esc(e.id)}" tabindex="0">
              <td class="c-date">${showDate ? `<span class="wd">${esc(weekdayLabel(e.date))}</span> ${esc(dateLabel(e.date))}` : ''}
                ${otherMonth ? `<span class="badge warn" title="Counted in ${esc(monthLabel(e.month))}">→ ${esc(monthLabel(e.month, true))}</span>` : ''}</td>
              <td class="c-task">${e.flag ? `<span class="flag" title="${esc(e.flag)}">⚠</span> ` : ''}${esc(e.task || '—')}
                ${e.flag && crossMonth ? `<div class="muted small">${esc(e.flag)}</div>` : ''}</td>
              <td class="c-time">${esc(e.start || '')}</td>
              <td class="c-time">${esc(e.finish || '')}</td>
              ${both
                ? `<td class="num">${fmt.hoursPlain(e.minutes)}</td><td class="num">${fmt.hoursPlain(e.minutes / 60)}</td>`
                : `<td class="num">${esc(fmt.duration(e.minutes))}</td>`}
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="4">${list.length} entr${list.length === 1 ? 'y' : 'ies'}</td>
          ${both ? `<td class="num">${fmt.hoursPlain(totalMin)}</td><td class="num strong">${fmt.hoursPlain(totalMin / 60)}</td>`
                 : `<td class="num strong">${esc(fmt.duration(totalMin))}</td>`}
        </tr></tfoot>
      </table>`;
    target.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this.editEntry(tr.dataset.id, ctx);
    }));
  },

  editEntry(id, ctx) {
    const entry = this.ctx.data.entries.find((e) => e.id === id);
    if (!entry) return;
    openDialog({
      title: `Edit entry · ${dateLabel(entry.date)}`,
      body: entryFieldsHTML(entry, { showMonth: true }),
      onOpen: (form) => wireEntryForm(form),
      onSubmit: async (form) => {
        await ctx.store.updateEntry(id, readEntryForm(form, entry));
      },
      danger: {
        label: 'Delete',
        confirm: 'Delete this entry?',
        onClick: () => ctx.store.deleteEntry(id),
      },
    });
  },
};
