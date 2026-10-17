// Unit tests for the summary helper behind search_briefs. No network,
// no stub server: node --test test/render.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summary, sentences } from '../src/render.js';

test('rupee figures with a decimal point survive the summary', () => {
  const brief = 'Drishyam 3 collected Rs 95.10 crore gross worldwide on its opening day. It made Rs 80.10 crore gross in India. Trade analysts expect a strong weekend.';
  const s = summary(brief);
  assert.equal(s, 'Drishyam 3 collected Rs 95.10 crore gross worldwide on its opening day. It made Rs 80.10 crore gross in India.');
  assert.match(s, /Rs 95\.10 crore/);
});

test('thousands separators and "Rs." are not sentence ends', () => {
  const s = summary('Banks recovered Rs. 10,258 crore from Mallya before the suit. The balance is disputed. More hearings follow.');
  assert.equal(s, 'Banks recovered Rs. 10,258 crore from Mallya before the suit. The balance is disputed.');
});

test('abbreviations, initials and versions do not split', () => {
  assert.deepEqual(sentences('Mr. Modi met Dr. Rao in No. 10. A. P. J. Abdul Kalam was cited. v2.5 shipped.'),
    ['Mr. Modi met Dr. Rao in No. 10.', 'A. P. J. Abdul Kalam was cited.', 'v2.5 shipped.']);
});

test('ordinary sentences, closing quotes and text without a stop', () => {
  assert.equal(summary('He said "we will win." Then he left! Why?'), 'He said "we will win." Then he left!');
  assert.equal(summary('No stop at the end'), 'No stop at the end');
  assert.equal(summary(''), '');
  assert.equal(summary('GDP grew 7.8% in Q1. Inflation was 3.2%.'), 'GDP grew 7.8% in Q1. Inflation was 3.2%.');
});

test('long text is cut on a word boundary with an ellipsis', () => {
  const s = summary('Word '.repeat(200) + 'end.', 50);
  assert.ok(s.length <= 52 && s.endsWith('...'), s);
});
