// REST client for the Indian Opinion API. The Worker is a thin adapter: every
// tool is one or two calls here, with the caller's own bearer token.

import { VERSION } from './version.js';

export class ApiError extends Error {
  constructor(status, body, retryAfter) {
    super((body && body.message) || `HTTP ${status}`);
    this.status = status;
    this.body = body || {};
    this.code = this.body.error || this.body.code || (status ? `http_${status}` : 'network');
    this.retryAfter = retryAfter ?? this.body.retry_after;
  }
}

/**
 * Optional hook for extra request headers on calls to the origin. The
 * production deployment uses it to attest the caller's address to the origin's
 * per-IP limits; that attestation is not part of the public source. Without
 * it, the origin sees the Worker's egress address.
 */
async function originHeaders(env, ctx) {
  return typeof env.__originHeaders === 'function' ? (await env.__originHeaders(ctx)) || {} : {};
}

export function makeClient(env, { token, clientIp } = {}) {
  const api = (env.IO_API || 'https://indianopinion.org/wp-json/io/v1').replace(/\/+$/, '');
  const fetchImpl = env.__fetch || fetch;

  async function call(method, path, { query, body, auth = false } = {}) {
    const url = new URL(api + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    const headers = {
      Accept: 'application/json',
      'User-Agent': `io-mcp/${VERSION} (+https://indianopinion.org/agents/)`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    Object.assign(headers, await originHeaders(env, { clientIp, method, url }));
    let res;
    try {
      res = await fetchImpl(url.toString(), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    } catch (e) {
      throw new ApiError(0, { error: 'network', message: `Could not reach the Indian Opinion API (${e.message}).` });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok || (data && data.ok === false)) {
      const ra = res.headers.get('Retry-After');
      throw new ApiError(res.status, data || { message: `HTTP ${res.status} from the API.` }, ra ? Number(ra) : undefined);
    }
    if (data === null) throw new ApiError(res.status, { error: 'bad_response', message: 'The API answered with something that is not JSON.' });
    return data;
  }

  /** Public page fetch on the site itself (used to turn an article URL into its id). */
  async function page(url) {
    const res = await fetchImpl(url, { headers: { Accept: 'text/html', 'User-Agent': `io-mcp/${VERSION} (+https://indianopinion.org/agents/)` }, redirect: 'follow' });
    if (!res.ok) throw new ApiError(res.status, { error: 'not_found', message: `That page answered HTTP ${res.status}.` });
    return res.text();
  }

  return { call, page, api };
}
