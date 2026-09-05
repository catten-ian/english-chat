/* ============================================================
   AI 英语对话教练 - 校验模块（server/validation.js）
   - user_data 顶层类型校验（matchesType）
   - Anki 代理守卫（ankiGuard）：白名单 + 牌组归属限定
   ============================================================ */
'use strict';

const {
  USER_DATA_KEYS,
  ANKI_DECK_PREFIX, ANKI_ALLOWED_MODELS,
  ANKI_MAX_NOTES, ANKI_MAX_CARDS, ANKI_MAX_MEDIA_B64,
  ANKI_READONLY_ACTIONS, ANKI_GUI_ACTIONS, ANKI_GUARDED_ACTIONS
} = require('./config');

/* 顶层类型约定：value 必须匹配该 key 声明的形状 */
function matchesType(val, expect) {
  if (expect === 'array') return Array.isArray(val);
  if (expect === 'object') return val !== null && typeof val === 'object' && !Array.isArray(val);
  if (expect === 'string') return typeof val === 'string';
  return false;
}

function ankiUserDeckRoot(username) {
  return ANKI_DECK_PREFIX + '::' + (username || 'default');
}
function isOwnedDeck(deck, username) {
  if (typeof deck !== 'string' || !deck) return false;
  const root = ankiUserDeckRoot(username);
  return deck === root || deck.startsWith(root + '::');
}
/* 牌组名形状校验：本应用所有牌组名都是「中文前缀::用户名::中文叶子」。
   历史事故：某次外部直连 AnkiConnect 的调用把中文按 ASCII 编码，
   「英语学习::catten::薄弱点」变成「????::catten::???」并在 Anki 里建出垃圾牌组。
   这里对经过本服务的牌组名做兜底：
   - 不得含 U+FFFD（UTF-8 解码失败的替换字符，双重编码事故的标志）
   - 不得含 '?'（本应用牌组名永远不用问号；ASCII 编码丢失中文的标志就是 ?）
   - 不得含控制字符 */
function isSaneDeckName(deck) {
  if (typeof deck !== 'string' || !deck) return false;
  if (deck.includes('\uFFFD') || deck.includes('?')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(deck)) return false;
  return true;
}
function isSafeMediaName(name) {
  // 只允许应用自己生成的音频文件名，禁止路径分隔符与父级引用
  return typeof name === 'string' && /^ai_en_[A-Za-z0-9_-]{1,64}\.(mp3|m4a|ogg|wav)$/.test(name);
}

/* AnkiConnect 的 note 支持 audio/picture/video 数组，其条目可写 {path:...}（把本机任意文件
   复制进 Anki 媒体库）或 {url:...}（让 Anki 去抓远端地址）。本应用的音频一律走
   storeMediaFile + [sound:...]（见 js/app/06-anki.js），从不使用这些字段，
   因此在代理层直接拒绝，避免通过 addNote 绕开 storeMediaFile 的文件名白名单。 */
const ANKI_NOTE_MEDIA_FIELDS = ['audio', 'picture', 'video'];
function badNoteMedia(note) {
  for (const f of ANKI_NOTE_MEDIA_FIELDS) {
    if (note[f] !== undefined) {
      return { status: 403, error: 'note.' + f + ' not allowed（音频请走 storeMediaFile）' };
    }
  }
  return null;
}

/* 顶层 OR 检测：括号内的 OR 是安全的（deck:X (is:due OR is:new)），
   括号外的 OR 会新增一个不受牌组限定的检索分支（deck:X OR deck:*），必须拒绝。
   括号不配对时形状不可信，同样按「有顶层 OR」处理。 */
function hasTopLevelOr(query) {
  let depth = 0;
  const re = /\(|\)|\sor\s/gi;
  let m;
  while ((m = re.exec(query)) !== null) {
    const tok = m[0];
    if (tok === '(') depth++;
    else if (tok === ')') { depth--; if (depth < 0) return true; }
    else if (depth === 0) return true;
  }
  return depth !== 0;
}

/* Anki 检索串归属校验。合法形态只有两种：
   1) 以 deck:<本用户牌组根> 开头，可继续 AND 其它条件（括号内可用 OR）
   2) 纯 nid: 列表（刚 addNotes 完用 changeDeck 归位，见 ensureDeckPlacement）
   历史缺陷：此前只做 query.includes('deck:'+root)，`deck:<root> OR deck:*`
   能整库读取 / 把任意卡片移进自己牌组。 */
function ankiQueryScoped(query, root) {
  const q = String(query || '').trim();
  if (!q) return false;
  if (q.includes('*')) return false;              // 通配符可逃出本用户子树
  if (/(^|\s)-deck:/i.test(q)) return false;      // 取反牌组限定
  // 形态 2：纯 nid: 列表（单个，或用 OR 连接多个）
  const alts = q.split(/\s+or\s+/i).map(s => s.trim()).filter(Boolean);
  if (alts.length && alts.length <= ANKI_MAX_NOTES && alts.every(t => /^nid:\d{1,20}$/.test(t))) return true;
  // 形态 1：deck: 限定开头，且不得有顶层 OR 追加不受限分支
  if (hasTopLevelOr(q)) return false;
  return q.startsWith('deck:' + root);
}

/* 校验一次 Anki 代理请求。通过返回 null，否则返回 { status, error } */
function ankiGuard(payload, username) {
  if (!payload || typeof payload !== 'object') return { status: 400, error: 'invalid anki payload' };
  const action = typeof payload.action === 'string' ? payload.action : '';
  if (!action) return { status: 400, error: 'anki action required' };

  const allowed = ANKI_READONLY_ACTIONS.has(action) || ANKI_GUI_ACTIONS.has(action) || ANKI_GUARDED_ACTIONS.has(action);
  if (!allowed) return { status: 403, error: 'anki action not allowed: ' + action.slice(0, 40) };
  if (!ANKI_GUARDED_ACTIONS.has(action)) return null;

  const p = payload.params && typeof payload.params === 'object' ? payload.params : {};
  const root = ankiUserDeckRoot(username);
  const denyDeck = (d) => ({ status: 403, error: 'deck not owned: ' + String(d).slice(0, 60) + '（仅允许 ' + root + ' 子树）' });
  // 牌组名必须同时满足：形状正常（无乱码/问号）+ 归属于当前用户
  const badDeck = (d) => (!isSaneDeckName(d) || !isOwnedDeck(d, username)) ? denyDeck(d) : null;

  switch (action) {
    case 'addNote': {
      const note = p.note;
      if (!note || typeof note !== 'object') return { status: 400, error: 'note required' };
      { const d = badDeck(note.deckName); if (d) return d; }
      if (note.modelName !== undefined && !ANKI_ALLOWED_MODELS.has(note.modelName)) {
        return { status: 403, error: 'model not allowed: ' + String(note.modelName).slice(0, 40) };
      }
      { const m = badNoteMedia(note); if (m) return m; }
      return null;
    }
    case 'addNotes':
    case 'canAddNotes': {
      const notes = p.notes;
      if (!Array.isArray(notes) || !notes.length) return { status: 400, error: 'notes required' };
      if (notes.length > ANKI_MAX_NOTES) return { status: 400, error: 'too many notes (max ' + ANKI_MAX_NOTES + ')' };
      for (const n of notes) {
        if (!n || typeof n !== 'object') return { status: 400, error: 'invalid note entry' };
        { const d = badDeck(n.deckName); if (d) return d; }
        if (n.modelName !== undefined && !ANKI_ALLOWED_MODELS.has(n.modelName)) {
          return { status: 403, error: 'model not allowed: ' + String(n.modelName).slice(0, 40) };
        }
        { const m = badNoteMedia(n); if (m) return m; }
      }
      return null;
    }
    case 'createDeck': {
      return badDeck(p.deck);
    }
    case 'changeDeck': {
      { const d = badDeck(p.deck); if (d) return d; }
      if (!Array.isArray(p.cards) || !p.cards.length) return { status: 400, error: 'cards required' };
      if (p.cards.length > ANKI_MAX_CARDS) return { status: 400, error: 'too many cards (max ' + ANKI_MAX_CARDS + ')' };
      if (!p.cards.every(c => Number.isSafeInteger(c) && c > 0)) return { status: 400, error: 'invalid card id' };
      return null;
    }
    case 'guiDeckReview': {
      return badDeck(p.name);
    }
    case 'getDeckStats': {
      const decks = p.decks;
      if (!Array.isArray(decks) || !decks.length) return { status: 400, error: 'decks required' };
      for (const d of decks) { const bad = badDeck(d); if (bad) return bad; }
      return null;
    }
    case 'findCards': {
      // 只允许两种检索形态：
      //   1) 显式限定在本用户牌组内：deck:英语学习::<user>[...]
      //   2) 纯 note id 列表：nid:123 OR nid:456
      //      （用于刚添加完卡片后 changeDeck 归位，见 ensureDeckPlacement）
      const query = typeof p.query === 'string' ? p.query : '';
      if (!query) return { status: 400, error: 'query required' };
      if (ankiQueryScoped(query, root)) return null;
      return { status: 403, error: 'query must be scoped to deck:' + root + ' 或为 nid: 列表' };
    }
    case 'cardsInfo': {
      const cards = p.cards;
      if (!Array.isArray(cards) || !cards.length) return { status: 400, error: 'cards required' };
      if (cards.length > ANKI_MAX_CARDS) return { status: 400, error: 'too many cards (max ' + ANKI_MAX_CARDS + ')' };
      if (!cards.every(c => Number.isSafeInteger(c) && c > 0)) return { status: 400, error: 'invalid card id' };
      return null;
    }
    case 'findNotes': {
      // 与 findCards 同样限定在本用户牌组内（生词去重时会查 deck:...::词汇 tag:vocabulary）
      const query = typeof p.query === 'string' ? p.query : '';
      if (!query) return { status: 400, error: 'query required' };
      if (!ankiQueryScoped(query, root)) {
        return { status: 403, error: 'query must be scoped to deck:' + root };
      }
      return null;
    }
    case 'notesInfo': {
      const notes = p.notes;
      if (!Array.isArray(notes) || !notes.length) return { status: 400, error: 'notes required' };
      if (notes.length > ANKI_MAX_CARDS) return { status: 400, error: 'too many notes (max ' + ANKI_MAX_CARDS + ')' };
      if (!notes.every(n => Number.isSafeInteger(n) && n > 0)) return { status: 400, error: 'invalid note id' };
      return null;
    }
    case 'createModel':
    case 'updateModelStyling': {
      const name = action === 'createModel' ? p.modelName : (p.model && p.model.name);
      if (!ANKI_ALLOWED_MODELS.has(name)) {
        return { status: 403, error: 'model not allowed: ' + String(name).slice(0, 40) };
      }
      return null;
    }
    case 'storeMediaFile': {
      if (!isSafeMediaName(p.filename)) return { status: 400, error: 'invalid media filename' };
      if (typeof p.data !== 'string' || !p.data) return { status: 400, error: 'media data required' };
      if (p.data.length > ANKI_MAX_MEDIA_B64) return { status: 400, error: 'media too large' };
      // 不允许通过 path/url 让 Anki 读取本机任意文件或发起外部请求
      if (p.path !== undefined || p.url !== undefined) return { status: 400, error: 'media path/url not allowed' };
      return null;
    }
    default:
      return { status: 403, error: 'anki action not allowed: ' + action.slice(0, 40) };
  }
}

module.exports = { matchesType, ankiGuard, ankiUserDeckRoot, isOwnedDeck, isSaneDeckName, isSafeMediaName, ankiQueryScoped };