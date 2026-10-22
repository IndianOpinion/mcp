// Tests for the 0.2.1 fixes (22 October 2026): IndianOpinion/mcp #5, #13, #16 and IndianOpinion/cli#23.
// Worker in process against the REST stub; no network.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import worker from '../src/index.js';
import { errorText, mcpWording, toolNext } from '../src/tools.js';
import { ApiError } from '../src/client.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const stubPath = [path.join(HERE, 'stub-rest.mjs'), path.join(HERE, '..', '..', 'io-cli', 'test', 'stub-rest.mjs')].find((f) => fs.existsSync(f));
const { startStub } = await import(pathToFileURL(stubPath).href);

const origLog = console.log;
let stub;
before(async () => { stub = await startStub(); console.log = () => {}; });
after(async () => { console.log = origLog; await stub.close(); });

async function connect() {
  const env = { IO_API: stub.api, SITE: stub.url };
  const client = new Client({ name: 'io-test', version: '1.0.0' }, { versionNegotiation: { mode: 'legacy' } });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: (url, init = {}) => { const h = new Headers(init.headers || {}); h.set('Host', 'localhost'); return worker.fetch(new Request(url, { ...init, headers: h }), env, {}); },
  });
  await client.connect(transport);
  return client;
}
const textOf = (r) => (r.content || []).map((c) => c.text).join('\n');

test('#16: search_briefs without q says the list is the latest briefs, unfiltered', async () => {
  const c = await connect();
  let r = await c.callTool({ name: 'search_briefs', arguments: {} });
  assert.match(textOf(r), /^The \d+ latest briefs? \(no q or category given, so nothing was filtered; this is not a search result\)\./);
  r = await c.callTool({ name: 'search_briefs', arguments: { q: 'metro' } });
  assert.match(textOf(r), /briefs? for "metro"\.|No published briefs matched "metro"/);
  await c.close();
});

test('#13: signup_start names signup_verify, never a REST POST, in text and structuredContent', async () => {
  const c = await connect();
  const r = await c.callTool({ name: 'signup_start', arguments: { email: 'briefing-bot@agents.example.org' } });
  assert.ok(!r.isError, textOf(r));
  assert.deepEqual(r.structuredContent.next, [{ rel: 'verify', tool: 'signup_verify' }]);
  assert.doesNotMatch(JSON.stringify(r.structuredContent) + textOf(r), /POST|\/agent\/verify/);
  await c.close();
});

test('#13: REST wording about /agent/start and /agent/verify becomes the tools', () => {
  assert.equal(mcpWording('There is no live code for this address; ask for a new one with POST /agent/start.'), 'There is no live code for this address; ask for a new one with the signup_start tool.');
  assert.equal(mcpWording('Read it from the mailbox, then POST it to /agent/verify.'), 'Read it from the mailbox, then call signup_verify with it.');
  assert.equal(mcpWording('POST https://indianopinion.org/wp-json/io/v1/agent/verify'), 'the signup_verify tool');
  const e = new ApiError(400, { error: 'expired', message: 'There is no live code for this address; ask for a new one with POST /agent/start.' });
  assert.doesNotMatch(errorText(e, 'signup_verify'), /POST/);
  assert.deepEqual(toolNext([{ rel: 'verify', method: 'POST', href: 'x' }]), [{ rel: 'verify', tool: 'signup_verify' }]);
});

const MIRROR = fs.existsSync(path.join(ROOT, 'discovery', 'server-card.json'));
test('#13: the server card account line cites the signup_verify tool, not a REST route (mirror only)', { skip: !MIRROR }, () => {
  const card = fs.readFileSync(path.join(ROOT, 'discovery', 'server-card.json'), 'utf8');
  assert.doesNotMatch(card, /POST \/wp-json/);
  assert.match(card, /signup_verify tool/);
});

test('cli#23: the instructions give both caps: 25 a tool call, 100 for REST and the CLI', async () => {
  const c = await connect();
  assert.match(c.getInstructions(), /at most 25 a call/);
  assert.match(c.getInstructions(), /up to 100/);
  await c.close();
});

test('#5: check and dev fall back to wrangler.example.toml (mirror only)', { skip: !MIRROR }, () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const k of ['check', 'dev']) assert.match(pkg.scripts[k], /wrangler\.example\.toml/);
  assert.ok(fs.existsSync(path.join(ROOT, 'wrangler.example.toml')));
});
