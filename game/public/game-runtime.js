const THREE = await import('https://esm.sh/three@0.180.0');
const { GLTFLoader } = await import('https://esm.sh/three@0.180.0/examples/jsm/loaders/GLTFLoader.js?deps=three@0.180.0');
const root = document.querySelector('#game-root');
root.innerHTML = `<div class="wg-shell"><canvas id="wg-canvas"></canvas><div class="wg-objective"><span>CHAPTER 01 · LOW TIDE</span><strong>The Missing Lantern</strong><small id="wg-nearby">Walk to a resident to begin a conversation</small></div><aside class="wg-panel"><div class="wg-brand">BELLWEATHER <span>THE QUIET TIDE</span></div><div id="wg-speaker" class="wg-panel-title">NO ONE NEARBY</div><div id="wg-transcript" class="wg-transcript">The harbor is quiet after the storm.</div><form id="wg-form" hidden><textarea id="wg-input" rows="3" maxlength="1200" placeholder="Ask what you need to know..."></textarea><button>Send ↗</button></form></aside><div class="wg-controls"><button data-mode="2d">2D</button><button class="active" data-mode="3d">3D</button><button id="wg-clues">Clues <b>0</b></button></div><button class="wg-interact" id="wg-interact" hidden>Talk ↗</button><div class="wg-touch"><button data-move="up">▲</button><button data-move="left">◀</button><button data-move="down">▼</button><button data-move="right">▶</button></div></div>`;

const scene = new THREE.Scene(); scene.background = new THREE.Color('#153239'); scene.fog = new THREE.FogExp2('#6f8581', 0.018);
const canvas = document.querySelector('#wg-canvas'); const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12; renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
scene.add(new THREE.HemisphereLight('#cfe4e3', '#243d3f', 2.2)); const sun = new THREE.DirectionalLight('#ffd0a0', 3.5); sun.position.set(-18, 22, 12); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
const mat = (color, roughness = 0.72, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const box = (size, position, material) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); return mesh; };
const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 80), mat('#3f5653', 0.98)); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.35, -5); ground.receiveShadow = true; scene.add(ground);
box([48, 0.3, 7], [0, -0.15, 7], mat('#67584b', 0.86)); for (let i = -5; i <= 5; i++) box([3.2, 0.18, 5.5], [i * 3.3, 0.12, 7], mat('#67584b', 0.86));
const prototypeEnvironment = scene.children.filter((object) => object.isMesh || object.isLine);
void new GLTFLoader().loadAsync('/world-game/assets/environment/bellweather-harbor.glb').then((gltf) => { gltf.scene.position.y = 0.3; gltf.scene.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } }); scene.add(gltf.scene); prototypeEnvironment.forEach((object) => { object.visible = false; }); }).catch((error) => console.warn('World-game environment asset unavailable; using prototype scene.', error));
box([18, 3.8, 10], [-13, 1.7, -11], mat('#56686a', 0.92)); box([5.5, 10, 5.5], [12, 4.8, -16], mat('#bec4bd', 0.58)); box([6.2, 0.6, 6.2], [12, 10.1, -16], mat('#252c2c', 0.45, 0.15));
const beacon = new THREE.PointLight('#ffd39b', 20, 34); beacon.position.set(12, 11.1, -16); scene.add(beacon); box([8, 2.6, 6], [7, 1.1, 0], mat('#815f49', 0.8));
const characterRigs = new Map();
function fallbackCharacter(group, color, playerCharacter = false) { const fallback = new THREE.Group(); const body = new THREE.Mesh(new THREE.CapsuleGeometry(playerCharacter ? 0.4 : 0.44, 1, 6, 12), mat(color, 0.68)); body.position.y = 0.96; body.castShadow = true; fallback.add(body); const head = new THREE.Mesh(new THREE.SphereGeometry(playerCharacter ? 0.33 : 0.36, 24, 18), mat('#bb846f', 0.62)); head.position.y = 1.85; head.castShadow = true; fallback.add(head); group.add(fallback); return fallback; }
async function loadCharacter(rig, filename) { try { const gltf = await new GLTFLoader().loadAsync(`/world-game/assets/characters/${filename}`); const model = gltf.scene; model.traverse((object) => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } }); const bounds = new THREE.Box3().setFromObject(model); const size = bounds.getSize(new THREE.Vector3()); if (!Number.isFinite(size.y) || size.y < 0.2) return; model.scale.setScalar(1.86 / size.y); const normalized = new THREE.Box3().setFromObject(model); const center = normalized.getCenter(new THREE.Vector3()); model.position.x -= center.x; model.position.z -= center.z; model.position.y -= normalized.min.y; rig.root.add(model); rig.fallback.visible = false; if (gltf.animations.length) { rig.mixer = new THREE.AnimationMixer(model); for (const clip of gltf.animations) rig.actions.set(clip.name.toLowerCase(), rig.mixer.clipAction(clip)); const idle = [...rig.actions].find(([name]) => name.includes('idle'))?.[1] || [...rig.actions.values()][0]; if (idle) { idle.reset().fadeIn(0.2).play(); rig.activeAction = idle; } } } catch (error) { console.warn(`World-game character asset unavailable: ${filename}`, error); } }
const player = new THREE.Group(); scene.add(player); const playerRig = { root: player, fallback: fallbackCharacter(player, '#39464d', true), actions: new Map() }; characterRigs.set('player', playerRig); void loadCharacter(playerRig, 'protagonist.glb');
const npcs = [{ id: 'eli', name: 'Eli Turner', x: 2, z: -11, color: '#e6b27a', file: 'eli-turner.glb' }, { id: 'mara', name: 'Mara Quinn', x: -4, z: -8, color: '#8eb6b2', file: 'mara-quinn.glb' }]; const npcMeshes = new Map();
for (const npc of npcs) { const group = new THREE.Group(); group.position.set(npc.x, 0, npc.z); scene.add(group); const rig = { root: group, fallback: fallbackCharacter(group, npc.color), actions: new Map() }; characterRigs.set(npc.id, rig); void loadCharacter(rig, npc.file); npcMeshes.set(npc.id, group); }

const state = { x: -6, z: 8, mode: '3d' }; const keys = new Set(); let syncElapsed = 0;
let lastPlayer = { x: state.x, z: state.z };
const token = localStorage.getItem('ai_en_token') || sessionStorage.getItem('ai_en_token') || ''; let settings = {};
try { settings = JSON.parse(localStorage.getItem('ai_en_settings_backup') || '{}'); } catch { /* Use provider defaults. */ }
const provider = settings.llmProvider || 'aihub8'; const model = settings.llmTextModel || undefined;
const headers = () => ({ 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) });
addEventListener('keydown', (event) => { if (!['INPUT', 'TEXTAREA'].includes(event.target?.tagName)) keys.add(event.key.toLowerCase()); });
addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
document.querySelectorAll('[data-move]').forEach((button) => { const key = button.dataset.move; button.onpointerdown = () => keys.add(key); button.onpointerup = button.onpointerleave = () => keys.delete(key); });
document.querySelectorAll('[data-mode]').forEach((button) => button.onclick = () => { state.mode = button.dataset.mode; document.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('active', item.dataset.mode === state.mode)); });

async function talk() {
  const npc = npcs.find((item) => Math.hypot(state.x - item.x, state.z - item.z) <= 2.6); if (!npc) return;
  const form = document.querySelector('#wg-form'); form.hidden = false; document.querySelector('#wg-input').focus();
  form.onsubmit = async (event) => {
    event.preventDefault(); const text = document.querySelector('#wg-input').value.trim(); if (!text) return;
    document.querySelector('#wg-input').value = ''; const output = document.querySelector('#wg-transcript'); output.textContent = '…';
    try {
      const response = await fetch('/api/world-game/npc', { method: 'POST', headers: headers(), body: JSON.stringify({ stageId: 'low-tide', npcId: npc.id, text, provider, model }) });
      if (!response.ok || !response.body) { output.textContent = response.status === 401 ? 'Sign in from the English app, then return here.' : 'The connection was interrupted.'; return; }
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let answer = '';
      while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() || ''; for (const event of events) for (const row of event.split(/\r?\n/)) if (row.startsWith('data:')) { const raw = row.slice(5).trim(); if (!raw || raw === '[DONE]') continue; try { const delta = JSON.parse(raw).choices?.[0]?.delta?.content; if (typeof delta === 'string') { answer += delta; output.textContent = answer; } } catch { /* Ignore non-text stream events. */ } } }
      if (!answer.trim()) output.textContent = 'The connection ended before the resident could answer.';
    } catch { output.textContent = 'The connection was interrupted.'; }
  };
}
document.querySelector('#wg-interact').addEventListener('click', talk);
addEventListener('keydown', (event) => { if (event.key.toLowerCase() === 'e' && !['INPUT', 'TEXTAREA'].includes(event.target?.tagName)) talk(); });

function resize() { const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return; camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix(); renderer.setSize(rect.width, rect.height, false); }
addEventListener('resize', resize); resize(); let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; let dx = 0; let dz = 0;
  if (keys.has('w') || keys.has('arrowup') || keys.has('up')) dz--; if (keys.has('s') || keys.has('arrowdown') || keys.has('down')) dz++;
  if (keys.has('a') || keys.has('arrowleft') || keys.has('left')) dx--; if (keys.has('d') || keys.has('arrowright') || keys.has('right')) dx++;
  const length = Math.hypot(dx, dz) || 1; state.x = Math.max(-28, Math.min(28, state.x + dx / length * 4.2 * dt)); state.z = Math.max(-25, Math.min(16, state.z + dz / length * 4.2 * dt));
  syncElapsed += dt;
  if (syncElapsed >= 0.5) { syncElapsed = 0; fetch('/api/world-game/move', { method: 'POST', headers: headers(), body: JSON.stringify({ stageId: 'low-tide', position: { x: state.x, z: state.z } }) }).catch(() => {}); }
  player.position.set(state.x, 0, state.z); const npc = npcs.find((item) => Math.hypot(state.x - item.x, state.z - item.z) <= 2.6); document.querySelector('#wg-interact').hidden = !npc;
  const moving = Math.hypot(state.x - lastPlayer.x, state.z - lastPlayer.z) > 0.002; lastPlayer = { x: state.x, z: state.z };
  for (const [id, rig] of characterRigs) if (rig.mixer) { rig.mixer.update(dt); const desired = moving && id === 'player' ? [...rig.actions].find(([name]) => name.includes('walk') || name.includes('run'))?.[1] : [...rig.actions].find(([name]) => name.includes('idle'))?.[1]; if (desired && desired !== rig.activeAction) { const previous = rig.activeAction; desired.reset().play(); if (previous?.isRunning()) previous.crossFadeTo(desired, 0.16, false); else desired.fadeIn(0.16); rig.activeAction = desired; } }
  document.querySelector('#wg-nearby').textContent = npc ? `Within talking distance · ${npc.name}` : 'Walk to a resident to begin a conversation'; document.querySelector('#wg-speaker').textContent = npc ? npc.name.toUpperCase() : 'NO ONE NEARBY';
  for (const [id, group] of npcMeshes) group.scale.setScalar(npc?.id === id ? 1.05 : 1);
  if (state.mode === '2d') { camera.position.set(state.x, 26, state.z + 0.01); camera.lookAt(state.x, 0, state.z); camera.fov = 38; } else { camera.position.lerp(new THREE.Vector3(state.x + 9, 6.4, state.z + 12), Math.min(1, dt * 4)); camera.lookAt(state.x, 1.2, state.z - 5); camera.fov = 48; }
  camera.updateProjectionMatrix(); renderer.render(scene, camera); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
