// Login, one-time device setup and the tab session.
//
// localStorage  sp-devices : { [account]: { name, salt, token } }  token = GitHub token encrypted with the
//                            account password (PBKDF2 → AES-GCM). Never stored in clear.
// sessionStorage sp-session: { name, owner, token, key }           survives a refresh, gone when the tab closes
//                            or on Sign out (same behaviour as the sinentefksi app).
import { GitHubApi, ghOwner, rememberOwner, DB_FILE } from './github.js';
import {
  deriveKey, encryptText, decryptText, randomBytes, b64enc, b64dec, openSlot, slotKey,
  parseEnvelope, generateDataKey, exportKey, importKey,
} from './crypto.js';
import { createDatabase } from './store.js';

const LS_DEVICES = 'sp-devices';
const SS_SESSION = 'sp-session';

const readDevices = () => { try { return JSON.parse(localStorage.getItem(LS_DEVICES) || '{}') || {}; } catch { return {}; } };
const writeDevices = (d) => localStorage.setItem(LS_DEVICES, JSON.stringify(d));

/** Account names that were set up on this device. */
export const deviceAccounts = () => Object.values(readDevices()).map((d) => d.name);
export { ghOwner, rememberOwner };

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

/** Normal sign-in on a device that was set up before. */
export async function login(name, password) {
  const dev = readDevices()[slotKey(name)];
  if (!dev) throw Object.assign(new Error(`“${name}” is not set up on this device yet.`), { needsSetup: true });
  let token;
  try {
    token = await decryptText(dev.token, await deriveKey(password, b64dec(dev.salt)));
  } catch {
    throw new Error('Wrong password. If it was changed on another device, use “Set up this device” with the new password.');
  }
  const owner = ghOwner();
  if (!owner) throw Object.assign(new Error('GitHub user unknown on this address.'), { needsSetup: true });
  const api = new GitHubApi({ owner, token });
  const db = await openDatabase(api, name, password);
  if (db.missing) throw new Error(`data.json is missing from ${owner}/${api.repo}.`);
  return startSession({ name: db.name, owner, token, dataKey: db.dataKey });
}

/**
 * One-time setup of this device: GitHub token + account + password.
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
  const owner = ghOwner();
  const api = new GitHubApi({ owner, token: token.trim() });
  const dataKey = await createDatabase(api, { name, password, generateDataKey });
  await rememberDevice(name.trim(), password, token.trim());
  return startSession({ name: name.trim(), owner, token: token.trim(), dataKey });
}

async function startSession({ name, owner, token, dataKey }) {
  try {
    sessionStorage.setItem(SS_SESSION, JSON.stringify({ name, owner, token, key: b64enc(await exportKey(dataKey)) }));
  } catch { /* private mode: session just won't survive a refresh */ }
  return { name, api: new GitHubApi({ owner, token }), dataKey, token };
}

export async function resumeSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SS_SESSION) || 'null');
    if (!s) return null;
    return { name: s.name, api: new GitHubApi({ owner: s.owner, token: s.token }), dataKey: await importKey(b64dec(s.key)), token: s.token };
  } catch {
    sessionStorage.removeItem(SS_SESSION);
    return null;
  }
}

export function endSession() {
  try { sessionStorage.removeItem(SS_SESSION); } catch { /* ignore */ }
}

/** After a password change: re-encrypt this device's copy of the token with the new password. */
export const reencryptDeviceToken = (name, newPassword, token) => rememberDevice(name, newPassword, token);
