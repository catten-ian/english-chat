'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { safeUrl, fetchText, parseFeed, extractArticle, loadArticles } = require('../server/services/reading-sources');

function articleHtml() {
  return '<html><head><title>Learning about cities</title></head><body><article><h1>Learning about cities</h1>' + Array.from({ length: 16 }, (_, i) => '<p>In district ' + i + ', residents discussed changes to their neighborhood with planners. They examined traffic, measured temperature, and compared the benefits of different trees. The evidence showed that careful maintenance mattered as much as initial construction. People whose experiences differed helped the team discover unexpected problems and make better decisions.</p>').join('') + '<script>alert(1)</script></article></body></html>';
}

test('source URL allowlist rejects arbitrary hosts, credentials, ports and protocols', () => {
  assert.equal(safeUrl('https://www.bbc.com/news/world-123'), 'https://www.bbc.com/news/world-123');
  for (const url of ['http://www.bbc.com/news', 'https://www.bbc.com.evil.test/', 'https://localhost/', 'https://www.bbc.com:8080/', 'https://user:pass@www.bbc.com/']) assert.throws(() => safeUrl(url));
});

test('RSS and Atom are parsed structurally with unsafe links discarded', () => {
  const rss = '<rss><channel><item><title><![CDATA[Trees &amp; streets]]></title><link>https://www.bbc.com/news/one</link></item><item><title>Bad</title><link>https://127.0.0.1/secret</link></item></channel></rss>';
  assert.deepEqual(parseFeed(rss), [{ title: 'Trees & streets', url: 'https://www.bbc.com/news/one' }]);
  const atom = '<feed><entry><title>City</title><link rel="self" href="https://evil.test/"/><link rel="alternate" href="https://www.theguardian.com/world/story"/></entry></feed>';
  assert.equal(parseFeed(atom)[0].url, 'https://www.theguardian.com/world/story');
  assert.throws(() => parseFeed('<rss><channel>'));
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x "secret">]><rss><channel/></rss>'), /entity declarations/);
});

test('full article is extracted as text with provenance, not RSS summary or HTML', () => {
  const article = extractArticle(articleHtml(), 'https://www.bbc.com/news/one', 'Fallback');
  assert.ok(article.wordCount >= 600);
  assert.equal(article.sourceUrl, 'https://www.bbc.com/news/one');
  assert.equal(article.sourceType, 'rss');
  assert.ok(article.paragraphs.every(p => !p.includes('<') && !p.includes('alert(1)')));
  assert.throws(() => extractArticle('<html><body><article><p>A short summary is not a full article.</p></article></body></html>', 'https://www.bbc.com/news/one', 'Short'));
});

test('redirects never follow an unallowlisted target', async () => {
  const requests = [];
  await assert.rejects(fetchText('https://www.bbc.com/news/one', async url => { requests.push(url); return new Response('', { status: 302, headers: { location: 'https://127.0.0.1/private' } }); }, AbortSignal.timeout(1000)), /not allowed/);
  assert.equal(requests.length, 1);
});

test('response body limit is enforced even without content-length', async () => {
  await assert.rejects(fetchText('https://www.bbc.com/news/one', async () => new Response('a'.repeat(2 * 1024 * 1024 + 1)), AbortSignal.timeout(1000)), /too large/);
});

test('RSS loader fetches full articles and rejects summary-only sources', async () => {
  const feed = '<rss><channel><item><title>City</title><link>https://www.bbc.com/news/one</link><description>Summary only.</description></item></channel></rss>';
  const fetcher = async url => new Response(url.includes('rss.xml') ? feed : articleHtml());
  const articles = await loadArticles('bbc', fetcher);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].publisher, 'bbc');
  await assert.rejects(loadArticles('bbc', async url => new Response(url.includes('rss.xml') ? feed : '<html><body><p>Only a summary.</p></body></html>')), /No sufficiently long/);
  await assert.rejects(loadArticles('evil', fetcher), /Unknown/);
});

test('every prepared article is a substantial offline fallback', () => {
  const source = fs.readFileSync(require.resolve('../js/app/28-reading-exports.js'), 'utf8');
  const sandbox = {};
  vm.runInNewContext(source.slice(0, source.indexOf('function readingPreparedArticle')) + ';this.articles = READING_PREPARED_ARTICLES;', sandbox);
  assert.ok(sandbox.articles.length >= 2);
  for (const article of sandbox.articles) {
    const count = article.paragraphs.join(' ').split(/\s+/).length;
    assert.ok(count >= 600, article.title + ': ' + count + ' words');
    assert.equal(new Set(article.paragraphs).size, article.paragraphs.length);
  }
});
