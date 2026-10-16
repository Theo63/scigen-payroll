// Sign-in and the tab session.
//
// Normal sign-in: account name + password only.
//   auth.json (public site repository) holds, per account, the data key wrapped with
//   that account's password, plus the GitHub token encrypted with the data key.
//   password → data key → token → read data.json from the private repository.
//
// Fallback "Sign in with a GitHub token": used once to create the database, or
// when auth.json cannot be written (token without access to the site repository).
//   localStorage sp-devices : { [account]: { name, salt, token } } token encrypted with the password.
//
// sessionStorage sp-session: { name, owner, token, key } survives a refresh, gone when the
// tab closes or on Sign out.
import {
  GitHubApi, ghOwner, rememberOwner, DB_FILE, SITE_REPO, AUTH_FILE, fetchPublicJSON,
} from './github.js';
import {
  deriveKey, encryptText, decryptText, randomBytes, b64enc, b64dec, openSlot, slotKey,
  parseEnvelope, generateDataKey, exportKey, importKey,
} from './crypto.js';
import { createDatabase, MIN_PASSWORD } from './store.js';

const LS_DEVICES = 'sp-devices';
const LS_LAST = 'sp-last-account';
const SS_SESSION = 'sp-session';
const AUTH_APP = 'scigen-payroll-auth';

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const readDevices = () => { try { return JSON.parse(ls.get(LS_DEVICES) || '{}') || {}; } catch { return {}; } };
const writeDevices = (d) => ls.set(LS_DEVICES, JSON.stringify(d));

export const deviceAccounts = () => Object.values(readDevices()).map((d) => d.name);
export const lastAccount = () => ls.get(LS_LAST) || deviceAccounts()[0] || '';
export { ghOwner, rememberOwner, MIN_PASSWORD };

const needsSetup = (message) => Object.assign(new Error(message), { needsSetup: true });

async function rememberDevice(name, password, token) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  const devices = readDevices();
  devices[slotKey(name)] = { name, salt: b64enc(salt), token: await encryptText(token, key) };
  writeDevices(devices);
}

export function forgetDevice(name) {
  const devices = readDevices();
  delete devices[slotKey(name)];
  writeDevices(devices);
}

/** The public sign-in file, or null. */
export async function readAuth() {
  const owner = ghOwner();
  if (!owner) return null;
  const a = await fetchPublicJSON({ owner });
  return a && a.app === AUTH_APP && a.users && a.token ? a : null;
}

async function openDatabase(api, name, password) {
  const f = await api.getFile(DB_FILE);
  if (!f) return { missing: true };
  const env = parseEnvelope(f.bytes);
  const slot = env.users[slotKey(name)];
  if (!slot) throw new Error(`There is no account called “${name}” in the database.`);
  const dataKey = await openSlot(slot, password);
  if (!dataKey) throw new Error('Wrong account name or password.');
  return { dataKey, name: slot.name };
}

/** Sign in with account name + password. */
export async function login(name, password) {
  const key = slotKey(name);
  if (!key || !password) throw new Error('Enter your account name and password.');
  const auth = await readAuth();
  const slot = auth && auth.users[key];

  const dev = readDevices()[key];
  const slotKey_ = slot ? await openSlot(slot, password) : null;

  if (slot && (slotKey_ || !dev)) {
    const dataKey = slotKey_;
    if (!dataKey) throw new Error('Wrong account name or password.');
    let token;
    try {
      token = await decryptText(auth.token, dataKey);
    } catch {
      throw needsSetup('The sign-in file could not be read. Sign in once with the GitHub token to repair it.');
    }
    const owner = auth.owner || ghOwner();
    const api = new GitHubApi({ owner, token });
    try {
      if (!(await api.getFile(DB_FILE))) throw new Error(`data.json is missing from ${owner}/${api.repo}.`);
    } catch (e) {
      if (e.ghAuth) throw needsSetup('The GitHub token saved for sign-in no longer works (expired or revoked). Sign in once with a new token.');
      throw e;
    }
    return startSession({ name: slot.name, owner, token, dataKey });
  }

  // Fallback: a token saved on this device by an earlier "Sign in with a GitHub token".
  if (dev) {
    let token;
    try {
      token = await decryptText(dev.token, await deriveKey(password, b64dec(dev.salt)));
    } catch {
      throw new Error('Wrong account name or password.');
    }
    const owner = ghOwner();
    const api = new GitHubApi({ owner, token });
    const db = await openDatabase(api, name, password);
    if (db.missing) throw new Error(`data.json is missing from ${owner}/${api.repo}.`);
    return startSession({ name: db.name, owner, token, dataKey: db.dataKey });
  }

  if (auth) throw new Error('Wrong account name or password.');
  throw needsSetup('Password-only sign-in is not set up yet. Sign in once with the GitHub token.');
}

/**
 * Sign in with a GitHub token (first time, new token, or no auth.json yet).
 * Returns the session, or { needsCreate: true } when the data repository has no database yet.
 */
export async function setupDevice({ owner, token, name, password }) {
  if (owner) rememberOwner(owner);
  owner = ghOwner();
  if (!owner || !token || !name || !password) throw new Error('Fill in every field.');
  const api = new GitHubApi({ owner, token: token.trim() });
  const db = await openDatabase(api, name, password);
  if (db.missing) return { needsCreate: true };
  await rememberDevice(db.name, password, token.trim());
  return startSession({ name: db.name, owner, token: token.trim(), dataKey: db.dataKey });
}

/** First-ever setup: creates the encrypted data.json with this account. */
export async function createNew({ token, name, password }) {
  if (!password || password.length < MIN_PASSWORD) throw new Error(`Use a password of at least ${MIN_PASSWORD} characters.`);
  const owner = ghOwner();
  const api = new GitHubApi({ owner, token: token.trim() });
  const dataKey = await createDatabase(api, { name, password, generateDataKey });
  await rememberDevice(name.trim(), password, token.trim());
  return startSession({ name: name.trim(), owner, token: token.trim(), dataKey });
}

async function startSession({ name, owner, token, dataKey }) {
  ls.set(LS_LAST, name);
  const session = { name, api: new GitHubApi({ owner, token }), dataKey, token };
  await saveSession(session);
  return session;
}

async function saveSession(s) {
  try {
    sessionStorage.setItem(SS_SESSION, JSON.stringify({ name: s.name, owner: s.api.owner, token: s.token, key: b64enc(await exportKey(s.dataKey)) }));
  } catch { /* private mode: the session just won't survive a refresh */ }
}

export async function resumeSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SS_SESSION) || 'null');
    if (!s) return null;
    return { name: s.name, api: new GitHubApi({ owner: s.owner, token: s.token }), dataKey: await importKey(b64dec(s.key)), token: s.token };
  } catch {
    try { sessionStorage.removeItem(SS_SESSION); } catch { /* ignore */ }
    return null;
  }
}

export function endSession() {
  try { sessionStorage.removeItem(SS_SESSION); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- auth.json
function sitePermissionError(e) {
  if (e && e.ghAuth) {
    return Object.assign(new Error(`the GitHub token cannot write to the ${SITE_REPO} repository. Add that repository to the token with Contents: Read and write.`), { sitePermission: true });
  }
  return e;
}

/** Writes auth.json in the public site repository from the database's account slots. */
export async function publishAuth(session, users) {
  const owner = session.api.owner;
  const site = new GitHubApi({ owner, token: session.token, repo: SITE_REPO });
  const body = {
    v: 1,
    app: AUTH_APP,
    note: 'Sign-in file for Scigen Payroll. Everything in it is encrypted with the account passwords.',
    owner,
    repo: session.api.repo,
    users,
    token: await encryptText(session.token, session.dataKey),
    updatedAt: new Date().toISOString(),
  };
  const text = `${JSON.stringify(body, null, 2)}\n`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let existing;
    try {
      existing = await site.getFile(AUTH_FILE);
      await site.putText(AUTH_FILE, text, existing && existing.sha, 'Update sign-in file');
      return;
    } catch (e) {
      if (e.ghConflict) continue;
      throw sitePermissionError(e);
    }
  }
  throw new Error('auth.json kept changing while saving; try again.');
}

const sameSlots = (a = {}, b = {}) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.join() === kb.join() && ka.every((k) => a[k].wrapped === b[k].wrapped && a[k].salt === b[k].salt);
};

/**
 * Makes sure auth.json matches the database accounts and carries a working token.
 * Returns { ok: true } or { ok: false, message, sitePermission }.
 */
export async function syncAuth(session, users) {
  try {
    const current = await readAuth();
    let tokenOk = false;
    if (current) {
      try { tokenOk = (await decryptText(current.token, session.dataKey)) === session.token; } catch { tokenOk = false; }
    }
    if (current && tokenOk && sameSlots(current.users, users)) return { ok: true };
    await publishAuth(session, users);
    return { ok: true, updated: true };
  } catch (e) {
    return { ok: false, message: e.message, sitePermission: Boolean(e.sitePermission) };
  }
}

/** Switch this session to a new GitHub token and store it in auth.json. */
export async function replaceToken(session, newToken, users) {
  const token = newToken.trim();
  const api = new GitHubApi({ owner: session.api.owner, token });
  const f = await api.getFile(DB_FILE);
  if (!f) throw new Error('That token works, but data.json was not found in the data repository.');
  const next = { ...session, token, api };
  await publishAuth(next, users);
  await saveSession(next);
  return next;
}

/** After a password change: re-encrypt this device's fallback copy of the token, if there is one. */
export async function reencryptDeviceToken(name, newPassword, token) {
  if (readDevices()[slotKey(name)]) await rememberDevice(name, newPassword, token);
}
