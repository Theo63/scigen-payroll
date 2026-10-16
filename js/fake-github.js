// In-memory imitation of the GitHub Contents API endpoints the app uses, with a
// private data repository and a public site repository. Used by the localhost
// demo (?demo) and by the Node tests. Not used on the real site.
export function makeFakeGitHub({
  token = 'demo-token',
  owner = 'demo-owner',
  repos = { 'scigen-payroll-data': { private: true }, 'scigen-payroll': { private: false } },
  tokenRepos = null, // repositories the token may write (default: all)
  load,
  persist,
} = {}) {
  const files = (load && load()) || {}; // "repo/path" -> { content (base64), sha }
  let counter = 0;
  const newSha = () => `sha${Date.now().toString(36)}${(counter++).toString(36)}`;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const stats = { gets: 0, puts: 0, conflicts: 0 };
  const canWrite = (repo) => !tokenRepos || tokenRepos.includes(repo);

  async function fetchFn(url, opts = {}) {
    const m = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/?]+)(.*)$/.exec(String(url));
    if (!m || m[1].toLowerCase() !== owner.toLowerCase() || !repos[m[2]]) return json(404, { message: 'Not Found' });
    const repo = m[2];
    const rest = m[3];
    const auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '';
    const authed = auth === `Bearer ${token}`;
    if (auth && !authed) return json(401, { message: 'Bad credentials' });
    const isPrivate = repos[repo].private;
    if (isPrivate && !(authed && canWrite(repo))) return json(404, { message: 'Not Found' });
    if (rest === '' || rest === '/') return json(200, { name: repo, private: isPrivate });
    const c = /^\/contents\/([^?]+)/.exec(rest);
    if (!c) return json(404, { message: 'Not Found' });
    const key = `${repo}/${decodeURIComponent(c[1])}`;
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'GET') {
      stats.gets += 1;
      const f = files[key];
      return f ? json(200, { sha: f.sha, content: f.content, encoding: 'base64' }) : json(404, { message: 'Not Found' });
    }
    if (method === 'PUT') {
      if (!authed) return json(401, { message: 'Requires authentication' });
      if (!canWrite(repo)) return json(403, { message: 'Resource not accessible by personal access token' });
      stats.puts += 1;
      const body = JSON.parse(opts.body);
      const existing = files[key];
      if (existing && body.sha !== existing.sha) { stats.conflicts += 1; return json(409, { message: 'sha mismatch' }); }
      if (!existing && body.sha) { stats.conflicts += 1; return json(409, { message: 'file does not exist' }); }
      const sha = newSha();
      files[key] = { content: body.content, sha };
      if (persist) persist(files);
      return json(existing ? 200 : 201, { content: { sha }, commit: { message: body.message } });
    }
    return json(405, { message: 'Method not allowed' });
  }

  /** Decoded text of a stored file, or null. */
  const read = (repo, path) => {
    const f = files[`${repo}/${path}`];
    return f ? new TextDecoder().decode(Uint8Array.from(atob(f.content), (ch) => ch.charCodeAt(0))) : null;
  };

  return { fetchFn, files, stats, token, owner, read };
}
