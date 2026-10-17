// OAuth 2.1 authorization server tests (phase 2): metadata, dynamic client
// registration, the email-code authorize page, PKCE, refresh rotation and
// replay, revocation (reaching the origin), the 401 challenge, and account tools
// end to end with an OAuth access token. The Worker runs in Node against the
// REST stub with an in-memory KV.
//   node --test test/

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import worker from '../src/index.js';
import { startStub, GOOD_TOKEN, GOOD_CODE, EMAIL } from './stub-rest.mjs';

const ORIGIN = 'http://localhost';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

function memKV() {
  const m = new Map();
  return {
    m,
    async get(k) { const v = m.get(k); if (!v) return null; if (v.exp && v.exp < Date.now()) { m.delete(k); return null; } return v.val; },
    async put(k, val, opts = {}) {
      assert.ok(!opts.expirationTtl || opts.expirationTtl >= 60, 'KV TTL must be at least 60 s');
      m.set(k, { val, exp: opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0 });
    },
    async delete(k) { m.delete(k); },
  };
}

let stub;
const logs = [];
const origLog = console.log;
before(async () => { stub = await startStub(); console.log = (...a) => { logs.push(a.join(' ')); }; });
after(async () => { console.log = origLog; await stub.close(); });

function newEnv(extra = {}) {
  return { IO_API: stub.api, SITE: stub.url, OAUTH_KV: memKV(), ...extra };
}
function call(env, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Host', 'localhost');
  if (!headers.has('CF-Connecting-IP')) headers.set('CF-Connecting-IP', '203.0.113.7');
  return worker.fetch(new Request(ORIGIN + path, { ...init, headers }), env, {});
}
const form = (o) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

async function registerClient(env, body = {}) {
  const r = await call(env, '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', ...body }) });
  assert.equal(r.status, 201);
  return r.json();
}

/** Walk the authorize page: GET, email, code. Returns the redirect Location. */
async function authorize(env, client, { challenge, code = GOOD_CODE, state = 'st-1', extra = {} } = {}) {
  const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, state, code_challenge: challenge, code_challenge_method: 'S256', scope: 'news:read account:read account:write', resource: `${ORIGIN}/mcp/oauth`, ...extra });
  const r1 = await call(env, `/oauth/authorize?${q}`);
  if (r1.status === 302) return { location: new URL(r1.headers.get('Location')), status: 302 };
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('X-Frame-Options'), 'DENY');
  const html = await r1.text();
  assert.match(html, /Connect Claude to Indian Opinion/);
  const req = html.match(/name="req" value="([^"]+)"/)[1];
  const r2 = await call(env, '/oauth/authorize', form({ req, step: 'email', email: EMAIL }));
  assert.equal(r2.status, 200);
  assert.match(await r2.text(), /br\*+@agents\.example\.org/);
  const r3 = await call(env, '/oauth/authorize', form({ req, step: 'code', code }));
  if (r3.status !== 302) return { status: r3.status, html: await r3.text(), req };
  return { location: new URL(r3.headers.get('Location')), status: 302, req };
}

async function token(env, params, headers = {}) {
  const init = form(params);
  Object.assign(init.headers, headers);
  const r = await call(env, '/oauth/token', init);
  return { status: r.status, body: await r.json(), headers: r.headers };
}

async function fullFlow(env) {
  const client = await registerClient(env);
  const { verifier, challenge } = pkce();
  const a = await authorize(env, client, { challenge });
  assert.equal(a.status, 302);
  const t = await token(env, { grant_type: 'authorization_code', code: a.location.searchParams.get('code'), code_verifier: verifier, client_id: client.client_id, redirect_uri: REDIRECT, resource: `${ORIGIN}/mcp/oauth` });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  return { client, tokens: t.body };
}

test('metadata: protected resource (RFC 9728) and authorization server (RFC 8414)', async () => {
  const env = newEnv();
  for (const [p, res] of [['/.well-known/oauth-protected-resource', '/mcp/oauth'], ['/.well-known/oauth-protected-resource/mcp/oauth', '/mcp/oauth'], ['/.well-known/oauth-protected-resource/mcp', '/mcp']]) {
    const r = await call(env, p);
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
    const j = await r.json();
    assert.equal(j.resource, ORIGIN + res);
    assert.deepEqual(j.authorization_servers, [ORIGIN]);
    assert.deepEqual(j.bearer_methods_supported, ['header']);
  }
  for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp/oauth']) {
    const j = await (await call(env, p)).json();
    assert.equal(j.issuer, ORIGIN);
    assert.equal(j.authorization_endpoint, `${ORIGIN}/oauth/authorize`);
    assert.equal(j.token_endpoint, `${ORIGIN}/oauth/token`);
    assert.equal(j.registration_endpoint, `${ORIGIN}/oauth/register`);
    assert.equal(j.revocation_endpoint, `${ORIGIN}/oauth/revoke`);
    assert.deepEqual(j.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(j.response_types_supported, ['code']);
    assert.ok(j.grant_types_supported.includes('refresh_token'));
    assert.ok(j.token_endpoint_auth_methods_supported.includes('none'));
  }
  // Metadata answers even before the KV binding exists; the flow does not.
  const bare = { IO_API: stub.api, SITE: stub.url };
  assert.equal((await call(bare, '/.well-known/oauth-authorization-server')).status, 200);
  assert.equal((await call(bare, '/oauth/register', { method: 'POST', body: '{}' })).status, 503);
});

test('dynamic client registration (RFC 7591): public and confidential, bad metadata refused', async () => {
  const env = newEnv();
  const pub = await registerClient(env);
  assert.match(pub.client_id, /^ioc_/);
  assert.equal(pub.client_secret, undefined);
  assert.equal(pub.token_endpoint_auth_method, 'none');
  assert.deepEqual(pub.redirect_uris, [REDIRECT]);
  const conf = await registerClient(env, { client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'client_secret_post' });
  assert.match(conf.client_secret, /^iocs_/);
  // The secret is stored hashed only.
  const stored = [...env.OAUTH_KV.m.values()].map((v) => v.val).join('\n');
  assert.ok(!stored.includes(conf.client_secret));
  for (const bad of [{ redirect_uris: [] }, { redirect_uris: ['http://evil.example/cb'] }, { redirect_uris: ['https://x.example/cb#frag'] }, { grant_types: ['password'] }, { token_endpoint_auth_method: 'private_key_jwt' }]) {
    const r = await call(env, '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [REDIRECT], ...bad }) });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.match((await r.json()).error, /invalid_/);
  }
});

test('authorize: email code sign-in, PKCE S256 success, tokens hashed and sealed at rest', async () => {
  const env = newEnv();
  const client = await registerClient(env);
  const { verifier, challenge } = pkce();
  const before = stub.requests.length;
  const a = await authorize(env, client, { challenge });
  assert.equal(a.status, 302);
  assert.equal(a.location.origin + a.location.pathname, REDIRECT);
  assert.equal(a.location.searchParams.get('state'), 'st-1');
  assert.equal(a.location.searchParams.get('iss'), ORIGIN);
  const code = a.location.searchParams.get('code');
  assert.match(code, /^ioz_/);
  const paths = stub.requests.slice(before).map((r) => `${r.method} ${r.path || r.url}`).join(' ');
  assert.match(paths, /agent\/start/);
  assert.match(paths, /agent\/verify/);

  const t = await token(env, { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: REDIRECT });
  assert.equal(t.status, 200);
  assert.equal(t.headers.get('Cache-Control'), 'no-store');
  assert.match(t.body.access_token, /^iot_/);
  assert.match(t.body.refresh_token, /^ior_/);
  assert.equal(t.body.token_type, 'Bearer');
  assert.equal(t.body.expires_in, 3600);
  const stored = [...env.OAUTH_KV.m.entries()].map(([k, v]) => k + ' ' + v.val).join('\n');
  for (const secret of [GOOD_TOKEN, t.body.access_token, t.body.refresh_token, code, EMAIL]) assert.ok(!stored.includes(secret), 'secret at rest');
  // The code is single use; a replay is refused and revokes what it issued.
  const again = await token(env, { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id });
  assert.equal(again.status, 400);
  assert.equal(again.body.error, 'invalid_grant');
  const r = await call(env, '/mcp/oauth', { method: 'POST', headers: { Authorization: `Bearer ${t.body.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  assert.equal(r.status, 401, 'tokens from a replayed code are revoked');
});

test('PKCE failures: missing challenge, plain method, wrong verifier, wrong client, wrong redirect', async () => {
  const env = newEnv();
  const client = await registerClient(env);
  let a = await authorize(env, client, { challenge: '' });
  assert.equal(a.location.searchParams.get('error'), 'invalid_request');
  assert.match(a.location.searchParams.get('error_description'), /PKCE is required/);
  const p = pkce();
  a = await authorize(env, client, { challenge: p.challenge, extra: { code_challenge_method: 'plain' } });
  assert.equal(a.location.searchParams.get('error'), 'invalid_request');
  a = await authorize(env, client, { challenge: p.challenge, extra: { resource: 'https://other.example/mcp' } });
  assert.equal(a.location.searchParams.get('error'), 'invalid_target');
  // Unregistered redirect: an error page, never a redirect.
  const r = await call(env, `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: p.challenge, code_challenge_method: 'S256' })}`);
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('Location'), null);

  a = await authorize(env, client, { challenge: p.challenge });
  const code = a.location.searchParams.get('code');
  const wrong = await token(env, { grant_type: 'authorization_code', code, code_verifier: pkce().verifier, client_id: client.client_id });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'invalid_grant');
  assert.match(wrong.body.error_description, /PKCE/);
  const after = await token(env, { grant_type: 'authorization_code', code, code_verifier: p.verifier, client_id: client.client_id });
  assert.equal(after.body.error, 'invalid_grant', 'a failed PKCE attempt burns the code');

  a = await authorize(env, client, { challenge: p.challenge });
  const other = await registerClient(env);
  const t1 = await token(env, { grant_type: 'authorization_code', code: a.location.searchParams.get('code'), code_verifier: p.verifier, client_id: other.client_id });
  assert.equal(t1.body.error, 'invalid_grant');
  const t2 = await token(env, { grant_type: 'authorization_code', code: a.location.searchParams.get('code'), code_verifier: p.verifier, client_id: client.client_id, redirect_uri: 'https://claude.ai/other' });
  assert.equal(t2.body.error, 'invalid_grant');
  const t3 = await token(env, { grant_type: 'authorization_code', code: a.location.searchParams.get('code'), client_id: client.client_id });
  assert.equal(t3.body.error, 'invalid_request', 'code_verifier is required');
});

test('authorize: a wrong email code re-shows the form and issues nothing', async () => {
  const env = newEnv();
  const client = await registerClient(env);
  const a = await authorize(env, client, { challenge: pkce().challenge, code: '000000' });
  assert.equal(a.status, 400);
  assert.match(a.html, /That code is not right\. 4 tries left/);
  assert.ok(![...env.OAUTH_KV.m.keys()].some((k) => k.startsWith('ac:')));
  const expired = await call(env, '/oauth/authorize', form({ req: 'x'.repeat(32), step: 'code', code: GOOD_CODE }));
  assert.equal(expired.status, 400);
  assert.match(await expired.text(), /expired/);
});

test('confidential client: secret required at the token endpoint (post and basic)', async () => {
  const env = newEnv();
  const client = await registerClient(env, { token_endpoint_auth_method: 'client_secret_basic' });
  const p = pkce();
  let a = await authorize(env, client, { challenge: p.challenge });
  const noSecret = await token(env, { grant_type: 'authorization_code', code: a.location.searchParams.get('code'), code_verifier: p.verifier, client_id: client.client_id });
  assert.equal(noSecret.status, 401);
  assert.equal(noSecret.body.error, 'invalid_client');
  a = await authorize(env, client, { challenge: p.challenge });
  const basic = 'Basic ' + Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64');
  const ok = await token(env, { grant_type: 'authorization_code', code: a.location.searchParams.get('code'), code_verifier: p.verifier }, { Authorization: basic });
  assert.equal(ok.status, 200);
});

test('refresh: rotation, old token refused, replay revokes the grant and the origin token', async () => {
  const env = newEnv();
  const { client, tokens } = await fullFlow(env);
  const r1 = await token(env, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refresh_token, tokens.refresh_token);
  assert.notEqual(r1.body.access_token, tokens.access_token);
  const hdr = (t) => ({ method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  assert.equal((await call(env, '/mcp/oauth', hdr(tokens.access_token))).status, 401, 'old access token dropped on refresh');
  assert.equal((await call(env, '/mcp/oauth', hdr(r1.body.access_token))).status, 200);
  // Narrowing scope is allowed, widening is not.
  const narrow = await token(env, { grant_type: 'refresh_token', refresh_token: r1.body.refresh_token, client_id: client.client_id, scope: 'news:read' });
  assert.equal(narrow.status, 200);
  assert.equal(narrow.body.scope, 'news:read');
  const wide = await token(env, { grant_type: 'refresh_token', refresh_token: narrow.body.refresh_token, client_id: client.client_id, scope: 'news:read account:write' });
  assert.equal(wide.body.error, 'invalid_scope');
  // Another client cannot use it.
  const other = await registerClient(env);
  assert.equal((await token(env, { grant_type: 'refresh_token', refresh_token: narrow.body.refresh_token, client_id: other.client_id })).body.error, 'invalid_grant');
  // Replay of a rotated refresh token kills the whole grant and revokes the ioa_ token at the origin.
  const before = stub.requests.length;
  const replay = await token(env, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id });
  assert.equal(replay.status, 400);
  assert.match(replay.body.error_description, /already used/);
  assert.ok(stub.requests.slice(before).some((r) => r.method === 'DELETE' && /agent\/tokens\/3f9c2a71b0de/.test(r.path || r.url)), 'origin token revoked');
  assert.equal((await token(env, { grant_type: 'refresh_token', refresh_token: narrow.body.refresh_token, client_id: client.client_id })).body.error, 'invalid_grant', 'live refresh token dead after replay');
  assert.equal((await token(env, { grant_type: 'password', client_id: client.client_id })).body.error, 'unsupported_grant_type');
});

test('revocation (RFC 7009): access token, refresh token ends the grant at the origin, unknown token is 200', async () => {
  const env = newEnv();
  const { client, tokens } = await fullFlow(env);
  const hdr = (t) => ({ method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  let r = await call(env, '/oauth/revoke', form({ token: tokens.access_token, token_type_hint: 'access_token', client_id: client.client_id }));
  assert.equal(r.status, 200);
  assert.equal((await call(env, '/mcp/oauth', hdr(tokens.access_token))).status, 401);
  // The refresh token still works after the access token is revoked.
  const r1 = await token(env, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: client.client_id });
  assert.equal(r1.status, 200);
  const before = stub.requests.length;
  r = await call(env, '/oauth/revoke', form({ token: r1.body.refresh_token, client_id: client.client_id }));
  assert.equal(r.status, 200);
  assert.ok(stub.requests.slice(before).some((x) => x.method === 'DELETE' && /agent\/tokens\//.test(x.path || x.url)));
  assert.equal((await call(env, '/mcp/oauth', hdr(r1.body.access_token))).status, 401, 'access token of a revoked grant is dead');
  assert.equal((await token(env, { grant_type: 'refresh_token', refresh_token: r1.body.refresh_token, client_id: client.client_id })).body.error, 'invalid_grant');
  r = await call(env, '/oauth/revoke', form({ token: 'ior_nothing', client_id: client.client_id }));
  assert.equal(r.status, 200);
  r = await call(env, '/oauth/revoke', form({ token: 'x', client_id: 'ioc_unknownunknown' }));
  assert.equal(r.status, 401);
});

test('401 challenge: /mcp/oauth without a token, bad tokens on both endpoints; /mcp stays public', async () => {
  const env = newEnv();
  const body = { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' };
  let r = await call(env, '/mcp/oauth', body);
  assert.equal(r.status, 401);
  const w = r.headers.get('WWW-Authenticate');
  assert.match(w, /^Bearer /);
  assert.match(w, /resource_metadata="http:\/\/localhost\/\.well-known\/oauth-protected-resource\/mcp\/oauth"/);
  assert.doesNotMatch(w, /error=/);
  assert.match(r.headers.get('Access-Control-Expose-Headers'), /WWW-Authenticate/);
  // The challenge points at a document that names this server as the authorization server.
  const prm = await (await call(env, '/.well-known/oauth-protected-resource/mcp/oauth')).json();
  assert.deepEqual(prm.authorization_servers, [ORIGIN]);

  r = await call(env, '/mcp', { ...body, headers: { ...body.headers, Authorization: 'Bearer iot_' + 'a'.repeat(43) } });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('WWW-Authenticate'), /error="invalid_token"/);
  assert.match(r.headers.get('WWW-Authenticate'), /oauth-protected-resource\/mcp"/);
  // Unchanged phase 1 behaviour: /mcp without a token answers with the public tools.
  r = await call(env, '/mcp', body);
  assert.equal(r.status, 200);
});

test('end to end: account tools through an OAuth access token reach the REST API as the ioa_ bearer', async () => {
  const env = newEnv();
  const { tokens } = await fullFlow(env);
  const client = new Client({ name: 'oauth-test', version: '1.0.0' }, { versionNegotiation: { mode: 'legacy' } });
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp/oauth`), {
    fetch: (url, init = {}) => { const h = new Headers(init.headers || {}); h.set('Host', 'localhost'); return worker.fetch(new Request(url, { ...init, headers: h }), env, {}); },
    requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  });
  await client.connect(transport);
  const before = stub.requests.length;
  const r = await client.callTool({ name: 'get_account', arguments: {} });
  assert.ok(!r.isError, JSON.stringify(r));
  assert.match(r.content.map((c) => c.text).join('\n'), /Account 1234/);
  const sent = stub.requests.slice(before).find((x) => /agent\/me/.test(x.path || x.url));
  assert.ok(sent, 'REST call made');
  assert.equal(sent.headers.authorization, `Bearer ${GOOD_TOKEN}`);
  await client.close();
  // Nothing secret in the log.
  const all = logs.join('\n');
  for (const s of [GOOD_TOKEN, tokens.access_token, tokens.refresh_token, EMAIL]) assert.ok(!all.includes(s), 'secret in log');
});

test('rate limits on authorize and token endpoints', async () => {
  const deny = { async limit() { return { success: false }; } };
  const env = newEnv({ RL_OAUTH: deny, RL_OAUTH_TOKEN: deny });
  let r = await call(env, '/oauth/authorize?client_id=ioc_x');
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('Retry-After'), '60');
  r = await call(env, '/oauth/token', form({ grant_type: 'refresh_token' }));
  assert.equal(r.status, 429);
  r = await call(env, '/oauth/register', { method: 'POST', body: '{}' });
  assert.equal(r.status, 429);
});
