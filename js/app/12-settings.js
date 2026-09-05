/* ============================================================
   AI 英语对话教练 — 设置面板、AnkiConnect 检测、登出、改密、头像、角色卡、斜杠命令
   由 js/app.js 拆分而来（原 4343-5141 行）。
   注意：这些脚本按 index.html 中的顺序加载，顺序不可调整
   （存在顶层 IIFE / 事件绑定 / const 声明的执行顺序依赖）。
============================================================ */
/* ---------- Settings Panel ---------- */
function getSavedCharacters() {
  const v = getSetting('characters', null) || [];
  // 合并内置角色与用户自定义角色
  const builtins = CHARACTERS.map(c => c.id);
  const customs = (Array.isArray(v) ? v : []).filter(c => c && c.id && !builtins.includes(c.id));
  return [...CHARACTERS, ...customs];
}

function getActiveCharacterId() {
  return getSetting('activeCharacter', 'alex');
}

function setActiveCharacterId(id) {
  setSetting('activeCharacter', id);
  activeCharacterId = id;
  alexBackstory = '';
}

function openSettings() {
  // Remove all stuck overlays/modals first
  removeAllModals();
  const old = document.getElementById('settingsModal');
  if (old) old.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'settingsTitle');
  const modal = document.createElement('div');
  modal.id = 'settingsModal';
  modal.className = 'modal-card';
  modal.style.maxWidth = '560px';
  modal.style.padding = '0';
  const isAnki = getSetting('ankiAutoAdd', false);
  const isAuto = getSetting('autoRead', false);
  const isStream = getSetting('streamChat', true);
  const isStrategist = getSetting('strategistEnabled', true);
  const isExecutor = getSetting('executorEnabled', true);
  const isMusic = musicEnabled();
  const isMusicAutoNext = musicAutoNext();
  const musicVol = Math.max(0, Math.min(100, parseInt(localStorage.getItem('ai_en_music_vol') || '60', 10)));
  const isTtsDuck = getSetting('ttsDuckMusic', true) !== false;
  const ttsDuckRatio = Math.max(0, Math.min(100, parseInt(getSetting('ttsDuckRatio', 20), 10) || 0));
  const avatar = getSetting('avatar', '');
  const activeChar = getActiveCharacterId();
  const saveChars = getSavedCharacters();
  const charOptions = saveChars.map(c =>
    `<div class="char-option ${c.id === activeChar ? 'active' : ''}" data-action="settings-select-char" data-arg1="${esc(c.id)}">
       <span class="char-flag">${esc(c.avatar || '🤖')}</span>
       <div class="char-info"><strong>${esc(c.name || c.fullName || c.id)}</strong><small>${esc(c.city || '')} · ${esc((c.interests || []).slice(0,2).join(', '))}</small></div>
     </div>`).join('');
  const strategistHistory = getSetting('strategistInstructions', []);
  const strategistItems = Array.isArray(strategistHistory) ? strategistHistory : [];
  const strategistHTML = strategistItems.length
    ? '<div id="strategistHistory" style="max-height:140px;overflow-y:auto;margin-top:6px">' + strategistItems.map((it, i) =>
        `<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 8px;background:var(--bg);border-radius:8px;margin-bottom:6px;font-size:12px">
           <span style="flex:1;word-break:break-all">${esc(it.text)}</span>
           ${it.permanent ? '<span style="color:var(--amber);flex-shrink:0">📌 常驻</span>' : ''}
           <span style="color:var(--text2);flex-shrink:0;font-size:11px">${esc((it.time || '').slice(5, 16))}</span>
           <button data-action="delete-strategist-instruction" data-arg1="${i}" style="border:none;background:none;color:var(--text2);cursor:pointer;font-size:13px;flex-shrink:0" title="删除">×</button>
         </div>`).join('') + '</div>'
    : '<div class="empty" style="padding:8px 0;font-size:12px">暂无指令，发送一条试试</div>';
  modal.innerHTML = `<div class="modal-header"><h3 id="settingsTitle">⚙️ 设置</h3><button class="modal-close" data-action="close-overlay" aria-label="关闭">×</button></div>
    <div class="modal-body">

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)" data-section="account">
      <div style="font-size:14px;font-weight:600;margin-bottom:10px">👤 账户</div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div id="avatarPreview" style="width:52px;height:52px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;font-size:26px;overflow:hidden;border:1px solid var(--border)">${avatar ? '<img src="' + esc(avatar) + '" style="width:100%;height:100%;object-fit:cover">' : '👤'}</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <span style="font-size:13px">当前账户：<strong>${esc(currentUser() || '')}</strong></span>
          <button data-action="click-avatar-file" style="padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:#fff;font-size:12px;cursor:pointer">🖼️ 上传头像</button>
          <input type="file" id="avatarFile" accept="image/*" style="display:none" data-action="upload-avatar">
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-direction:column">
        <input id="setOldPw" type="password" placeholder="原密码" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
        <input id="setNewPw" type="password" placeholder="新密码（至少 4 位）" autocomplete="new-password" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
        <button data-action="change-password" style="padding:6px 14px;border-radius:6px;border:none;background:var(--amber);color:#fff;font-size:12px;cursor:pointer;align-self:flex-start">🔑 修改密码</button>
        <div id="pwMsg" style="font-size:12px;color:var(--green);min-height:16px"></div>
      </div>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)" data-section="characters">
      <div style="font-size:14px;font-weight:600;margin-bottom:10px">🎭 角色卡</div>
      <div style="display:flex;flex-direction:column;gap:6px">${charOptions}</div>
      <button data-action="prompt-new-character" style="margin-top:8px;padding:6px 14px;border-radius:6px;border:1px dashed var(--primary);background:#fff;color:var(--primary);font-size:12px;cursor:pointer">＋ 新建角色</button>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)" data-section="chat">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">🧭 聊天偏好</div>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 0">
        <input type="checkbox" id="setAnki" ${isAnki ? 'checked' : ''} style="width:17px;height:17px">
        <span style="font-size:14px">📚 自动添加到 Anki</span>
      </label>
      <div id="ankiDetail" style="display:${isAnki ? 'block' : 'none'};margin-left:26px;font-size:12px;color:var(--text2);padding:4px 0 6px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiVocab" ${getSetting('ankiAutoVocab', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 生词</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiCorr" ${getSetting('ankiAutoCorr', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 纠错</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiExt" ${getSetting('ankiAutoExt', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 拓展知识</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiWeak" ${getSetting('ankiAutoWeak', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 薄弱点自动出题</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiAutoSync" ${getSetting('ankiAutoSync', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 自动同步复习数据（每次对话后）</label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0"><input type="checkbox" id="setAnkiAudio" ${getSetting('ankiAutoAudio', false) ? 'checked' : ''} style="width:15px;height:15px"> 🎵 生词卡片附带发音（ElevenLabs TTS）</label>
      </div>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 0">
        <input type="checkbox" id="setAutoRead" ${isAuto ? 'checked' : ''} style="width:17px;height:17px">
        <span style="font-size:14px">🔊 自动朗读回复</span>
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 0">
        <input type="checkbox" id="setStream" ${isStream ? 'checked' : ''} style="width:17px;height:17px">
        <span style="font-size:14px">⚡ 流式输出回复</span>
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 0">
        <input type="checkbox" id="setStrategist" ${isStrategist ? 'checked' : ''} style="width:17px;height:17px">
        <span style="font-size:14px">🧠 策略师（回复前分析风格与意图）</span>
      </label>
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 0">
        <input type="checkbox" id="setExecutor" ${isExecutor ? 'checked' : ''} style="width:17px;height:17px">
        <span style="font-size:14px">🔎 执行者（需要时联网搜索）</span>
      </label>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)" data-section="music">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:14px;font-weight:600">🎵 背景音乐</div>
        <span id="setMusicStatus" style="font-size:11px;color:var(--text2)">${musicItems.length ? musicItems.length + ' 首曲目' : '正在读取 music/ 目录…'}</span>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;margin-bottom:8px">
        <input type="checkbox" id="setMusicEnabled" ${isMusic ? 'checked' : ''} style="width:16px;height:16px"> 启用顶部音乐按钮
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;margin-bottom:8px">
        <input type="checkbox" id="setMusicAutoNext" ${isMusicAutoNext ? 'checked' : ''} style="width:16px;height:16px"> 播放结束自动切换下一首
      </label>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:12px;white-space:nowrap">播放模式</span>
        <button type="button" class="a-btn small" id="setMusicModeBtn" data-action="music-cycle-mode" style="flex:1" title="循环切换：列表循环 / 单曲循环 / 随机播放">${musicModeLabel()}</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:12px;white-space:nowrap">当前曲目</span>
        <select id="setMusicTrack" data-action="settings-music-select" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none">${musicSettingsOptions()}</select>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span id="setMusicTime" style="font-size:11px;color:var(--text2);width:34px;text-align:right;font-variant-numeric:tabular-nums">0:00</span>
        <input type="range" id="setMusicSeek" min="0" max="100" step="0.1" value="0" data-action="music-seek" style="flex:1;accent-color:var(--primary)" aria-label="播放进度" title="拖动跳转">
        <span id="setMusicDur" style="font-size:11px;color:var(--text2);width:34px;font-variant-numeric:tabular-nums">--:--</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:12px;white-space:nowrap">音量</span>
        <input type="range" id="setMusicVol" min="0" max="100" step="1" value="${musicVol}" data-action="set-music-vol" style="flex:1;accent-color:var(--primary)" aria-label="音量滑块">
        <input type="number" id="setMusicVolNum" min="0" max="100" step="1" value="${musicVol}" data-action="set-music-vol" style="width:48px;box-sizing:border-box;padding:4px 4px;border:1px solid var(--border);border-radius:6px;font-size:12px;outline:none;text-align:center;font-variant-numeric:tabular-nums" aria-label="音量百分比（0-100）">
        <span style="font-size:12px;color:var(--text2)">%</span>
      </div>
      <div style="border-top:1px dashed var(--border);margin:2px 0 10px;padding-top:10px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;margin-bottom:8px">
          <input type="checkbox" id="setTtsDuck" ${isTtsDuck ? 'checked' : ''} style="width:16px;height:16px"> 朗读（TTS）时自动压低背景音乐
        </label>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:12px;white-space:nowrap">朗读时音乐</span>
          <input type="range" id="setTtsDuckRatio" min="0" max="100" step="10" value="${ttsDuckRatio}" data-action="set-tts-duck-ratio" style="flex:1;accent-color:var(--primary)">
          <span id="setTtsDuckRatioValue" style="width:44px;text-align:right;font-size:12px;color:var(--text2)">${ttsDuckRatio === 0 ? '暂停' : ttsDuckRatio + '%'}</span>
        </div>
        <div style="font-size:11px;color:var(--text3)">朗读期间背景音乐压到该音量，结束后自动恢复；0 = 朗读时完全暂停音乐。</div>
      </div>
      <div style="display:flex;gap:8px">
        <button type="button" class="a-btn small" data-action="music-prev">⏮ 上一首</button>
        <button type="button" class="a-btn primary small" id="setMusicPlayBtn" data-action="settings-music-toggle">${(typeof musicAudio !== 'undefined' && musicAudio && !musicAudio.paused) ? '⏸ 暂停' : '▶ 播放'}</button>
        <button type="button" class="a-btn small" data-action="music-next">下一首 ⏭</button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:8px;line-height:1.6">顶部 🎵 按钮：单击播放/暂停，双击下一首，滚轮调音量，<b>悬停展开迷你播放器</b>（可拖动进度）。</div>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)" data-section="quiz">
      <div style="font-size:14px;font-weight:600;margin-bottom:8px">📝 薄弱点出题策略</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px">分析发现薄弱点后，AI 自动生成题目推送到 Anki 薄弱点牌组，利用 Anki 的原生排程（FSRS）复习。题组可能在同一道题中考察多个相关薄弱点。</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:12px;white-space:nowrap">出题时机</span>
        <select id="setQuizStrategy" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none">
          <option value="instant" ${getSetting('ankiQuizStrategy', 'instant') === 'instant' ? 'selected' : ''}>⚡ 即时（发现即出题）</option>
          <option value="batch" ${getSetting('ankiQuizStrategy', 'instant') === 'batch' ? 'selected' : ''}>📦 积攒（攒够一批再出）</option>
        </select>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:8px">
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;flex:1">
          积攒阈值
          <input type="number" id="setQuizBatchSize" value="${getSetting('ankiQuizBatchSize', 5)}" min="2" max="20" style="width:48px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;outline:none"> 个
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;flex:1">
          每薄弱点题数
          <input type="number" id="setQuizPerWp" value="${getSetting('ankiQuizPerWp', 2)}" min="1" max="5" style="width:44px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;outline:none"> 道
        </label>
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px"><input type="checkbox" id="setQuizMultiWp" ${getSetting('ankiQuizMultiWp', true) === false ? '' : 'checked'} style="width:15px;height:15px"> 尽量一题多薄弱点（多轮 API 强化覆盖）</label>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)" data-section="topic">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">🎯 你想谈论的主题</div>
      <input id="setUserTopic" type="text" value="${esc(getSetting('userTopic',''))}" placeholder="例：科幻电影、健身、心理咨询…（留空则不引导）"
        style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <div style="font-size:14px;font-weight:600;margin:12px 0 6px">📏 回复长度</div>
      <input id="setRespLen" type="text" value="${esc(getSetting('responseLengthGuide',''))}" placeholder="例：约 120 词 / 两三句话 / 用 1 个例句展开…"
        style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)" data-section="answer">
      <div style="font-size:14px;font-weight:600;margin-bottom:8px">📝 作答设置（作文 / 翻译 / 描述作答框）</div>
      <div style="display:flex;gap:12px;margin-bottom:8px">
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;flex:1">
          字体大小
          <select id="setAnswerFontSize" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none">
            ${[13,14,15,16,17,18,20,22,24].map(v => '<option value="' + v + '"' + (getSetting('answerFontSize', 15) === v ? ' selected' : '') + '>' + v + 'px</option>').join('')}
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;flex:1">
          字体样式
          <select id="setAnswerFontFamily" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none">
            <option value="inherit" ${getSetting('answerFontFamily','inherit') === 'inherit' ? 'selected' : ''}>默认（跟随系统）</option>
            <option value="Segoe UI, 'PingFang SC', 'Microsoft YaHei', sans-serif" ${getSetting('answerFontFamily','inherit') === "Segoe UI, 'PingFang SC', 'Microsoft YaHei', sans-serif" ? 'selected' : ''}>无衬线（系统）</option>
            <option value="Georgia, 'Times New Roman', serif" ${getSetting('answerFontFamily','inherit') === "Georgia, 'Times New Roman', serif" ? 'selected' : ''}>衬线 Serif</option>
            <option value="'Courier New', monospace" ${getSetting('answerFontFamily','inherit') === "'Courier New', monospace" ? 'selected' : ''}>等宽 Mono</option>
            <option value="'Comic Sans MS', 'Comic Neue', sans-serif" ${getSetting('answerFontFamily','inherit') === "'Comic Sans MS', 'Comic Neue', sans-serif" ? 'selected' : ''}>手写 Comic</option>
            <option value="'Segoe Script', cursive" ${getSetting('answerFontFamily','inherit') === "'Segoe Script', cursive" ? 'selected' : ''}>花体 Cursive</option>
          </select>
        </label>
      </div>
      <div style="font-size:12px;color:var(--text2)">作答框默认在左右留出较大边缘间距，内容变长后会自动缩短边缘留白以容纳更多文字。</div>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)" data-section="trrules">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">🌐 翻译规则版本（用于翻译题库 / AI 出题 / 评分）</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px">选择 AI 评分时使用哪套规则：</div>
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:6px 0">
        <input type="radio" name="setTrRule" value="gaokao" ${(getSetting('translationRuleVersion', null) || 'auto') === 'gaokao' ? 'checked' : ''} style="margin-top:3px">
        <div>
          <div style="font-size:13px;font-weight:600">🏫 高考版（默认）</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.5">${esc(TRANSLATION_RULES.gaokao.desc)}</div>
        </div>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:6px 0">
        <input type="radio" name="setTrRule" value="standard" ${getSetting('translationRuleVersion', null) === 'standard' ? 'checked' : ''} style="margin-top:3px">
        <div>
          <div style="font-size:13px;font-weight:600">📚 标准版</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.5">${esc(TRANSLATION_RULES.standard.desc)}</div>
        </div>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:6px 0">
        <input type="radio" name="setTrRule" value="legacy" ${getSetting('translationRuleVersion', null) === 'legacy' ? 'checked' : ''} style="margin-top:3px">
        <div>
          <div style="font-size:13px;font-weight:600">📜 旧版</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.5">${esc(TRANSLATION_RULES.legacy.desc)}</div>
        </div>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:6px 0">
        <input type="radio" name="setTrRule" value="" ${!getSetting('translationRuleVersion', null) ? 'checked' : ''} style="margin-top:3px">
        <div>
          <div style="font-size:13px;font-weight:600">🤖 自动</div>
          <div style="font-size:11px;color:var(--text2);line-height:1.5">选择题库自动判定（上海高考 → 高考版，其他 → 标准版）。这是默认行为。</div>
        </div>
      </label>
      <div style="font-size:11px;color:var(--text3);margin-top:6px">注：「必用词」来自题目 JSON 中的「词」字段。当前翻译题库（上海高考 2020-2024 一二三模）共 348 道已注入必用词。</div>
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)" data-section="strategist">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">🤖 策略师指令（引导 Alex 的风格/角色）</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px">发送一条指令让策略师在每次回复前参考。可选「常驻」：写入系统提示词长期生效；不勾选则只对下一条消息生效一次。</div>
      <textarea id="setStrategistInstr" rows="2" placeholder="例：让 Alex 更幽默一点 / 扮演一个严格的面试官 / 多用俚语…" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;resize:vertical"></textarea>
      <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="setInstrPermanent" style="width:16px;height:16px">📌 常驻（写入系统提示词）</label>
        <button data-action="send-strategist-instruction" style="padding:6px 16px;border-radius:6px;border:none;background:var(--primary);color:#fff;font-size:12px;cursor:pointer">发送指令</button>
      </div>
      <div style="font-size:12px;font-weight:600;margin-top:10px">📜 历史指令</div>
      ${strategistHTML}
    </div>

    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)" data-section="keys">
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">🔌 服务与密钥</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:10px">密钥保存在服务端 <code>.env</code>（gitignored），页面只显示掩码，永不明文回传。保存后立即生效，无需重启。</div>
      <div id="keysStatusBox" style="font-size:12px;color:var(--text2)">⏳ 正在读取密钥状态…</div>
      <div id="keysEditor" style="display:none;margin-top:10px">
        <div style="margin-bottom:10px">
          <div style="font-size:12px;margin-bottom:4px">MiniMax（对话 / 评分 / 出题 / 联网搜索）</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <input id="setKeyMinimax" type="password" placeholder="粘贴新 key（留空不修改）" autocomplete="new-password"
              style="flex:1;min-width:180px;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none">
            <button class="a-btn small" data-action="keys-rotate" data-arg1="minimax">保存</button>
            <button class="a-btn small ghost" data-action="keys-test" data-arg1="minimax">检测</button>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:4px">上游地址：<span id="setMinimaxBaseTxt"></span>
            <span data-action="keys-edit-base" style="color:var(--primary);cursor:pointer">修改</span></div>
          <div id="setMinimaxBaseEdit" style="display:none;margin-top:6px">
            <div style="display:flex;gap:6px">
              <input id="setMinimaxBase" type="text" placeholder="https://api.minimaxi.com"
                style="flex:1;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none">
              <button class="a-btn small" data-action="keys-save-base">保存</button>
            </div>
            <div style="font-size:11px;color:var(--text3);margin-top:4px">一般不用改；走反代/镜像时才需要。</div>
          </div>
        </div>
        <div>
          <div style="font-size:12px;margin-bottom:4px">ElevenLabs（语音朗读 / 卡片发音）</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <input id="setKeyEleven" type="password" placeholder="粘贴新 key（留空不修改）" autocomplete="new-password"
              style="flex:1;min-width:180px;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;outline:none">
            <button class="a-btn small" data-action="keys-rotate" data-arg1="eleven">保存</button>
            <button class="a-btn small ghost" data-action="keys-test" data-arg1="eleven">检测</button>
          </div>
        </div>
        <div id="keysMsg" style="font-size:12px;margin-top:8px;min-height:16px;line-height:1.6"></div>
      </div>
    </div>

    <div style="padding:8px 0;font-size:14px;display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span>📚 AnkiConnect</span>
      <button data-action="check-anki-connect" style="padding:5px 14px;border-radius:6px;border:1px solid var(--border);background:#fff;color:var(--text);font-size:12px;cursor:pointer">🔄 检测连接</button>
      <button data-action="reconnect-anki-connect" style="padding:5px 14px;border-radius:6px;border:none;background:var(--primary);color:#fff;font-size:12px;cursor:pointer;display:none" id="reconnectAnkiBtn">重连</button>
      <span id="ankiStatus" style="font-size:12px;color:var(--text2)">未检测</span>
    </div>
    <div style="font-size:11px;color:var(--text2);padding:0 0 6px 0;line-height:1.6">
      当前薄弱点牌组：<code>${esc(ankiWeakDeck())}</code><br>
      笔记类型：<code>${esc(ANKI_QUIZ_MODEL)}</code>（Question/Answer/Explanation）
    </div>
    <div style="padding:8px 0;font-size:14px;display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span>💾 数据存储</span>
      <span id="storageStatus" style="font-size:12px;color:var(--text2)">${localStorage.getItem('ai_en_convs') ? '本地(有数据)' : '本地(空)'}</span>
    </div>
    <div style="padding:8px 0;font-size:14px;display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span>📡 后端服务器</span>
      <span id="backendStatus" style="font-size:12px;color:var(--text2)">检测中...</span>
    </div>
    <div style="padding:8px 0;font-size:14px;display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span>💾 数据备份</span>
      <button data-action="backup-now" style="padding:5px 14px;border-radius:6px;border:none;background:var(--green);color:#fff;font-size:12px;cursor:pointer">立即备份</button>
      <span id="backupStatus" style="font-size:11px;color:var(--text2)"></span>
    </div>
    </div>
    <div class="modal-footer">
      <button class="a-btn danger" data-action="logout-user">🚪 退出登录</button>
      <div style="display:flex;gap:8px">
        <button class="a-btn primary" data-action="save-settings">保存设置</button>
        <button class="a-btn" data-action="close-overlay">关闭</button>
      </div>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // Check backend status
  fetch(BACKEND_URL + '/api/health').then(r => r.json()).then(d => {
    const label = (d && d.status === 'ok') ? '✅ 在线' : ('⚠️ ' + ((d && d.status) || '未知'));
    document.getElementById('backendStatus').textContent = label + ((d && d.minimax !== undefined) ? (' · MiniMax ' + (d.minimax ? '✓' : '✗')) : '');
  }).catch(() => {
    document.getElementById('backendStatus').textContent = '❌ 离线 (需运行 node server.js)';
  });
  // 服务与密钥：读取当前状态（掩码 + 来源）
  loadKeysStatus();
  // Auto-check AnkiConnect on settings open
  checkAnkiConnect(false);
  // Anki master toggle → 显示/隐藏细分选项
  const setAnkiEl = document.getElementById('setAnki');
  if (setAnkiEl) {
    setAnkiEl.addEventListener('change', function() {
      const detail = document.getElementById('ankiDetail');
      if (detail) detail.style.display = this.checked ? 'block' : 'none';
    });
  }
  // 出题策略联动：批量模式才需要显示积攒阈值
  const strategyEl = document.getElementById('setQuizStrategy');
  if (strategyEl) {
    const batchLabel = strategyEl.closest('div').nextElementSibling;
    function syncStrategyUI() {
      if (batchLabel) batchLabel.style.display = strategyEl.value === 'batch' ? 'flex' : 'none';
    }
    strategyEl.addEventListener('change', syncStrategyUI);
    syncStrategyUI();
  }
  // Show backup status
  const bh = JSON.parse(localStorage.getItem('ai_en_backup_history') || '[]');
  if (bh.length) {
    document.getElementById('backupStatus').textContent = '上次: ' + new Date(bh[bh.length-1].time).toLocaleTimeString();
  } else {
    document.getElementById('backupStatus').textContent = '暂无备份';
  }
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  // 将设置内容按组折叠（DOM 重组，不破坏逻辑，只改视觉层级）
  restructureSettingsModal(modal);
}

/* 把平铺的设置项按分组折叠到 <details> 里（首次打开设置时调用） */
function restructureSettingsModal(modal) {
  try {
    const body = modal.querySelector('.modal-body');
    if (!body) return;
    const sections = [
      { title: '👤 账户', matchText: '当前账户' },
      { title: '📝 作答设置', matchText: '作答设置' },
      { title: '🎭 角色卡', matchText: '新建角色' },
      { title: '🌐 翻译规则', matchText: '翻译规则版本' },
      { title: '💬 聊天偏好', matchText: '自动添加到 Anki' },
      { title: '🎵 背景音乐', matchText: '背景音乐' },
      { title: '🃏 薄弱点出题策略', matchText: '薄弱点出题策略' },
      { title: '🎯 主题与长度', matchText: '你想谈论的主题' },
      { title: '🤖 策略师指令', matchText: '策略师指令' },
      { title: '🔌 服务与密钥', matchText: '服务与密钥' },
      { title: '🔌 连接与备份', matchText: 'AnkiConnect' }
    ];
    const groups = [];
    let pending = [];
    for (const child of Array.from(body.children)) {
      if (child.tagName === 'DIV') {
        const text = child.textContent || '';
        const matched = sections.find(s => text.includes(s.matchText));
        if (matched) {
          if (pending.length) groups.push({ title: null, items: pending });
          pending = [child];
          groups.push({ title: matched.title, items: pending });
          pending = [];
        } else {
          pending.push(child);
        }
      } else {
        pending.push(child);
      }
    }
    if (pending.length) groups.push({ title: null, items: pending });
    // 按 sections 定义顺序重排（账户 → 作答设置 → 角色卡 → …），未命名的组保持在末尾
    const orderMap = {};
    sections.forEach((s, i) => { orderMap[s.title] = i; });
    groups.sort((a, b) => {
      if (!a.title) return 1;
      if (!b.title) return -1;
      return (orderMap[a.title] ?? 99) - (orderMap[b.title] ?? 99);
    });
    body.innerHTML = '';
    let openCount = 0;
    for (const g of groups) {
      if (!g.title) {
        g.items.forEach(i => body.appendChild(i));
        continue;
      }
      const det = document.createElement('details');
      det.className = 'settings-section';
      // 前 3 组（账户 + 作答设置 + 角色卡）默认展开，方便首次打开即可调整作答字体
      if (openCount < 3) det.setAttribute('open', '');
      openCount++;
      const summary = document.createElement('summary');
      summary.textContent = g.title;
      det.appendChild(summary);
      const inner = document.createElement('div');
      inner.className = 'section-body';
      g.items.forEach(i => inner.appendChild(i));
      det.appendChild(inner);
      body.appendChild(det);
    }
  } catch (e) { console.warn('[settings restructure] err:', e); }
}

/* ---------- AnkiConnect 检测/重连 ----------
   浏览器直连 AnkiConnect 会被 CORS 拒绝（AnkiConnect 默认只信任 Origin: http://localhost），
   所以一律走后端 /api/proxy/anki 代理（后端直连本机，无 CORS）。
   同时为兼容不同 Anki 配置：自动探测可用 model 与 deck 并缓存，避免 "model was not found" 错误。
*/
let ankiUrlWorking = null;            // 后端代理报告的工作地址（仅供参考显示）
let ankiModelCache = null;            // 探测到的笔记类型列表（首次 addNote 时探测并缓存）
let ankiDeckEnsured = false;          // 是否已确保 deck 存在

async function ankiPostCall(payload) {
  const r = await fetch((BACKEND_URL || '') + '/api/proxy/anki', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    let friendly = 'proxy HTTP ' + r.status;
    try {
      const errBody = await r.json();
      if (errBody && errBody.error === 'ankiconnect unreachable') friendly = 'Anki 未运行或 AnkiConnect 未连接';
      else if (errBody && errBody.error) friendly = errBody.error;
    } catch (e) {}
    throw new Error(friendly);
  }
  return await r.json();
}

// 探测 Anki 可用的笔记类型（modelNames）和确保 deck 存在（兼容旧调用）
async function ankiProbeAndEnsureDeck() {
  if (ankiModelCache) return ankiModelCache;
  try {
    await ensureQuizModelAndDeck();
    const models = await ankiPostCall({ action: 'modelNames', version: 6 }).then(d => d.result && d.result.result).catch(() => null);
    if (Array.isArray(models) && models.length) {
      const preferred = ['Basic', 'Basic (and reversed card)', 'Front-Back'];
      ankiModelCache = preferred.find(m => models.includes(m)) || models[0];
    }
  } catch (e) { /* ignore */ }
  ankiDeckEnsured = true;
  return ankiModelCache;
}

/* ---------- 服务与密钥（设置面板「🔌 服务与密钥」） ----------
   后端 /api/keys/*：状态只回掩码；rotate 写 .env 并立即生效。 */
const SOURCE_LABELS = { env: '进程环境变量', file: '.env 文件', none: '未配置' };

async function loadKeysStatus() {
  const box = document.getElementById('keysStatusBox');
  const editor = document.getElementById('keysEditor');
  if (!box) return;
  try {
    const r = await fetch(BACKEND_URL + '/api/keys/status', { headers: authHeaders() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const row = (name, s) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:3px 0">
        <span style="width:78px;flex-shrink:0">${name}</span>
        <span>${s.configured ? '✅ 已配置' : '❌ 未配置'}</span>
        <span style="color:var(--text2);font-variant-numeric:tabular-nums">${esc(s.masked || '—')}</span>
        <span style="font-size:11px;color:var(--text3)">来源: ${esc(SOURCE_LABELS[s.source] || s.source)}</span>
      </div>`;
    box.innerHTML = row('MiniMax', d.minimax) + row('ElevenLabs', d.eleven);
    const baseTxt = document.getElementById('setMinimaxBaseTxt');
    if (baseTxt) baseTxt.textContent = d.minimax.base || 'https://api.minimaxi.com';
    if (editor) editor.style.display = '';
  } catch (e) {
    box.innerHTML = '❌ 无法读取密钥状态（后端离线？）';
    if (editor) editor.style.display = 'none';
  }
}

async function rotateKey(service) {
  const msg = document.getElementById('keysMsg');
  const input = document.getElementById(service === 'minimax' ? 'setKeyMinimax' : 'setKeyEleven');
  if (!input || !msg) return;
  const key = input.value.trim();
  if (!key) { msg.textContent = '⚠️ 请先粘贴新 key（留空表示不修改）'; msg.style.color = 'var(--amber)'; return; }
  msg.textContent = '⏳ 保存中…'; msg.style.color = 'var(--text2)';
  try {
    const r = await fetch(BACKEND_URL + '/api/keys/rotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ service, key })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    input.value = '';
    msg.innerHTML = '✅ 已保存并立即生效（新掩码 ' + esc(d.masked) + '）' +
      (d.sourceWarning ? '<br><span style="color:var(--amber)">' + esc(d.sourceWarning) + '</span>' : '');
    msg.style.color = 'var(--green)';
    loadKeysStatus();
  } catch (e) {
    msg.textContent = '❌ 保存失败: ' + (e.message || e);
    msg.style.color = 'var(--red)';
  }
}

async function testKeyConn(service) {
  const msg = document.getElementById('keysMsg');
  if (!msg) return;
  msg.textContent = '⏳ 正在用当前密钥请求上游（最小成本）…';
  msg.style.color = 'var(--text2)';
  try {
    const r = await fetch(BACKEND_URL + '/api/keys/test/' + service, { method: 'POST', headers: authHeaders() });
    const d = await r.json();
    msg.textContent = (d.ok ? '✅ ' : '❌ ') + (d.detail || '');
    msg.style.color = d.ok ? 'var(--green)' : 'var(--red)';
  } catch (e) {
    msg.textContent = '❌ 检测失败: ' + (e.message || e);
    msg.style.color = 'var(--red)';
  }
}

function toggleBaseEditor() {
  const el = document.getElementById('setMinimaxBaseEdit');
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

async function saveMinimaxBase() {
  const msg = document.getElementById('keysMsg');
  const input = document.getElementById('setMinimaxBase');
  if (!input || !msg) return;
  const base = input.value.trim();
  if (!base) { msg.textContent = '⚠️ 请输入上游地址'; msg.style.color = 'var(--amber)'; return; }
  try {
    const r = await fetch(BACKEND_URL + '/api/keys/rotate-base', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ base })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    msg.textContent = '✅ 上游地址已更新: ' + d.base;
    msg.style.color = 'var(--green)';
    toggleBaseEditor();
    loadKeysStatus();
  } catch (e) {
    msg.textContent = '❌ 保存失败: ' + (e.message || e);
    msg.style.color = 'var(--red)';
  }
}

async function checkAnkiConnect(manual) {
  const statusEl = document.getElementById('ankiStatus');
  const reconnectBtn = document.getElementById('reconnectAnkiBtn');
  if (!statusEl) return;
  if (manual) statusEl.textContent = '⏳ 检测中…';
  try {
    const data = await ankiPostCall({ action: 'version', version: 6 });
    if (!data.ok) throw new Error(data.error || data.last || 'unreachable');
    const ver = data.result && data.result.result;
    ankiUrlWorking = data.url;
    statusEl.textContent = '✅ 已连接 (Anki ' + (ver || '') + ') · 通过 ' + data.url;
    statusEl.style.color = 'var(--green)';
    if (reconnectBtn) reconnectBtn.style.display = 'none';
    // 顺便探测 model/deck（静默失败不影响状态显示）
    try { await ensureQuizModelAndDeck(); } catch (e) {}
    try { renderAnkiSidebar(); } catch (e) {}
    return true;
  } catch (e) {
    statusEl.textContent = '❌ 未连接 — ' + (e.message || e);
    statusEl.style.color = 'var(--red)';
    if (reconnectBtn) reconnectBtn.style.display = manual ? '' : 'inline-block';
    if (manual) toastMsg('❌ AnkiConnect 连接失败：' + (e.message || ''));
    return false;
  }
}

async function reconnectAnkiConnect() {
  ankiModelCache = null; ankiDeckEnsured = false;   // 强制重新探测
  const ok = await checkAnkiConnect(true);
  if (!ok) toastMsg('请确认 Anki 已运行、AnkiConnect 插件已安装（默认 8765 端口），然后重新点击「重连」。');
}

/* ---------- 退出登录 ---------- */
async function logoutUser() {
  if (!confirm('退出登录？本机缓存将被清空，数据仍在服务器数据库中。')) return;
  try { await apiLogout(); } catch (e) {}
  // 退出前停掉所有后台任务，避免旧账户的分析结果写入下一个账户
  if (currentAbort) { try { currentAbort.abort(); } catch (e) {} }
  cancelAnalysisTasks();
  conversation = [];
  // 清空全部用户态缓存（含 ai_en_setting_* 偏好、阅读、词典历史、本地备份），
  // 否则下一个账户登录后可能读到上一个账户的设置与历史
  clearUserCache();
  try { localStorage.removeItem('ai_en_cache_owner'); } catch (e) {}
  const modal = document.getElementById('settingsModal');
  if (modal) modal.parentElement.remove();
  location.reload();
}

function saveSettings() {
  const anki = document.getElementById('setAnki').checked;
  const autoRead = document.getElementById('setAutoRead').checked;
  const stream = document.getElementById('setStream').checked;
  const strategist = document.getElementById('setStrategist').checked;
  const executor = document.getElementById('setExecutor').checked;
  const musicEnabledSetting = !!document.getElementById('setMusicEnabled')?.checked;
  const musicAutoNextSetting = !!document.getElementById('setMusicAutoNext')?.checked;
  const ttsDuckSetting = document.getElementById('setTtsDuck') ? !!document.getElementById('setTtsDuck').checked : true;
  const ttsDuckRatioSetting = Math.max(0, Math.min(100, parseInt(document.getElementById('setTtsDuckRatio')?.value, 10) || 0));
  const musicTrackSetting = parseInt(document.getElementById('setMusicTrack')?.value, 10);
  const musicVolumeSetting = parseInt(document.getElementById('setMusicVol')?.value, 10) || 0;
  const userTopic = (document.getElementById('setUserTopic').value || '').trim();
  const respLen = (document.getElementById('setRespLen').value || '').trim();
  // 作答字体设置
  const answerFontSize = parseInt(document.getElementById('setAnswerFontSize')?.value) || 15;
  const answerFontFamily = document.getElementById('setAnswerFontFamily')?.value || 'inherit';
  // Anki 细分开关
  const autoVocab = !!document.getElementById('setAnkiVocab')?.checked;
  const autoCorr = !!document.getElementById('setAnkiCorr')?.checked;
  const autoExt = !!document.getElementById('setAnkiExt')?.checked;
  const autoWeak = !!document.getElementById('setAnkiWeak')?.checked;
  const quizStrategy = document.getElementById('setQuizStrategy')?.value || 'instant';
  const quizBatchSize = parseInt(document.getElementById('setQuizBatchSize')?.value) || 5;
  const quizPerWp = parseInt(document.getElementById('setQuizPerWp')?.value) || 2;
  const quizMultiWp = !!document.getElementById('setQuizMultiWp')?.checked;
  const quizAutoSync = !!document.getElementById('setAnkiAutoSync')?.checked;
  const quizAudio = !!document.getElementById('setAnkiAudio')?.checked;
  // 翻译规则版本
  const trRuleEl = document.querySelector('input[name="setTrRule"]:checked');
  const translationRuleVersion = trRuleEl ? (trRuleEl.value || '') : '';
  ankiAutoAdd = anki;
  autoReadAloud = autoRead;
  streamChatEnabled = stream;
  strategistEnabled = strategist;
  executorEnabled = executor;
  setSetting('ankiAutoAdd', anki);
  setSetting('ankiAutoVocab', autoVocab);
  setSetting('ankiAutoCorr', autoCorr);
  setSetting('ankiAutoExt', autoExt);
  setSetting('ankiAutoWeak', autoWeak);
  setSetting('ankiQuizStrategy', quizStrategy);
  setSetting('ankiQuizBatchSize', quizBatchSize);
  setSetting('ankiQuizPerWp', quizPerWp);
  setSetting('ankiQuizMultiWp', quizMultiWp);
  setSetting('ankiAutoSync', quizAutoSync);
  setSetting('ankiAutoAudio', quizAudio);
  setSetting('autoRead', autoRead);
  setSetting('streamChat', stream);
  setSetting('strategistEnabled', strategist);
  setSetting('executorEnabled', executor);
  setSetting('musicEnabled', musicEnabledSetting);
  setSetting('musicAutoNext', musicAutoNextSetting);
  setSetting('ttsDuckMusic', ttsDuckSetting);
  setSetting('ttsDuckRatio', ttsDuckRatioSetting);
  setMusicVol(musicVolumeSetting);
  if (Number.isInteger(musicTrackSetting) && musicTrackSetting >= 0) {
    localStorage.setItem('ai_en_music_idx', String(musicTrackSetting));
    musicIdx = musicTrackSetting;
  }
  setSetting('userTopic', userTopic);
  setSetting('responseLengthGuide', respLen);
  setSetting('answerFontSize', answerFontSize);
  setSetting('answerFontFamily', answerFontFamily);
  setSetting('activeCharacter', activeCharacterId);
  if (translationRuleVersion === '') {
    setSetting('translationRuleVersion', null);
  } else {
    setSetting('translationRuleVersion', translationRuleVersion);
  }
  const mergedSettings = {
    ...getSettingsBackup(),
    ankiAutoAdd: anki,
    ankiAutoVocab: autoVocab,
    ankiAutoCorr: autoCorr,
    ankiAutoExt: autoExt,
    ankiAutoWeak: autoWeak,
    ankiQuizStrategy: quizStrategy,
    ankiQuizBatchSize: quizBatchSize,
    ankiQuizPerWp: quizPerWp,
    ankiQuizMultiWp: quizMultiWp,
    ankiAutoSync: quizAutoSync,
    ankiAutoAudio: quizAudio,
    autoRead: autoRead,
    streamChat: stream,
    strategistEnabled: strategist,
    executorEnabled: executor,
    musicEnabled: musicEnabledSetting,
    musicAutoNext: musicAutoNextSetting,
    musicMode: musicMode(),
    musicVolume: musicVolumeSetting,
    musicTrack: Number.isInteger(musicTrackSetting) ? musicTrackSetting : 0,
    ttsDuckMusic: ttsDuckSetting,
    ttsDuckRatio: ttsDuckRatioSetting,
    userTopic,
    responseLengthGuide: respLen,
    answerFontSize,
    answerFontFamily,
    activeCharacter: activeCharacterId,
    translationRuleVersion: translationRuleVersion || null
  };
  // 本地快照与服务端保持一致，避免后续 setCurrentConvId 用旧快照覆盖这次保存
  saveSettingsBackup(mergedSettings);
  apiSave('settings', mergedSettings);
  const aBtn = document.getElementById('ankiToggle');
  const rBtn = document.getElementById('autoReadToggle');
  if (aBtn) aBtn.classList.toggle('active', anki);
  if (rBtn) rBtn.classList.toggle('active', autoRead);
  applyMusicEnabledUI();
  document.getElementById('settingsModal').parentElement.remove();
  applyAnswerFontSettings();
  if (anki) { syncAnkiReviewData().catch(() => {}); renderAnkiSidebar().catch(() => {}); }
}

/* ---------- 修改密码 ---------- */
async function changePassword() {
  const oldPw = document.getElementById('setOldPw').value;
  const newPw = document.getElementById('setNewPw').value;
  const msg = document.getElementById('pwMsg');
  if (!oldPw || !newPw) { msg.textContent = '请输入原密码和新密码'; msg.style.color = 'var(--red)'; return; }
  if (newPw.length < 4) { msg.textContent = '新密码至少 4 位'; msg.style.color = 'var(--red)'; return; }
  try {
    await apiChangePassword(oldPw, newPw);
    msg.textContent = '✅ 密码已修改';
    msg.style.color = 'var(--green)';
    document.getElementById('setOldPw').value = '';
    document.getElementById('setNewPw').value = '';
  } catch (e) {
    msg.textContent = '❌ ' + e.message;
    msg.style.color = 'var(--red)';
  }
}

/* ---------- 头像上传 ---------- */
function uploadAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { alert('头像图片不能超过 2MB'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    setSetting('avatar', dataUrl);
    apiSave('avatar', dataUrl);
    const preview = document.getElementById('avatarPreview');
    if (preview) preview.innerHTML = '<img src="' + esc(dataUrl) + '" style="width:100%;height:100%;object-fit:cover">';
    const badge = document.getElementById('userBadge');
    if (badge) {
      badge.textContent = currentUser() || '';
      badge.style.backgroundImage = 'url("' + dataUrl.replace(/"/g, '') + '")';
    }
    document.querySelectorAll('.msg.user .avatar').forEach(el => { el.innerHTML = userAvatarHTML(); });
    toastMsg('✅ 头像已更新');
  };
  reader.readAsDataURL(file);
}

/* ---------- 角色卡选择 ---------- */
function settingsSelectCharacter(id) {
  setActiveCharacterId(id);
  document.querySelectorAll('.char-option').forEach(el => el.classList.toggle('active', el.dataset.charId === id || el.getAttribute('data-arg1') === id));
  document.querySelectorAll('.char-option').forEach(el => {
    el.classList.toggle('active', el.textContent.includes(getActiveCharacter().name));
  });
  toastMsg('🎭 已切换角色：' + getActiveCharacter().fullName);
}

function promptNewCharacter() {
  removeAllModals();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '新建角色');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
  const modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:14px;padding:22px;max-width:440px;width:92%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
  modal.innerHTML = `<h3 style="font-size:17px;font-weight:700;margin-bottom:14px">🎭 新建角色卡</h3>
    <div style="display:flex;flex-direction:column;gap:10px">
      <input id="ncName" placeholder="名字（如 Luna）" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <input id="ncFlags" placeholder="国籍 / 城市（如 American / Seattle）" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <input id="ncOcc" placeholder="职业 / 身份（如 high school teacher）" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <input id="ncEmoji" placeholder="头像 Emoji（如 🍀）" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none">
      <textarea id="ncPersona" rows="4" placeholder="性格 / 说话风格 / 兴趣爱好 / 背景故事…" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;resize:vertical"></textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button data-action="close-overlay" style="padding:7px 18px;border-radius:8px;border:1px solid var(--border);background:#fff;font-size:13px;cursor:pointer">取消</button>
      <button data-action="save-new-character" style="padding:7px 18px;border-radius:8px;border:none;background:var(--primary);color:#fff;font-size:13px;cursor:pointer">创建</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
}

function saveNewCharacter() {
  const name = (document.getElementById('ncName').value || '').trim();
  if (!name) { alert('请输入角色名字'); return; }
  const id = 'custom_' + Date.now();
  const custom = {
    id: id,
    name: name,
    fullName: name,
    nationality: '',
    city: (document.getElementById('ncFlags').value || ''),
    age: 0,
    occupation: (document.getElementById('ncOcc').value || ''),
    personality: [],
    interests: [],
    family: '',
    mannerisms: (document.getElementById('ncPersona').value || '').trim(),
    pet: '',
    backstorySeed: (document.getElementById('ncPersona').value || '').trim(),
    avatar: (document.getElementById('ncEmoji').value || '🤖')
  };
  const existing = getSetting('characters', []) || [];
  existing.push(custom);
  setSetting('characters', existing);
  apiSave('characters', existing);
  document.querySelector('.modal-overlay')?.remove();
  toastMsg('✅ 已创建角色：' + name);
  openSettings();
}

/* ---------- 策略师指令 ---------- */
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
  openSettings();   // 重新打开设置刷新历史列表
}
function deleteStrategistInstruction(idx) {
  const list = getStrategistInstructions();
  if (idx >= 0 && idx < list.length) {
    list.splice(idx, 1);
    saveStrategistInstructions(list);
    openSettings();
  }
}

/* ---------- Retry Analysis ---------- */
function retryAnalysis(userMsgId) {
  const node = findNode(userMsgId);
  if (!node) return;
  activeVariant(node).feedback = null;
  renderFeedbackForMsg(userMsgId);
  callAnalysis(activeVariant(node).content, userMsgId);
}

/* ---------- Slash Commands in Main Chat ---------- */
const SLASH_COMMANDS = [
  { name: '/new', description: '开始新对话' },
  { name: '/topic', description: '选择对话主题' },
  { name: '/translate', alias: '/t', description: '打开词典翻译并查询文本' },
  { name: '/ask', description: '向英语老师提问' },
  { name: '/feedback', description: '打开反馈面板' },
  { name: '/settings', description: '打开设置' },
  { name: '/compact', description: '收起反馈面板' },
  { name: '/help', description: '显示斜杠命令帮助' }
];

function hideSlashMenu() {
  const menu = document.getElementById('slashMenu');
  if (menu) menu.style.display = 'none';
}

function renderSlashMenu(query) {
  const menu = document.getElementById('slashMenu');
  if (!menu) return;
  const q = String(query || '').toLowerCase();
  const items = SLASH_COMMANDS.filter(c => c.name.includes(q) || c.description.includes(q));
  if (!items.length) { hideSlashMenu(); return; }
  menu.innerHTML = items.map((c, i) => `<button class="slash-item" data-command="${esc(c.name)}" data-action="choose-slash-command" data-arg1="${esc(c.name)}"><strong>${esc(c.name)}</strong>${c.alias ? `<small>${esc(c.alias)}</small>` : ''}<span>${esc(c.description)}</span></button>`).join('');
  menu.style.display = 'block';
}

function chooseSlashCommand(command) {
  const input = document.getElementById('userInput');
  if (!input) return;
  input.value = command + ' ';
  input.focus();
  hideSlashMenu();
}

function handleSlashCommand(text) {
  hideSlashMenu();
  // /t or /translate <text> → switch to dict tab and translate
  const tMatch = text.match(/^\/(?:t|translate)\s+(.+)/s);
  if (tMatch) {
    switchRightTab('dict');
    const input = document.getElementById('dictInput');
    input.value = tMatch[1];
    setTimeout(queryDict, 300);
    return true;
  }
  // /ask <question> → switch to dict tab and ask
  const aMatch = text.match(/^\/ask\s+(.+)/s);
  if (aMatch) {
    switchRightTab('dict');
    const input = document.getElementById('dictInput');
    input.value = '/ask ' + aMatch[1];
    setTimeout(queryDict, 300);
    return true;
  }
  if (text === '/new') { promptNewConversation(); return true; }
  if (text === '/topic') { promptNewConversation(); return true; }
  if (text === '/feedback') { setFeedbackPanelMode('expanded'); return true; }
  if (text === '/compact') { setFeedbackPanelMode('collapsed'); return true; }
  if (text === '/settings') { openSettings(); return true; }
  if (text === '/help') {
    const input = document.getElementById('userInput');
    input.value = SLASH_COMMANDS.map(c => c.name + ' — ' + c.description).join('\n');
    return true;
  }
  return false;
}
