// In-memory imitation of the GitHub Contents API endpoints the app uses.
// Used by the localhost demo (?demo) and by the Node tests. Not used on the real site.
export function makeFakeGitHub({ token = 'demo-token', owner = 'demo-owner', repo = 'scigen-payroll-data', load, persist } = {}) {
  const files = (load && load()) || {}; // path -> { content (base64), sha }
  let counter = 0;
  const newSha = () => `sha${Date.now().toString(36)}${(counter++).toString(36)}`;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const stats = { gets: 0, puts: 0, conflicts: 0 };

  async function fetchFn(url, opts = {}) {
    const u = String(url);
    const auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '';
    if (!u.toLowerCase().startsWith(base.toLowerCase())) return json(404, { message: 'Not Found' });
    if (auth !== `Bearer ${token}`) return json(401, { message: 'Bad credentials' });
    const rest = u.slice(base.length);
    if (rest === '' || rest === '/') return json(200, { name: repo, private: true });
    const m = /^\/contents\/([^?]+)/.exec(rest);
    if (!m) return json(404, { message: 'Not Found' });
    const path = decodeURIComponent(m[1]);
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'GET') {
      stats.gets += 1;
      const f = files[path];
      return f ? json(200, { path, sha: f.sha, content: f.content, encoding: 'base64' }) : json(404, { message: 'Not Found' });
    }
    if (method === 'PUT') {
      stats.puts += 1;
      const body = JSON.parse(opts.body);
      const existing = files[path];
      if (existing && body.sha !== existing.sha) { stats.conflicts += 1; return json(409, { message: 'sha mismatch' }); }
      if (!existing && body.sha) { stats.conflicts += 1; return json(409, { message: 'file does not exist' }); }
      const sha = newSha();
      files[path] = { content: body.content, sha };
      if (persist) persist(files);
      return json(existing ? 200 : 201, { content: { path, sha }, commit: { message: body.message } });
    }
    return json(405, { message: 'Method not allowed' });
  }

  return { fetchFn, files, stats, token, owner, repo };
}
