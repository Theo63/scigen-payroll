import { esc, dateLabel, todayISO, monthLabel } from '../format.js';
import { contractYearStart, addMonths, monthOf } from '../calc.js';
import { busy, openDialog, $ } from '../ui.js';

function expenseFieldsHTML(x = {}) {
  return `
    <div class="grid-form expense-form">
      <label class="f-date">Date<input type="date" name="date" value="${esc(x.date || todayISO())}" required></label>
      <label class="f-amount">Amount<input type="number" name="amount" step="0.01" inputmode="decimal" value="${x.amount ?? ''}" required></label>
      <label class="f-desc">What<input type="text" name="description" value="${esc(x.description || '')}" placeholder="e.g. MacBook Air" required></label>
    </div>`;
}

function readExpenseForm(form) {
  const f = form.elements;
  const amount = Number(f.amount.value);
  if (!f.date.value) throw new Error('Pick a date.');
  if (!Number.isFinite(amount) || f.amount.value === '') throw new Error('Enter an amount.');
  return { date: f.date.value, amount, description: f.description.value.trim() };
}

export default {
  mount(el, ctx) {
    el.innerHTML = `
      <section class="view expenses">
        <div class="toolbar"><h1>Expenses</h1><span class="spacer"></span>
          <span class="muted" data-slot="headline"></span></div>
        <article class="card">
          <header class="card-head"><h2>Add expense</h2>
            <span class="muted small">Purchases paid from what you are owed. They are subtracted from the remaining amount.</span></header>
          <form class="add-form" autocomplete="off">
            ${expenseFieldsHTML()}
            <div class="form-actions"><button class="btn primary" type="submit">Add expense</button></div>
          </form>
        </article>
        <article class="card"><div class="table-wrap" data-slot="table"></div></article>
      </section>`;

    const form = $(el, '.add-form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await busy(form.querySelector('[type=submit]'), async () => {
        await ctx.store.addExpense(readExpenseForm(form));
        form.reset();
        form.elements.date.value = todayISO();
      }, 'Expense added');
    });

    $(el, '[data-slot=table]').addEventListener('click', (ev) => {
      const row = ev.target.closest('tr[data-id]');
      if (row) this.edit(row.dataset.id);
    });
    this.update(el, ctx);
  },

  update(el, ctx) {
    this.ctx = ctx;
    const { fmt, settings } = ctx;
    const list = [...ctx.data.expenses].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const total = list.reduce((a, x) => a + (Number(x.amount) || 0), 0);
    $(el, '[data-slot=headline]').innerHTML = `Total paid <strong>${fmt.money(total + (Number(settings.opening.paid) || 0))}</strong>`;

    const target = $(el, '[data-slot=table]');
    if (!list.length) {
      target.innerHTML = '<p class="muted empty">No expenses yet.</p>';
      return;
    }
    // Group by contract year, newest first, with a subtotal per year.
    const groups = new Map();
    for (const x of list) {
      const key = contractYearStart(monthOf(x.date), settings.yearStartMonth);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(x);
    }
    target.innerHTML = `
      <table class="table expense-table">
        <thead><tr><th>Date</th><th>What</th><th class="num">Amount</th></tr></thead>
        ${[...groups.entries()].map(([start, rows]) => `
          <tbody>
            <tr class="group-row"><th colspan="2">${monthLabel(start, true)} – ${monthLabel(addMonths(start, 11), true)}</th>
              <th class="num">${fmt.money(rows.reduce((a, x) => a + (Number(x.amount) || 0), 0))}</th></tr>
            ${rows.map((x) => `
              <tr class="clickable" data-id="${esc(x.id)}" tabindex="0">
                <td>${esc(dateLabel(x.date, true))}</td>
                <td>${esc(x.description || '—')}</td>
                <td class="num">${fmt.money(x.amount)}</td>
              </tr>`).join('')}
          </tbody>`).join('')}
        <tfoot><tr><td colspan="2">${list.length} expense${list.length === 1 ? '' : 's'}${settings.opening.paid ? ` + opening ${fmt.money(settings.opening.paid)}` : ''}</td>
          <td class="num strong">${fmt.money(total)}</td></tr></tfoot>
      </table>`;
    target.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this.edit(tr.dataset.id);
    }));
  },

  edit(id) {
    const ctx = this.ctx;
    const x = ctx.data.expenses.find((e) => e.id === id);
    if (!x) return;
    openDialog({
      title: 'Edit expense',
      body: expenseFieldsHTML(x),
      onSubmit: (form) => ctx.store.updateExpense(id, readExpenseForm(form)),
      danger: { label: 'Delete', confirm: `Delete “${x.description}”?`, onClick: () => ctx.store.deleteExpense(id) },
    });
  },
};
