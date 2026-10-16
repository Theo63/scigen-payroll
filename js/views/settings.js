import { esc, monthLabel, todayISO, dateLabel, dateTimeLabel } from '../format.js';
import { withDefaults, monthOf } from '../calc.js';
import { busy, toast, download, toCSV, openDialog, $ } from '../ui.js';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function rateRow(r = {}) {
  return `
    <div class="rate-row">
      <label>From month<input type="month" name="from" value="${esc(r.from || monthOf(todayISO()))}" required></label>
      <label>Rate / hour<input type="number" name="rate" step="any" min="0" inputmode="decimal" value="${r.rate ?? ''}" required></label>
      <button type="button" class="icon-btn" data-action="remove-rate" aria-label="Remove">✕</button>
    </div>`;
}

const FORMS = {
  rates(s) {
    const rows = [...s.rates].sort((a, b) => a.from.localeCompare(b.from));
    return `
      <p class="muted small">The rate in force for a month is the last row whose “From month” is on or before it. Add a row when the rate changes; older months keep their old rate.</p>
      <div class="rate-rows">${rows.map(rateRow).join('')}</div>
      <div class="form-actions">
        <button type="button" class="btn ghost small" data-action="add-rate">+ Add rate change</button>
        <span class="spacer"></span><button type="submit" class="btn primary small">Save rates</button>
      </div>`;
  },
  display(s) {
    return `
      <div class="grid-form settings-grid">
        <label>Currency symbol<input type="text" name="symbol" maxlength="4" value="${esc(s.currency.symbol)}" required></label>
        <label>Symbol position<select name="position">
          <option value="before" ${s.currency.position === 'before' ? 'selected' : ''}>Before (€1,234.50)</option>
          <option value="after" ${s.currency.position === 'after' ? 'selected' : ''}>After (1,234.50 €)</option></select></label>
        <label>Decimals<select name="decimals">
          ${[0, 2].map((d) => `<option value="${d}" ${Number(s.currency.decimals) === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
        <label>Duration display<select name="durationDisplay">
          ${[['minutes+hours', 'Minutes and hours (like the sheet)'], ['minutes', 'Minutes'], ['hours', 'Decimal hours'], ['hmm', 'h:mm']]
            .map(([v, l]) => `<option value="${v}" ${s.durationDisplay === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Contract year starts in<select name="yearStartMonth">
          ${MONTH_NAMES.map((n, i) => `<option value="${i + 1}" ${Number(s.yearStartMonth) === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="checks">
        <label class="check"><input type="checkbox" name="subtractExpenses" ${s.subtractExpenses ? 'checked' : ''}> Subtract expenses from the remaining amount</label>
        <label class="check"><input type="checkbox" name="showYearCards" ${s.showYearCards ? 'checked' : ''}> Show contract-year cards on the dashboard</label>
        <label class="check"><input type="checkbox" name="showYearAverage" ${s.showYearAverage ? 'checked' : ''}> Show average monthly pay per year</label>
      </div>
      <div class="form-actions"><span class="spacer"></span><button type="submit" class="btn primary small">Save display</button></div>`;
  },
  opening(s) {
    return `
      <p class="muted small">Amounts from before this site’s records, added on top of everything else. Leave at 0 when the full history is imported.</p>
      <div class="grid-form settings-grid">
        <label>Opening earned<input type="number" name="total" step="0.01" inputmode="decimal" value="${s.opening.total ?? 0}"></label>
        <label>Opening paid<input type="number" name="paid" step="0.01" inputmode="decimal" value="${s.opening.paid ?? 0}"></label>
        <label>Label<input type="text" name="label" value="${esc(s.opening.label || '')}" placeholder="e.g. Carried over from the sheet"></label>
      </div>
      <div class="form-actions"><span class="spacer"></span><button type="submit" class="btn primary small">Save opening balance</button></div>`;
  },
};

const READ = {
  rates(form) {
    const rows = [...form.querySelectorAll('.rate-row')].map((r) => ({
      from: r.querySelector('[name=from]').value,
      rate: Number(r.querySelector('[name=rate]').value),
    }));
    if (!rows.length) throw new Error('Keep at least one rate.');
    if (rows.some((r) => !r.from || !Number.isFinite(r.rate))) throw new Error('Every rate row needs a month and a number.');
    if (new Set(rows.map((r) => r.from)).size !== rows.length) throw new Error('Two rate rows start in the same month.');
    return { rates: rows.sort((a, b) => a.from.localeCompare(b.from)) };
  },
  display(form) {
    const f = form.elements;
    return {
      currency: { symbol: f.symbol.value.trim() || '€', position: f.position.value, decimals: Number(f.decimals.value) },
      durationDisplay: f.durationDisplay.value,
      yearStartMonth: Number(f.yearStartMonth.value),
      subtractExpenses: f.subtractExpenses.checked,
      showYearCards: f.showYearCards.checked,
      showYearAverage: f.showYearAverage.checked,
    };
  },
  opening(form) {
    const f = form.elements;
    return { opening: { total: Number(f.total.value) || 0, paid: Number(f.paid.value) || 0, label: f.label.value.trim() } };
  },
};

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export default {
  mount(el, ctx) {
    this.dirty = {};
    this.lastSettings = '';
    el.innerHTML = `
      <section class="view settings">
        <div class="toolbar"><h1>Settings</h1></div>

        <article class="card"><header class="card-head"><h2>Hourly rate</h2></header>
          <form data-form="rates" autocomplete="off"></form></article>

        <article class="card"><header class="card-head"><h2>Money and display</h2></header>
          <form data-form="display" autocomplete="off"></form></article>

        <article class="card"><header class="card-head"><h2>Manual month values</h2></header>
          <p class="muted small">Months where “hours to be paid” or the rate was set by hand. Edit them from the month’s page in the work log.</p>
          <div class="table-wrap" data-slot="manual"></div></article>

        <article class="card"><header class="card-head"><h2>Opening balance</h2></header>
          <form data-form="opening" autocomplete="off"></form></article>

        <article class="card"><header class="card-head"><h2>Data</h2></header>
          <div class="data-actions">
            <button class="btn" data-action="export-json">Download full backup (JSON)</button>
            <button class="btn ghost" data-action="export-entries">Entries as CSV</button>
            <button class="btn ghost" data-action="export-expenses">Expenses as CSV</button>
          </div>
          <form class="import-form" data-slot="import">
            <h3>Import</h3>
            <p class="muted small">Load <code>data/seed.json</code> made by <code>npm run parse-sheet</code>, or a backup downloaded above.</p>
            <div class="import-row">
              <input type="file" name="file" accept="application/json,.json" required>
              <label class="check"><input type="checkbox" name="replace"> Replace existing data</label>
              <button type="submit" class="btn primary small">Import</button>
            </div>
            <p class="small" data-slot="import-status"></p>
          </form></article>

        <article class="card"><header class="card-head"><h2>Sign-in</h2></header>
          <div data-slot="auth-status"></div>
          <form data-slot="replace-token" autocomplete="off" class="token-form">
            <h3>Replace the GitHub token</h3>
            <p class="muted small">When the token expires or you make a new one. It needs Contents: Read and write on both <code>scigen-payroll-data</code> and <code>scigen-payroll</code>.</p>
            <div class="import-row">
              <input type="password" name="token" placeholder="github_pat_…" required autocomplete="off">
              <button type="submit" class="btn small">Replace token</button>
            </div>
          </form>
        </article>

        <article class="card"><header class="card-head"><h2>Accounts</h2></header>
          <p class="muted small">Each account has its own password. Both see and edit the same data. Every change is saved as a commit in the private <code>scigen-payroll-data</code> repository, so its history is kept there.</p>
          <div class="table-wrap" data-slot="accounts"></div>
          <div class="two-col account-forms">
            <form data-slot="add-account" autocomplete="off">
              <h3>Add an account</h3>
              <div class="grid-form settings-grid">
                <label>Account name<input type="text" name="name" required autocomplete="off"></label>
                <label>Password<input type="password" name="password" minlength="12" required autocomplete="new-password"></label>
                <label>Confirm password<input type="password" name="password2" minlength="12" required autocomplete="new-password"></label>
              </div>
              <p class="muted small">They can then sign in on any device with this name and password. Use at least 12 characters.</p>
              <div class="form-actions"><button type="submit" class="btn small">Add account</button></div>
            </form>
            <form data-slot="change-password" autocomplete="off">
              <h3>Change my password</h3>
              <div class="grid-form settings-grid">
                <label>New password<input type="password" name="password" minlength="12" required autocomplete="new-password"></label>
                <label>Confirm<input type="password" name="password2" minlength="12" required autocomplete="new-password"></label>
              </div>
              <p class="muted small">Works on every device right away. At least 12 characters.</p>
              <div class="form-actions"><button type="submit" class="btn small">Change password</button></div>
            </form>
          </div>
        </article>

        <article class="card"><header class="card-head"><h2>This device</h2></header>
          <div data-slot="account"></div></article>
      </section>`;

    for (const name of Object.keys(FORMS)) {
      const form = $(el, `[data-form=${name}]`);
      form.addEventListener('input', () => { this.dirty[name] = true; });
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        await busy(form.querySelector('[type=submit]'), async () => {
          await this.ctx.store.saveSettings(this.ctx.data.settings, READ[name](form));
          this.dirty[name] = false;
          this.lastSettings = '';
          this.update(el, this.ctx);
        }, 'Saved');
      });
    }
    const rates = $(el, '[data-form=rates]');
    rates.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-action]');
      if (!t) return;
      if (t.dataset.action === 'add-rate') {
        rates.querySelector('.rate-rows').insertAdjacentHTML('beforeend', rateRow({}));
        this.dirty.rates = true;
      } else if (t.dataset.action === 'remove-rate') {
        t.closest('.rate-row').remove();
        this.dirty.rates = true;
      }
    });

    el.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-action]');
      if (!t) return;
      const c = this.ctx;
      const stamp = todayISO();
      if (t.dataset.action === 'export-json') {
        download(`scigen-payroll-backup-${stamp}.json`, JSON.stringify(c.store.exportData(c.data), null, 2));
      } else if (t.dataset.action === 'export-entries') {
        const rows = [...c.data.entries].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.start || '').localeCompare(b.start || ''));
        download(`scigen-entries-${stamp}.csv`, toCSV([
          ['Date', 'Counted in month', 'Task', 'Start', 'Finish', 'Minutes', 'Hours', 'Flag'],
          ...rows.map((e) => [dateLabel(e.date), e.month, e.task, e.start, e.finish, e.minutes, Math.round((e.minutes / 60) * 1000) / 1000, e.flag || '']),
        ]), 'text/csv');
      } else if (t.dataset.action === 'export-expenses') {
        const rows = [...c.data.expenses].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        download(`scigen-expenses-${stamp}.csv`, toCSV([['Date', 'Description', 'Amount'], ...rows.map((x) => [dateLabel(x.date), x.description, x.amount])]), 'text/csv');
      } else if (t.dataset.action === 'clear-month') {
        busy(t, () => c.store.saveMonth(t.dataset.month, {}), 'Manual values cleared');
      } else if (t.dataset.action === 'signout') {
        c.signOut();
      } else if (t.dataset.action === 'forget-device') {
        if (confirm('Remove the GitHub token saved in this browser by “Sign in with a GitHub token”? Signing in with name and password keeps working.')) c.forgetDevice();
      } else if (t.dataset.action === 'retry-auth') {
        c.retryAuthSync();
      } else if (t.dataset.action === 'set-password') {
        const name = t.dataset.name;
        openDialog({
          title: `New password for ${name}`,
          body: `
            <p class="muted small">Use this when ${esc(name)} forgot the password. Tell them the new one privately.</p>
            <div class="grid-form settings-grid">
              <label>New password<input type="password" name="password" minlength="12" required autocomplete="new-password"></label>
              <label>Confirm<input type="password" name="password2" minlength="12" required autocomplete="new-password"></label>
            </div>`,
          submitLabel: 'Set password',
          onSubmit: async (form) => {
            if (form.elements.password.value !== form.elements.password2.value) throw new Error('The passwords do not match.');
            await c.store.setPassword(name, form.elements.password.value);
            toast(`Password for ${name} changed`);
          },
        });
      } else if (t.dataset.action === 'remove-account') {
        if (confirm(`Remove the account “${t.dataset.name}”? Its password will no longer open the database.`)) {
          busy(t, () => c.store.removeAccount(t.dataset.name), 'Account removed');
        }
      }
    });

    const addAcc = $(el, '[data-slot=add-account]');
    addAcc.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = addAcc.elements;
      await busy(addAcc.querySelector('[type=submit]'), async () => {
        if (f.password.value !== f.password2.value) throw new Error('The passwords do not match.');
        await this.ctx.store.addAccount(f.name.value, f.password.value);
        addAcc.reset();
      }, 'Account added');
    });
    const chg = $(el, '[data-slot=change-password]');
    chg.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = chg.elements;
      await busy(chg.querySelector('[type=submit]'), async () => {
        if (f.password.value !== f.password2.value) throw new Error('The passwords do not match.');
        await this.ctx.changePassword(f.password.value);
        chg.reset();
      }, 'Password changed');
    });

    const tok = $(el, '[data-slot=replace-token]');
    tok.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await busy(tok.querySelector('[type=submit]'), async () => {
        await this.ctx.replaceToken(tok.elements.token.value);
        tok.reset();
      }, 'Token replaced');
    });

    const imp = $(el, '[data-slot=import]');
    imp.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const status = $(el, '[data-slot=import-status]');
      const file = imp.elements.file.files[0];
      const replace = imp.elements.replace.checked;
      const result = await busy(imp.querySelector('[type=submit]'), async () => {
        if (!file) throw new Error('Choose a file first.');
        const json = JSON.parse(await file.text());
        const n = `${(json.entries || []).length} entries, ${(json.expenses || []).length} expenses, ${Object.keys(json.months || {}).length} manual months`;
        if (!confirm(`Import ${n}${replace ? ', replacing everything currently stored' : ''}?`)) return true;
        status.textContent = 'Importing…';
        const r = await this.ctx.store.importData(json, { replace });
        status.textContent = `Imported ${r.entries} entries, ${r.expenses} expenses and ${r.months} manual months.`;
        imp.reset();
        toast('Import finished');
        return true;
      });
      if (result === undefined && status.textContent.startsWith('Importing')) {
        status.textContent = 'Import failed; nothing was changed.';
      }
    });

    this.update(el, ctx);
  },

  update(el, ctx) {
    this.ctx = ctx;
    const s = withDefaults(ctx.data.settings);
    const sig = JSON.stringify(s);
    if (sig !== this.lastSettings) {
      for (const name of Object.keys(FORMS)) {
        if (!this.dirty[name]) $(el, `[data-form=${name}]`).innerHTML = FORMS[name](s);
      }
      this.lastSettings = sig;
    }

    const { fmt } = ctx;
    const manual = Object.entries(ctx.data.months).sort(([a], [b]) => b.localeCompare(a));
    $(el, '[data-slot=manual]').innerHTML = manual.length ? `
      <table class="table">
        <thead><tr><th>Month</th><th class="num">Hours worked</th><th class="num">Hours to be paid</th><th class="num">Rate</th><th>Note</th><th></th></tr></thead>
        <tbody>${manual.map(([m, d]) => {
          const row = ctx.summary.months.find((r) => r.month === m);
          return `<tr>
            <td><a href="#/log/${m}">${monthLabel(m)}</a></td>
            <td class="num">${row ? fmt.hoursPlain(row.totalHours) : '0'}</td>
            <td class="num">${d.hoursToBePaid ?? '—'}</td>
            <td class="num">${d.rate !== undefined ? fmt.money(d.rate) : '—'}</td>
            <td class="small">${esc(d.note || '')}</td>
            <td class="num"><button class="btn ghost small" data-action="clear-month" data-month="${m}">Clear</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>` : '<p class="muted">None.</p>';

    const accounts = [...(ctx.data.accounts || [])].sort((a, b) => a.name.localeCompare(b.name));
    $(el, '[data-slot=accounts]').innerHTML = `
      <table class="table">
        <thead><tr><th>Account</th><th>Last sign-in</th><th>Password last set</th><th></th></tr></thead>
        <tbody>${accounts.map((a) => `<tr>
          <td>${esc(a.name)}${same(a.name, ctx.user.name) ? ' <span class="badge">you</span>' : ''}</td>
          <td class="last-login">${a.lastLogin ? esc(dateTimeLabel(a.lastLogin)) : '<span class="muted">never</span>'}</td>
          <td class="muted">${a.updatedAt ? esc(dateLabel(a.updatedAt.slice(0, 10))) : ''}</td>
          <td class="num">${same(a.name, ctx.user.name) ? '' : `
            <button class="btn ghost small" data-action="set-password" data-name="${esc(a.name)}">Set password</button>
            <button class="btn ghost danger small" data-action="remove-account" data-name="${esc(a.name)}">Remove</button>`}</td>
        </tr>`).join('')}</tbody>
      </table>`;

    const st = ctx.authStatus;
    $(el, '[data-slot=auth-status]').innerHTML = !st || st.checking
      ? '<p class="muted"><span class="spinner inline"></span> Checking password-only sign-in…</p>'
      : st.ok
        ? '<p class="status ok">✓ Password-only sign-in is on. Every account signs in on any device with just its name and password.</p>'
        : `<div class="status warn">
            <p><strong>Password-only sign-in is off.</strong> The reason: ${esc(st.message)}</p>
            ${st.sitePermission ? `<ol class="steps small">
              <li>Open <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">GitHub → Fine-grained tokens</a> and click your token.</li>
              <li>Click <strong>Edit</strong>. Under <strong>Repository access</strong>, add <code>scigen-payroll</code> next to <code>scigen-payroll-data</code>.</li>
              <li>Permissions stay as they are: <strong>Contents: Read and write</strong> now applies to both. Click <strong>Update</strong>.</li>
              <li>Come back here and press <strong>Try again</strong>.</li>
            </ol>` : ''}
            <div class="form-actions"><button class="btn small" data-action="retry-auth">Try again</button></div>
          </div>`;

    $(el, '[data-slot=account]').innerHTML = `
      <dl class="stats">
        <div><dt>Signed in as</dt><dd>${esc(ctx.user.name)}</dd></div>
      </dl>
      <div class="form-actions">
        <button class="btn ghost danger small" data-action="forget-device">Remove saved token from this browser</button>
        <span class="spacer"></span>
        <button class="btn small" data-action="signout">Sign out</button>
      </div>`;
  },
};
