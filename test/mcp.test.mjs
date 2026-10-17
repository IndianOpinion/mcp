// Local tests for the io-mcp Worker: the Worker module runs in Node against
// the REST stub (test/stub-rest.mjs, shared with the CLI repo). Covers initialize (modern and
// legacy), tools/list, every tool's happy path and auth failure, prompts,
// resources, discovery files and the edge guards.
//   node --test test/

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import worker from '../src/index.js';
import { TOOL_NAMES } from '../src/tools.js';
import { startStub, GOOD_TOKEN, GOOD_CODE, EMAIL } from './stub-rest.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', 'public');
const REVOKED = 'ioa_000000000000_revokedrevokedrevoked';

let stub; let deadStub;
const logs = [];
const origLog = console.log;

const assets = {
  async fetch(req) {
    const p = new URL(req.url).pathname;
    try {
      const body = await readFile(path.join(PUBLIC, p));
      return new Response(body, { status: 200 });
    } catch { return new Response('nope', { status: 404 }); }
  },
};

function envFor(s, extra = {}) {
  return { IO_API: s.api, SITE: s.url, ASSETS: assets, ...extra };
}

const seen = [];
function workerFetch(env, host = 'localhost') {
  return async (url, init = {}) => {
    const headers = new Headers(init.headers || {});
    headers.set('Host', host);
    seen.push({ pv: headers.get('MCP-Protocol-Version'), method: headers.get('Mcp-Method'), name: headers.get('Mcp-Name') });
    return worker.fetch(new Request(url, { ...init, headers }), env, {});
  };
}

async function connect(env, { token, mode = 'legacy' } = {}) {
  const client = new Client({ name: 'io-test', version: '1.0.0' }, { versionNegotiation: { mode } });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: workerFetch(env),
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}

const textOf = (r) => (r.content || []).map((c) => c.text).join('\n');

before(async () => {
  stub = await startStub();
  deadStub = await startStub({ agentLive: false });
  console.log = (...a) => { logs.push(a.join(' ')); };
});
after(async () => {
  console.log = origLog;
  await stub.close();
  await deadStub.close();
});

test('initialize, legacy handshake through the SDK client', async () => {
  const c = await connect(envFor(stub));
  const info = c.getServerVersion();
  assert.equal(info.name, 'indianopinion');
  assert.match(c.getInstructions(), /untrusted third-party-derived data/);
  await c.close();
});

test('initialize, modern 2026-07-28 negotiation', async () => {
  const c = await connect(envFor(stub), { mode: { pin: '2026-07-28' } });
  const mark = seen.length;
  const { tools } = await c.listTools();
  assert.equal(tools.length, 14);
  const r = await c.callTool({ name: 'search_briefs', arguments: { q: 'metro' } });
  assert.ok(!r.isError, textOf(r));
  const modern = seen.slice(mark);
  assert.ok(modern.some((x) => x.pv === '2026-07-28' && x.method === 'tools/call' && x.name === 'search_briefs'), JSON.stringify(modern));
  await c.close();
});

test('legacy handshake by hand: initialize, initialized, tools/list', async () => {
  const f = workerFetch(envFor(stub));
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  let r = await f('http://localhost/mcp', { method: 'POST', headers: h, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'old', version: '0' } } }) });
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.match(body, /"protocolVersion":"2025-06-18"/);
  r = await f('http://localhost/mcp', { method: 'POST', headers: { ...h, 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(r.status, 202);
  r = await f('http://localhost/mcp', { method: 'POST', headers: { ...h, 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /search_briefs/);
});

test('tools/list: 14 tools, titles, all four hints explicit, deterministic order', async () => {
  const c = await connect(envFor(stub));
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name), TOOL_NAMES);
  for (const t of tools) {
    assert.ok(t.title, `${t.name} title`);
    assert.ok(t.description.length > 60, `${t.name} description`);
    for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.equal(typeof t.annotations[k], 'boolean', `${t.name} ${k}`);
    }
    assert.ok(t.outputSchema, `${t.name} outputSchema`);
    assert.ok(/^[a-z_]{3,24}$/.test(t.name), t.name);
  }
  const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
  assert.equal(byName.signup_start.openWorldHint, true);
  assert.equal(byName.unsubscribe.destructiveHint, true);
  assert.equal(byName.unfollow_topic.destructiveHint, true);
  assert.equal(byName.update_preferences.destructiveHint, false);
  assert.equal(byName.get_digest.readOnlyHint, true);
  const sb = tools.find((t) => t.name === 'search_briefs');
  assert.equal(sb.inputSchema.properties.limit.maximum, 25);
  await c.close();
});

test('public tools: happy paths without a token', async () => {
  const c = await connect(envFor(stub));
  let r = await c.callTool({ name: 'search_briefs', arguments: { q: 'bengaluru metro' } });
  assert.ok(!r.isError, textOf(r));
  assert.equal(r.structuredContent.items.length, 1);
  assert.equal(r.structuredContent.items[0].post_id, 99812);
  assert.ok(r.structuredContent.items[0].md_url.endsWith('.md'));
  assert.equal(r.structuredContent.items[0].framing['pro-government'], 1);
  r = await c.callTool({ name: 'search_briefs', arguments: { category: 'Politics', limit: 1 } });
  assert.equal(r.structuredContent.items.length, 1);
  assert.ok(r.structuredContent.next_cursor);
  const r2 = await c.callTool({ name: 'search_briefs', arguments: { cursor: r.structuredContent.next_cursor, limit: 1 } });
  assert.equal(r2.structuredContent.items[0].category, 'Politics');
  assert.notEqual(r2.structuredContent.items[0].post_id, r.structuredContent.items[0].post_id);
  r = await c.callTool({ name: 'search_briefs', arguments: {} });
  assert.equal(r.structuredContent.items.length, 5);
  r = await c.callTool({ name: 'search_briefs', arguments: { limit: 26 } });
  assert.ok(r.isError, 'limit above 25 is refused');

  r = await c.callTool({ name: 'get_brief', arguments: { id_or_url: '99812' } });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /## Coverage/);
  r = await c.callTool({ name: 'get_brief', arguments: { id_or_url: `${stub.url}/story-99812/`, include: ['sources', 'analysis'] } });
  assert.ok(!r.isError, textOf(r));
  assert.equal(r.structuredContent.sources.length, 3);
  r = await c.callTool({ name: 'get_brief', arguments: { id_or_url: `${stub.url}/story-99812.md` } });
  assert.equal(r.structuredContent.post_id, 99812);
  r = await c.callTool({ name: 'get_brief', arguments: { id_or_url: 'https://example.com/x/' } });
  assert.ok(r.isError);
  assert.match(textOf(r), /only reads indianopinion.org/);
  r = await c.callTool({ name: 'get_brief', arguments: { id_or_url: '1' } });
  assert.ok(r.isError);

  r = await c.callTool({ name: 'signup_start', arguments: { email: EMAIL, agent_name: 'Morning briefer' } });
  assert.ok(!r.isError, textOf(r));
  assert.match(textOf(r), /signup_verify/);
  assert.match(textOf(r), /daily digest/);
  r = await c.callTool({ name: 'signup_start', arguments: { email: 'not-an-email' } });
  assert.ok(r.isError);
  assert.match(textOf(r), /invalid_email/);
  r = await c.callTool({ name: 'signup_start', arguments: { email: 'slow@agents.example.org' } });
  assert.ok(r.isError);
  assert.match(textOf(r), /retry after 42 s/);

  r = await c.callTool({ name: 'signup_verify', arguments: { email: EMAIL, code: GOOD_CODE } });
  assert.ok(!r.isError, textOf(r));
  assert.equal(r.structuredContent.token, GOOD_TOKEN);
  assert.match(textOf(r), /daily digest is on/);
  r = await c.callTool({ name: 'signup_verify', arguments: { email: EMAIL, code: '000000' } });
  assert.ok(r.isError);
  assert.match(textOf(r), /attempts left: 4/);
  await c.close();
});

const ACCOUNT_CALLS = {
  get_account: {},
  update_preferences: { breaking: { threshold: 0.25, composite: 'breaking' }, digest: { format: 'json' } },
  list_topics: {},
  follow_topic: { text: 'Supreme Court', tier: 'instant' },
  unfollow_topic: { topic_id: 412 },
  get_digest: {},
  list_breaking: { days: 7 },
  get_breaking_event: { event_id: 5531 },
  unsubscribe: { what: 'breaking' },
  create_browser_link: {},
};

test('account tools: happy path with a token, and the token reaches the REST API', async () => {
  const c = await connect(envFor(stub), { token: GOOD_TOKEN });
  for (const [name, args] of Object.entries(ACCOUNT_CALLS)) {
    const before = stub.requests.length;
    const r = await c.callTool({ name, arguments: args });
    assert.ok(!r.isError, `${name}: ${textOf(r)}`);
    assert.ok(r.structuredContent, `${name} structuredContent`);
    assert.ok(textOf(r).length > 10, `${name} text`);
    const sent = stub.requests.slice(before).find((q) => q.path.includes('/agent/'));
    assert.equal(sent.headers.authorization, `Bearer ${GOOD_TOKEN}`, `${name} forwards the bearer`);
  }
  assert.equal(stub.state.prefs.breaking.threshold, 0.25);
  let r = await c.callTool({ name: 'get_digest', arguments: { date: '2026-10-02', limit: 2 } });
  assert.equal(r.structuredContent.stories.length, 2);
  assert.equal(r.structuredContent.truncated, true);
  r = await c.callTool({ name: 'get_digest', arguments: { date: '1999-01-01' } });
  assert.ok(r.isError);
  assert.match(textOf(r), /not_found/);
  r = await c.callTool({ name: 'follow_topic', arguments: { text: 'metro' } });
  assert.ok(!r.isError);
  assert.equal(r.structuredContent.ambiguous, true);
  assert.match(textOf(r), /key t412/);
  r = await c.callTool({ name: 'follow_topic', arguments: { text: 'x', key: 't1' } });
  assert.ok(r.isError);
  r = await c.callTool({ name: 'update_preferences', arguments: { breaking: { threshold: 1.5 } } });
  assert.ok(r.isError, 'threshold above 1 is refused before the API');
  r = await c.callTool({ name: 'update_preferences', arguments: {} });
  assert.ok(r.isError);
  r = await c.callTool({ name: 'list_breaking', arguments: { only_would_send: true } });
  assert.equal(r.structuredContent.events.length, 1);
  await c.close();
});

test('account tools: auth failure without a token and with a revoked one', async () => {
  const c = await connect(envFor(stub));
  for (const [name, args] of Object.entries(ACCOUNT_CALLS)) {
    const before = stub.requests.length;
    const r = await c.callTool({ name, arguments: args });
    assert.ok(r.isError, `${name} without token`);
    assert.match(textOf(r), /needs an Indian Opinion agent token/);
    assert.equal(stub.requests.length, before, `${name} makes no REST call without a token`);
  }
  await c.close();
  const c2 = await connect(envFor(stub), { token: REVOKED });
  for (const [name, args] of Object.entries(ACCOUNT_CALLS)) {
    const r = await c2.callTool({ name, arguments: args });
    assert.ok(r.isError, `${name} revoked`);
    assert.match(textOf(r), /invalid_token/);
  }
  await c2.close();
});

test('a malformed bearer is a 401 with WWW-Authenticate', async () => {
  const f = workerFetch(envFor(stub));
  const r = await f('http://localhost/mcp', { method: 'POST', headers: { Authorization: 'Bearer not-ours', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('WWW-Authenticate'), /invalid_token/);
});

test('agent API not live yet: account tools say so, public tools still work', async () => {
  const c = await connect(envFor(deadStub), { token: GOOD_TOKEN });
  let r = await c.callTool({ name: 'get_account', arguments: {} });
  assert.ok(r.isError);
  assert.match(textOf(r), /not answering yet/);
  r = await c.callTool({ name: 'signup_start', arguments: { email: EMAIL } });
  assert.match(textOf(r), /not answering yet/);
  r = await c.callTool({ name: 'search_briefs', arguments: {} });
  assert.ok(!r.isError);
  await c.close();
});

test('search_briefs uses the origin cursor when the REST route supports it', async () => {
  const native = await startStub({ briefsNative: true });
  const c = await connect(envFor(native));
  const r = await c.callTool({ name: 'search_briefs', arguments: { q: 'bengaluru', limit: 3 } });
  assert.ok(!r.isError, textOf(r));
  const q = native.requests.find((x) => x.path.endsWith('/briefs'));
  assert.match(q.search, /q=bengaluru/);
  await c.close();
  await native.close();
});

test('prompts and resources', async () => {
  const c = await connect(envFor(stub), { token: GOOD_TOKEN });
  const { prompts } = await c.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name), ['morning_briefing', 'explain_framing_gap', 'watch_topic', 'tune_breaking', 'brief_my_human']);
  const g = await c.getPrompt({ name: 'tune_breaking', arguments: { target_per_day: '2' } });
  assert.match(g.messages[0].content.text, /list_breaking/);
  const { resources } = await c.listResources();
  assert.ok(resources.find((x) => x.uri === 'indianopinion://about'));
  const { resourceTemplates } = await c.listResourceTemplates();
  assert.deepEqual(resourceTemplates.map((t) => t.uriTemplate).sort(), ['indianopinion://brief/{id}', 'indianopinion://digest/{date}']);
  let rr = await c.readResource({ uri: 'indianopinion://about' });
  assert.match(rr.contents[0].text, /How to cite/);
  rr = await c.readResource({ uri: 'indianopinion://brief/99812' });
  assert.match(rr.contents[0].text, /^# Bengaluru Metro/);
  rr = await c.readResource({ uri: 'indianopinion://digest/latest' });
  assert.match(rr.contents[0].text, /Indian Opinion digest 2026-10-02/);
  await c.close();
});

test('discovery files, static assets and pass-through', async () => {
  const env = envFor(stub);
  const f = workerFetch(env, 'indianopinion.org');
  for (const p of ['/.well-known/mcp/server-card.json', '/.well-known/mcp-server-card', '/.well-known/mcp.json']) {
    const r = await f(`https://indianopinion.org${p}`);
    assert.equal(r.status, 200, p);
    const card = await r.json();
    assert.equal(card.remotes[0].url, 'https://indianopinion.org/mcp');
    assert.match(card._status, /draft/);
  }
  let r = await f('https://indianopinion.org/agents.txt');
  const t = await r.text();
  assert.match(t, /^MCP: https:\/\/indianopinion.org\/mcp$/m);
  assert.match(t, /[Dd]raft/);
  r = await f('https://indianopinion.org/agents/openapi.json');
  assert.equal(r.status, 200);
  const oa = await r.json();
  assert.equal(oa.openapi, '3.1.0');
  const ops = new Set();
  for (const item of Object.values(oa.paths)) for (const op of Object.values(item)) if (op.operationId) ops.add(op.operationId);
  for (const n of TOOL_NAMES) assert.ok(ops.has(n), `openapi operationId ${n}`);
  r = await f('https://indianopinion.org/agents/cli/');
  assert.match(await r.text(), /latest\.tgz/);
  r = await f('https://indianopinion.org/agents/skill/SKILL.md');
  assert.equal(r.status, 200, '/agents/skill/SKILL.md');
  // The CLI files are built from https://github.com/IndianOpinion/cli by
  // `npm run build:cli` and are not committed; CI builds them first.
  if (fs.existsSync(path.join(HERE, '..', 'public', 'agents', 'cli', 'latest.json'))) {
    for (const p of ['/agents/cli/io.sh', '/agents/cli/latest.tgz', '/agents/cli/latest.json', '/agents/cli/SHA256SUMS']) {
      r = await f(`https://indianopinion.org${p}`);
      assert.equal(r.status, 200, p);
    }
    r = await f('https://indianopinion.org/agents/cli/io.sh');
    assert.match(r.headers.get('content-type'), /shellscript/);
  }
  // Not ours: handed to the origin unchanged.
  const realFetch = globalThis.fetch;
  let passed = null;
  globalThis.fetch = async (req) => { passed = req.url; return new Response('origin'); };
  try {
    r = await f('https://indianopinion.org/mcp-explained-a-post-slug/');
    assert.equal(await r.text(), 'origin');
    assert.equal(passed, 'https://indianopinion.org/mcp-explained-a-post-slug/');
  } finally { globalThis.fetch = realFetch; }
  // workers.dev: health, and no pass-through
  const fd = workerFetch(env, 'io-mcp.example.workers.dev');
  r = await fd('https://io-mcp.example.workers.dev/health');
  assert.equal((await r.json()).name, 'io-mcp');
  r = await fd('https://io-mcp.example.workers.dev/wp-admin/');
  assert.equal(r.status, 404);
});

test('edge guards: GET is 405, big bodies 413, bad Origin 403', async () => {
  const f = workerFetch(envFor(stub));
  let r = await f('http://localhost/mcp');
  assert.equal(r.status, 405);
  r = await f('http://localhost/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '20000' }, body: 'x'.repeat(20000) });
  assert.equal(r.status, 413);
  r = await f('http://localhost/mcp', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
  assert.equal(r.status, 403);
});

test('the token never appears in the Worker log', async () => {
  assert.ok(logs.length > 10, 'tool calls were logged');
  for (const l of logs) assert.ok(!l.includes(GOOD_TOKEN.split('_')[2]), `secret in log: ${l.slice(0, 80)}`);
});
