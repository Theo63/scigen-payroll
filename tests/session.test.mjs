// Sign-in end to end against the fake GitHub, with browser storage stubbed.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeGitHub } from '../js/fake-github.js';

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

let fake;
let session;
let storeMod;
const newDevice = () => { globalThis.localStorage = new MemStorage(); globalThis.sessionStorage = new MemStorage(); };

beforeEach(async () => {
  globalThis.location = { hostname: 'theo63.github.io' };
  newDevice();
  fake = makeFakeGitHub({ owner: 'Theo63', token: 'tok-1' });
  globalThis.fetch = fake.fetchFn;
  session = await import('../js/session.js');
  storeMod = await import('../js/store.js');
});

/** First-time flow: token sign-in creates the database, the app publishes auth.json. */
async function firstTime() {
  const s = await session.createNew({ token: 'tok-1', name: 'theodore', password: 'theodore-pass-1' });
  const store = storeMod.createStore({ api: s.api, dataKey: s.dataKey, account: s.name, onUsersChanged: (u) => session.publishAuth(s, u) });
  await store.refresh();
  const r = await session.syncAuth(s, store.getUsers());
  assert.deepEqual(r, { ok: true, updated: true });
  return { s, store };
}

test('after the first token sign-in, any device signs in with name + password only', async () => {
  const { store } = await firstTime();
  await store.addAccount('maria', 'maria-password-1');
  newDevice(); // a different browser: nothing saved locally
  const m = await session.login('maria', 'maria-password-1');
  assert.equal(m.name, 'maria');
  assert.equal(m.token, 'tok-1');
  newDevice();
  const t = await session.login('Theodore', 'theodore-pass-1');
  assert.equal(t.name, 'theodore');
});

test('wrong password or unknown account is refused', async () => {
  const { store } = await firstTime();
  await store.addAccount('maria', 'maria-password-1');
  newDevice();
  await assert.rejects(session.login('maria', 'theodore-pass-1'), /Wrong account name or password/);
  await assert.rejects(session.login('nobody', 'whatever-password'), /Wrong account name or password/);
});

test('auth.json contains no readable token or password', async () => {
  const { store } = await firstTime();
  await store.addAccount('maria', 'maria-password-1');
  const text = fake.read('scigen-payroll', 'auth.json');
  assert.ok(text);
  assert.ok(!text.includes('tok-1'));
  assert.ok(!text.includes('maria-password-1'));
});

test('password changes and resets work everywhere immediately', async () => {
  const { store } = await firstTime();
  await store.addAccount('maria', 'maria-password-1');
  await store.setPassword('maria', 'maria-new-password');
  await store.changePassword('theodore-new-pass');
  newDevice();
  await assert.rejects(session.login('maria', 'maria-password-1'), /Wrong/);
  assert.equal((await session.login('maria', 'maria-new-password')).name, 'maria');
  newDevice();
  assert.equal((await session.login('theodore', 'theodore-new-pass')).name, 'theodore');
});

test('removed account can no longer sign in', async () => {
  const { store } = await firstTime();
  await store.addAccount('maria', 'maria-password-1');
  await store.removeAccount('maria');
  newDevice();
  await assert.rejects(session.login('maria', 'maria-password-1'), /Wrong/);
});

test('token without access to the site repository: clear message, token sign-in still works', async () => {
  fake = makeFakeGitHub({ owner: 'Theo63', token: 'tok-1', tokenRepos: ['scigen-payroll-data'] });
  globalThis.fetch = fake.fetchFn;
  const s = await session.createNew({ token: 'tok-1', name: 'theodore', password: 'theodore-pass-1' });
  const store = storeMod.createStore({ api: s.api, dataKey: s.dataKey, account: s.name, onUsersChanged: (u) => session.publishAuth(s, u) });
  await store.refresh();
  const r = await session.syncAuth(s, store.getUsers());
  assert.equal(r.ok, false);
  assert.equal(r.sitePermission, true);
  assert.match(r.message, /scigen-payroll/);
  await assert.rejects(store.addAccount('maria', 'maria-password-1'), /Saved, but password-only sign-in was not updated/);
  // same browser: the token saved by the token sign-in still lets theodore in
  assert.equal((await session.login('theodore', 'theodore-pass-1')).name, 'theodore');
  // a new browser has no way in without the token
  newDevice();
  await assert.rejects(session.login('theodore', 'theodore-pass-1'), (e) => e.needsSetup === true);
});

test('replacing the token re-publishes auth.json with the new one', async () => {
  const { s, store } = await firstTime();
  // GitHub now accepts only the new token
  const fake2 = makeFakeGitHub({ owner: 'Theo63', token: 'tok-2', load: () => fake.files });
  globalThis.fetch = fake2.fetchFn;
  s.api.fetchFn = fake2.fetchFn;
  const next = await session.replaceToken(s, 'tok-2', store.getUsers());
  assert.equal(next.token, 'tok-2');
  newDevice();
  assert.equal((await session.login('theodore', 'theodore-pass-1')).token, 'tok-2');
});

test('expired token gives a "sign in with a new token" error', async () => {
  await firstTime();
  globalThis.fetch = makeFakeGitHub({ owner: 'Theo63', token: 'other', load: () => fake.files }).fetchFn;
  newDevice();
  await assert.rejects(session.login('theodore', 'theodore-pass-1'), (e) => e.needsSetup && /no longer works/.test(e.message));
});
