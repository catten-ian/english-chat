/* ============================================================
   阅读练习导出与时文源：预置文章、服务器时文正文、Word/长图导出
   由 js/app.js 拆分而来
   ============================================================ */
'use strict';

/* 预置时文保持离线可用；RSS 仅在用户主动选择时访问，失败则回退到预置文章。 */
const READING_PREPARED_ARTICLES = [
  {
    title: 'How Cities Learn to Adapt',
    paragraphs: [
      'Cities are often described as machines, but they behave more like living systems. They absorb people, habits, money, and ideas, then change in ways that no single planner can completely predict. A street redesigned for buses may later become a safer route for children, while a neglected park can become a cooling refuge during a heatwave.',
      'That is why adaptation matters as much as construction. A city facing hotter summers may plant trees, redesign streets, open public buildings as cooling centers, and change building rules. None of these measures works alone. Their value depends on whether residents can reach them, understand them, and help improve them.',
      'The most successful projects usually begin with careful observation. Officials talk to commuters, shop owners, children, and older residents before deciding what to change. Sensors can reveal traffic and temperature, but a map cannot explain why a parent avoids a crossing or why a shop closes earlier than expected.',
      'Adaptation also requires patience. Benefits may arrive slowly, while costs are immediate and visible. Communities need ways to measure progress, publish results, and correct mistakes. A pilot project is useful only when its failures are treated as evidence rather than hidden as embarrassment.',
      'Resilience therefore includes institutions as well as infrastructure. Schools can teach emergency routines, hospitals can coordinate during extreme weather, and neighborhood groups can check on people who live alone. These networks make a response faster because trust has already been built before a crisis begins.',
      'A resilient city is one that learns quickly, protects vulnerable residents, and turns experience into better decisions. It does not promise that disruption can be eliminated. Instead, it gives people a fairer chance to recover, participate, and prepare for the next change.',
      'Consider the apparently simple decision to plant a row of trees beside a busy road. Engineers must leave room for underground cables, while transport planners must protect sightlines at junctions. Residents may welcome shade but worry about roots damaging pavements. A useful consultation therefore does not merely ask whether people like trees. It explains the tradeoffs and invites suggestions about species, locations, maintenance, and the distribution of benefits.',
      'Distribution is particularly important because the hottest neighborhoods are not always the ones with the strongest political voice. A district with little greenery may also contain crowded housing, older residents, and workers who cannot remain indoors during the hottest hours. Giving every district the same number of trees might appear fair, yet reinforce existing inequalities. A better approach considers both exposure to danger and the resources people already have to cope with it.',
      'Measurement must also be designed carefully. Counting the number of new trees is easy, but it does not show whether they survived or whether pedestrians actually feel cooler. A city could track shade at different times, compare summer temperatures, and ask residents how they use the street. If a project performs poorly, that evidence should lead to changes in watering, planting, or street design, not simply to another attractive announcement.',
      'There are financial questions as well. A grant may pay for construction without covering years of maintenance. Without a reliable budget, an impressive public space can gradually become unusable. Local authorities need to estimate continuing costs before celebrating initial investment. They also need to make responsibility clear: when several departments share a project, everyone can assume that someone else will repair a broken fountain or replace a damaged sign.',
      'The lessons extend beyond climate. A city adapting to an aging population might improve crossings, benches, and public transport information. These changes can help parents with young children and people carrying heavy shopping too. However, planners should not assume that one solution benefits everyone equally. A bench placed beside a noisy road may be technically accessible but unpleasant to use. Testing ordinary journeys with residents reveals problems that a drawing may conceal.',
      'Ultimately, adaptation is a continuing conversation between evidence and experience. Experts contribute knowledge about materials, weather, and budgets; residents contribute knowledge about daily life. Neither kind of knowledge is sufficient by itself. When a city makes decisions openly and revises them honestly, disagreement becomes a source of information. That process cannot prevent every disruption, but it can turn an uncertain future into a shared task rather than a private struggle. The habit also creates institutional memory: later planners can see which assumptions failed, which groups were overlooked, and which modest experiments deserved expansion. A resilient city is never finished; it keeps learning after the emergency has left the headlines. It should also explain uncertainty plainly, because residents are more likely to cooperate when they understand what is known, what is being tested, and how a decision can be revised. Regular public reviews can compare promises with results, invite criticism before a small problem becomes a crisis, and ensure that adaptation remains a shared responsibility rather than a slogan used only in official speeches.',
      'The same principle applies to public trust. A warning that arrives too late, a cooling center that is difficult to reach, or a consultation that ignores a neighborhood can weaken confidence even when the project looks successful on paper. Officials who publish both progress and failure give residents a reason to continue participating. Adaptation is strongest when people can see how their observations changed a decision and when future plans leave room for another careful correction. This transparency makes difficult tradeoffs easier to discuss for every group affected by change.',
    ]
  },
  {
    title: 'The Quiet Value of Repair',
    paragraphs: [
      'Repair is often treated as a private chore, yet it has public value. When people mend a bicycle, a jacket, or a household appliance, they extend the useful life of an object and reduce the demand for new materials. The decision may appear small, but repeated across a neighborhood it can change what shops sell and what manufacturers design.',
      'Repair also preserves knowledge. A craftsperson who explains how a hinge works is passing on more than a quick fix; they are teaching a way to observe, test, and make a careful choice. Such knowledge is especially valuable to young people, who can discover that technology is not magic but a collection of understandable decisions.',
      'Modern products can make repair difficult by hiding parts behind glue or replacing a simple component with an entire sealed unit. Consumer groups therefore argue for clearer manuals and accessible spare parts. Their aim is not to reject innovation, but to make innovation compatible with responsibility.',
      'The culture of repair has a social dimension as well. A community workshop gives strangers a reason to meet and allows people with different abilities to contribute. Someone may bring a broken lamp, while another offers patience, tools, or advice. The result is an exchange of skills rather than a one-way purchase.',
      'Repair cannot solve every environmental problem, and unsafe work should be left to trained professionals. Nevertheless, it changes the meaning of ownership. An object becomes part of a longer story, and care becomes a practical form of economy. Learning to repair is therefore also learning to value time, materials, and one another.',
      'The first lesson in a repair workshop is often diagnosis rather than action. A lamp that fails to light might have a broken bulb, a loose connection, or a damaged cable. Replacing parts at random wastes money and may create new dangers. Volunteers begin by asking when the problem appeared and what happened immediately before it. This habit of tracing causes helps learners distinguish an observation from an assumption, a skill useful far beyond the workbench.',
      'A responsible workshop also makes its limits visible. Volunteers should explain which tasks they can safely attempt and when an object needs a qualified professional. Medical equipment, damaged batteries, and electrical devices with uncertain insulation are not suitable opportunities for casual experimentation. Refusing a repair can be an act of care rather than a failure of confidence. Good judgment includes knowing when the information or tools available are insufficient.',
      'For manufacturers, making a product repairable can involve uncomfortable choices. A sealed case may be thinner and cheaper to assemble than one held together with screws. Yet the savings disappear from the consumer perspective if a small fault forces replacement of the whole device. Product labels that describe spare-part availability and expected repair costs could make these hidden differences easier to compare. Competition would then reward durability alongside appearance and price.',
      'Economic barriers remain even when repair is technically possible. A replacement component might cost little, but skilled labor and transport can make the final bill larger than the price of a new product. Community workshops cannot replace professional businesses, nor should volunteers be expected to subsidize every repair. They can, however, teach basic maintenance and help people make informed decisions before buying. Cleaning a filter or tightening a loose screw may prevent an expensive failure later.',
      'The benefits are not limited to objects successfully restored. Someone who watches a bicycle brake being adjusted learns to recognize wear and to describe a future problem more precisely. A child who takes apart an unusable clock may discover why different materials were chosen for different parts. Even an unsuccessful repair can produce useful knowledge, provided the workshop records what was tried and avoids presenting uncertain explanations as established facts.',
      'Repair also challenges the expectation that everything should look new. A carefully patched jacket can remain comfortable and meaningful, although the patch is visible. In some communities, visible mending becomes a creative practice, turning damage into a record of use. This does not require everyone to reject new products. It invites a more deliberate question: what is genuinely improved by replacement, and what is merely made unfamiliar enough to feel desirable?',
      'Over time, these questions can reshape local relationships. Libraries may lend tools, schools may invite craftspeople to demonstrate skills, and shops may offer reliable advice about maintenance. Such arrangements take planning and trust, but they lower the threshold for participation. The lasting achievement of a repair culture is therefore not a collection of perfectly restored objects. It is a community better able to investigate problems, share knowledge, and decide what deserves continued care. Keeping records matters here as well: a workshop can note which fixes lasted, which instructions confused beginners, and when professional help was necessary. That memory prevents every new learner from repeating the same experiment and makes practical knowledge easier to pass on. It can also reveal which products repeatedly fail, giving consumers and manufacturers evidence for safer design rather than relying on isolated complaints. When these lessons are shared openly, repair becomes more than a private economy: it becomes a practical form of citizenship in which people reduce waste, protect one another from unsafe shortcuts, and ask producers to take responsibility for the full life of what they sell.',
      'A repair culture also needs patience. A careful diagnosis may take longer than a quick replacement, but it prevents a small fault from becoming a larger hazard. By teaching people to pause, inspect, and ask for help when necessary, workshops turn maintenance into a form of practical judgment rather than a race to make an object look new.',
    ]
  }
];

function readingPreparedArticle() {
  const index = Math.floor(Math.random() * READING_PREPARED_ARTICLES.length);
  const article = READING_PREPARED_ARTICLES[index];
  return { title: article.title, paragraphs: article.paragraphs.slice(), sourceType: 'prepared', wordCount: article.paragraphs.join(' ').split(/\s+/).length };
}

async function readingFetchRssArticle() {
  const configured = String(getSetting('readingRssSource', getSetting('readingRssUrl', 'bbc')));
  const source = configured === 'guardian' || configured.includes('theguardian.com') ? 'guardian' : 'bbc';
  const response = await apiFetch('/api/reading/sources?source=' + source, { headers: authHeaders(), signal: AbortSignal.timeout(25000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '时文加载失败');
  const articles = (result.articles || []).filter(article => Array.isArray(article.paragraphs) && article.paragraphs.join(' ').split(/\s+/).length >= 600);
  if (!articles.length) throw new Error('RSS 没有足够长的正文');
  return articles[Math.floor(Math.random() * articles.length)];
}

async function readingTranslateHardWords() {
  const article = document.getElementById('gameReadingArticle');
  if (!article || !article.textContent.trim() || getSetting('readingShowGlossary', true) === false) return;
  const words = [...new Set((article.textContent.match(/\b[a-zA-Z]{9,}\b/g) || []).map(w => w.toLowerCase()))].slice(0, 20);
  if (!words.length) return;
  try {
    const raw = await callAPI([{role:'system',content:'Return JSON only as {"items":[{"word":"...","meaning":"简洁中文本义"}]}. Give basic Chinese senses only.'},{role:'user',content:'Translate these potentially difficult words: '+words.join(', ')}],{maxTokens:1200,temperature:0.2});
    const parsed = typeof readingPracticeParseJSON === 'function' ? readingPracticeParseJSON(raw) : JSON.parse(raw);
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    if (!items.length) return;
    const block = document.createElement('aside'); block.className='reading-glossary';
    block.innerHTML='<strong>重点词汇</strong><ul>'+items.filter(x=>x.word&&x.meaning).map(x=>'<li><b>'+esc(x.word)+'</b> '+esc(x.meaning)+'</li>').join('')+'</ul>';
    article.appendChild(block);
  } catch (e) { if (typeof dbg === 'function') dbg('READING_GLOSSARY',e.message); }
}

async function readingResolveCurrentArticle() {
  if (typeof readingFetchRssArticle !== 'function') return readingPreparedArticle();
  try { return await readingFetchRssArticle(); } catch (e) {
    if (typeof toastMsg === 'function') toastMsg('RSS 暂时不可用，已使用预置时文');
    return readingPreparedArticle();
  }
}

function readingExportRoot() {
  const article = document.getElementById('gameReadingArticle');
  const questions = document.getElementById('gameReadingQuestions');
  if (!article || !article.textContent.trim()) {
    if (typeof toastMsg === 'function') toastMsg('请先生成阅读题组');
    return null;
  }
  const root = document.createElement('section');
  root.className = 'reading-export-sheet';
  root.style.cssText = 'background:#fff;color:#111;max-width:820px;margin:0 auto;padding:28px;font:16px/1.8 Georgia,"Times New Roman",serif;';
  root.innerHTML = article.innerHTML + (questions ? questions.innerHTML : '');
  root.querySelectorAll('input,button').forEach((el) => el.remove());
  root.querySelectorAll('.gr-feedback').forEach((el) => { el.style.display = ''; });
  return root;
}

function readingExportEsc(value) {
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* A tiny dependency-free ZIP writer.  DOCX is an Open XML package, so using a
   real .docx here avoids the old HTML-with-a-.doc-extension download. */
function readingExportCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function readingExportU16(value) { return new Uint8Array([value & 255, (value >>> 8) & 255]); }
function readingExportU32(value) { return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function readingExportZip(entries) {
  const encoder = new TextEncoder();
  const chunks = []; const central = []; let offset = 0;
  entries.forEach(({name, content}) => {
    const nameBytes = encoder.encode(name); const data = encoder.encode(content); const crc = readingExportCrc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length); const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0, true);
    view.setUint16(8, 0, true); view.setUint16(10, 0, true); view.setUint16(12, 0, true);
    view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true); view.setUint16(26, nameBytes.length, true); view.setUint16(28, 0, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length); chunks.push(local);
    const record = new Uint8Array(46 + nameBytes.length); const rv = new DataView(record.buffer);
    rv.setUint32(0, 0x02014b50, true); rv.setUint16(4, 20, true); rv.setUint16(6, 20, true); rv.setUint16(8, 0, true); rv.setUint16(10, 0, true); rv.setUint16(12, 0, true); rv.setUint16(14, 0, true);
    rv.setUint32(16, crc, true); rv.setUint32(20, data.length, true); rv.setUint32(24, data.length, true); rv.setUint16(28, nameBytes.length, true); rv.setUint16(30, 0, true); rv.setUint16(32, 0, true); rv.setUint16(34, 0, true); rv.setUint16(36, 0, true); rv.setUint32(38, 0, true); rv.setUint32(42, offset, true); record.set(nameBytes, 46); central.push(record); offset += local.length;
  });
  const centralSize = central.reduce((n, x) => n + x.length, 0); const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
  return new Blob([...chunks, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function readingPracticeExportWord() {
  const root = readingExportRoot();
  if (!root) return;
  const paragraphs = [...root.querySelectorAll('h1,h2,h3,p,li,.pf-section')].map((el) => el.textContent.trim()).filter(Boolean);
  const body = paragraphs.map((text) => '<w:p><w:r><w:t xml:space="preserve">' + readingExportEsc(text) + '</w:t></w:r></w:p>').join('');
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>';
  const blob = readingExportZip([
    {name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'},
    {name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},
    {name: 'word/document.xml', content: documentXml}
  ]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'reading-practice.docx'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readingPracticeExportImage() {
  const root = readingExportRoot();
  if (!root) return;
  /* 不引入第三方库：SVG foreignObject 能保留中文和题目排版，并可下载为 PNG。 */
  const width = 900;
  root.style.width = (width - 56) + 'px'; root.style.boxSizing = 'border-box'; root.style.position = 'fixed'; root.style.left = '-100000px'; root.style.top = '0'; root.style.visibility = 'hidden';
  document.body.appendChild(root);
  const height = Math.max(600, Math.ceil(root.scrollHeight || root.getBoundingClientRect().height) + 56);
  root.style.position = 'static'; root.style.left = 'auto'; root.style.top = 'auto'; root.style.visibility = 'visible';
  const serialized = new XMLSerializer().serializeToString(root);
  root.remove();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><style>body{margin:0;background:white;color:#111;font:16px/1.8 Georgia,"Times New Roman",serif}h2{font-size:24px}input,button{display:none}.gr-feedback{display:block}</style><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">' + serialized + '</div></foreignObject></svg>';
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((png) => { const u = URL.createObjectURL(png); const a = document.createElement('a'); a.href = u; a.download = 'reading-practice.png'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }, 'image/png');
  };
  image.onerror = () => { URL.revokeObjectURL(url); if (typeof toastMsg === 'function') toastMsg('当前浏览器不支持长图导出，请使用打印/PDF'); };
  image.src = url;
}

function readingPracticePrint() {
  const root = readingExportRoot();
  if (!root) return;
  const old = document.body.querySelector('.reading-print-overlay');
  if (old) old.remove();
  const overlay = document.createElement('div'); overlay.className = 'reading-print-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;overflow:auto;background:#fff;z-index:99999;padding:20px;';
  overlay.appendChild(root);
  document.body.appendChild(overlay);
  const cleanup = () => { overlay.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
