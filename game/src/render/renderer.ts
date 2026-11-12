import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GameState } from '../simulation/state';
import { Npc, WORLD } from '../content/world';

export type Renderer = {
  setMode(mode: GameState['mode']): void;
  resize(): void;
  render(state: GameState, dt: number): void;
  dispose(): void;
};

function material(color: string, roughness = 0.72, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

type CharacterRig = { root: THREE.Group; fallback: THREE.Group; mixer?: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; activeAction?: THREE.AnimationAction };
const CHARACTER_FILES: Record<string, string> = {
  player: 'protagonist.glb',
  eli: 'eli-turner.glb',
  mara: 'mara-quinn.glb'
};

function addFallbackCharacter(root: THREE.Group, color: string, isPlayer = false) {
  const fallback = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(isPlayer ? 0.4 : 0.44, 1.0, 6, 12), material(color, 0.68));
  body.position.y = 0.96; body.castShadow = true; fallback.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(isPlayer ? 0.33 : 0.36, 24, 18), material('#bb846f', 0.62));
  head.position.y = 1.85; head.castShadow = true; fallback.add(head);
  root.add(fallback);
  return fallback;
}

async function loadCharacter(rig: CharacterRig, file: string) {
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/characters/${file}`);
    const model = gltf.scene;
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y < 0.2) return;
    model.scale.setScalar(1.86 / size.y);
    const normalized = new THREE.Box3().setFromObject(model);
    const center = normalized.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= normalized.min.y;
    rig.root.add(model);
    rig.fallback.visible = false;
    if (gltf.animations.length) {
      rig.mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) rig.actions.set(clip.name.toLowerCase(), rig.mixer.clipAction(clip));
      const idle = [...rig.actions].find(([name]) => name.includes('idle'))?.[1] ?? [...rig.actions.values()][0];
      if (idle) { idle.reset().fadeIn(0.2).play(); rig.activeAction = idle; }
    }
  } catch {
    console.warn(`World-game character asset unavailable: ${file}`);
  }
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#263b43');
  scene.fog = new THREE.FogExp2('#657773', 0.012);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 240);
  const mapCamera = new THREE.OrthographicCamera(-24, 24, 15, -15, 0.1, 180);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));

  scene.add(new THREE.HemisphereLight('#c4d9e2', '#22353a', 1.65));
  const sun = new THREE.DirectionalLight('#ffcfaa', 2.6); sun.position.set(-24, 34, 18); sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536); sun.shadow.camera.left = -40; sun.shadow.camera.right = 40; sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40; scene.add(sun);
  const harborFill = new THREE.DirectionalLight('#8bb8c5', 0.75); harborFill.position.set(18, 12, -26); scene.add(harborFill);
  void new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/environment/bellweather-harbor-v2.glb`).then((gltf) => {
    gltf.scene.position.y = 0.025;
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = object.name !== 'Sculpted harbor water Mesh';
        object.receiveShadow = object.name !== 'Sculpted harbor water Mesh';
        if (object.name === 'Cube') object.visible = false;
      if (object.name === 'Sculpted harbor water Mesh' && object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const surface of materials) {
          if (surface instanceof THREE.MeshStandardMaterial) {
            surface.roughness = 0.32;
            surface.metalness = 0.08;
            if (surface.normalMap) surface.normalScale.setScalar(0.12);
          }
        }
      }
      }
    });
    scene.add(gltf.scene);
  }).catch((error) => console.warn('World-game harbor asset unavailable.', error));

  const player = new THREE.Group(); scene.add(player);
  const characters = new Map<string, CharacterRig>();
  const playerRig = { root: player, fallback: addFallbackCharacter(player, '#39464d', true), actions: new Map<string, THREE.AnimationAction>() } satisfies CharacterRig;
  characters.set('player', playerRig);
  void loadCharacter(playerRig, CHARACTER_FILES.player);
  const npcMeshes = new Map<string, THREE.Group>();
  const addNpc = (npc: Npc) => {
    const group = new THREE.Group(); group.position.set(npc.position.x, 0, npc.position.z);
    scene.add(group);
    const rig = { root: group, fallback: addFallbackCharacter(group, npc.accent), actions: new Map<string, THREE.AnimationAction>() } satisfies CharacterRig;
    characters.set(npc.id, rig);
    void loadCharacter(rig, CHARACTER_FILES[npc.id]);
    npcMeshes.set(npc.id, group);
  };
  WORLD.npcs.forEach(addNpc);

  let mode: GameState['mode'] = '3d';
  let lastPlayer: { x: number; z: number } = { x: WORLD.playerSpawn.x, z: WORLD.playerSpawn.z };
  const resize = () => { const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return; camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix(); renderer.setSize(rect.width, rect.height, false); };
  const render = (state: GameState, dt: number) => {
    player.position.set(state.player.x, 0, state.player.z);
    const moving = Math.hypot(state.player.x - lastPlayer.x, state.player.z - lastPlayer.z) > 0.002;
    lastPlayer = { ...state.player };
    for (const [id, rig] of characters) {
      if (rig.mixer) {
        rig.mixer.update(dt);
        const desired = moving && id === 'player'
          ? [...rig.actions].find(([name]) => name.includes('walk') || name.includes('run'))?.[1]
          : [...rig.actions].find(([name]) => name.includes('idle'))?.[1];
        if (desired && desired !== rig.activeAction) {
          const previous = rig.activeAction;
          desired.reset().play();
          if (previous?.isRunning()) previous.crossFadeTo(desired, 0.16, false);
          else desired.fadeIn(0.16);
          rig.activeAction = desired;
        }
      }
    }
    for (const [id, group] of npcMeshes) group.scale.setScalar(state.nearbyNpc === id ? 1.05 : 1);
    if (mode === '2d') {
      const halfHeight = 27;
      const halfWidth = halfHeight * camera.aspect;
      mapCamera.left = -halfWidth; mapCamera.right = halfWidth; mapCamera.top = halfHeight; mapCamera.bottom = -halfHeight;
      mapCamera.position.set(state.player.x, 36, state.player.z);
      mapCamera.lookAt(state.player.x, 0, state.player.z);
      mapCamera.updateProjectionMatrix();
      renderer.render(scene, mapCamera);
    } else {
      camera.position.lerp(new THREE.Vector3(state.player.x + 10, 5.6, state.player.z - 10), Math.min(1, dt * 4));
      camera.lookAt(state.player.x + 0.4, 2.0, state.player.z - 0.3);
      camera.fov = 50;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }
  };
  resize(); window.addEventListener('resize', resize);
  return { setMode(next) { mode = next; renderer.shadowMap.enabled = next === '3d'; renderer.setPixelRatio(Math.min(window.devicePixelRatio, next === '3d' ? 1.5 : 0.8)); resize(); }, resize, render, dispose() { window.removeEventListener('resize', resize); for (const rig of characters.values()) rig.mixer?.stopAllAction(); renderer.dispose(); scene.traverse((object) => { const mesh = object as THREE.Mesh; if (mesh.geometry) mesh.geometry.dispose(); if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose()); else if (mesh.material) mesh.material.dispose(); }); } };
}
