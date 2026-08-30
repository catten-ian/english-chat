/* ============================================================
   AI 英语对话教练 — 背景音乐播放器（含多标签页互斥）
   由 js/app.js 拆分而来（原 5410-5621 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。

   功能：
   - 顶部按钮：单击播放/暂停、双击下一首、滚轮调音量、悬停展开迷你播放器
   - 播放模式：列表循环 / 单曲循环 / 随机播放（musicMode 设置项）
   - 进度条可拖动跳转（迷你播放器 + 设置面板各一份）
   - Media Session：系统媒体键 / 锁屏控制（navigator.mediaSession）
   - 曲目播放失败自动跳过；刷新页面后尝试续播（受浏览器自动播放策略限制）
   - 多标签页互斥（BroadcastChannel）；TTS 朗读时压低/暂停由 AudioManager 协调
============================================================ */
/* ============ 背景音乐（顶部导航栏按钮） ============ */
let musicItems = [];          // [{ file, name }]
let musicIdx = -1;            // 当前播放索引
let musicAudio = null;        // Audio 实例
let musicBubbleTimer = null;  // 气泡自动隐藏定时器
let musicClickTimer = null;   // 单击/双击区分定时器
let musicTabId = null;        // 本标签页唯一 ID（跨标签页互斥用）
let musicBC = null;           // BroadcastChannel 实例（多标签页互斥）
let musicErrStreak = 0;       // 连续播放失败计数（全部失败时停止自动跳过）
let musicPopEl = null;        // 迷你播放器弹层元素
let musicPopShowTimer = null; // 弹层悬停展开定时器
let musicPopHideTimer = null; // 弹层隐藏定时器

const MUSIC_MODES = [
  { id: 'list',    icon: '🔁', label: '列表循环' },
  { id: 'single',  icon: '🔂', label: '单曲循环' },
  { id: 'shuffle', icon: '🔀', label: '随机播放' }
];
const MUSIC_PLAYING_FLAG = 'ai_en_music_playing';

function musicEnabled() { return getSetting('musicEnabled', true) !== false; }
function musicAutoNext() { return getSetting('musicAutoNext', true) !== false; }
function musicMode() {
  const m = getSetting('musicMode', 'list');
  return MUSIC_MODES.some(x => x.id === m) ? m : 'list';
}
function musicModeLabel(id) {
  const o = MUSIC_MODES.find(x => x.id === (id || musicMode()));
  return o ? (o.icon + ' ' + o.label) : '';
}
function cycleMusicMode() {
  const i = MUSIC_MODES.findIndex(x => x.id === musicMode());
  const next = MUSIC_MODES[(i + 1) % MUSIC_MODES.length];
  setSetting('musicMode', next.id);
  updateMusicUI();
  showMusicBubble(next.icon + ' ' + next.label);
}

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
          updateMusicUI();
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
    localStorage.removeItem(MUSIC_PLAYING_FLAG);
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
  musicSyncProgress();
  updateMusicUI();
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
    // 双击下一首 + 滚轮调音量 + 悬停展开迷你播放器（仅绑定一次）
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
        const next = Math.max(0, Math.min(100, cur + (e.deltaY < 0 ? 2 : -2)));
        setMusicVol(next);
        showMusicBubble('🔉 音量 ' + next + '%');
      }, { passive: false });
      btn.addEventListener('mouseenter', scheduleMusicPopShow);
      btn.addEventListener('mouseleave', scheduleMusicPopHide);
    }
    // 初始化跨标签页互斥通道（仅一次）
    initMusicChannel();
    // 系统媒体键支持
    setupMediaSession();
    // 构建悬停迷你播放器
    buildMusicPopover();
    // 刷新前正在播放 → 尝试续播（浏览器可能拦截自动播放，失败则提示点击）
    if (localStorage.getItem(MUSIC_PLAYING_FLAG) === '1' && musicEnabled() && musicItems.length) {
      musicPlayIdx(musicIdx < 0 ? 0 : musicIdx, true);
    }
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
    localStorage.setItem(MUSIC_PLAYING_FLAG, '1');
    musicBroadcast({ type: 'play', idx: musicIdx });   // 本页恢复播放 → 顶掉其它页
  } else {
    musicAudio.pause();
    localStorage.removeItem(MUSIC_PLAYING_FLAG);
    musicBroadcast({ type: 'pause' });                 // 本页暂停 → 通知其它页
    showMusicBubble('⏸ 已暂停');
  }
  updateMusicUI();
}

// 播完一首后的推进逻辑：单曲循环重播本首；随机播放抽下一首；列表循环顺序下一首
function advanceTrack() {
  if (!musicItems.length) return;
  const mode = musicMode();
  if (mode === 'single') { musicPlayIdx(musicIdx); return; }
  if (mode === 'shuffle' && musicItems.length > 1) {
    let n = musicIdx;
    while (n === musicIdx) n = Math.floor(Math.random() * musicItems.length);
    musicPlayIdx(n);
    return;
  }
  musicNext();
}

function musicPlayIdx(i, isResume) {
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
    localStorage.removeItem(MUSIC_PLAYING_FLAG);
    // 单曲循环不受「自动切换」开关影响；列表/随机模式下关闭自动切换则播完即停
    if (musicMode() !== 'single' && !musicAutoNext()) { updateMusicUI(); return; }
    advanceTrack();
  };
  musicAudio.onerror = function() {
    musicErrStreak++;
    localStorage.removeItem(MUSIC_PLAYING_FLAG);
    if (musicErrStreak >= musicItems.length) {
      showMusicBubble('⚠️ 所有曲目均播放失败，请检查 music/ 目录文件');
      updateMusicUI();
      return;
    }
    showMusicBubble('⚠️ 播放失败，自动跳过：' + (musicItems[i].name || musicItems[i].file));
    setTimeout(function() { advanceTrack(); }, 400);
  };
  if (!musicAudio.dataset.eventsBound) {
    musicAudio.dataset.eventsBound = '1';
    musicAudio.addEventListener('loadedmetadata', musicSyncProgress);
    musicAudio.addEventListener('timeupdate', musicSyncProgress);
    musicAudio.addEventListener('playing', function() {
      musicErrStreak = 0;
      updateMusicUI();
    });
  }
  musicErrStreak = 0;
  localStorage.setItem(MUSIC_PLAYING_FLAG, '1');
  const p = musicAudio.play();
  if (p && typeof p.then === 'function') {
    p.catch(function(err) {
      // 刷新后续播可能被浏览器自动播放策略拦截 → 提示用户手动点击
      localStorage.removeItem(MUSIC_PLAYING_FLAG);
      updateMusicUI();
      if (isResume || (err && err.name === 'NotAllowedError')) showMusicBubble('点击 🎵 开始播放音乐');
    });
  }
  showMusicBubble('🎵 ' + (musicItems[i].name || musicItems[i].file));
  musicBroadcast({ type: 'play', idx: i });            // 播放新曲 → 顶掉其它页
  musicSyncProgress();
  updateMusicUI();
}

function musicNext() {
  if (!musicItems.length) return;
  // 随机模式下手动切歌也随机走
  if (musicMode() === 'shuffle' && musicItems.length > 1) {
    let n = musicIdx;
    while (n === musicIdx) n = Math.floor(Math.random() * musicItems.length);
    musicPlayIdx(n);
    return;
  }
  musicPlayIdx((musicIdx + 1) % musicItems.length);
}

function musicPrev() {
  if (!musicItems.length) return;
  // 已播放超过 3 秒 → 回到本曲开头；否则切上一首（常见播放器行为）
  if (musicAudio && musicAudio.currentTime > 3) {
    musicAudio.currentTime = 0;
    return;
  }
  musicPlayIdx((musicIdx - 1 + musicItems.length) % musicItems.length);
}

function settingsMusicSelect(v) {
  const i = parseInt(v, 10);
  if (Number.isInteger(i) && i >= 0 && i < musicItems.length) musicPlayIdx(i);
}

function settingsMusicToggle() { doToggleMusic(); }

/* ============ 进度 / 拖动跳转 ============ */
function fmtMusicTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

function musicSyncProgress() {
  if (!musicAudio) return;
  const cur = musicAudio.currentTime || 0;
  const dur = (isFinite(musicAudio.duration) && musicAudio.duration > 0) ? musicAudio.duration : 0;
  const sk = document.getElementById('setMusicSeek');
  if (sk) {
    if (dur > 0) sk.max = String(dur);
    if (document.activeElement !== sk) sk.value = String(cur);
  }
  const st = document.getElementById('setMusicTime');
  if (st) st.textContent = fmtMusicTime(cur);
  const sd = document.getElementById('setMusicDur');
  if (sd) sd.textContent = dur ? fmtMusicTime(dur) : '--:--';
  const pk = document.getElementById('musicPopSeek');
  if (pk) {
    if (dur > 0) pk.max = String(dur);
    if (document.activeElement !== pk) pk.value = String(cur);
  }
  const pt = document.getElementById('musicPopTime');
  if (pt) pt.textContent = fmtMusicTime(cur) + ' / ' + (dur ? fmtMusicTime(dur) : '--:--');
}

function musicSeekTo(v) {
  if (!musicAudio || !musicAudio.duration) return;
  const t = parseFloat(v);
  if (!isFinite(t)) return;
  musicAudio.currentTime = Math.max(0, Math.min(musicAudio.duration, t));
  musicSyncProgress();
}

/* ============ 系统媒体键（Media Session API） ============ */
function setupMediaSession() {
  try {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', function() {
      if (musicAudio && musicAudio.paused) doToggleMusic();
    });
    navigator.mediaSession.setActionHandler('pause', function() {
      if (musicAudio && !musicAudio.paused) doToggleMusic();
    });
    navigator.mediaSession.setActionHandler('previoustrack', function() { musicPrev(); });
    navigator.mediaSession.setActionHandler('nexttrack', function() { musicNext(); });
  } catch (e) { /* 部分浏览器不支持，静默忽略 */ }
}

function updateMediaSessionMeta() {
  try {
    if (!('mediaSession' in navigator)) return;
    if (musicIdx >= 0 && musicItems[musicIdx] && 'MediaMetadata' in window) {
      const name = musicItems[musicIdx].name || musicItems[musicIdx].file;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: name, artist: '背景音乐', album: 'AI 英语对话教练'
      });
    }
    navigator.mediaSession.playbackState = (musicAudio && !musicAudio.paused) ? 'playing' : 'paused';
  } catch (e) { /* ignore */ }
}

function updateMusicUI() {
  const btn = document.getElementById('musicToggle');
  const playing = !!(musicAudio && !musicAudio.paused);
  if (btn) btn.classList.toggle('playing', playing);
  // 播放/暂停按钮文案（设置面板 + 迷你播放器）
  const playLabels = [
    { el: document.getElementById('setMusicPlayBtn'), play: '⏸ 暂停', pause: '▶ 播放' },
    { el: document.getElementById('musicPopPlay'), play: '⏸', pause: '▶' }
  ];
  playLabels.forEach(function(x) {
    if (x.el) x.el.textContent = playing ? x.play : x.pause;
  });
  // 播放模式按钮
  const modeTxt = musicModeLabel();
  const mb1 = document.getElementById('setMusicModeBtn');
  if (mb1) mb1.textContent = modeTxt;
  const mb2 = document.getElementById('musicPopMode');
  if (mb2) mb2.textContent = modeTxt;
  // 当前曲目名 / 序号
  const name = (musicIdx >= 0 && musicItems[musicIdx]) ? (musicItems[musicIdx].name || musicItems[musicIdx].file) : '';
  const nameEl = document.getElementById('musicPopName');
  if (nameEl) nameEl.textContent = name || '未播放';
  const idxEl = document.getElementById('musicPopIdx');
  if (idxEl) idxEl.textContent = musicItems.length ? ((musicIdx < 0 ? 0 : musicIdx) + 1) + ' / ' + musicItems.length : '';
  musicSyncProgress();
  updateMediaSessionMeta();
}

function setMusicVol(v) {
  v = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  localStorage.setItem('ai_en_music_vol', String(v));
  if (musicAudio) musicAudio.volume = v / 100;
  const sv = document.getElementById('setMusicVol');
  if (sv && document.activeElement !== sv) sv.value = String(v);
  const sn = document.getElementById('setMusicVolNum');
  if (sn && document.activeElement !== sn) sn.value = String(v);
  const pv = document.getElementById('musicPopVol');
  if (pv && document.activeElement !== pv) pv.value = String(v);
}

/* ============ 顶部按钮气泡（瞬态提示） ============ */
function showMusicBubble(text) {
  // 迷你播放器展开时，提示改显示在弹层内，避免重叠
  if (musicPopEl && musicPopEl.classList.contains('show')) {
    const s = document.getElementById('musicPopStatus');
    if (s) {
      s.textContent = text;
      clearTimeout(musicBubbleTimer);
      musicBubbleTimer = setTimeout(function() { s.textContent = ''; }, 2500);
    }
    return;
  }
  const b = document.getElementById('musicBubble');
  if (!b) return;
  b.textContent = text;
  b.classList.add('show');
  clearTimeout(musicBubbleTimer);
  musicBubbleTimer = setTimeout(function() { b.classList.remove('show'); }, 2500);
}

/* ============ 悬停迷你播放器弹层 ============ */
function buildMusicPopover() {
  if (musicPopEl || !document.body) return;
  const pop = document.createElement('div');
  pop.id = 'musicPop';
  pop.className = 'music-pop';
  pop.setAttribute('role', 'group');
  pop.setAttribute('aria-label', '背景音乐播放器');
  pop.innerHTML =
    '<div class="music-pop-title">' +
      '<span id="musicPopName">未播放</span>' +
      '<span id="musicPopIdx" class="music-pop-idx"></span>' +
    '</div>' +
    '<div class="music-pop-seek">' +
      '<input type="range" id="musicPopSeek" min="0" max="100" step="0.1" value="0" data-action="music-seek" aria-label="播放进度">' +
      '<span id="musicPopTime">0:00 / --:--</span>' +
    '</div>' +
    '<div class="music-pop-ctrls">' +
      '<button type="button" id="musicPopMode" data-action="music-cycle-mode" title="切换播放模式">🔁 列表循环</button>' +
      '<button type="button" data-action="music-prev" title="上一首（播放超过 3 秒则回到开头）">⏮</button>' +
      '<button type="button" id="musicPopPlay" data-action="settings-music-toggle" title="播放 / 暂停">▶</button>' +
      '<button type="button" data-action="music-next" title="下一首">⏭</button>' +
    '</div>' +
    '<div class="music-pop-vol">' +
      '<span>🔉</span>' +
      '<input type="range" id="musicPopVol" min="0" max="100" step="1" data-action="set-music-vol" aria-label="音量">' +
    '</div>' +
    '<div id="musicPopStatus" class="music-pop-status"></div>';
  document.body.appendChild(pop);
  musicPopEl = pop;
  pop.addEventListener('mouseenter', cancelMusicPopHide);
  pop.addEventListener('mouseleave', scheduleMusicPopHide);
  const pv = pop.querySelector('#musicPopVol');
  if (pv) pv.value = String(parseFloat(localStorage.getItem('ai_en_music_vol') || '60'));
  updateMusicUI();
}

function scheduleMusicPopShow() {
  if (!musicEnabled()) return;
  clearTimeout(musicPopHideTimer);
  clearTimeout(musicPopShowTimer);
  musicPopShowTimer = setTimeout(showMusicPopover, 350);
}

function scheduleMusicPopHide() {
  clearTimeout(musicPopShowTimer);
  clearTimeout(musicPopHideTimer);
  musicPopHideTimer = setTimeout(hideMusicPopover, 200);
}

function cancelMusicPopHide() {
  clearTimeout(musicPopHideTimer);
}

function showMusicPopover() {
  if (!musicPopEl) buildMusicPopover();
  if (!musicPopEl) return;
  const btn = document.getElementById('musicToggle');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const w = 258;
  let left = r.right - w;
  if (left < 8) left = 8;
  musicPopEl.style.width = w + 'px';
  musicPopEl.style.left = left + 'px';
  musicPopEl.style.top = (r.bottom + 8) + 'px';
  musicPopEl.classList.add('show');
  updateMusicUI();
}

function hideMusicPopover() {
  if (musicPopEl) musicPopEl.classList.remove('show');
}
