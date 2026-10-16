// Password → AES-256-GCM key (PBKDF2-SHA256), same scheme as the sinentefksi app,
// plus a random data key wrapped once per account so each account has its own password.
// Works in the browser and in Node (globalThis.crypto).

export const PBKDF2_ITERS = 310000;
const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

export function b64enc(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64dec(str) {
  const bin = atob(String(str).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function uuid() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Password + salt → AES-GCM key (the "KEK" that protects a key slot and the local token). */
export async function deriveKey(password, salt, iterations = PBKDF2_ITERS) {
  const km = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export const generateDataKey = () => subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
export const exportKey = async (key) => new Uint8Array(await subtle.exportKey('raw', key));
export const importKey = (raw) => subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);

/** iv(12) + ciphertext */
export async function encryptBytes(bytes, key) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
export async function decryptBytes(data, key) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12)));
}
export const encryptText = async (text, key) => b64enc(await encryptBytes(te.encode(text), key));
export const decryptText = async (b64, key) => td.decode(await decryptBytes(b64dec(b64), key));

// ---------------------------------------------------------------- key slots
/** A key slot = the data key wrapped with a key derived from one account's password. */
export async function makeSlot(name, password, dataKey) {
  const salt = randomBytes(16);
  const kek = await deriveKey(password, salt);
  return {
    name,
    salt: b64enc(salt),
    iters: PBKDF2_ITERS,
    wrapped: b64enc(await encryptBytes(await exportKey(dataKey), kek)),
    updatedAt: new Date().toISOString(),
  };
}

/** Returns the data key, or null when the password does not open this slot. */
export async function openSlot(slot, password) {
  try {
    const kek = await deriveKey(password, b64dec(slot.salt), slot.iters || PBKDF2_ITERS);
    return await importKey(await decryptBytes(b64dec(slot.wrapped), kek));
  } catch {
    return null;
  }
}

export const slotKey = (name) => String(name || '').trim().toLowerCase();

// ---------------------------------------------------------------- envelope (data.json)
export const ENVELOPE_APP = 'scigen-payroll';

export async function sealEnvelope(db, users, dataKey) {
  return { v: 2, app: ENVELOPE_APP, users, data: await encryptText(JSON.stringify(db), dataKey) };
}

export function parseEnvelope(bytes) {
  let env;
  try { env = JSON.parse(td.decode(bytes)); } catch { throw new Error('data.json is not a readable database file.'); }
  if (!env || env.app !== ENVELOPE_APP || !env.users || typeof env.data !== 'string') {
    throw new Error('data.json is not a Scigen Payroll database.');
  }
  return env;
}

export async function openEnvelope(env, dataKey) {
  try {
    return JSON.parse(await decryptText(env.data, dataKey));
  } catch {
    throw new Error('Could not decrypt the database with this key.');
  }
}
