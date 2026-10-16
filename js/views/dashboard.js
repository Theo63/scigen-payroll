import { esc, monthLabel, dateLabel, todayISO } from '../format.js';

import { entryFieldsHTML, wireEntryForm, readEntryForm, busy, $ } from '../ui.js';

export default {
  mount(el, ctx) {
    el.innerHTML = `
      <section class="view dashboard">
        <div class="kpis" data-slot="kpis"></div>
        <div data-slot="empty"></div>
        <div class="two-col">
          <article class="card">
            <header class="card-head"><h2 data-slot="month-title">This month</h2>
              <a class="link" data-slot="month-link" href="#/log">Open work log →</a></header>
            <div data-slot="thismonth"></div>
            <form class="quick-add" autocomplete="off">
              <h3>Quick add</h3>
              ${entryFieldsHTML({}, { defaultDate: todayISO() })}
              <div class="form-actions"><button class="btn primary" type="submit">Add entry</button></div>
            </form>
          </article>
          <article class="card">
            <header class="card-head"><h2>Latest entries</h2></header>
            <div data-slot="recent"></div>
          </article>
        </div>
        <div class="years" data-slot="years"></div>
        <article class="card">
          <header class="card-head"><h2>Months</h2><span class="muted small">Click a month to open it</span></header>
          <div class="table-wrap" data-slot="months"></div>
        </article>
      </section>`;
    const form = $(el, '.quick-add');
    wireEntryForm(form);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector('[type=submit]');
      await busy(btn, async () => {
        const entry = readEntryForm(form);
        await ctx.store.addEntry(entry);
        form.reset();
        form.elements.date.value = todayISO();
      }, 'Entry added');
    });
    this.update(el, ctx);
  },

  update(el, ctx) {
    const { summary, fmt, data, settings, today } = ctx;
    const t = summary.totals;
    const firstMonth = summary.months[0] ? summary.months[0].month : null;

    $(el, '[data-slot=kpis]').innerHTML = `
      <div class="kpi">
        <span class="kpi-label">Earned</span>
        <span class="kpi-value">${fmt.money(t.earned)}</span>
        <span class="kpi-sub">${firstMonth ? `since ${monthLabel(firstMonth, true)} · ` : ''}${fmt.hoursRound(t.hours)} worked</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">Paid (expenses)</span>
        <span class="kpi-value">${fmt.money(t.paid)}</span>
        <span class="kpi-sub">${data.expenses.length} expense${data.expenses.length === 1 ? '' : 's'}${settings.opening.paid ? ` + opening ${fmt.money(settings.opening.paid)}` : ''}</span>
      </div>
      <div class="kpi kpi-accent ${t.remaining < 0 ? 'neg' : ''}">
        <span class="kpi-label">Remaining</span>
        <span class="kpi-value">${fmt.money(t.remaining)}</span>
        <span class="kpi-sub">${settings.subtractExpenses ? 'earned minus paid' : 'expenses not subtracted'}</span>
      </div>`;

    $(el, '[data-slot=empty]').innerHTML = !data.entries.length && !data.expenses.length ? `
      <div class="card notice">
        <h2>No data yet</h2>
        <p>Import the history from your Google Sheet in <a href="#/settings">Settings → Data</a>, or start adding entries below.</p>
      </div>` : '';

    // This month
    const m = summary.months.find((r) => r.month === today) || {
      month: today, entries: 0, totalHours: 0, hoursToBePaid: 0, hoursManual: false,
      rate: ctx.rateFor(today), rateManual: false, pay: 0,
    };
    $(el, '[data-slot=month-title]').textContent = monthLabel(today);
    $(el, '[data-slot=month-link]').setAttribute('href', `#/log/${today}`);
    $(el, '[data-slot=thismonth]').innerHTML = `
      <dl class="stats">
        <div><dt>Hours worked</dt><dd>${fmt.hours(m.totalHours)}</dd></div>
        <div><dt>Hours to be paid</dt><dd>${fmt.hours(m.hoursToBePaid)}${m.hoursManual ? ' <span class="badge">manual</span>' : ''}</dd></div>
        <div><dt>Rate</dt><dd>${fmt.money(m.rate)}/h${m.rateManual ? ' <span class="badge">manual</span>' : ''}</dd></div>
        <div><dt>Pay</dt><dd class="strong">${fmt.money(m.pay)}</dd></div>
      </dl>`;

    // Latest entries
    const recent = [...data.entries]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.start || '').localeCompare(a.start || ''))
      .slice(0, 6);
    $(el, '[data-slot=recent]').innerHTML = recent.length ? `
      <ul class="recent">
        ${recent.map((e) => `
          <li><a href="#/log/${esc(e.month)}">
            <span class="recent-date">${esc(dateLabel(e.date))}</span>
            <span class="recent-task">${esc(e.task || '—')}</span>
            <span class="recent-dur">${fmt.hours(e.minutes / 60)}</span>
          </a></li>`).join('')}
      </ul>` : '<p class="muted">No entries yet.</p>';

    // Contract years
    const yearsEl = $(el, '[data-slot=years]');
    if (settings.showYearCards && summary.years.length) {
      yearsEl.innerHTML = summary.years.map((y) => `
        <article class="card year">
          <header class="card-head"><h2>Year ${y.index}</h2>
            <span class="muted small">${monthLabel(y.start, true)} – ${monthLabel(y.end, true)}</span></header>
          <dl class="stats">
            <div><dt>Hours</dt><dd>${fmt.hoursRound(y.hours)}</dd></div>
            <div><dt>Earned</dt><dd>${fmt.money(y.pay)}</dd></div>
            <div><dt>Expenses</dt><dd>${fmt.money(y.expenses)}</dd></div>
            ${settings.showYearAverage ? `<div><dt>Avg / month</dt><dd>${fmt.money(y.avgMonthlyPay)} <span class="muted small">over ${y.monthsElapsed} mo</span></dd></div>` : ''}
          </dl>
        </article>`).join('');
    } else {
      yearsEl.innerHTML = '';
    }

    // Months table, newest first
    const rows = [...summary.months].reverse();
    $(el, '[data-slot=months]').innerHTML = rows.length ? `
      <table class="table months-table">
        <thead><tr><th>Month</th><th class="num">Entries</th><th class="num">Hours worked</th>
          <th class="num">Hours paid</th><th class="num">Rate</th><th class="num">Pay</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
            <tr class="clickable ${r.month === today ? 'current' : ''}" data-href="#/log/${r.month}" title="${esc(r.note)}">
              <td>${monthLabel(r.month)}${r.note ? ' <span class="badge warn" title="' + esc(r.note) + '">note</span>' : ''}</td>
              <td class="num">${r.entries}</td>
              <td class="num">${fmt.hoursPlain(r.totalHours)}</td>
              <td class="num">${fmt.hoursPlain(r.hoursToBePaid)}${r.hoursManual ? '<sup title="manual value">*</sup>' : ''}</td>
              <td class="num">${fmt.money(r.rate)}${r.rateManual ? '<sup title="manual value">*</sup>' : ''}</td>
              <td class="num strong">${fmt.money(r.pay)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="muted small">* manual value set for that month</p>` : '<p class="muted">Nothing yet.</p>';
    el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  },
};

