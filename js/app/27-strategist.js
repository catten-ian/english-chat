/* ============================================================
   策略师指令设置：保存一次性或常驻的对话指导
   由 js/app.js 拆分而来
   ============================================================ */
'use strict';
function getStrategistInstructions() {
  const v = getSetting('strategistInstructions', []);
  return Array.isArray(v) ? v : [];
}
function saveStrategistInstructions(list) {
  setSetting('strategistInstructions', list);
  apiSave('strategist', list);
}
function sendStrategistInstruction() {
  const input = document.getElementById('setStrategistInstr');
  const text = (input.value || '').trim();
  if (!text) { toastMsg('请输入指令内容'); return; }
  const permanent = document.getElementById('setInstrPermanent').checked;
  const list = getStrategistInstructions();
  list.push({ text: text, permanent: Boolean(permanent), time: new Date().toISOString() });
  saveStrategistInstructions(list);
  input.value = '';
  document.getElementById('setInstrPermanent').checked = false;
  toastMsg(permanent ? '📌 指令已设为常驻' : '✅ 指令已发送（仅一次）');
  openSettings();
}
function deleteStrategistInstruction(idx) {
  const list = getStrategistInstructions();
  if (idx >= 0 && idx < list.length) {
    list.splice(idx, 1);
    saveStrategistInstructions(list);
    openSettings();
  }
}
