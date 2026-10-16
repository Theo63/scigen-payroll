// Local preview: http://localhost:5173/?demo  (only on localhost, see app.js)
// Runs the real login, encryption and save code against a fake GitHub kept in
// this browser's localStorage. First visit creates a demo database (account
// "demo", password "demo1234") and imports data/seed.json if it exists.
import { makeFakeGitHub } from './fake-github.js';
import { GitHubApi, rememberOwner } from './github.js';

const LS_REPO = 'sp-demo-repo';
const DEMO = { owner: 'demo-owner', token: 'demo-token', name: 'demo', password: 'demo1234' };

export async function installDemo({ fresh = false } = {}) {
  if (fresh) {
    localStorage.removeItem(LS_REPO);
    localStorage.removeItem('sp-devices');
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
  rememberOwner(DEMO.owner);

  if (!fresh && !fake.files['data.json']) {
    const session = await import('./session.js');
    const { createStore } = await import('./store.js');
    const s = await session.createNew({ token: DEMO.token, name: DEMO.name, password: DEMO.password });
    try {
      const res = await realFetch('data/seed.json', { cache: 'no-store' });
      if (res.ok) {
        const store = createStore({ api: new GitHubApi({ owner: DEMO.owner, token: DEMO.token }), dataKey: s.dataKey, account: DEMO.name });
        await store.importData(await res.json(), { replace: true });
      }
    } catch { /* no seed: empty demo */ }
    session.endSession();
  }
  return DEMO;
}
