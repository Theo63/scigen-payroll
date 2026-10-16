// Encrypted database in a private GitHub repository (data.json), same model as
// the sinentefksi app: every change re-reads the file, applies the change and
// writes it back with the blob sha, so two accounts can never silently
// overwrite each other (a stale write is rejected and retried).
import { DB_FILE } from './github.js';
import { sealEnvelope, parseEnvelope, openEnvelope, makeSlot, slotKey, uuid } from './crypto.js';
import { DEFAULT_SETTINGS, withDefaults } from './calc.js';

export function emptyDB() {
  return { version: 1, settings: structuredClone(DEFAULT_SETTINGS), months: {}, entries: [], expenses: [] };
}

export function normalizeDB(d = {}) {
  return {
    version: 1,
    settings: d.settings ? withDefaults(d.settings) : structuredClone(DEFAULT_SETTINGS),
    months: d.months && typeof d.months === 'object' ? d.months : {},
    entries: Array.isArray(d.entries) ? d.entries : [],
    expenses: Array.isArray(d.expenses) ? d.expenses : [],
  };
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const now = () => new Date().toISOString();

function entryFields(e) {
  return clean({
    date: e.date,
    month: e.month || String(e.date).slice(0, 7),
    task: e.task || '',
    start: e.start || '',
    finish: e.finish || '',
    minutes: Number(e.minutes) || 0,
    flag: e.flag || '',
    source: e.source,
  });
}
function expenseFields(x) {
  return clean({ date: x.date, amount: Number(x.amount) || 0, description: x.description || '', source: x.source });
}

/**
 * api: GitHubApi, dataKey: CryptoKey, account: the signed-in account name.
 */
export function createStore({ api, dataKey, account }) {
  let db = emptyDB();
  let users = {};
  let sha = null;
  const listeners = new Set();
  let loadedOnce = false;

  const snapshot = () => ({
    settings: db.settings,
    months: db.months,
    entries: db.entries,
    expenses: db.expenses,
    accounts: Object.values(users).map((u) => ({ name: u.name, updatedAt: u.updatedAt })),
    account,
    ready: loadedOnce,
  });
  const emit = () => { const s = snapshot(); listeners.forEach((cb) => cb(s)); };

  async function load() {
    const f = await api.getFile(DB_FILE);
    if (!f) throw new Error(`data.json is missing from ${api.owner}/${api.repo}.`);
    const env = parseEnvelope(f.bytes);
    db = normalizeDB(await openEnvelope(env, dataKey));
    users = env.users;
    sha = f.sha;
    loadedOnce = true;
  }

  async function save(message) {
    const env = await sealEnvelope(db, users, dataKey);
    sha = await api.putText(DB_FILE, JSON.stringify(env), sha, `${message} (${account})`);
  }

  // One operation at a time per tab: overlapping saves would otherwise share the
  // in-memory copy and one could write the other's freshly loaded data.
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  /** Re-read, apply the change on top of the latest data, save. Retries on conflicts. */
  const commit = (message, mutate) => serial(() => commitNow(message, mutate));
  async function commitNow(message, mutate) {
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await load();
        const result = await mutate(db, users);
        await save(message);
        emit();
        return result;
      } catch (e) {
        lastErr = e;
        if (!e.ghConflict) break;
      }
    }
    emit();
    throw lastErr;
  }

  const refresh = () => serial(async () => {
    const before = sha;
    await load();
    if (sha !== before) emit();
  });

  const findIdx = (list, id) => {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) throw new Error('That item no longer exists (the other account may have deleted it).');
    return i;
  };

  return {
    /** Initial load + refresh when the tab comes back into focus and every 2 minutes. */
    subscribeAll(onChange, onError) {
      listeners.add(onChange);
      serial(load).then(emit, onError);
      const tick = () => { if (!document.hidden) refresh().catch(onError); };
      const onVis = () => { if (!document.hidden) tick(); };
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('focus', tick);
      const timer = setInterval(tick, 120000);
      return () => {
        listeners.delete(onChange);
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('focus', tick);
        clearInterval(timer);
      };
    },
    refresh,

    addEntry: (e) => commit('Add entry', (d) => {
      d.entries.push({ id: uuid(), ...entryFields(e), createdAt: now(), createdBy: account });
    }),
    updateEntry: (id, e) => commit('Edit entry', (d) => {
      const i = findIdx(d.entries, id);
      d.entries[i] = { ...d.entries[i], ...entryFields(e), updatedAt: now(), updatedBy: account };
    }),
    deleteEntry: (id) => commit('Delete entry', (d) => { d.entries.splice(findIdx(d.entries, id), 1); }),

    addExpense: (x) => commit('Add expense', (d) => {
      d.expenses.push({ id: uuid(), ...expenseFields(x), createdAt: now(), createdBy: account });
    }),
    updateExpense: (id, x) => commit('Edit expense', (d) => {
      const i = findIdx(d.expenses, id);
      d.expenses[i] = { ...d.expenses[i], ...expenseFields(x), updatedAt: now(), updatedBy: account };
    }),
    deleteExpense: (id) => commit('Delete expense', (d) => { d.expenses.splice(findIdx(d.expenses, id), 1); }),

    saveMonth: (month, { hoursToBePaid, rate, note } = {}) => commit(`Month ${month}`, (d) => {
      const m = {};
      if (hoursToBePaid !== undefined && hoursToBePaid !== null && hoursToBePaid !== '') m.hoursToBePaid = Number(hoursToBePaid);
      if (rate !== undefined && rate !== null && rate !== '') m.rate = Number(rate);
      if (note) m.note = String(note);
      if (Object.keys(m).length) d.months[month] = m; else delete d.months[month];
    }),

    saveSettings: (_current, patch) => commit('Settings', (d) => {
      d.settings = withDefaults({ ...d.settings, ...patch });
    }),

    importData: (file, { replace = false } = {}) => commit('Import', (d) => {
      if (!file || file.format !== 'scigen-payroll-seed') throw new Error('This is not a Scigen Payroll seed or backup file.');
      if (!replace && (d.entries.length || d.expenses.length || Object.keys(d.months).length)) {
        throw new Error(`The database already has ${d.entries.length} entries and ${d.expenses.length} expenses. Tick "Replace existing data" to overwrite them.`);
      }
      const at = now();
      if (file.settings) d.settings = withDefaults(file.settings);
      d.months = { ...(file.months || {}) };
      d.entries = (file.entries || []).map((e) => ({ id: e.id || uuid(), ...entryFields(e), createdAt: e.createdAt || at, createdBy: e.createdBy || account }));
      d.expenses = (file.expenses || []).filter((x) => x.date)
        .map((x) => ({ id: x.id || uuid(), ...expenseFields(x), createdAt: x.createdAt || at, createdBy: x.createdBy || account }));
      return { entries: d.entries.length, expenses: d.expenses.length, months: Object.keys(d.months).length };
    }),

    exportData(data) {
      const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.start || '').localeCompare(String(b.start || ''));
      return {
        format: 'scigen-payroll-seed',
        version: 1,
        generatedAt: now(),
        settings: withDefaults(data.settings),
        months: data.months,
        entries: [...data.entries].sort(byDate),
        expenses: [...data.expenses].sort(byDate),
      };
    },

    // ---- accounts (key slots). The data key never changes, so no re-encryption is needed.
    addAccount: (name, password) => commit(`Add account ${name}`, async (_d, u) => {
      const k = slotKey(name);
      if (!k) throw new Error('Enter a name for the account.');
      if (u[k]) throw new Error(`An account called “${name}” already exists.`);
      if (!password || password.length < 8) throw new Error('Use a password of at least 8 characters.');
      u[k] = await makeSlot(name.trim(), password, dataKey);
    }),
    removeAccount: (name) => commit(`Remove account ${name}`, (_d, u) => {
      const k = slotKey(name);
      if (k === slotKey(account)) throw new Error('You cannot remove the account you are signed in with.');
      if (!u[k]) throw new Error('No such account.');
      delete u[k];
    }),
    changePassword: (newPassword) => commit('Change password', async (_d, u) => {
      if (!newPassword || newPassword.length < 8) throw new Error('Use a password of at least 8 characters.');
      const k = slotKey(account);
      u[k] = await makeSlot(u[k] ? u[k].name : account, newPassword, dataKey);
    }),
  };
}

/** First-ever setup: create data.json with one account. Fails if it already exists. */
export async function createDatabase(api, { name, password, generateDataKey }) {
  const dataKey = await generateDataKey();
  const users = { [slotKey(name)]: await makeSlot(name.trim(), password, dataKey) };
  const env = await sealEnvelope(emptyDB(), users, dataKey);
  await api.putText(DB_FILE, JSON.stringify(env), null, `Create database (${name.trim()})`);
  return dataKey;
}
