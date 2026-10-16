// Minimal GitHub Contents API client for one file in the private data repository.
export const DATA_REPO = 'scigen-payroll-data'; // private: the encrypted database
export const SITE_REPO = 'scigen-payroll'; // public: this site + auth.json
export const BRANCH = 'main';
export const DB_FILE = 'data.json';
export const AUTH_FILE = 'auth.json';
const LS_OWNER = 'sp-gh-owner';

const te = new TextEncoder();

/** GitHub user that owns the repos: taken from <owner>.github.io, else remembered from setup. */
export function ghOwner() {
  const host = globalThis.location ? location.hostname : '';
  if (host.endsWith('.github.io')) return host.split('.')[0];
  try { return localStorage.getItem(LS_OWNER) || ''; } catch { return ''; }
}
export function rememberOwner(owner) {
  try { localStorage.setItem(LS_OWNER, owner.trim()); } catch { /* ignore */ }
}

function b64enc(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64dec(str) {
  const bin = atob(str.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class GitHubApi {
  constructor({ owner, token, repo = DATA_REPO, branch = BRANCH, fetchFn = globalThis.fetch.bind(globalThis) }) {
    this.owner = owner;
    this.token = token;
    this.repo = repo;
    this.branch = branch;
    this.fetchFn = fetchFn;
  }

  async request(path, opts = {}) {
    const res = await this.fetchFn(`https://api.github.com/repos/${this.owner}/${this.repo}${path}`, {
      cache: 'no-store',
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.headers || {}),
      },
    });
    return res;
  }

  error(res) {
    if (res.status === 401) return Object.assign(new Error('GitHub rejected the token (401). It may be wrong, expired or revoked.'), { ghAuth: true });
    if (res.status === 403) return Object.assign(new Error('GitHub refused access (403). The token needs “Contents: Read and write” on the data repository.'), { ghAuth: true });
    if (res.status === 404) return Object.assign(new Error(`Repository ${this.owner}/${this.repo} was not found, or the token cannot see it.`), { ghAuth: true });
    return new Error(`GitHub error ${res.status}.`);
  }

  /** { bytes, sha } or null when the file does not exist. Throws on auth / repo problems. */
  async getFile(path = DB_FILE) {
    const res = await this.request(`/contents/${path}?ref=${this.branch}`);
    if (res.status === 404) {
      // Distinguish "file missing" from "repo missing / no access".
      const probe = await this.request('');
      if (!probe.ok) throw this.error(probe);
      return null;
    }
    if (!res.ok) throw this.error(res);
    const j = await res.json();
    return { bytes: b64dec(j.content || ''), sha: j.sha };
  }

  /** Writes the file; `sha` must match the current blob or GitHub answers 409/422 (conflict). */
  async putFile(path, bytes, sha, message) {
    const body = { message, branch: this.branch, content: b64enc(bytes) };
    if (sha) body.sha = sha;
    const res = await this.request(`/contents/${path}`, { method: 'PUT', body: JSON.stringify(body) });
    if (res.status === 409 || res.status === 422) throw Object.assign(new Error('Someone saved at the same time; retrying.'), { ghConflict: true });
    if (!res.ok) throw this.error(res);
    return (await res.json()).content.sha;
  }

  putText(path, text, sha, message) {
    return this.putFile(path, te.encode(text), sha, message);
  }
}

/**
 * Reads a JSON file from the public site repository without a token.
 * Uses the GitHub API first (always fresh), then the copy served by GitHub Pages.
 * Returns null when the file does not exist or cannot be read.
 */
export async function fetchPublicJSON({ owner, repo = SITE_REPO, path = AUTH_FILE, fetchFn = globalThis.fetch.bind(globalThis) }) {
  try {
    const res = await fetchFn(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${BRANCH}`, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (res.status === 404) return null;
    if (res.ok) {
      const j = await res.json();
      return JSON.parse(new TextDecoder().decode(b64dec(j.content || '')));
    }
  } catch { /* fall back to the Pages copy */ }
  try {
    const res = await fetchFn(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch { /* not available */ }
  return null;
}
