/* ============================================================
   AI 英语对话教练 — 背景音乐播放器（含多标签页互斥）
   由 js/app.js 拆分而来（原 5410-5621 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ============ 背景音乐（顶部导航栏按钮） ============ */
let musicItems = [];          // [{ file, name }]
let musicIdx = -1;            // 当前播放索引
let musicAudio = null;        // Audio 实例
let musicBubbleTimer = null;  // 气泡自动隐藏定时器
let musicClickTimer = null;   // 单击/双击区分定时器
let musicTabId = null;        // 本标签页唯一 ID（跨标签页互斥用）
let musicBC = null;           // BroadcastChannel 实例（多标签页互斥）

function musicEnabled() { return getSetting('musicEnabled', true) !== false; }
function musicAutoNext() { return getSetting('musicAutoNext', true) !== false; }

// 向其它标签页广播音乐状态（同一 profile / 同一 origin 下共享）
function musicBroadcast(msg) {
  try {
    if (!musicBC || !('BroadcastChannel' in window)) return;
    if (!musicTabId) musicTabId = 'tab_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    msg.tabId = musicTabId;
    musicBC.postMessage(msg);
  } catch (e) { dbg('MUSIC_BC_SEND', e.message); }
}

// 监听其它标签页的播放广播：保证同一时刻只有一个页面在播放背景音乐
function initMusicChannel() {
  try {
    if (!('BroadcastChannel' in window)) return;
    if (musicBC) { try { musicBC.close(); } catch (e) {} }
    musicBC = new BroadcastChannel('ai-en-music');
    musicBC.onmessage = function(e) {
      const m = e && e.data;
      if (!m || m.tabId === musicTabId) return;
      if (m.type === 'play') {
        // 其它标签页开始播放 → 本页若在播则静默暂停（互斥，不重叠）
        if (musicAudio && !musicAudio.paused) {
          musicAudio.pause();
          updateMusicUI();
          showMusicBubble('🎵 已在另一页面播放，本页已暂停');
        }
        // 跟随当前曲目（localStorage 共享，但内存变量需手动同步）
        if (Number.isInteger(m.idx) && m.idx >= 0 && m.idx < musicItems.length) {
          musicIdx = m.idx;
          if (musicAudio && musicAudio.src) {
            musicAudio.src = (BACKEND_URL || '') + '/music/' + encodeURIComponent(musicItems[m.idx].file);
          }
        }
      } else if (m.type === 'pause') {
        // 另一页面暂停：保持本页已暂停状态即可（无需额外动作）
        if (musicAudio && musicAudio.paused) updateMusicUI();
      }
    };
  } catch (e) { dbg('MUSIC_BC', e.message); }
}

function musicSettingsOptions() {
  if (!musicItems.length) return '<option value="">暂无曲目</option>';
  return musicItems.map((item, i) => `<option value="${i}" ${i === musicIdx ? 'selected' : ''}>${esc(item.name || item.file)}</option>`).join('');
}

function applyMusicEnabledUI() {
  const btn = document.getElementById('musicToggle');
  const enabled = musicEnabled();
  if (btn) {
    btn.disabled = !enabled;
    btn.classList.toggle('disabled', !enabled);
  }
  if (!enabled && musicAudio && !musicAudio.paused) {
    musicAudio.pause();
    musicBroadcast({ type: 'pause' });   // 关闭音乐 → 通知其它页也停
    updateMusicUI();
  }
}

function refreshMusicSettingsControls() {
  const select = document.getElementById('setMusicTrack');
  if (select) {
    select.innerHTML = musicSettingsOptions();
    if (musicIdx >= 0) select.value = String(musicIdx);
  }
  const status = document.getElementById('setMusicStatus');
  if (status) status.textContent = musicItems.length ? `${musicItems.length} 首曲目` : 'music/ 目录暂无音频';
}

async function musicInit() {
  try {
    const res = await fetch((BACKEND_URL || '') + '/api/music/list');
    const data = await res.json();
    musicItems = (data.files || []).map(f => ({ file: f.file, name: f.name }));
    if (musicItems.length) {
      const savedIdx = parseInt(localStorage.getItem('ai_en_music_idx') || '-1', 10);
      musicIdx = (savedIdx >= 0 && savedIdx < musicItems.length) ? savedIdx : 0;
    } else {
      musicIdx = -1;
    }
    applyMusicEnabledUI();
    refreshMusicSettingsControls();
    // 双击下一首 + 滚轮调音量（仅绑定一次）
    const btn = document.getElementById('musicToggle');
    if (btn && !btn.dataset.musicBound) {
      btn.dataset.musicBound = '1';
      btn.addEventListener('dblclick', function(e) {
        e.preventDefault();
        if (musicClickTimer) { clearTimeout(musicClickTimer); musicClickTimer = null; }
        musicNext();
      });
      btn.addEventListener('wheel', function(e) {
        e.preventDefault();
        const cur = parseFloat(localStorage.getItem('ai_en_music_vol') || '60');
        const next = Math.max(0, Math.min(100, cur + (e.deltaY < 0 ? 5 : -5)));
        setMusicVol(next);
        showMusicBubble('🔉 音量 ' + next + '%');
      }, { passive: false });
    }
    // 初始化跨标签页互斥通道（仅一次）
    initMusicChannel();
  } catch (e) {
    dbg('MUSIC_LOAD_ERR', e.message);
  }
}

function toggleMusic() {
  // 区分单击/双击：250ms 内第二次点击视为双击，交给 dblclick 处理
  if (musicClickTimer) { clearTimeout(musicClickTimer); musicClickTimer = null; return; }
  musicClickTimer = setTimeout(function() {
    musicClickTimer = null;
    doToggleMusic();
  }, 250);
}

function doToggleMusic() {
  if (!musicEnabled()) { showMusicBubble('请先在设置中启用背景音乐'); return; }
  if (!musicItems.length) {
    musicInit().then(function() {
      if (!musicItems.length) { showMusicBubble('music/ 目录暂无音乐，请放入音频文件'); return; }
      musicPlayIdx(musicIdx < 0 ? 0 : musicIdx);
    });
    return;
  }
  if (musicIdx < 0) musicIdx = 0;
  if (!musicAudio || !musicAudio.src) { musicPlayIdx(musicIdx); return; }
  if (musicAudio.paused) {
    musicAudio.play().catch(function() {});
    musicBroadcast({ type: 'play', idx: musicIdx });   // 本页恢复播放 → 顶掉其它页
  } else {
    musicAudio.pause();
    musicBroadcast({ type: 'pause' });                 // 本页暂停 → 通知其它页
    showMusicBubble('⏸ 已暂停');
  }
  updateMusicUI();
}

function musicPlayIdx(i) {
  if (!musicItems.length) return;
  if (i < 0 || i >= musicItems.length) i = 0;
  musicIdx = i;
  localStorage.setItem('ai_en_music_idx', String(i));
  const url = (BACKEND_URL || '') + '/music/' + encodeURIComponent(musicItems[i].file);
  if (!musicAudio) musicAudio = new Audio();
  musicAudio.src = url;
  musicAudio.loop = false;
  musicAudio.volume = (parseFloat(localStorage.getItem('ai_en_music_vol') || '60') / 100);
  musicAudio.onended = function() {
    if (musicAutoNext()) musicNext();
    else updateMusicUI();
  };
  musicAudio.onerror = function() { showMusicBubble('播放失败: ' + musicItems[i].file); };
  musicAudio.play().catch(function() {});
  showMusicBubble('🎵 ' + (musicItems[i].name || musicItems[i].file));
  musicBroadcast({ type: 'play', idx: i });            // 播放新曲 → 顶掉其它页
  updateMusicUI();
}

function musicNext() {
  if (!musicItems.length) return;
  musicPlayIdx((musicIdx + 1) % musicItems.length);
}

function musicPrev() {
  if (!musicItems.length) return;
  musicPlayIdx((musicIdx - 1 + musicItems.length) % musicItems.length);
}

function settingsMusicSelect(v) {
  const i = parseInt(v, 10);
  if (Number.isInteger(i) && i >= 0 && i < musicItems.length) musicPlayIdx(i);
}

function settingsMusicToggle() { doToggleMusic(); }

function updateMusicUI() {
  const btn = document.getElementById('musicToggle');
  if (!btn) return;
  const playing = musicAudio && !musicAudio.paused;
  btn.classList.toggle('playing', !!playing);
}

function setMusicVol(v) {
  v = Math.max(0, Math.min(100, Number(v) || 0));
  localStorage.setItem('ai_en_music_vol', String(v));
  if (musicAudio) musicAudio.volume = v / 100;
  const value = document.getElementById('setMusicVolValue');
  if (value) value.textContent = v + '%';
}

function showMusicBubble(text) {
  const b = document.getElementById('musicBubble');
  if (!b) return;
  b.textContent = text;
  b.classList.add('show');
  clearTimeout(musicBubbleTimer);
  musicBubbleTimer = setTimeout(function() { b.classList.remove('show'); }, 2500);
}
