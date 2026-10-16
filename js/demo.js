// Local preview: http://localhost:5173/?demo  (only on localhost, see app.js)
// Runs the real sign-in, encryption and save code against a fake GitHub kept in
// this browser's localStorage. First visit creates a demo database (account
// "demo", password "demo-password-1") with data/seed.json if it exists.
// ?demo=fresh starts from an empty fake GitHub (first-time setup flow).
import { makeFakeGitHub } from './fake-github.js';
import { GitHubApi, rememberOwner } from './github.js';

const LS_REPO = 'sp-demo-repo-v2';
const DEMO = { owner: 'demo-owner', token: 'demo-token', name: 'demo', password: 'demo-password-1' };

export async function installDemo({ fresh = false } = {}) {
  if (fresh) {
    localStorage.removeItem(LS_REPO);
    localStorage.removeItem('sp-devices');
    localStorage.removeItem('sp-last-account');
    sessionStorage.clear();
  }
  const fake = makeFakeGitHub({
    token: DEMO.token,
    owner: DEMO.owner,
    load: () => { try { return JSON.parse(localStorage.getItem(LS_REPO) || 'null'); } catch { return null; } },
    persist: (files) => { try { localStorage.setItem(LS_REPO, JSON.stringify(files)); } catch { /* quota */ } },
  });
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => (String(url).startsWith('https://api.github.com/') ? fake.fetchFn(url, opts) : realFetch(url, opts));
  window.__fakeGitHub = fake;
  rememberOwner(DEMO.owner);

  if (!fresh && !fake.files['scigen-payroll-data/data.json']) {
    const session = await import('./session.js');
    const { createStore } = await import('./store.js');
    const s = await session.createNew({ token: DEMO.token, name: DEMO.name, password: DEMO.password });
    const store = createStore({ api: new GitHubApi({ owner: DEMO.owner, token: DEMO.token }), dataKey: s.dataKey, account: DEMO.name });
    try {
      const res = await realFetch('data/seed.json', { cache: 'no-store' });
      if (res.ok) await store.importData(await res.json(), { replace: true });
    } catch { /* no seed: empty demo */ }
    await store.refresh();
    await session.publishAuth(s, store.getUsers());
    session.forgetDevice(DEMO.name);
    session.endSession();
  }
  return DEMO;
}
