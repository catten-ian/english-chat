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
  },
  {
    title: 'When a River Returns to the City',
    paragraphs: [
      'For much of the last century, many cities treated rivers as obstacles to be controlled or as convenient channels for industry. Concrete walls straightened bends, roads covered the banks, and factories used the water to move goods. These changes brought real benefits: transport became more predictable, floods could be diverted from some streets, and riverside land became easier to build on. Yet the apparent efficiency came with costs that were not always counted. Wetlands disappeared, fish lost places to reproduce, and residents were separated from water that had shaped their town for generations. In some districts, a river could be seen only from a bridge or through a fence. The question facing planners today is not simply whether to make a river look attractive. It is whether the city can restore useful ecological functions while protecting people and homes from danger.',
      'Restoration rarely means returning a waterway to an imagined untouched past. The land around it has changed, and millions of people may depend on roads, housing, and businesses that now occupy the former floodplain. A practical project therefore begins with evidence. Engineers measure water levels and flow, ecologists study habitat, and residents describe where streets flood or where children already gather. These sources can disagree. A model may identify a technically ideal place for a wetland, while local families worry that the same land is their only safe walking route. Consultation is valuable when it changes the design, not when it merely announces a decision after all important choices have been made. Small pilot areas can reveal problems before a city commits its entire budget.',
      'Natural features can reduce risk, but they are not magic barriers. Marshes and floodable parks may hold water temporarily, slow a peak, and provide habitat during ordinary seasons. Their performance depends on location, soil, maintenance, and the scale of a storm. A restored bank cannot protect a neighborhood if drainage pipes are blocked or if buildings continue to be placed in the most exposed areas. Cities need layers of protection: clear warnings, evacuation routes, stronger critical facilities, and land-use rules that reflect changing conditions. These measures also raise questions of fairness. A new riverside park may increase nearby property values and rents, potentially pushing out the residents who endured earlier pollution. Environmental improvement should include plans for access and housing so that public gains do not become private benefits for a small group.',
      'The most durable projects connect daily life with long-term care. Schools can use the river to teach biology and local history; community groups can report litter or damaged paths; and public agencies can publish water-quality results in language residents can understand. Maintenance needs a reliable budget, because plants die and paths wear down after the opening ceremony. Success should be measured over years, not only by the number of trees planted. Are more species present? Can people safely reach the bank? Does floodwater move through the planned space? Are residents from different neighborhoods benefiting? These questions keep a project open to correction. A river that returns to city life is not a completed monument. It is a shared system that must remain useful when weather, population, and public priorities change.'
      ,'Cities can make this work more durable by agreeing in advance which agency responds to a blocked channel, damaged path, or unsafe bank. If responsibilities are scattered, each office may assume that another will act. A public maintenance calendar gives residents a way to report problems and see whether they were addressed. It also protects restoration from becoming a one-time construction project whose future depends on a temporary grant. The river remains part of ordinary civic life when people can use it safely, learn from it, and take part in decisions about its care.'
    ]
  },
  {
    title: 'The Hidden Work Behind Reliable Public Transport',
    paragraphs: [
      'Passengers usually notice public transport when something goes wrong: a delayed train, a crowded bus, or an announcement that is difficult to hear. They rarely see the quiet work that makes an ordinary journey dependable. Operators coordinate vehicle schedules, inspect tracks and roads, train staff, and plan how to respond when a signal or a lift fails. A timetable is therefore more than a list of departure times. It is a promise supported by spare vehicles, maintenance windows, clear communication, and decisions about where limited resources should go. When a service is designed only around the average journey, it may fail the people whose trips are less predictable, including shift workers, students, people with disabilities, and families travelling with children.',
      'Reliability is shaped by the entire journey, not only by the time spent inside a vehicle. A station may be close on a map but difficult to reach across a dangerous road. A bus may arrive on time while the information display is broken or the platform is inaccessible. Transport agencies increasingly use data from sensors and ticketing systems to identify delays, yet numbers cannot fully explain why passengers avoid a route. Interviews and observation can reveal that a transfer feels unsafe at night, that a sign uses unfamiliar language, or that a lift is frequently out of service. Good planning combines these kinds of evidence. It also makes uncertainty visible: real-time updates should distinguish a confirmed arrival from an estimate that may change.',
      'Expanding service requires choices about both speed and coverage. A fast route between major centers can carry many passengers, but it may leave outer neighborhoods with long walks and infrequent connections. A dense network can bring more places within reach, though vehicles may move slowly if streets are congested. There is no single design that satisfies every goal. Public discussion helps determine which tradeoffs matter most, while published performance measures let residents see whether promises were kept. Agencies should compare more than total passenger numbers. They can examine waiting times by neighborhood, missed connections, accessibility, and the reliability of service during early mornings and late evenings. Otherwise, a system may appear successful overall while repeatedly failing the same groups.',
      'Maintenance is another public decision. Replacing worn equipment before it fails may seem less exciting than opening a new line, but preventive work avoids sudden disruption and can improve safety. Cutting maintenance can make a budget look smaller this year while transferring larger costs to future passengers. Transparent asset plans explain what is being repaired, why it matters, and how long the work will take. During disruptions, staff need practical authority to help passengers rather than merely repeat a script. Clear alternative routes and accessible assistance can turn a frustrating delay into a manageable one. Reliable transport is ultimately a relationship of trust. People are more willing to plan around a service when they receive honest information and see the system learn from recurring failures.'
      ,'Trust also depends on what happens after a major disruption. Agencies can publish a short review that explains the cause, the decisions made, and the changes planned to reduce a repeat. Such a review should not become a search for one person to blame. Complex failures often involve several conditions, including old equipment, unclear procedures, and unexpected demand. A useful account identifies these conditions and assigns follow-up work to named teams. Passengers can then judge whether the service learned anything from the event. This steady feedback matters as much as a new vehicle or station because it makes improvement visible and gives workers a reason to report small problems early.'
      ,'Accessibility also depends on details that are easy to overlook. A journey planner may offer a route with a lift, but it should say whether that lift is operating now and what alternative exists if it stops. Audio announcements need visual equivalents, while digital maps should work for people who cannot comfortably read a small screen. Staff training matters because passengers facing a disruption often need a person who can explain options clearly. Transport agencies can test these services with people who have different mobility, sensory, language, and caregiving needs. That testing should happen before a new system is declared complete. Feedback gathered afterward can guide repairs, but early participation can prevent avoidable barriers from being built into the design.'
    ]
  },
  {
    title: 'How Libraries Serve a Changing Neighborhood',
    paragraphs: [
      'A public library is often described as a place to borrow books, but its role becomes clearer when a neighborhood changes. New families arrive, older residents need different services, and work moves between offices and homes. Some people have reliable internet and a quiet room; others share devices or depend on a public connection to complete essential tasks. The library can offer materials, but it can also provide a stable place where people ask questions without having to buy a service first. This does not mean that librarians can solve every problem. It means the institution can help residents find trustworthy information, discover local support, and learn how to use resources that would otherwise be difficult to reach.',
      'Designing these services requires listening carefully. A digital-skills workshop may attract people who already feel confident while missing those who are most uncertain. Parents may need evening hours, job seekers may need private access to a computer, and newcomers may benefit from books in languages spoken at home. Attendance figures show how many people came, but they do not reveal who stopped attending or why. Short conversations, anonymous feedback, and partnerships with schools or community groups can make hidden needs visible. The building itself also sends a message. If signs are confusing or staff appear too busy to approach, a service may technically exist without feeling available. Accessibility includes ramps and large print, but also clear procedures and a welcoming response to basic questions.',
      'Libraries must balance openness with limited space and staff time. A room used for quiet study cannot always host a lively meeting, and computers reserved for job applications may be needed by students after school. Rather than treating these conflicts as evidence that one group does not belong, managers can test schedules and explain how decisions are made. Some spaces can serve different purposes at different hours. Rules work best when they protect access without making users feel that they are under suspicion. Partnerships can extend what a library offers, but responsibility should remain clear: if an outside organization runs a program, visitors still need to know whom to contact when it is cancelled or inaccessible.',
      'The value of a library is difficult to measure with a single number. Loans and visits matter, yet so do a student who finds a quiet place, a resident who learns to evaluate a suspicious message, and a community group that discovers a room where members can meet. These outcomes may appear small and may take time to develop. Public institutions can still gather evidence by asking whether services are used by the people they were designed for, whether users return, and what barriers remain. Publishing both successes and gaps helps a library adjust its work rather than defend every existing program. As neighborhoods change, the library remains useful when it protects free access to knowledge while changing the ways that access is offered.'
      ,'This role is especially important when information is confusing or designed to attract attention rather than explain a subject. Staff can teach visitors how to compare sources, check dates, and distinguish evidence from opinion without telling them what conclusion they must reach. A library can also invite local experts to answer questions while making clear where professional advice is required. These activities do not replace schools, health services, or public agencies. They create a calm point of connection where residents can learn how to find the right institution and prepare better questions. The value lies partly in helping people become more independent information users over time.'
      ,'A changing neighborhood also needs places where people can meet across age and language groups. A repair workshop, reading circle, or conversation table can help residents exchange practical knowledge that is not found in a catalogue. Such activities should be shaped with the people who will use them, since a program planned without local input may repeat assumptions about what visitors need. Libraries can invite small proposals, lend materials, and make schedules visible well in advance. Clear expectations help volunteers and staff share responsibility without turning a public service into unpaid work. When these relationships are maintained carefully, the library becomes a dependable civic space that supports learning as well as access to information.'
    ]
  },
  {
    title: 'Food Waste Is a Problem of Coordination',
    paragraphs: [
      'Food waste is often explained as a matter of individual carelessness, but much of it is produced by decisions made across a supply chain. Farms may harvest more than buyers eventually accept; shops may order extra stock to avoid empty shelves; restaurants may prepare large portions because customers expect abundance. Each decision can seem reasonable on its own. Together they create edible food that is difficult to sell or distribute before it spoils. Household habits matter too, especially when people misunderstand date labels or buy more than they can use. Reducing waste therefore requires coordination between growers, transport companies, retailers, charities, local authorities, and customers. A message telling people to plan meals cannot solve a system in which perfectly good produce is rejected for its appearance.',
      'Better information can help reveal where losses occur. Weighing discarded food by category may show that a shop throws away bread at closing time while a nearby community kitchen needs supplies in the evening. But measurement is useful only when someone can act on it. A donation arrangement needs safe storage, predictable collection, and clear rules about responsibility. Small businesses may lack staff to manage a complicated process, so a shared service or digital matching system can reduce the burden. Technology alone cannot create trust. Donors need to know that food will be handled safely, and recipient organizations need enough notice to plan distribution. A practical program begins with the routines people already follow and changes the handoff between them.',
      'Preventing surplus is usually better than moving it after it has been produced. Farmers and buyers can agree on more flexible standards for size or shape, stores can use sales data to order carefully, and kitchens can adjust portions while allowing diners to ask for more. These changes can meet resistance. A manager may fear losing customers if displays look sparse; a grower may not want to invest in a crop without a firm buyer. Policies can share some risk, but they must be designed with the realities of each business in mind. Public campaigns should also avoid shaming people. A household that lacks storage space or stable work hours may not be able to follow advice written for someone with predictable routines. Effective guidance gives adaptable options and recognizes different circumstances.',
      'Food recovery must remain safe and respectful. Donated food should meet clear handling standards, and recipients should be able to choose what they need rather than accept whatever is left over. Charities cannot be expected to absorb every cost created by commercial waste. Reliable partnerships provide funding for transport, refrigeration, and staff, while prevention reduces the amount that must be moved. Progress can be tracked through several measures: the volume prevented, the amount safely redistributed, the cost of collection, and whether the people receiving food find it useful. No single figure tells the whole story. When every participant can see the results and the burdens are shared fairly, reducing food waste becomes a practical improvement to the food system rather than a short-lived publicity effort.'
      ,'Local governments can help by making the rules understandable and consistent. Businesses need to know how to document donations and whom to contact when a collection is delayed. Community kitchens need stable support rather than a flood of supplies one week and none the next. Public reporting can show whether a program is reducing waste or simply shifting its cost to volunteers. The best arrangements make prevention the normal business practice and recovery a reliable second step. They also respect the people receiving food, who should have choices and clear information about ingredients. A coordinated system treats food as a valuable resource and treats every participant as a partner in reducing avoidable loss.'
    ]
  }
];

let readingPreparedLastIndex = -1;
function readingPreparedArticle() {
  let index = Math.floor(Math.random() * READING_PREPARED_ARTICLES.length);
  if (READING_PREPARED_ARTICLES.length > 1 && index === readingPreparedLastIndex) index = (index + 1) % READING_PREPARED_ARTICLES.length;
  readingPreparedLastIndex = index;
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
  return { ...articles[Math.floor(Math.random() * articles.length)], sourceType: 'rss' };
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
    block.innerHTML='<details><summary><strong>重点词汇</strong><span> · '+items.filter(x=>x.word&&x.meaning).length+' 个</span></summary><ul>'+items.filter(x=>x.word&&x.meaning).map(x=>'<li><b>'+esc(x.word)+'</b> '+esc(x.meaning)+'</li>').join('')+'</ul></details>';
    article.appendChild(block);
  } catch (e) { if (typeof dbg === 'function') dbg('READING_GLOSSARY',e.message); }
}

async function readingResolveCurrentArticle() {
  if (typeof readingFetchRssArticle !== 'function') return readingPreparedArticle();
  try { return await readingFetchRssArticle(); } catch (e) {
    if (typeof toastMsg === 'function') toastMsg('RSS 暂时不可用，已回退到时文精选');
    return { ...readingPreparedArticle(), sourceType: 'prepared-fallback', sourceNotice: e.message || 'RSS unavailable' };
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
  root.querySelectorAll('input,select,button').forEach((el) => {
    if (el.matches('input,select')) {
      const blank = document.createElement('span');
      blank.textContent = ' ______ ';
      blank.setAttribute('aria-label', '作答空格');
      el.replaceWith(blank);
    } else el.remove();
  });
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
