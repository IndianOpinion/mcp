// OAuth 2.1 authorization server for the MCP connectors (phase 2).
//
// ChatGPT and claude.ai connectors accept OAuth or no auth, never a static
// bearer header. This module lets them reach the account tools with the same
// identity the rest of the site uses: the passwordless email code. There is no
// new identity store. The sign-in page calls the REST agent API
// (POST /agent/start, POST /agent/verify); verify returns an ordinary ioa_
// bearer token, and every OAuth access token issued here stands for that ioa_
// token, so the tools, the digest and the account routes see exactly what a
// bearer-token client sends.
//
// Endpoints (paths relative to the request origin):
//   GET  /.well-known/oauth-protected-resource[/mcp|/mcp/oauth]   RFC 9728
//   GET  /.well-known/oauth-authorization-server[/mcp|/mcp/oauth] RFC 8414
//   POST /oauth/register     dynamic client registration, RFC 7591
//   GET  /oauth/authorize    email step; POST the email, then the code
//   POST /oauth/token        authorization_code (PKCE S256 required), refresh_token (rotated)
//   POST /oauth/revoke       RFC 7009
//
// State lives in the KV namespace OAUTH_KV. Every key is a SHA-256 of the
// secret it stands for, and every value that carries the ioa_ token is sealed
// with AES-GCM under a key derived from the presented secret itself (the code,
// the access token or the refresh token). Nothing at rest is usable without the
// secret the client holds, and the Worker needs no signing key.

import { makeClient, ApiError } from './client.js';

export const ACCESS_TTL = 3600;              // 1 hour
export const REFRESH_TTL = 30 * 24 * 3600;   // 30 days
export const CODE_TTL = 60;                  // KV's minimum TTL; codes are also checked against exp
export const PENDING_TTL = 600;              // the sign-in page: 10 minutes for email then code
export const CLIENT_TTL = 180 * 24 * 3600;   // registrations expire unless used
export const SCOPES = ['news:read', 'account:read', 'account:write'];
export const OAUTH_MCP_PATH = '/mcp/oauth';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- crypto helpers ----------

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
export function randomToken(n = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}
export async function sha256(str) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str)));
}
export async function sha256hex(str) {
  return [...await sha256(str)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function aesKey(secret) {
  return crypto.subtle.importKey('raw', await sha256('io-oauth-seal|v1|' + secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(secret, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64url(out);
}
export async function unseal(secret, str) {
  try {
    const raw = unb64url(str);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await aesKey(secret), raw.slice(12));
    return JSON.parse(dec.decode(pt));
  } catch { return null; }
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export async function s256(verifier) {
  return b64url(await sha256(verifier));
}

const K = {
  client: (id) => `c:${id}`,
  pending: async (id) => `p:${await sha256hex('p|' + id)}`,
  code: async (c) => `ac:${await sha256hex('ac|' + c)}`,
  access: async (t) => `at:${await sha256hex('at|' + t)}`,
  refresh: async (t) => `rt:${await sha256hex('rt|' + t)}`,
  grant: (id) => `g:${id}`,
};

async function kvGet(env, key) {
  const v = await env.OAUTH_KV.get(key);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}
async function kvPut(env, key, obj, ttl) {
  await env.OAUTH_KV.put(key, JSON.stringify(obj), { expirationTtl: Math.max(60, Math.ceil(ttl)) });
}
const kvDel = (env, key) => env.OAUTH_KV.delete(key);
const now = () => Math.floor(Date.now() / 1000);

// ---------- responses ----------

const API_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body, null, 2) + '\n', { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache', ...API_CORS, ...extra } });
}
function oauthError(error, description, status = 400, extra = {}) {
  return json({ error, error_description: description }, status, extra);
}
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(title, body, status = 200) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} | Indian Opinion</title>
<style>
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1d1d1b;--muted:#5f5d57;--line:#d9d5cc;--accent:#8a1c1c}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#eceae4;--muted:#a9a69e;--line:#3a3934;--accent:#e07a6a}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 Georgia,serif}
main{max-width:28rem;margin:3rem auto;padding:0 16px}
h1{font-size:1.4rem;margin:0 0 .5rem}p{margin:.5rem 0}.muted{color:var(--muted);font-size:.9rem}
label{display:block;margin:1rem 0 .25rem;font-weight:bold}
input{width:100%;box-sizing:border-box;padding:.6rem;font:inherit;border:1px solid var(--line);border-radius:4px;background:transparent;color:inherit}
button{margin-top:1rem;padding:.6rem 1.2rem;font:inherit;border:0;border-radius:4px;background:var(--accent);color:#fff;cursor:pointer}
.err{color:var(--accent);font-weight:bold}
</style></head><body><main>
<p class="muted">Indian Opinion</p>
${body}
</main></body></html>
`, { status, headers: PAGE_HEADERS });
}

// ---------- metadata ----------

export function protectedResourceMetadata(origin, path = OAUTH_MCP_PATH) {
  return {
    resource: origin + path,
    authorization_servers: [origin],
    scopes_supported: SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Indian Opinion',
    resource_documentation: 'https://indianopinion.org/agents/',
  };
}

export function authServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: SCOPES,
    authorization_response_iss_parameter_supported: true,
    service_documentation: 'https://indianopinion.org/agents/',
  };
}

export function resourceMetadataUrl(origin, mcpPath) {
  return `${origin}/.well-known/oauth-protected-resource${mcpPath === '/mcp/' ? '/mcp' : mcpPath}`;
}

/** The WWW-Authenticate value for a 401 on an MCP endpoint (RFC 9728 section 5.1). */
export function challenge(origin, mcpPath, error) {
  const parts = [`Bearer realm="indianopinion.org"`, `resource_metadata="${resourceMetadataUrl(origin, mcpPath)}"`, `scope="${SCOPES.join(' ')}"`];
  if (error) parts.push(`error="${error}"`);
  return parts.join(', ');
}

// ---------- clients (RFC 7591) ----------

function validRedirect(u) {
  let url;
  try { url = new URL(u); } catch { return false; }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true;
  // Private-use schemes for native apps (RFC 8252 7.1), e.g. cursor://
  return /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$|^(cursor|vscode|claude):$/.test(url.protocol);
}

async function register(request, env) {
  let body;
  try { body = await request.json(); } catch { return oauthError('invalid_client_metadata', 'The body must be a JSON object.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return oauthError('invalid_client_metadata', 'The body must be a JSON object.');
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) return oauthError('invalid_redirect_uri', 'redirect_uris must list 1 to 10 URIs.');
  for (const u of uris) if (typeof u !== 'string' || u.length > 2000 || !validRedirect(u)) return oauthError('invalid_redirect_uri', 'Each redirect URI must be https, http on localhost, or a private-use scheme, without a fragment.');
  const method = body.token_endpoint_auth_method || 'client_secret_basic';
  if (!['none', 'client_secret_basic', 'client_secret_post'].includes(method)) return oauthError('invalid_client_metadata', 'token_endpoint_auth_method must be none, client_secret_basic or client_secret_post.');
  const grants = body.grant_types || ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grants) || grants.some((g) => !['authorization_code', 'refresh_token'].includes(g))) return oauthError('invalid_client_metadata', 'grant_types may hold authorization_code and refresh_token only.');
  const rtypes = body.response_types || ['code'];
  if (!Array.isArray(rtypes) || rtypes.some((r) => r !== 'code')) return oauthError('invalid_client_metadata', 'response_types may hold code only.');
  const name = typeof body.client_name === 'string' ? body.client_name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) : '';
  const clientUri = typeof body.client_uri === 'string' && /^https:\/\//.test(body.client_uri) ? body.client_uri.slice(0, 300) : undefined;

  const clientId = 'ioc_' + randomToken(18);
  const rec = { redirect_uris: uris, client_name: name, token_endpoint_auth_method: method, grant_types: grants, created: now() };
  const out = { client_id: clientId, client_id_issued_at: rec.created, redirect_uris: uris, client_name: name || undefined, client_uri: clientUri,
    token_endpoint_auth_method: method, grant_types: grants, response_types: ['code'], scope: SCOPES.join(' ') };
  if (method !== 'none') {
    const secret = 'iocs_' + randomToken(32);
    rec.secret_hash = await sha256hex('cs|' + secret);
    out.client_secret = secret;
    out.client_secret_expires_at = 0;
  }
  if (clientUri) rec.client_uri = clientUri;
  await kvPut(env, K.client(clientId), rec, CLIENT_TTL);
  return json(out, 201);
}

async function getClient(env, clientId) {
  if (typeof clientId !== 'string' || !/^ioc_[A-Za-z0-9_-]{10,64}$/.test(clientId)) return null;
  return kvGet(env, K.client(clientId));
}

/** Client authentication at the token and revocation endpoints. Returns { id, rec } or a Response. */
async function authClient(request, form, env) {
  let id = form.get('client_id') || '';
  let secret = form.get('client_secret') || '';
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Basic\s+(.+)$/i);
  if (m) {
    try {
      const [u, p] = atob(m[1].trim()).split(':');
      id = decodeURIComponent(u || ''); secret = decodeURIComponent(p || '');
    } catch { return oauthError('invalid_client', 'Malformed Basic credentials.', 401, { 'WWW-Authenticate': 'Basic realm="indianopinion.org"' }); }
  }
  const rec = await getClient(env, id);
  if (!rec) return oauthError('invalid_client', 'Unknown client_id. Register again at the registration endpoint.', 401);
  if (rec.token_endpoint_auth_method !== 'none') {
    if (!secret || !safeEqual(await sha256hex('cs|' + secret), rec.secret_hash || '')) return oauthError('invalid_client', 'Client authentication failed.', 401, m ? { 'WWW-Authenticate': 'Basic realm="indianopinion.org"' } : {});
  }
  return { id, rec };
}

// ---------- authorize ----------

function redirectWith(redirectUri, params) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store' } });
}

function normScope(s) {
  if (!s) return SCOPES.join(' ');
  const asked = String(s).split(/\s+/).filter(Boolean);
  const bad = asked.filter((x) => !SCOPES.includes(x));
  return bad.length ? null : asked.join(' ');
}

function validResource(origin, r) {
  if (!r) return true;
  return [origin + '/mcp', origin + '/mcp/', origin + OAUTH_MCP_PATH, origin].includes(r);
}

function emailForm(reqId, client, msg = '') {
  return page('Sign in', `<h1>Connect ${esc(client.client_name || 'an app')} to Indian Opinion</h1>
<p>Sign in with your email. We send a 6-digit code; there is no password.</p>
<p class="muted">The app will be able to read your digest, topics and Breaking News, and change your preferences. It will return to ${esc(new URL(client.redirect).host || client.redirect)}.</p>
${msg ? `<p class="err">${esc(msg)}</p>` : ''}
<form method="post" action="/oauth/authorize">
<input type="hidden" name="req" value="${esc(reqId)}"><input type="hidden" name="step" value="email">
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="200">
<button type="submit">Send code</button>
</form>
<p class="muted">New addresses get an Indian Opinion account with the daily digest and Breaking News (up to 5 a day) on; unsubscribe at any time. <a href="https://indianopinion.org/privacy-policy/">Privacy</a></p>
<p class="muted">Sign-ups through a connector start as agent accounts; the first digest carries a button to switch to a reader's account.</p>`, msg ? 400 : 200);
}

function codeForm(reqId, masked, msg = '') {
  return page('Enter the code', `<h1>Check your email</h1>
<p>We sent a 6-digit code to ${esc(masked || 'your address')}. It expires in 10 minutes.</p>
${msg ? `<p class="err">${esc(msg)}</p>` : ''}
<form method="post" action="/oauth/authorize">
<input type="hidden" name="req" value="${esc(reqId)}"><input type="hidden" name="step" value="code">
<label for="code">Code</label><input id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" required maxlength="6">
<button type="submit">Allow</button>
</form>
<p class="muted">Pressing Allow signs you in and lets the app use your account. Wrong address? Close this window and start again.</p>`, msg ? 400 : 200);
}

function apiMessage(e) {
  if (!(e instanceof ApiError)) return 'Something went wrong. Try again in a minute.';
  if (e.status === 429) return `Too many tries. Wait ${e.retryAfter || 60} seconds and try again.`;
  if (e.code === 'invalid_code') return `That code is not right.${e.body && e.body.attempts_left !== undefined ? ` ${e.body.attempts_left} tries left.` : ''}`;
  if (e.code === 'expired') return 'That code has expired. Close this window and start again.';
  if (e.code === 'invalid_email' || e.code === 'suppressed') return (e.body && e.body.message) || 'We cannot send to that address.';
  if (e.code === 'account_disabled') return 'This account is disabled.';
  if (e.status === 0 || e.status >= 500 || e.status === 404) return 'Sign-in is not available right now. Try again later.';
  return (e.body && e.body.message) || 'That did not work. Try again.';
}

async function authorizeGet(url, env) {
  const q = url.searchParams;
  const client = await getClient(env, q.get('client_id'));
  if (!client) return page('Unknown app', '<h1>Unknown app</h1><p>This app is not registered with Indian Opinion, or its registration has expired. Remove the connector and add it again.</p>', 400);
  const redirect = q.get('redirect_uri') || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : '');
  if (!client.redirect_uris.includes(redirect)) return page('Bad redirect', '<h1>Redirect not registered</h1><p>The app asked to return to an address it did not register.</p>', 400);
  const state = q.get('state') || undefined;
  const iss = url.origin;
  if (q.get('response_type') !== 'code') return redirectWith(redirect, { error: 'unsupported_response_type', error_description: 'Only response_type=code is supported.', state, iss });
  const challengeVal = q.get('code_challenge') || '';
  if (!challengeVal) return redirectWith(redirect, { error: 'invalid_request', error_description: 'PKCE is required: send code_challenge with code_challenge_method=S256.', state, iss });
  if (q.get('code_challenge_method') !== 'S256') return redirectWith(redirect, { error: 'invalid_request', error_description: 'code_challenge_method must be S256.', state, iss });
  if (!/^[A-Za-z0-9_-]{43}$/.test(challengeVal)) return redirectWith(redirect, { error: 'invalid_request', error_description: 'code_challenge must be the base64url SHA-256 of the verifier (43 characters).', state, iss });
  const scope = normScope(q.get('scope'));
  if (scope === null) return redirectWith(redirect, { error: 'invalid_scope', error_description: `Scopes: ${SCOPES.join(' ')}.`, state, iss });
  const resource = q.get('resource') || '';
  if (!validResource(url.origin, resource)) return redirectWith(redirect, { error: 'invalid_target', error_description: `resource must be ${url.origin}${OAUTH_MCP_PATH} or ${url.origin}/mcp.`, state, iss });

  const reqId = randomToken(24);
  const pending = { client_id: q.get('client_id'), client_name: client.client_name, redirect, state, challenge: challengeVal, scope, resource, exp: now() + PENDING_TTL };
  await kvPut(env, await K.pending(reqId), { s: await seal(reqId, pending) }, PENDING_TTL);
  return emailForm(reqId, { client_name: client.client_name, redirect });
}

async function loadPending(env, reqId) {
  if (typeof reqId !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(reqId)) return null;
  const box = await kvGet(env, await K.pending(reqId));
  if (!box) return null;
  const p = await unseal(reqId, box.s);
  if (!p || p.exp < now()) return null;
  return p;
}

async function authorizePost(request, url, env, clientIp) {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.includes('application/x-www-form-urlencoded') && !ct.includes('multipart/form-data')) return page('Bad request', '<h1>Bad request</h1>', 400);
  const form = await request.formData();
  const reqId = String(form.get('req') || '');
  const p = await loadPending(env, reqId);
  if (!p) return page('Expired', '<h1>This sign-in has expired</h1><p>Close this window and connect again from your app.</p>', 400);
  const api = makeClient(env, { clientIp });
  const pkey = await K.pending(reqId);

  if (form.get('step') === 'email') {
    const email = String(form.get('email') || '').trim().slice(0, 200);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return emailForm(reqId, { client_name: p.client_name, redirect: p.redirect }, 'Enter a valid email address.');
    try {
      const r = await api.call('POST', '/agent/start', { body: { email, agent_name: (p.client_name || 'MCP connector').slice(0, 60), purpose: 'MCP connector (OAuth)' } });
      p.email = email;
      p.masked = r.sent_to_masked || '';
      await kvPut(env, pkey, { s: await seal(reqId, p) }, Math.max(60, p.exp - now()));
      return codeForm(reqId, p.masked);
    } catch (e) {
      return emailForm(reqId, { client_name: p.client_name, redirect: p.redirect }, apiMessage(e));
    }
  }

  if (form.get('step') === 'code') {
    if (!p.email) return emailForm(reqId, { client_name: p.client_name, redirect: p.redirect }, 'Enter your email first.');
    const code = String(form.get('code') || '').replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) return codeForm(reqId, p.masked, 'The code is 6 digits.');
    let r;
    try {
      const label = ('oauth ' + (p.client_name || 'connector')).replace(/[^\p{L}\p{N} ._:-]/gu, '').slice(0, 40);
      r = await api.call('POST', '/agent/verify', { body: { email: p.email, code, token_label: label } });
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'expired' || e.code === 'locked' || e.code === 'account_disabled')) await kvDel(env, pkey);
      return codeForm(reqId, p.masked, apiMessage(e));
    }
    if (!r || typeof r.token !== 'string' || !r.token.startsWith('ioa_')) return codeForm(reqId, p.masked, 'Sign-in is not available right now. Try again later.');
    await kvDel(env, pkey);
    const grantId = randomToken(12);
    const code2 = 'ioz_' + randomToken(32);
    const rec = { grant_id: grantId, client_id: p.client_id, redirect: p.redirect, challenge: p.challenge, scope: p.scope, resource: p.resource,
      ioa: r.token, token_id: r.token_id || '', account_id: r.account && r.account.id, exp: now() + CODE_TTL };
    await kvPut(env, await K.code(code2), { grant_id: grantId, s: await seal(code2, rec) }, CODE_TTL);
    console.log(JSON.stringify({ t: 'oauth', ev: 'authorized', client: p.client_id, tid: rec.token_id }));
    return redirectWith(p.redirect, { code: code2, state: p.state, iss: url.origin });
  }
  return page('Bad request', '<h1>Bad request</h1>', 400);
}

// ---------- tokens ----------

async function issueTokens(env, grant, ioa) {
  const access = 'iot_' + randomToken(32);
  const refresh = 'ior_' + randomToken(32);
  const exp = now() + ACCESS_TTL;
  const accessKey = await K.access(access);
  const refreshKey = await K.refresh(refresh);
  const inner = { grant_id: grant.grant_id, client_id: grant.client_id, scope: grant.scope, resource: grant.resource, token_id: grant.token_id, ioa };
  await kvPut(env, accessKey, { grant_id: grant.grant_id, s: await seal(access, { ...inner, exp }) }, ACCESS_TTL);
  await kvPut(env, refreshKey, { grant_id: grant.grant_id, s: await seal(refresh, { ...inner, exp: now() + REFRESH_TTL }) }, REFRESH_TTL);
  await kvPut(env, K.grant(grant.grant_id), { client_id: grant.client_id, scope: grant.scope, token_id: grant.token_id, access_key: accessKey, refresh_key: refreshKey, created: grant.created || now(), rotated: now() }, REFRESH_TTL);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL, refresh_token: refresh, scope: grant.scope };
}

/** Drop every record of a grant and, when the ioa_ token is known, revoke it at the origin. */
async function killGrant(env, grantId, ioa, tokenId) {
  const g = await kvGet(env, K.grant(grantId));
  if (g) {
    if (g.access_key) await kvDel(env, g.access_key);
    if (g.refresh_key) await kvDel(env, g.refresh_key);
    await kvDel(env, K.grant(grantId));
  }
  if (ioa && tokenId) {
    try { await makeClient(env, { token: ioa }).call('DELETE', `/agent/tokens/${encodeURIComponent(tokenId)}`, { auth: true }); }
    catch (e) { console.log(JSON.stringify({ t: 'oauth', ev: 'origin_revoke_failed', tid: tokenId, status: e && e.status })); }
  }
}

async function tokenEndpoint(request, env) {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.includes('application/x-www-form-urlencoded')) return oauthError('invalid_request', 'Send application/x-www-form-urlencoded.');
  const form = await request.formData();
  const c = await authClient(request, form, env);
  if (c instanceof Response) return c;
  const gt = form.get('grant_type');

  if (gt === 'authorization_code') {
    const code = String(form.get('code') || '');
    const verifier = String(form.get('code_verifier') || '');
    if (!code) return oauthError('invalid_request', 'code is required.');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return oauthError('invalid_request', 'code_verifier is required (43 to 128 characters, RFC 7636).');
    const key = await K.code(code);
    const box = await kvGet(env, key);
    if (!box) return oauthError('invalid_grant', 'The code is unknown, used or expired.');
    if (box.used) {
      // A replayed code: revoke what the first exchange issued (RFC 6749 4.1.2).
      await killGrant(env, box.grant_id);
      await kvDel(env, key);
      return oauthError('invalid_grant', 'The code was already used; its tokens are revoked.');
    }
    const rec = await unseal(code, box.s);
    if (!rec || rec.exp < now()) { await kvDel(env, key); return oauthError('invalid_grant', 'The code is unknown, used or expired.'); }
    if (rec.client_id !== c.id) return oauthError('invalid_grant', 'The code was issued to another client.');
    const redirect = form.get('redirect_uri');
    if (redirect !== null && redirect !== rec.redirect) return oauthError('invalid_grant', 'redirect_uri does not match the authorization request.');
    const res = form.get('resource');
    if (res && rec.resource && res !== rec.resource) return oauthError('invalid_target', 'resource does not match the authorization request.');
    if (!safeEqual(await s256(verifier), rec.challenge)) {
      await kvDel(env, key);
      return oauthError('invalid_grant', 'PKCE verification failed.');
    }
    await kvPut(env, key, { grant_id: rec.grant_id, used: true }, CODE_TTL);
    const out = await issueTokens(env, { grant_id: rec.grant_id, client_id: rec.client_id, scope: rec.scope, resource: rec.resource || '', token_id: rec.token_id }, rec.ioa);
    console.log(JSON.stringify({ t: 'oauth', ev: 'token', grant: 'authorization_code', client: c.id, tid: rec.token_id }));
    return json(out);
  }

  if (gt === 'refresh_token') {
    const rt = String(form.get('refresh_token') || '');
    if (!rt) return oauthError('invalid_request', 'refresh_token is required.');
    const key = await K.refresh(rt);
    const box = await kvGet(env, key);
    if (!box) return oauthError('invalid_grant', 'The refresh token is unknown, revoked or expired.');
    const rec = await unseal(rt, box.s);
    if (!rec || rec.exp < now()) return oauthError('invalid_grant', 'The refresh token is unknown, revoked or expired.');
    if (box.rotated) {
      // A rotated refresh token came back: treat the grant as stolen (OAuth 2.1 4.3.1).
      await killGrant(env, rec.grant_id, rec.ioa, rec.token_id);
      await kvDel(env, key);
      console.log(JSON.stringify({ t: 'oauth', ev: 'refresh_replay', client: c.id, tid: rec.token_id }));
      return oauthError('invalid_grant', 'This refresh token was already used; the grant is revoked. Connect again.');
    }
    if (rec.client_id !== c.id) return oauthError('invalid_grant', 'The refresh token was issued to another client.');
    const g = await kvGet(env, K.grant(rec.grant_id));
    if (!g || g.refresh_key !== key) return oauthError('invalid_grant', 'The refresh token is unknown, revoked or expired.');
    let scope = rec.scope;
    if (form.get('scope')) {
      const asked = normScope(form.get('scope'));
      if (asked === null || asked.split(' ').some((s) => !rec.scope.split(' ').includes(s))) return oauthError('invalid_scope', 'A refresh may only narrow the scope.');
      scope = asked;
    }
    if (g.access_key) await kvDel(env, g.access_key);
    // Keep the old record, marked rotated, so a replay can be detected and the grant killed.
    await kvPut(env, key, { grant_id: rec.grant_id, rotated: true, s: box.s }, Math.max(60, rec.exp - now()));
    const out = await issueTokens(env, { grant_id: rec.grant_id, client_id: rec.client_id, scope, resource: rec.resource, token_id: rec.token_id, created: g.created }, rec.ioa);
    console.log(JSON.stringify({ t: 'oauth', ev: 'token', grant: 'refresh_token', client: c.id, tid: rec.token_id }));
    return json(out);
  }

  return oauthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token.');
}

async function revokeEndpoint(request, env) {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.includes('application/x-www-form-urlencoded')) return oauthError('invalid_request', 'Send application/x-www-form-urlencoded.');
  const form = await request.formData();
  const c = await authClient(request, form, env);
  if (c instanceof Response) return c;
  const token = String(form.get('token') || '');
  if (!token) return oauthError('invalid_request', 'token is required.');
  const tries = form.get('token_type_hint') === 'access_token' ? ['access', 'refresh'] : ['refresh', 'access'];
  for (const kind of tries) {
    const key = await K[kind](token);
    const box = await kvGet(env, key);
    if (!box) continue;
    const rec = await unseal(token, box.s);
    if (!rec || rec.client_id !== c.id) break; // RFC 7009: another client's token is ignored, still 200
    if (kind === 'access') {
      await kvDel(env, key);
    } else {
      // Revoking the refresh token ends the grant and the ioa_ token behind it.
      await killGrant(env, rec.grant_id, rec.ioa, rec.token_id);
      await kvDel(env, key);
    }
    console.log(JSON.stringify({ t: 'oauth', ev: 'revoked', kind, client: c.id, tid: rec.token_id }));
    break;
  }
  return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store', ...API_CORS } });
}

/** Resolve an OAuth access token to its record ({ ioa, token_id, scope, ... }) or null. */
export async function lookupAccessToken(env, token) {
  if (!env.OAUTH_KV || !/^iot_[A-Za-z0-9_-]{30,80}$/.test(token)) return null;
  const box = await kvGet(env, await K.access(token));
  if (!box) return null;
  const rec = await unseal(token, box.s);
  if (!rec || rec.exp < now()) return null;
  return rec;
}

// ---------- router ----------

const PRM_PATHS = ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource/mcp/oauth'];
const ASM_PATHS = ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp', '/.well-known/oauth-authorization-server/mcp/oauth', '/.well-known/openid-configuration'];
export const OAUTH_PATHS = new Set([...PRM_PATHS, ...ASM_PATHS, '/oauth/register', '/oauth/authorize', '/oauth/token', '/oauth/revoke']);

async function limited(binding, key) {
  if (!binding) return false;
  try { const r = await binding.limit({ key }); return !r.success; } catch { return false; }
}

/** Handle an OAuth path, or return null when the path is not ours. */
export async function handleOAuth(request, env) {
  const url = new URL(request.url);
  const p = url.pathname;
  if (!OAUTH_PATHS.has(p)) return null;
  const origin = url.origin;
  const clientIp = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const m = request.method;

  if (m === 'OPTIONS' && p !== '/oauth/authorize') return new Response(null, { status: 204, headers: API_CORS });
  if (PRM_PATHS.includes(p)) {
    if (m !== 'GET' && m !== 'HEAD') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    const res = p.endsWith('/mcp') ? '/mcp' : OAUTH_MCP_PATH;
    return json(protectedResourceMetadata(origin, res), 200, { 'Cache-Control': 'public, max-age=300' });
  }
  if (ASM_PATHS.includes(p)) {
    if (m !== 'GET' && m !== 'HEAD') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    if (p === '/.well-known/openid-configuration') return json({ error: 'not_found', error_description: 'No OpenID Connect here; see /.well-known/oauth-authorization-server.' }, 404);
    return json(authServerMetadata(origin), 200, { 'Cache-Control': 'public, max-age=300' });
  }

  if (!env.OAUTH_KV) return oauthError('temporarily_unavailable', 'OAuth is not configured on this deployment (no OAUTH_KV binding).', 503);

  if (p === '/oauth/register' || p === '/oauth/authorize') {
    if (await limited(env.RL_OAUTH, `oa:${clientIp}`)) {
      if (p === '/oauth/authorize') return new Response(page('Slow down', '<h1>Too many tries</h1><p>Wait a minute and try again.</p>', 429).body, { status: 429, headers: { ...PAGE_HEADERS, 'Retry-After': '60' } });
      return oauthError('slow_down', 'Rate limited: wait 60 seconds.', 429, { 'Retry-After': '60' });
    }
  } else if (await limited(env.RL_OAUTH_TOKEN, `ot:${clientIp}`)) {
    return oauthError('slow_down', 'Rate limited: wait 60 seconds.', 429, { 'Retry-After': '60' });
  }

  if (p === '/oauth/register') return m === 'POST' ? register(request, env) : json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (p === '/oauth/authorize') {
    if (m === 'GET') return authorizeGet(url, env);
    if (m === 'POST') return authorizePost(request, url, env, clientIp);
    return page('Method not allowed', '<h1>Method not allowed</h1>', 405);
  }
  if (p === '/oauth/token') return m === 'POST' ? tokenEndpoint(request, env) : json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  if (p === '/oauth/revoke') return m === 'POST' ? revokeEndpoint(request, env) : json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  return null;
}
