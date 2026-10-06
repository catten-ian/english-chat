'use strict';

const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { parseHTML } = require('linkedom');
const { Readability } = require('@mozilla/readability');

const FEEDS = Object.freeze({
  bbc: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  guardian: 'https://www.theguardian.com/world/rss',
});
const HOSTS = new Set(['feeds.bbci.co.uk', 'www.bbc.co.uk', 'www.bbc.com', 'www.theguardian.com']);
const MIN_WORDS = 600;
const MAX_BYTES = 2 * 1024 * 1024;
const CACHE_MS = 15 * 60 * 1000;
const cache = new Map();
const pending = new Map();

function safeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !HOSTS.has(url.hostname)) throw new Error('Article source is not allowed');
  return url.href;
}

async function fetchText(url, fetchImpl, signal) {
  let current = safeUrl(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetchImpl(current, { signal, redirect: 'manual', headers: { Accept: 'application/rss+xml, application/xml, text/html', 'User-Agent': 'EnglishLearningReader/1.0' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new Error('Article redirect limit');
      current = safeUrl(new URL(location, current).href);
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) throw new Error('Source HTTP ' + response.status);
    if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('Article is too large'); }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) throw new Error('Article is too large');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    return { text: Buffer.concat(chunks).toString('utf8'), url: current };
  }
  throw new Error('Article redirect limit');
}

function plainText(html) {
  const { document } = parseHTML('<html><body>' + String(html || '') + '</body></html>');
  document.querySelectorAll('script,style,iframe,form,noscript').forEach(el => el.remove());
  return document.body.textContent.replace(/\s+/g, ' ').trim();
}

function parseFeed(xml) {
  // Publisher feeds do not need document type declarations or external entities.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('RSS entity declarations are not allowed');
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid RSS XML');
  const parsed = new XMLParser({ ignoreAttributes: false, processEntities: true, isArray: name => name === 'item' || name === 'entry' }).parse(xml);
  const entries = parsed.rss?.channel?.item || parsed.feed?.entry || [];
  return entries.slice(0, 12).flatMap(entry => {
    const title = plainText(typeof entry.title === 'object' ? entry.title['#text'] : entry.title);
    const links = Array.isArray(entry.link) ? entry.link : [entry.link];
    const link = links.find(x => typeof x === 'string' || !x?.['@_rel'] || x['@_rel'] === 'alternate');
    try {
      const url = safeUrl(typeof link === 'string' ? link : link?.['@_href']);
      // Only publisher article hosts may be fetched; a feed URL is not an article.
      if (new URL(url).hostname === 'feeds.bbci.co.uk') return [];
      return [{ title, url }];
    } catch (_) { return []; }
  });
}

function extractArticle(html, url, fallbackTitle) {
  const { document } = parseHTML(html);
  document.querySelectorAll('script,style,iframe,form,noscript').forEach(el => el.remove());
  const parsed = new Readability(document, { charThreshold: 1000 }).parse();
  if (!parsed?.content) throw new Error('Source has no readable article');
  const { document: content } = parseHTML('<html><body>' + parsed.content + '</body></html>');
  const paragraphs = [...content.querySelectorAll('p')].map(el => el.textContent.replace(/\s+/g, ' ').trim()).filter(text => text.split(/\s+/).length >= 8);
  const wordCount = paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_WORDS) throw new Error('Full article is shorter than ' + MIN_WORDS + ' words');
  if (wordCount > 8000) throw new Error('Full article is too long');
  return { title: plainText(parsed.title || fallbackTitle), paragraphs, wordCount, sourceUrl: url, sourceType: 'rss', fetchedAt: new Date().toISOString() };
}

async function loadArticles(source, fetchImpl = fetch) {
  if (!Object.hasOwn(FEEDS, source)) throw new Error('Unknown reading source');
  const signal = AbortSignal.timeout(20000);
  const feed = await fetchText(FEEDS[source], fetchImpl, signal);
  const entries = parseFeed(feed.text);
  const articles = [];
  // Bound publisher requests; never pad a short RSS summary into a long article.
  for (let i = 0; i < Math.min(entries.length, 6); i += 2) {
    const results = await Promise.allSettled(entries.slice(i, i + 2).map(async entry => {
      const page = await fetchText(entry.url, fetchImpl, signal);
      return extractArticle(page.text, page.url, entry.title);
    }));
    for (const result of results) if (result.status === 'fulfilled') articles.push({ ...result.value, publisher: source });
    if (articles.length || signal.aborted) break;
  }
  if (!articles.length) throw new Error('No sufficiently long full articles are currently available');
  return articles;
}

async function getArticles(source = 'bbc') {
  if (!Object.hasOwn(FEEDS, source)) throw new Error('Unknown reading source');
  const cached = cache.get(source);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.articles;
  if (!pending.has(source)) pending.set(source, loadArticles(source).then(articles => { cache.set(source, { at: Date.now(), articles }); return articles; }).finally(() => pending.delete(source)));
  return pending.get(source);
}

module.exports = { FEEDS, MIN_WORDS, safeUrl, fetchText, parseFeed, extractArticle, loadArticles, getArticles };
