// Tests for the 0.2.0 fixes (19 October 2026): IndianOpinion/mcp #3, #6, #7, #8,
// #9, #10 and #11, and cursor paging. The same file runs in the private
// platform tree (io-mcp-worker/) and in the public mirror (IndianOpinion/mcp):
// the REST stub is test/stub-rest.mjs in the mirror and io-cli/test/stub-rest.mjs
// in the platform tree. No network.
//   node --test test/

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import worker from '../src/index.js';
import { TOOL_NAMES, errorText, keysetCursor } from '../src/tools.js';
import { ApiError } from '../src/client.js';
import { VERSION } from '../src/version.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const stubPath = [path.join(HERE, 'stub-rest.mjs'), path.join(HERE, '..', '..', 'io-cli', 'test', 'stub-rest.mjs')].find((f) => fs.existsSync(f));
const { startStub, GOOD_TOKEN } = await import(pathToFileURL(stubPath).href);

const origLog = console.log;
let stub;
before(async () => { stub = await startStub(); console.log = () => {}; });
after(async () => { console.log = origLog; await stub.close(); });

const envFor = (s, extra = {}) => ({ IO_API: s.api, SITE: s.url, ...extra });
async function connect(env, { token } = {}) {
  const client = new Client({ name: 'io-test', version: '1.0.0' }, { versionNegotiation: { mode: 'legacy' } });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: (url, init = {}) => { const h = new Headers(init.headers || {}); h.set('Host', 'localhost'); return worker.fetch(new Request(url, { ...init, headers: h }), env, {}); },
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  await client.connect(transport);
  return client;
}
const textOf = (r) => (r.content || []).map((c) => c.text).join('\n');
async function rpc(env, body, headers = {}) {
  const r = await worker.fetch(new Request('http://localhost/mcp', {
    method: 'POST', body: JSON.stringify(body),
    headers: { Host: 'localhost', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
  }), env, {});
  const t = await r.text();
  const line = t.split('\n').find((l) => l.startsWith('data: '));
  return JSON.parse(line ? line.slice(6) : t);
}

test('#11: serverInfo.version is the bumped VERSION', async () => {
  assert.equal(VERSION, '0.2.1');
  const c = await connect(envFor(stub));
  assert.equal(c.getServerVersion().version, VERSION);
  await c.close();
});

test('#9: listChanged is false for tools, prompts and resources', async () => {
  const j = await rpc(envFor(stub), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'qa', version: '1' } } });
  const caps = j.result.capabilities;
  assert.equal(caps.tools.listChanged, false);
  assert.equal(caps.prompts.listChanged, false);
  assert.equal(caps.resources.listChanged, false);
});

test('#7: every tool advertises a real outputSchema, and results validate against it', async () => {
  const c = await connect(envFor(stub));
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name), TOOL_NAMES);
  for (const t of tools) {
    assert.ok(Object.keys(t.outputSchema.properties || {}).length >= 2, `${t.name} outputSchema has properties`);
  }
  const sb = tools.find((t) => t.name === 'search_briefs').outputSchema;
  for (const k of ['ok', 'count', 'items', 'next_cursor', 'truncated']) assert.ok(sb.required.includes(k), `search_briefs requires ${k}`);
  assert.ok(sb.properties.items.items.required.includes('post_id'));
  // The SDK validates structuredContent against outputSchema; a mismatch would be an isError result.
  let r = await c.callTool({ name: 'search_briefs', arguments: { limit: 2 } });
  assert.ok(!r.isError, textOf(r));
  r = await c.callTool({ name: 'get_brief', arguments: { id_or_url: '99812', include: ['brief', 'analysis', 'coverage', 'sources'] } });
  assert.ok(!r.isError, textOf(r));
  await c.close();
});

test('#8: error text has a space before "(error: ...)" and a 404 hint that fits the tool', () => {
  const e404 = new ApiError(404, { code: 'io_not_found', message: 'No such article.' });
  assert.equal(errorText(e404, 'get_brief'), 'No such article. (error: io_not_found). Check the id or URL; search_briefs finds published briefs.');
  assert.doesNotMatch(errorText(e404, 'get_brief'), /date/);
  const bad = new ApiError(400, { error: 'invalid_date', message: 'Dates are India dates written YYYY-MM-DD.', field: 'date' });
  assert.equal(errorText(bad, 'get_digest'), 'Dates are India dates written YYYY-MM-DD. (error: invalid_date, field: date). Fix the value and call again.');
  assert.match(errorText(new ApiError(404, { error: 'not_found', message: 'No digest.' }), 'get_digest'), /Check the date/);
  assert.match(errorText(new ApiError(404, { error: 'not_found', message: 'No event.' }), 'get_breaking_event'), /Check the event_id/);
});

test('#6: resources/read errors are JSON-RPC errors, ids and dates are validated', async () => {
  const anon = envFor(stub);
  const read = (env, uri, token) => rpc(env, { jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri } }, token ? { Authorization: `Bearer ${token}` } : {});
  let j = await read(anon, 'indianopinion://brief/999999999');
  assert.ok(j.error, JSON.stringify(j));
  assert.ok([-32602, -32002].includes(j.error.code), `not found code ${j.error.code}`);
  assert.match(j.error.message, /No such article\. \(error: io_not_found\)/);
  const before2 = stub.requests.length;
  j = await read(anon, 'indianopinion://brief/abc');
  assert.ok(j.error && [-32602, -32002].includes(j.error.code), JSON.stringify(j));
  assert.doesNotMatch(j.error.message, /No route was found/);
  j = await read(anon, 'indianopinion://brief/9981x2');
  assert.ok(j.error, 'a typo never reads another article');
  assert.equal(stub.requests.length, before2, 'malformed ids make no REST call');
  j = await read(anon, 'indianopinion://digest/latest');
  assert.ok(j.error, 'digest without a token is an error, not content');
  assert.equal(j.error.code, -32001);
  assert.match(j.error.message, /needs an agent token/);
  j = await read(anon, 'indianopinion://digest/2026-13-45', GOOD_TOKEN);
  assert.ok(j.error && [-32602, -32002].includes(j.error.code), 'impossible date refused');
  j = await read(anon, 'indianopinion://digest/1999-01-01', GOOD_TOKEN);
  assert.ok(j.error && [-32602, -32002].includes(j.error.code), JSON.stringify(j));
  j = await read(anon, 'indianopinion://brief/99812');
  assert.match(j.result.contents[0].text, /^# Bengaluru Metro/);
});

test('#10: sign-up text says the digest AND Breaking News are switched on', async () => {
  const c = await connect(envFor(stub));
  const { tools } = await c.listTools();
  const desc = Object.fromEntries(tools.map((t) => [t.name, t.description]));
  for (const n of ['signup_start', 'signup_verify']) {
    assert.match(desc[n], /daily digest/);
    assert.match(desc[n], /Breaking News/);
  }
  let r = await c.callTool({ name: 'signup_start', arguments: { email: 'briefing-bot@agents.example.org' } });
  assert.match(textOf(r), /daily digest and Breaking News/);
  r = await c.callTool({ name: 'signup_verify', arguments: { email: 'briefing-bot@agents.example.org', code: '482913' } });
  assert.match(textOf(r), /Breaking News is on/);
  assert.match(c.getInstructions(), /Breaking News/);
  await c.close();
});

test('#3: close_account closes with confirm true, says it is deactivation, and the token stops working', async () => {
  const s = await startStub();
  try {
    const c = await connect(envFor(s), { token: GOOD_TOKEN });
    const { tools } = await c.listTools();
    const t = tools.find((x) => x.name === 'close_account');
    assert.equal(t.annotations.destructiveHint, true);
    assert.equal(t.annotations.readOnlyHint, false);
    let r = await c.callTool({ name: 'close_account', arguments: {} });
    assert.ok(r.isError, 'confirm is required');
    assert.ok(!s.state.closed);
    r = await c.callTool({ name: 'close_account', arguments: { confirm: true } });
    assert.ok(!r.isError, textOf(r));
    assert.equal(r.structuredContent.closed, true);
    assert.equal(r.structuredContent.deleted, false);
    assert.match(textOf(r), /does not delete/);
    assert.match(textOf(r), /hello@indianopinion\.org/);
    const sent = s.requests.find((q) => q.path.endsWith('/agent/close'));
    assert.deepEqual(JSON.parse(sent.body), { confirm: true });
    r = await c.callTool({ name: 'get_account', arguments: {} });
    assert.ok(r.isError);
    assert.match(textOf(r), /invalid_token/);
    await c.close();
    const anon = await connect(envFor(s));
    r = await anon.callTool({ name: 'close_account', arguments: { confirm: true } });
    assert.ok(r.isError);
    assert.match(textOf(r), /needs an Indian Opinion agent token/);
    await anon.close();
  } finally { await s.close(); }
});

test('following next_cursor never skips a brief, and pages stay full', async () => {
  for (const oversize of [false, true]) {
    const s = await startStub({ briefsNative: true, briefsOversize: oversize });
    try {
      const c = await connect(envFor(s));
      const seen = [];
      let cursor;
      for (let i = 0; i < 5; i++) {
        const r = await c.callTool({ name: 'search_briefs', arguments: { limit: 2, ...(cursor ? { cursor } : {}) } });
        assert.ok(!r.isError, textOf(r));
        const ids = r.structuredContent.items.map((x) => x.post_id);
        assert.ok(ids.length === 2 || !r.structuredContent.next_cursor, `page ${i + 1} is full while more remain (oversize ${oversize}): ${ids}`);
        seen.push(...ids);
        cursor = r.structuredContent.next_cursor;
        if (!cursor) break;
      }
      assert.deepEqual(seen, [99812, 99790, 99770, 99750, 99730], `every brief once, in order (oversize ${oversize})`);
      await c.close();
    } finally { await s.close(); }
  }
  const k = JSON.parse(Buffer.from(keysetCursor({ id: 99790, published: '2026-10-02T02:32:00Z' }), 'base64url').toString());
  assert.deepEqual(k, { d: '2026-10-02 02:32:00', i: 99790 });
});

test('list_breaking says when the window holds more than one page', async () => {
  const c = await connect(envFor(stub), { token: GOOD_TOKEN });
  const r = await c.callTool({ name: 'list_breaking', arguments: { days: 7 } });
  assert.ok(!r.isError, textOf(r));
  assert.equal(r.structuredContent.window_total, 2);
  assert.equal(r.structuredContent.truncated, false);
  assert.doesNotMatch(textOf(r), /pages the rest/);
  await c.close();
});

test('discovery/ copies (public mirror) match what src/discovery.js renders', async (t) => {
  const dir = path.join(HERE, '..', 'discovery');
  if (!fs.existsSync(dir)) { t.skip('no discovery/ directory in this tree'); return; }
  const { serverCard, agentsTxt } = await import('../src/discovery.js');
  assert.equal(fs.readFileSync(path.join(dir, 'server-card.json'), 'utf8'), JSON.stringify(serverCard(), null, 2) + '\n', 'run npm run discovery');
  assert.equal(fs.readFileSync(path.join(dir, 'agents.txt'), 'utf8'), agentsTxt(), 'run npm run discovery');
});
