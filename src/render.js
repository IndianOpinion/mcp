// Small formatting helpers shared by tools, resources and prompts. Text is
// compact Markdown for the model; the full record goes in structuredContent.

const REL_TO_TOOL = {
  verify: 'signup_verify', me: 'get_account', account: 'get_account', preferences: 'update_preferences',
  topics: 'list_topics', digest: 'get_digest', breaking: 'list_breaking', articles: 'search_briefs',
  unsubscribe: 'unsubscribe', 'browser-link': 'create_browser_link',
};

export function nextLine(next) {
  if (!Array.isArray(next) || next.length === 0) return '';
  const names = [];
  for (const n of next) {
    if (!n || !n.rel) continue;
    const t = REL_TO_TOOL[n.rel] || `${n.method || 'GET'} ${n.rel}`;
    if (!names.includes(t)) names.push(t);
  }
  return names.length ? `\nNext: ${names.join(', ')}` : '';
}

// A full stop after one of these words does not end a sentence: "Rs. 95",
// "Mr. Modi", "No. 3". Matched case-insensitively against the word just
// before the stop; a single capital letter (an initial, "A. P. J.") too.
const ABBREV = /^(?:rs|re|inr|mr|mrs|ms|dr|prof|sr|jr|st|no|nos|vs|lt|col|gen|gov|govt|hon|maj|capt|sgt|insp|supt|inc|ltd|co|corp|pvt|approx|est|fig|vol|e\.g|i\.e|etc|u\.s|u\.k)$/i;

/**
 * Split text into sentences. A sentence ends at . ! or ? (with any closing
 * quotes or brackets) followed by whitespace or the end of the text, so never
 * inside a number ("95.10", "10,258.5"), and not after an abbreviation.
 * 17 October 2026: the old one-line regex, /[^.!?]+[.!?]+(\s|$)/g,
 * could not match a sentence that held a decimal point, so the match
 * restarted after the point and silently dropped everything before it:
 * "Rs 95.10 crore" came out as "10 crore".
 */
export function sentences(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const out = [];
  const re = /[.!?]+["'’”)\]]*(?=\s|$)/g;
  let start = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    const end = m.index + m[0].length;
    if (m[0].replace(/["'’”)\]]+$/, '') === '.') {
      const word = (s.slice(start, m.index).match(/(\S+)$/) || ['', ''])[1].replace(/^["'‘“(\[]+/, '');
      if (ABBREV.test(word) || /^[A-Z]$/.test(word)) continue;
    }
    out.push(s.slice(start, end).trim());
    start = end;
  }
  const rest = s.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** First two sentences, at most about 400 characters. */
export function summary(text, max = 400) {
  if (!text) return '';
  let out = sentences(text).slice(0, 2).join(' ').trim();
  if (out.length > max) out = out.slice(0, max - 1).replace(/\s+\S*$/, '') + '...';
  return out;
}

export function framingCounts(stances) {
  const c = {};
  for (const s of stances || []) if (s && s.stance) c[s.stance] = (c[s.stance] || 0) + 1;
  return c;
}

export function framingText(counts) {
  const e = Object.entries(counts || {});
  return e.length ? e.map(([k, v]) => `${k} ${v}`).join(', ') : 'none recorded';
}

/** A brief record from /io/v1/brief or /briefs, reduced for a list. */
export function compactBrief(b, api) {
  const id = b.id ?? b.post_id;
  return {
    post_id: id,
    title: b.title,
    url: b.url,
    md_url: b.md || b.md_url || null,
    json_url: b.json_url || `${api}/brief/${id}`,
    published: b.published || null,
    category: b.section || b.category || null,
    outlets_count: b.corroboration ?? b.outlets_count ?? (b.sources ? b.sources.length : null),
    framing: b.framing_labels || framingCounts(b.stances),
    summary: b.summary || summary(b.brief),
  };
}

export function briefListText(items, header) {
  const lines = [header];
  items.forEach((b, i) => {
    lines.push(`\n${i + 1}. ${b.title}`);
    lines.push(`${b.category || 'Uncategorised'} | ${b.published || ''} | outlets: ${b.outlets_count ?? '?'} | framing: ${framingText(b.framing)}`);
    lines.push(`url: ${b.url}  md_url: ${b.md_url || 'n/a'}  json_url: ${b.json_url}`);
    if (b.summary) lines.push(`summary: ${b.summary}`);
  });
  return lines.join('\n');
}

export function b64urlEncode(obj) {
  const s = JSON.stringify(obj);
  const b = btoa(unescape(encodeURIComponent(s)));
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  try {
    const b = str.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b))));
  } catch {
    return null;
  }
}

/** The digest document as Markdown (used by get_digest and the digest resource). */
export function digestMarkdown(d, items) {
  const lines = [`# Indian Opinion digest ${d.date}`, '', d.lead ? `Lead: ${d.lead}` : '', `stories: ${(d.stories || []).length}`, `web: ${d.web_url || ''}`];
  (items || d.stories || []).forEach((s, i) => {
    lines.push('', `${i + 1}. ${s.title}`);
    lines.push(`category: ${s.category || ''} | outlets: ${s.outlets_count ?? '?'} | framing: ${framingText(s.framing_labels)}`);
    lines.push(`url: ${s.url}  md_url: ${s.md_url || ''}`);
    if (s.summary) lines.push(`summary: ${s.summary}`);
  });
  return lines.filter((l) => l !== null).join('\n');
}
