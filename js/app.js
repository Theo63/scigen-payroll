import { esc, makeFmt } from './format.js';
import { summarize, withDefaults, rateFor, currentMonth } from './calc.js';
import { toast } from './ui.js';
import dashboard from './views/dashboard.js';
import worklog from './views/worklog.js';
import expenses from './views/expenses.js';
import settings from './views/settings.js';

const VIEWS = { dashboard, log: worklog, expenses, settings };
const TABS = [
  ['dashboard', 'Dashboard', '◧'],
  ['log', 'Work log', '☰'],
  ['expenses', 'Expenses', '€'],
  ['settings', 'Settings', '⚙'],
];

// ?demo on localhost previews the app with in-memory data and no login (never on the real site).
const DEMO = new URLSearchParams(location.search).has('demo') && ['localhost', '127.0.0.1'].includes(location.hostname);

const root = document.getElementById('app');
let auth = null; // session.js (or the demo stand-in)
let session = null; // { name, api, dataKey, token }
let store = null;
let data = null;
let unsubscribe = null;
let authStatus = null; // result of the last auth.json check
let current = { key: null, view: null, el: null };

// ---------------------------------------------------------------- screens
function screen(html) {
  current = { key: null, view: null, el: null };
  root.innerHTML = html;
}

function showLoading(text = 'Loading…') {
  screen(`<main class="center-screen"><div class="loader" aria-live="polite"><span class="spinner"></span>${esc(text)}</div></main>`);
}

const brand = '<div class="brand big"><span class="logo">S</span><span>Scigen Payroll</span></div>';

function showLogin(message = '') {
  screen(`
    <main class="center-screen">
      <form class="card narrow login" autocomplete="on">
        ${brand}
        <label>Account<input type="text" name="name" value="${esc(auth.lastAccount())}" autocomplete="username"
          autocapitalize="none" spellcheck="false" required></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <p class="error" role="alert">${esc(message)}</p>
        <button class="btn primary block" type="submit">Sign in</button>
        <button class="link small" type="button" data-action="setup">Sign in with a GitHub token (first time or new token)</button>
      </form>
    </main>`);
  const form = root.querySelector('form');
  const err = form.querySelector('.error');
  (form.elements.name.value ? form.elements.password : form.elements.name).focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    err.textContent = '';
    btn.textContent = 'Unlocking…';
    try {
      session = await auth.login(form.elements.name.value.trim(), form.elements.password.value);
      startData({ freshLogin: true });
    } catch (e) {
      if (e.needsSetup) { showSetup({ name: form.elements.name.value.trim(), message: e.message }); return; }
      err.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
  form.querySelector('[data-action=setup]').addEventListener('click', () => showSetup({ name: form.elements.name.value.trim() }));
}

function showSetup({ name = '', message = '' } = {}) {
  const owner = auth.ghOwner();
  screen(`
    <main class="center-screen">
      <form class="card narrow login setup" autocomplete="off">
        ${brand}
        <h1>Sign in with a GitHub token</h1>
        <p class="muted small">Only needed the very first time, or when the token is replaced. After that, everyone signs in with just their account name and password.</p>
        ${owner ? '' : '<label>GitHub user that owns the repositories<input type="text" name="owner" placeholder="e.g. Theo63" required></label>'}
        <label>GitHub token
          <input type="password" name="token" placeholder="github_pat_…" required autocomplete="off">
          <small>Fine-grained token with Contents read and write on the private scigen-payroll-data repository.</small></label>
        <label>Account name<input type="text" name="name" value="${esc(name)}" placeholder="e.g. theodore" required autocomplete="username"></label>
        <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
        <div class="create-only" hidden>
          <p class="notice-inline">No database exists yet in <code>scigen-payroll-data</code>. Confirm the password to create it with this account as the first one.</p>
          <label>Confirm password<input type="password" name="password2" autocomplete="new-password"></label>
        </div>
        <p class="error" role="alert">${esc(message)}</p>
        <button class="btn primary block" type="submit">Continue</button>
        <button class="link small" type="button" data-action="back">Back to sign in</button>
      </form>
    </main>`);
  const form = root.querySelector('form');
  const err = form.querySelector('.error');
  const createBox = form.querySelector('.create-only');
  let creating = false;
  (form.elements.owner || form.elements.token).focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = form.elements;
    const btn = form.querySelector('[type=submit]');
    err.textContent = '';
    btn.disabled = true;
    try {
      if (creating) {
        if (f.password.value.length < auth.MIN_PASSWORD) throw new Error(`Use a password of at least ${auth.MIN_PASSWORD} characters.`);
        if (f.password.value !== f.password2.value) throw new Error('The passwords do not match.');
        session = await auth.createNew({ token: f.token.value, name: f.name.value, password: f.password.value });
        toast('Encrypted database created');
        startData({ freshLogin: true });
        return;
      }
      const r = await auth.setupDevice({
        owner: f.owner ? f.owner.value : '', token: f.token.value, name: f.name.value, password: f.password.value,
      });
      if (r.needsCreate) {
        creating = true;
        createBox.hidden = false;
        btn.textContent = 'Create database';
        f.password2.focus();
        btn.disabled = false;
        return;
      }
      session = r;
      startData({ freshLogin: true });
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
    }
  });
  form.querySelector('[data-action=back]').addEventListener('click', () => showLogin());
}

function showLoadError(e) {
  screen(`
    <main class="center-screen">
      <div class="card narrow">
        <h1>Could not open the database</h1>
        <p>${esc(e.message || String(e))}</p>
        ${e.ghAuth ? '<p class="muted small">If the GitHub token expired or was replaced, sign in with the new token.</p>' : ''}
        <div class="form-actions">
          <button class="btn ghost" data-action="signout">Sign out</button>
          ${e.ghAuth ? '<button class="btn ghost" data-action="setup">Sign in with a new token</button>' : ''}
          <button class="btn primary" data-action="retry">Try again</button>
        </div>
      </div>
    </main>`);
  root.querySelector('[data-action=retry]').addEventListener('click', () => startData());
  root.querySelector('[data-action=signout]').addEventListener('click', signOut);
  const s = root.querySelector('[data-action=setup]');
  if (s) s.addEventListener('click', () => { const n = session && session.name; signOut(false); showSetup({ name: n || '' }); });
}

function shell() {
  current = { key: null, view: null, el: null };
  root.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/dashboard"><span class="logo">S</span><span>Scigen Payroll</span></a>
      <nav class="tabs" aria-label="Sections">
        ${TABS.map(([k, label, icon]) => `<a href="#/${k}" data-tab="${k}"><span class="tab-icon" aria-hidden="true">${icon}</span><span>${label}</span></a>`).join('')}
      </nav>
      <div class="who"><span class="who-email">${esc(session.name)}</span>
        <button class="btn ghost small" data-action="signout">Sign out</button></div>
    </header>
    <main id="view"></main>`;
  root.querySelector('[data-action=signout]').addEventListener('click', () => signOut());
}

// ---------------------------------------------------------------- routing
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const name = VIEWS[parts[0]] ? parts[0] : 'dashboard';
  return { name, param: parts[1] || null };
}

function buildCtx(param) {
  const s = withDefaults(data.settings);
  const today = currentMonth();
  return {
    data,
    settings: s,
    summary: summarize({ entries: data.entries, monthDocs: data.months, expenses: data.expenses, settings: s, today }),
    fmt: makeFmt(s),
    store,
    user: { name: session.name },
    today,
    param,
    rateFor: (m) => rateFor(m, s.rates),
    signOut: () => signOut(),
    changePassword: async (newPassword) => {
      try {
        await store.changePassword(newPassword);
      } finally {
        await auth.reencryptDeviceToken(session.name, newPassword, session.token);
      }
    },
    authStatus,
    retryAuthSync: () => runAuthSync(true),
    replaceToken: async (newToken) => {
      session = await auth.replaceToken(session, newToken, store.getUsers());
      store = null;
      startData();
    },
    forgetDevice: () => { auth.forgetDevice(session.name); signOut(); },
  };
}

function render() {
  if (!session || !data || !data.ready) return;
  if (!root.querySelector('#view')) shell();
  const { name, param } = parseRoute();
  const key = `${name}/${param || ''}`;
  const ctx = buildCtx(param);
  root.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
  if (current.key !== key) {
    const el = root.querySelector('#view');
    const view = Object.create(VIEWS[name]);
    current = { key, view, el };
    view.mount(el, ctx);
    window.scrollTo(0, 0);
  } else {
    current.view.update(current.el, ctx);
  }
}

window.addEventListener('hashchange', render);

// ---------------------------------------------------------------- data
function startData({ freshLogin = false } = {}) {
  if (unsubscribe) unsubscribe();
  data = null;
  showLoading('Loading your records…');
  store = auth.createStore({ ...session, onUsersChanged: (users) => auth.publishAuth(session, users) });
  authStatus = null;
  let failedFirst = false;
  let synced = false;
  unsubscribe = store.subscribeAll(
    (d) => {
      data = d;
      render();
      if (!synced && d.ready) {
        synced = true;
        runAuthSync(false);
        if (freshLogin) store.recordLogin().catch((e) => console.warn('Could not record sign-in', e));
      }
    },
    (e) => {
      console.error(e);
      if (!data || !data.ready) {
        if (failedFirst) return;
        failedFirst = true;
        showLoadError(e);
      } else {
        toast(`Sync problem: ${e.message}`, 'error');
      }
    },
  );
}

/** Keeps auth.json (password-only sign-in) in step with the accounts in the database. */
async function runAuthSync(manual) {
  if (!store || !session) return;
  authStatus = { checking: true };
  render();
  authStatus = await auth.syncAuth(session, store.getUsers());
  if (!authStatus.ok && !manual) toast(`Password-only sign-in is off: ${authStatus.message}`, 'error');
  if (manual && authStatus.ok) toast('Password-only sign-in is on');
  render();
}

function signOut(reload = true) {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  auth.endSession();
  session = null;
  store = null;
  data = null;
  if (reload) showLogin();
}

// ---------------------------------------------------------------- boot
async function boot() {
  if (DEMO) {
    showLoading('Preparing the demo…');
    const params = new URLSearchParams(location.search);
    await (await import('./demo.js')).installDemo({ fresh: params.get('demo') === 'fresh' });
    document.title = 'Scigen Payroll (demo)';
  }
  const [sessionMod, storeMod] = await Promise.all([import('./session.js'), import('./store.js')]);
  auth = {
    ...sessionMod,
    createStore: ({ api, dataKey, name, onUsersChanged }) => storeMod.createStore({ api, dataKey, account: name, onUsersChanged }),
  };
  session = await auth.resumeSession();
  if (session) startData();
  else showLogin();
}

boot().catch((e) => {
  console.error(e);
  screen(`<main class="center-screen"><div class="card narrow"><h1>Could not start</h1><p>${esc(e.message || e)}</p></div></main>`);
});
