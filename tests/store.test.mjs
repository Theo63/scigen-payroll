import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeFakeGitHub } from '../js/fake-github.js';
import { GitHubApi } from '../js/github.js';
import { createStore, createDatabase } from '../js/store.js';
import { generateDataKey, openSlot, parseEnvelope, slotKey } from '../js/crypto.js';
import { summarize } from '../js/calc.js';

function setup() {
  const fake = makeFakeGitHub();
  const api = () => new GitHubApi({ owner: fake.owner, token: fake.token, fetchFn: fake.fetchFn });
  return { fake, api };
}
const td = new TextDecoder();
const envOf = (fake) => parseEnvelope(Buffer.from(fake.files['data.json'].content, 'base64'));

test('database is encrypted at rest: no plaintext task or amount in data.json', async () => {
  const { fake, api } = setup();
  const key = await createDatabase(api(), { name: 'Theodore', password: 'correct horse', generateDataKey });
  const s = createStore({ api: api(), dataKey: key, account: 'Theodore' });
  await s.addEntry({ date: '2026-10-16', task: 'SECRET-TASK-TEXT', start: '10:00', finish: '12:00', minutes: 120 });
  await s.addExpense({ date: '2026-10-16', amount: 1234.56, description: 'SECRET-EXPENSE' });
  const raw = td.decode(Buffer.from(fake.files['data.json'].content, 'base64'));
  assert.ok(!raw.includes('SECRET'), 'plaintext leaked');
  assert.ok(!raw.includes('1234.56'), 'amount leaked');
  assert.ok(raw.includes('"app":"scigen-payroll"'));
});

test('each account opens the database with its own password only', async () => {
  const { fake, api } = setup();
  const key = await createDatabase(api(), { name: 'Theodore', password: 'pass-one-1', generateDataKey });
  const s = createStore({ api: api(), dataKey: key, account: 'Theodore' });
  await s.addAccount('Maria', 'pass-two-2');
  const env = envOf(fake);
  assert.deepEqual(Object.keys(env.users).sort(), ['maria', 'theodore']);
  assert.ok(await openSlot(env.users.theodore, 'pass-one-1'));
  assert.ok(await openSlot(env.users.maria, 'pass-two-2'));
  assert.equal(await openSlot(env.users.maria, 'pass-one-1'), null);
  assert.equal(await openSlot(env.users.theodore, 'wrong'), null);
  await assert.rejects(s.addAccount('maria', 'whatever-123'), /already exists/);
  await assert.rejects(s.removeAccount('Theodore'), /cannot remove/);
  await s.removeAccount('Maria');
  assert.equal(envOf(fake).users[slotKey('Maria')], undefined);
});

test('changing a password keeps the data readable and invalidates the old one', async () => {
  const { fake, api } = setup();
  const key = await createDatabase(api(), { name: 'Theodore', password: 'old-password', generateDataKey });
  const s = createStore({ api: api(), dataKey: key, account: 'Theodore' });
  await s.addEntry({ date: '2026-10-01', task: 'x', minutes: 60 });
  await s.changePassword('new-password');
  const slot = envOf(fake).users.theodore;
  assert.equal(await openSlot(slot, 'old-password'), null);
  const k2 = await openSlot(slot, 'new-password');
  const s2 = createStore({ api: api(), dataKey: k2, account: 'Theodore' });
  await s2.refresh().catch(() => {});
  const r = await s2.addEntry({ date: '2026-10-02', task: 'y', minutes: 30 });
  assert.equal(r, undefined);
});

test('two accounts editing at the same time: both changes survive (sha conflict → retry)', async () => {
  const { fake, api } = setup();
  const key = await createDatabase(api(), { name: 'A', password: 'password-a', generateDataKey });
  const a = createStore({ api: api(), dataKey: key, account: 'A' });
  await a.addAccount('B', 'password-b');
  const b = createStore({ api: api(), dataKey: key, account: 'B' });
  await Promise.all([
    a.addEntry({ date: '2026-10-01', task: 'from A', minutes: 60 }),
    b.addEntry({ date: '2026-10-01', task: 'from B', minutes: 90 }),
    a.addExpense({ date: '2026-10-01', amount: 10, description: 'A exp' }),
    b.addExpense({ date: '2026-10-01', amount: 20, description: 'B exp' }),
  ]);
  let seen;
  const c = createStore({ api: api(), dataKey: key, account: 'A' });
  await c.saveMonth('2026-10', { note: 'probe' });
  // read back through a fresh store
  const env = envOf(fake);
  const { openEnvelope } = await import('../js/crypto.js');
  seen = await openEnvelope(env, key);
  assert.deepEqual(seen.entries.map((e) => e.task).sort(), ['from A', 'from B']);
  assert.deepEqual(seen.expenses.map((e) => e.description).sort(), ['A exp', 'B exp']);
  assert.ok(fake.stats.conflicts > 0, 'the test should actually have produced conflicts');
});

test('wrong token is reported as an auth problem', async () => {
  const { fake } = setup();
  const bad = new GitHubApi({ owner: fake.owner, token: 'nope', fetchFn: fake.fetchFn });
  await assert.rejects(bad.getFile('data.json'), (e) => e.ghAuth === true);
});

const seedPath = new URL('../data/seed.json', import.meta.url);
test('importing the sheet seed through the encrypted store gives the sheet totals', { skip: !fs.existsSync(seedPath) && 'run npm run parse-sheet first' }, async () => {
  const { fake, api } = setup();
  const key = await createDatabase(api(), { name: 'Theodore', password: 'pw-12345678', generateDataKey });
  const s = createStore({ api: api(), dataKey: key, account: 'Theodore' });
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const r = await s.importData(seed, { replace: false });
  assert.equal(r.entries, seed.entries.length);
  await assert.rejects(s.importData(seed, { replace: false }), /already has/);
  const { openEnvelope } = await import('../js/crypto.js');
  const db = await openEnvelope(envOf(fake), key);
  const sum = summarize({ entries: db.entries, monthDocs: db.months, expenses: db.expenses, settings: db.settings, today: '2026-10' });
  assert.deepEqual([sum.totals.earned, sum.totals.paid, sum.totals.remaining], [7355.48, 6960, 395.48]);
  const size = fake.files['data.json'].content.length;
  assert.ok(size < 2_000_000, `data.json is ${size} bytes`);
});
