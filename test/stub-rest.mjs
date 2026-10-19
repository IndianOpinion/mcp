// Stub of the Indian Opinion REST API for tests: the public brief routes
// (/wp-json/io/v1/briefs, /brief/{id}), one article page with its JSON link,
// its .md twin, and every /agent route of the agent API contract (version of
// 2 October 2026, with /agent/close and breaking/recent paging of 19 October).
// Fixtures follow the contract's examples. No network.
//
// startStub({agentLive, briefsNative, briefsOversize}) -> {url, api, close, requests, state}
//   agentLive false answers every /agent route with WordPress's rest_no_route
//   404, which is what the live site does until the agent API is deployed.
//   briefsNative: /briefs filters and pages itself with an opaque next_cursor,
//   and refuses an invalid limit or since with 400 invalid_field, as the live
//   route does since 19 October 2026.
//   briefsOversize (with briefsNative): /briefs answers one item more than the
//   limit asked for, with the cursor after that extra item, to test that a
//   client never drops an item between pages.

import http from 'node:http';

export const GOOD_TOKEN = 'ioa_3f9c2a71b0de_Qm9vb2sgYXJlIGdyZWF0IGFuZCBzbyBhcmUgYWdlbnRz';
export const GOOD_CODE = '482913';
export const EMAIL = 'briefing-bot@agents.example.org';

function brief(id, title, section, published, extra = {}) {
  return {
    id, title, section, published, modified: published, language: 'en',
    url: `__SITE__/story-${id}/`,
    md: `__SITE__/story-${id}.md`,
    brief: `${title}. This is the first sentence of the brief. This is the second sentence. A third sentence that a list view leaves out.`,
    analysis: 'Outlets agree on the core facts and differ on emphasis.',
    keywords: extra.keywords || [],
    corroboration: extra.corroboration || 3,
    sources: [
      { url: 'https://www.thehindu.com/a', outlet: 'thehindu.com' },
      { url: 'https://www.ndtv.com/b', outlet: 'ndtv.com' },
      { url: 'https://indianexpress.com/c', outlet: 'indianexpress.com' },
    ],
    stances: [
      { outlet: 'thehindu.com', stance: 'neutral-report', note: 'Straight account' },
      { outlet: 'ndtv.com', stance: 'pro-government', note: 'Leads with the ministry line' },
      { outlet: 'indianexpress.com', stance: 'government-critical', note: 'Leads with the opposition' },
    ],
    license: 'Summary and commentary (c) Indian Opinion, reusable with attribution.',
    citation_anchor: `__SITE__/story-${id}/#story-in-brief`,
    index_state: 'index',
  };
}

const BRIEFS = [
  brief(99812, 'Bengaluru Metro Yellow Line opens to the public', 'India', '2026-10-02T03:45:00Z', { keywords: ['Bengaluru Metro', 'BMRCL'] }),
  brief(99790, 'BSF reports border incident in Punjab', 'Politics', '2026-10-02T02:32:00Z', { keywords: ['BSF', 'Punjab'] }),
  brief(99770, 'Supreme Court hears electoral bonds review', 'Politics', '2026-10-02T02:10:00Z', { keywords: ['Supreme Court of India'] }),
  brief(99750, 'Sensex closes higher on bank stocks', 'Business', '2026-10-01T10:40:00Z', { keywords: ['Sensex'] }),
  brief(99730, 'Monsoon withdraws from north-west India', 'India', '2026-10-01T06:30:00Z', { keywords: ['IMD', 'monsoon'] }),
];

function digestDoc(site) {
  return {
    ok: true, date: '2026-10-02', subject: 'Today in India, 2 October: Bengaluru Metro opens',
    lead: 'Bengaluru Metro Yellow Line opens to the public.', built_at: '2026-10-02T13:05:11Z',
    web_url: `${site}/today/`,
    stories: BRIEFS.slice(0, 3).map((b) => ({
      post_id: b.id, title: b.title, url: b.url.replace('__SITE__', site), md_url: b.md.replace('__SITE__', site),
      json_url: `${site}/wp-json/io/v1/brief/${b.id}`, category: b.section, outlets_count: 3,
      outlets: [{ name: 'The Hindu', framing: ['neutral-report'] }],
      framing_labels: { 'neutral-report': 1, 'pro-government': 1, 'government-critical': 1 },
      summary: 'Two sentence summary. Second sentence.',
    })),
    next: [], docs: `${site}/agents/`,
  };
}

function event(site, id = 5531) {
  return {
    event_id: id, post_id: 99790, headline: 'BSF reports border incident in Punjab',
    url: `${site}/story-99790/`, md_url: `${site}/story-99790.md`, decided_at: '2026-10-02T11:02:00Z',
    outlets: ['thehindu.com', 'ndtv.com'],
    scores: { breaking: 0.81, new_event: 0.77, high_stakes: 0.55, confirmed: 0.92 },
    composites: { min: 0.55, mean: 0.76, geo: 0.75, breaking: 0.81 },
    your_score: 0.76, would_send: true, delivery: { status: 'sent', at: '2026-10-02T11:03:12Z' }, people_decision: 'shadow',
  };
}

export async function startStub({ agentLive = true, briefsNative = false, briefsOversize = false } = {}) {
  const requests = [];
  const state = {
    prefs: {
      digest: { on: true, hour_local: 7, tz: 'Asia/Kolkata', format: 'text' },
      breaking: { on: true, threshold: 0.5, composite: 'mean', max_per_day: 5 },
      nudges: false,
    },
    topics: [{ topic_id: 412, name: 'Bengaluru Metro', tier: 'instant', state: 'active', since: '2026-10-02T21:44:10Z' }],
    tokens: [{ id: '3f9c2a71b0de', label: 'prod', created_at: '2026-10-02T21:40:00Z', last_used_at: '2026-10-02T21:41:00Z', current: true }],
    closed: false,
    latest: null,
  };
  let site = '';

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const u = new URL(req.url, 'http://x');
    requests.push({ method: req.method, path: u.pathname, search: u.search, headers: req.headers, body });
    const send = (status, obj, headers = {}) => {
      const text = typeof obj === 'string' ? obj : JSON.stringify(obj).replaceAll('__SITE__', site);
      res.writeHead(status, { 'Content-Type': typeof obj === 'string' ? (headers['Content-Type'] || 'text/html') : 'application/json; charset=UTF-8', 'Cache-Control': 'no-store', ...headers });
      res.end(text);
    };
    const docs = `${site}/agents/`;
    const err = (status, error, message, extra = {}, headers = {}) => send(status, { ok: false, error, message, docs, ...extra }, headers);
    const p = u.pathname;

    // Public site pages
    if (p === '/story-99812/' && req.method === 'GET') {
      return send(200, `<!doctype html><html><head><title>x</title><link rel="alternate" type="application/json" href="${site}/wp-json/io/v1/brief/99812" title="Machine-readable summary" /></head><body>page</body></html>`);
    }
    if (p === '/story-99812.md') return send(200, '# Bengaluru Metro Yellow Line opens to the public\n\nBrief text.\n', { 'Content-Type': 'text/markdown; charset=utf-8' });

    // The CLI's latest.json, when a test sets state.latest (doctor's version check).
    if (p === '/agents/cli/latest.json' && state.latest) return send(200, { version: state.latest, url: `${site}/agents/cli/indianopinion-${state.latest}.tgz`, sha256: '0'.repeat(64) });

    // Public REST
    if (p === '/wp-json/io/v1/briefs') {
      const bad = (field, message) => send(400, { ok: false, error: 'invalid_field', field, message, code: field === 'cursor' ? 'io_bad_cursor' : 'io_invalid_param', data: { status: 400 }, docs });
      const rawLimit = u.searchParams.get('limit');
      if (briefsNative && rawLimit !== null && !(/^\d+$/.test(rawLimit) && +rawLimit >= 1 && +rawLimit <= 100)) return bad('limit', 'limit must be a whole number from 1 to 100.');
      const limit = Math.min(100, Math.max(1, parseInt(rawLimit || '20', 10)));
      let items = BRIEFS;
      const since = u.searchParams.get('since');
      if (briefsNative && since && Number.isNaN(Date.parse(since))) return bad('since', 'since must be an ISO 8601 time.');
      if (since) items = items.filter((b) => Date.parse(b.published) > Date.parse(since));
      if (briefsNative) {
        const q = (u.searchParams.get('q') || '').toLowerCase();
        if (q) items = items.filter((b) => b.title.toLowerCase().includes(q));
        const c = u.searchParams.get('cursor');
        let start = 0;
        if (c) {
          // 'native-<id>' as issued here, or the origin's keyset form {d, i} in base64url
          // (what a client rebuilds from the last item it kept).
          let after = (/^native-(\d+)$/.exec(c) || [])[1];
          if (!after) { try { after = JSON.parse(Buffer.from(c, 'base64url').toString()).i; } catch { after = undefined; } }
          if (!after) return bad('cursor', 'That cursor is not one this route issued.');
          start = items.findIndex((b) => b.id < Number(after));
          if (start < 0) start = items.length;
        }
        const n = briefsOversize ? limit + 1 : limit;
        const page = items.slice(start, start + n);
        const last = page[page.length - 1];
        return send(200, { count: page.length, page: c ? null : 1, per_page: limit, next_cursor: last && start + n < items.length ? `native-${last.id}` : null, items: page });
      }
      return send(200, { count: Math.min(limit, items.length), items: items.slice(0, limit) });
    }
    let m = p.match(/^\/wp-json\/io\/v1\/brief\/(\d+)$/);
    if (m) {
      const b = BRIEFS.find((x) => x.id === Number(m[1]));
      return b ? send(200, b) : send(404, { code: 'io_not_found', message: 'No such article.', data: { status: 404 } });
    }

    if (!p.startsWith('/wp-json/io/v1/agent')) return send(404, '<!doctype html><title>404</title>');
    if (!agentLive) return send(404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.', data: { status: 404 } });

    const route = p.slice('/wp-json/io/v1/agent'.length) || '/';
    const B = `${site}/wp-json/io/v1/agent`;
    let json = null;
    if (body && req.method !== 'GET') {
      if (!String(req.headers['content-type'] || '').includes('application/json')) return err(415, 'json_required', 'Send Content-Type: application/json.');
      try { json = JSON.parse(body); } catch { return err(415, 'json_required', 'The body is not JSON.'); }
    }

    if (route === '/' && req.method === 'GET') {
      return send(200, { ok: true, name: 'Indian Opinion agent API', version: '2026-10-02', docs, signup: { start: `${B}/start`, verify: `${B}/verify` } });
    }
    if (route === '/start' && req.method === 'POST') {
      if (!json || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(json.email || '')) return err(400, 'invalid_email', 'That is not an email address we can send to.', { field: 'email' });
      if (json.email === 'slow@agents.example.org') return err(429, 'rate_limited', 'Too many codes for this address.', { retry_after: 42, scope: 'email' }, { 'Retry-After': '42' });
      return send(200, { ok: true, sent_to_masked: 'br*******@agents.example.org', expires_in: 600, resend_after: 60, code_length: 6, max_attempts: 5,
        next: [{ rel: 'verify', method: 'POST', href: `${B}/verify`, body: { email: json.email, code: '<6 digits from the email>' } }], docs });
    }
    if (route === '/verify' && req.method === 'POST') {
      if (!json || json.code !== GOOD_CODE) return err(400, 'invalid_code', 'That code is not right.', { attempts_left: 4 });
      return send(200, { ok: true, token: GOOD_TOKEN, token_id: '3f9c2a71b0de', token_type: 'Bearer',
        account: { id: 1234, kind: 'agent', email_masked: 'br*******@agents.example.org', new_account: true },
        browser_url: `${B}/browser?t=abc`, browser_url_expires_in: 600, defaults_applied: true,
        digest: { on: true, hour_local: 7, tz: 'Asia/Kolkata', format: 'text' },
        next: [{ rel: 'me', method: 'GET', href: `${B}/me` }, { rel: 'digest', method: 'GET', href: `${B}/digest/latest` }], docs });
    }

    // Everything below needs a bearer token
    const auth = String(req.headers.authorization || '');
    if (!auth) return err(401, 'missing_token', 'Send Authorization: Bearer <token>.', {}, { 'WWW-Authenticate': 'Bearer realm="indianopinion.org"' });
    if (auth !== `Bearer ${GOOD_TOKEN}` || state.closed) return err(401, 'invalid_token', 'That token is unknown or revoked.', {}, { 'WWW-Authenticate': 'Bearer realm="indianopinion.org", error="invalid_token"' });

    if (route === '/me' && req.method === 'GET') {
      return send(200, { ok: true, account: { id: 1234, kind: 'agent', email: EMAIL, email_masked: 'br*******@agents.example.org', level: 'subscriber', created_at: '2026-10-02T21:40:00Z',
        agent: { agent_name: 'Morning briefer', operator_url: null, purpose: 'Brief my owner' } },
        preferences: state.prefs, topics_followed: state.topics.length, breaking_today: { sent_last_24h: 1, max_per_day: state.prefs.breaking.max_per_day },
        token: state.tokens[0], next: [{ rel: 'digest', method: 'GET', href: `${B}/digest/latest` }], docs });
    }
    if (route === '/preferences' && req.method === 'GET') return send(200, { ok: true, preferences: state.prefs, docs, next: [] });
    if (route === '/preferences' && (req.method === 'PATCH' || req.method === 'POST')) {
      const t = json?.breaking?.threshold;
      if (t !== undefined && (typeof t !== 'number' || t < 0 || t > 1)) return err(400, 'invalid_preference', `breaking.threshold must be a number from 0.0 to 1.0; got ${t}.`, { field: 'breaking.threshold', allowed: [0, 1] });
      const h = json?.digest?.hour_local;
      if (h !== undefined && ![7, 12, 18, 21].includes(h)) return err(400, 'invalid_preference', 'digest.hour_local must be one of 7, 12, 18, 21.', { field: 'digest.hour_local', allowed: [7, 12, 18, 21] });
      for (const k of Object.keys(json || {})) if (!['digest', 'breaking', 'nudges'].includes(k)) return err(400, 'unknown_field', `Unknown field ${k}.`, { field: k });
      if (json.digest) Object.assign(state.prefs.digest, json.digest);
      if (json.breaking) Object.assign(state.prefs.breaking, json.breaking);
      if (json.nudges !== undefined) state.prefs.nudges = json.nudges;
      return send(200, { ok: true, preferences: state.prefs, next: [{ rel: 'breaking', method: 'GET', href: `${B}/breaking/recent?days=7` }], docs });
    }
    if (route === '/topics' && req.method === 'GET') {
      return send(200, { ok: true, following: state.topics,
        suggested: [{ key: 't88', topic_id: 88, name: 'Supreme Court of India', section: 'governance', stories_7d: 31 }, { key: 'g1045', topic_id: null, name: 'ISRO', section: 'science', stories_7d: 9 }],
        limits: { max_topics: 25, new_topics_per_day: 5 }, quiet_hours: 'off', next: [], docs });
    }
    if (route === '/topics' && req.method === 'POST') {
      if (json?.text && /^metro$/i.test(json.text)) {
        return err(409, 'ambiguous', 'More than one topic matches; POST again with the chosen key.', { options: [{ key: 't412', name: 'Bengaluru Metro', context: 'transport' }, { key: 't413', name: 'Delhi Metro', context: 'transport' }] });
      }
      const id = json?.topic_id || 88;
      const existing = state.topics.find((t) => t.topic_id === id);
      if (existing) return send(200, { ok: true, created: false, subscription: existing, docs, next: [] });
      const sub = { topic_id: id, name: json?.text || 'Supreme Court of India', tier: json?.tier || 'daily', state: 'active', since: '2026-10-02T22:00:00Z' };
      state.topics.push(sub);
      return send(201, { ok: true, created: true, subscription: sub, docs, next: [{ rel: 'topics', method: 'GET', href: `${B}/topics` }] });
    }
    m = route.match(/^\/topics\/(\d+)$/);
    if (m && req.method === 'DELETE') {
      const before = state.topics.length;
      state.topics = state.topics.filter((t) => t.topic_id !== Number(m[1]));
      return send(200, { ok: true, removed: state.topics.length < before, docs, next: [] });
    }
    if (route === '/digest/latest' && req.method === 'GET') return send(200, digestDoc(site));
    m = route.match(/^\/digest\/(.+)$/);
    if (m && req.method === 'GET') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m[1])) return err(400, 'invalid_date', 'Use YYYY-MM-DD.');
      if (m[1] !== '2026-10-02') return err(404, 'not_found', `No digest for ${m[1]}.`);
      return send(200, digestDoc(site));
    }
    if (route === '/breaking/recent' && req.method === 'GET') {
      const days = Number(u.searchParams.get('days') || 7);
      if (!(days >= 1 && days <= 7)) return err(400, 'invalid_field', 'days must be 1 to 7.', { field: 'days', allowed: [1, 7] });
      const ev2 = { ...event(site, 5532), would_send: false, your_score: 0.31, delivery: null, headline: 'Minor policy update' };
      const all = [event(site), ev2];
      const lim = Number(u.searchParams.get('limit') || 500);
      if (!(Number.isInteger(lim) && lim >= 1 && lim <= 500)) return err(400, 'invalid_field', 'limit must be a whole number from 1 to 500.', { field: 'limit', allowed: [1, 500] });
      const start = u.searchParams.get('cursor') === 'brk-c2' ? 1 : 0;
      const evs = all.slice(start, start + lim);
      const more = start + lim < all.length;
      return send(200, { ok: true, rule: { ...state.prefs.breaking }, window: { from: '2026-09-25T21:00:00Z', to: '2026-10-02T21:00:00Z', days },
        window_total: all.length, summary: { candidates: evs.length, would_send: evs.filter((e) => e.would_send).length, sent: evs.filter((e) => e.delivery).length, covers: 'this page' },
        limit: lim, truncated: more, next_cursor: more ? 'brk-c2' : null, events: evs, next: [], docs });
    }
    m = route.match(/^\/breaking\/(\d+)$/);
    if (m && req.method === 'GET') {
      if (m[1] !== '5531') return err(404, 'not_found', `No breaking event ${m[1]}.`);
      return send(200, { ok: true, ...event(site), brief: 'Two sentence brief.', sources: [{ url: 'https://www.thehindu.com/a', outlet: 'thehindu.com' }], docs, next: [] });
    }
    if (route === '/articles' && req.method === 'GET') {
      return send(200, { ok: true, count: BRIEFS.length, items: BRIEFS, next_since: '2026-10-02T09:15:00Z', docs, next: [] });
    }
    if (route === '/unsubscribe' && req.method === 'POST') {
      const what = json?.what;
      if (!['digest', 'breaking', 'topics', 'all'].includes(what)) return err(400, 'invalid_field', 'what must be digest, breaking, topics or all.', { field: 'what', allowed: ['digest', 'breaking', 'topics', 'all'] });
      const stopped = what === 'all' ? ['digest', 'breaking', 'topics', 'nudges'] : [what];
      if (stopped.includes('digest')) state.prefs.digest.on = false;
      if (stopped.includes('breaking')) state.prefs.breaking.on = false;
      return send(200, { ok: true, stopped, preferences: state.prefs, docs, next: [] });
    }
    if (route === '/close' && req.method === 'POST') {
      if (!json || json.confirm !== true) return err(400, 'invalid_field', 'Send {"confirm": true} to close the account.', { field: 'confirm', allowed: [true] });
      state.closed = true;
      state.prefs.digest.on = false;
      state.prefs.breaking.on = false;
      const retention = 'Closing deactivates the account; it does not delete it. The account record is kept, deactivated, under the retention terms of https://indianopinion.org/privacy-policy/. To ask for erasure or a copy of your data, write to hello@indianopinion.org.';
      return send(200, { ok: true, closed: true, already_closed: false, deleted: false, stopped: ['digest', 'breaking', 'topics', 'nudges'], tokens_revoked: state.tokens.length,
        retention, message: `The account is closed. ${retention}`, next: [], docs });
    }
    if (route === '/tokens' && req.method === 'GET') return send(200, { ok: true, tokens: state.tokens, docs, next: [] });
    if (route === '/tokens' && req.method === 'POST') {
      const t = { id: 'a1b2c3d4e5f6', label: json?.label || null, created_at: '2026-10-02T22:10:00Z', last_used_at: null, current: false };
      state.tokens.push(t);
      return send(201, { ok: true, token: 'ioa_a1b2c3d4e5f6_c2Vjb25kc2VjcmV0c2Vjb25kc2VjcmV0', token_id: t.id, docs, next: [] });
    }
    m = route.match(/^\/tokens\/([a-z0-9]+)$/);
    if (m && req.method === 'DELETE') {
      const before = state.tokens.length;
      state.tokens = state.tokens.filter((t) => t.id !== m[1]);
      return send(200, { ok: true, revoked: state.tokens.length < before, docs, next: [] });
    }
    if (route === '/browser-link' && req.method === 'POST') return send(200, { ok: true, browser_url: `${B}/browser?t=onetime`, expires_in: 600, docs, next: [] });
    return send(404, { code: 'rest_no_route', message: 'No route was found matching the URL and request method.', data: { status: 404 } });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  site = `http://127.0.0.1:${server.address().port}`;
  return { url: site, api: `${site}/wp-json/io/v1`, requests, state, close: () => new Promise((r) => server.close(r)) };
}
