/* ============================================================
   AI 英语对话教练 — 设置导入处理
   由 js/app.js 拆分而来；Tavern 角色卡导入在设置页渲染之后按需执行。
============================================================ */
function chooseTavernCardFile() {
  const input = document.getElementById('tavernCardFile');
  if (input) input.click();
}

async function importTavernCard(input) {
  const file = input && input.files && input.files[0];
  if (!file || typeof TavernCards === 'undefined') return;
  try {
    let raw;
    if (/\.png$/i.test(file.name) || file.type === 'image/png') {
      raw = TavernCards.decodePngText(await file.arrayBuffer());
      if (!raw.avatar && typeof FileReader !== 'undefined') {
        raw.avatar = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
    } else {
      raw = JSON.parse(await file.text());
    }
    const character = TavernCards.normalize(raw);
    const existing = Array.isArray(getSetting('characters', [])) ? getSetting('characters', []) : [];
    let id = character.id;
    let suffix = 2;
    while (CHARACTERS.some(c => c.id === id) || existing.some(c => c && c.id === id)) id = character.id + '_' + suffix++;
    character.id = id;
    existing.push(character);
    setSetting('characters', existing);
    setActiveCharacterId(id);
    apiSave('characters', existing);
    toastMsg('✅ 已导入角色卡：' + character.name + (character.worldbook.length ? '（含世界书）' : ''));
    if (input) input.value = '';
    openSettings();
  } catch (e) {
    if (input) input.value = '';
    toastMsg('❌ 角色卡导入失败：' + (e.message || '格式不受支持'));
  }
}
