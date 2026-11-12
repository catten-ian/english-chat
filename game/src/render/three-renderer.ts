import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { GameState } from '../simulation/state';
import { Npc, WORLD } from '../content/world';
import { floorHeightAt } from '../../../shared/world-game-navigation.cjs';

import type { Renderer } from './renderer';

// Dispose late-arriving assets as well as the visible scene when 3D is unloaded.
function releaseObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      for (const surface of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(surface);
        for (const value of Object.values(surface)) if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const surface of materials) surface.dispose();
}

function material(color: string, roughness = 0.72, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

type CharacterRig = { root: THREE.Group; fallback: THREE.Group; mixer?: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; activeAction?: THREE.AnimationAction };
const CHARACTER_FILES: Record<string, string> = {
  player: 'protagonist.glb',
  eli: 'eli-turner.glb',
  mara: 'mara-quinn.glb',
  jonah: 'jonah-reed.glb'
};
// The build exposes only completed, shipped files. Pending Tripo jobs are never
// requested by the browser, including NPCs not yet present in this chapter.
const availableCharacters = new Set<string>(import.meta.env.WORLD_GAME_CHARACTER_FILES || []);

function addFallbackCharacter(root: THREE.Group, color: string, isPlayer = false) {
  const fallback = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(isPlayer ? 0.4 : 0.44, 1.0, 6, 12), material(color, 0.68));
  body.position.y = 0.96; body.castShadow = true; fallback.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(isPlayer ? 0.33 : 0.36, 24, 18), material('#bb846f', 0.62));
  head.position.y = 1.85; head.castShadow = true; fallback.add(head);
  root.add(fallback);
  return fallback;
}

async function loadCharacter(rig: CharacterRig, file: string, isDisposed: () => boolean) {
  if (!availableCharacters.has(file)) return;
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/characters/${file}`);
    const model = gltf.scene;
    if (isDisposed()) { releaseObject(model); return; }
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
    });
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y < 0.2) { releaseObject(model); return; }
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
    if (!isDisposed()) console.warn(`World-game character asset unavailable: ${file}`);
  }
}

export function createThreeRenderer(canvas: HTMLCanvasElement): Renderer {
  let disposed = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#65758c');
  scene.fog = new THREE.FogExp2('#78899b', 0.012);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 240);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));

  scene.add(new THREE.HemisphereLight('#aabbd5', '#242e38', 0.55));
  const sun = new THREE.DirectionalLight('#ffc6a0', 1.15);
  sun.position.set(-26, 17, 24); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 100 });
  sun.shadow.normalBias = .025; sun.shadow.bias = -.00015;
  sun.shadow.camera.updateProjectionMatrix(); scene.add(sun);scene.add(sun.target);
  const harborFill = new THREE.DirectionalLight('#9cb6df', 0.4);
  harborFill.position.set(8, 9, -24); scene.add(harborFill);
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  let environment: THREE.WebGLRenderTarget | undefined;
  let skyTexture: THREE.DataTexture | undefined;
  void new RGBELoader().loadAsync(`${import.meta.env.BASE_URL}assets/environment/bellweather-dusk.hdr`).then(texture => {
    if (disposed) { texture.dispose(); return; }
    texture.mapping = THREE.EquirectangularReflectionMapping;
    environment = environmentGenerator.fromEquirectangular(texture);
    scene.environment = environment.texture;
    scene.environmentIntensity = .65;
    skyTexture = texture;
    scene.background = texture;
    scene.backgroundBlurriness = .015;
    scene.backgroundIntensity = .45;
    scene.environmentRotation.y = scene.backgroundRotation.y = 2.8;
    environmentGenerator.dispose();
  }).catch(error => { environmentGenerator.dispose();if (!disposed) console.warn('Harbor environment unavailable.', error); });
  const waterMaterials: THREE.MeshStandardMaterial[] = [];
  // A single half-resolution planar pass gives the wet quay real window and
  // character reflections. Phones keep the PBR clearcoat without the extra pass.
  const wetDeck = new Reflector(new THREE.PlaneGeometry(30.1,5.68), {
    textureWidth: 512, textureHeight: 256, multisample: 0, clipBias: .003, color: 0x687b87
  });
  wetDeck.rotation.x=-Math.PI/2;wetDeck.position.set(4.14,.079,-7.76);
  const wetDeckMaterial=wetDeck.material as THREE.ShaderMaterial;
  wetDeckMaterial.transparent=true;wetDeckMaterial.depthWrite=false;
  wetDeckMaterial.fragmentShader=wetDeckMaterial.fragmentShader.replace('color ), 1.0','color ), 0.24');
  scene.add(wetDeck);
  void new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/environment/bellweather-harbor-v6.glb`).then((gltf) => {
    if (disposed) { releaseObject(gltf.scene); return; }
    gltf.scene.position.y = 0.025;
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const isWater = /Sculpted.harbor.water/i.test(object.name);
        object.castShadow = !isWater;
        object.receiveShadow = !isWater;
        if (object.name === 'Cube') object.visible = false;
      if (isWater) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const surface of materials) {
          if (surface instanceof THREE.MeshStandardMaterial) {
            surface.color.set('#12303b');
            surface.roughness = 0.12;
            surface.metalness = 0.14;
            surface.envMapIntensity = 1.1;
            if (surface.normalMap) surface.normalScale.setScalar(0.18);
            waterMaterials.push(surface);
          }
        }
      }
      }
    });
    scene.add(gltf.scene);
  }).catch((error) => { if (!disposed) console.warn('World-game harbor asset unavailable.', error); });
  // Practical lights illuminate faces and nearby timber, with no extra shadow maps.
  for (const [x,z] of [[7,-4],[10,4.2],[18,13]]) {
    const lamp = new THREE.PointLight('#ffb56b', 36, 10, 2);
    lamp.position.set(-x, 2.25, z); scene.add(lamp);
  }

  const player = new THREE.Group(); scene.add(player);
  const characters = new Map<string, CharacterRig>();
  const playerRig = { root: player, fallback: addFallbackCharacter(player, '#39464d', true), actions: new Map<string, THREE.AnimationAction>() } satisfies CharacterRig;
  characters.set('player', playerRig);
  void loadCharacter(playerRig, CHARACTER_FILES.player, () => disposed);
  const npcMeshes = new Map<string, THREE.Group>();
  const addNpc = (npc: Npc) => {
    const group = new THREE.Group(); group.position.set(-npc.position.x, floorHeightAt(npc.position.x,npc.position.z), npc.position.z);
    scene.add(group);
    const rig = { root: group, fallback: addFallbackCharacter(group, npc.accent), actions: new Map<string, THREE.AnimationAction>() } satisfies CharacterRig;
    characters.set(npc.id, rig);
    void loadCharacter(rig, CHARACTER_FILES[npc.id], () => disposed);
    npcMeshes.set(npc.id, group);
  };
  WORLD.npcs.forEach(addNpc);

  let lastPlayer: { x: number; z: number } = { x: WORLD.playerSpawn.x, z: WORLD.playerSpawn.z };
  let facing = Math.PI;
  let elapsed = 0;
  let cameraInitialized = false;
  const cameraPosition = new THREE.Vector3();
  const cameraLook = new THREE.Vector3();
  const smoothedLook = new THREE.Vector3();
  const resize = () => { const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return; camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix(); renderer.setSize(rect.width, rect.height, false);wetDeck.visible=rect.width>900&&window.matchMedia('(pointer: fine)').matches; };
  const render = (state: GameState, dt: number) => {
    // The harbor asset reflects logical X once. Keep simulation/save coordinates
    // unchanged and apply the same presentation transform to every runtime actor.
    player.position.set(-state.player.x, floorHeightAt(state.player.x,state.player.z), state.player.z);
    const dx = state.player.x - lastPlayer.x, dz = state.player.z - lastPlayer.z;
    const moving = Math.hypot(dx, dz) > 0.002;
    if (moving) facing = Math.atan2(-dx, dz);
    const turn = Math.atan2(Math.sin(facing-player.rotation.y),Math.cos(facing-player.rotation.y));
    player.rotation.y += turn * Math.min(1, dt * 12);
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
    for (const [id, group] of npcMeshes) {
      group.visible = state.activeNpcIds.includes(id as Npc['id']);
      if (state.nearbyNpc === id) group.rotation.y = Math.atan2(player.position.x-group.position.x,player.position.z-group.position.z);
    }
    const partnerId = state.activeNpc || state.nearbyNpc;
    const partner = partnerId && state.activeNpcIds.includes(partnerId) ? npcMeshes.get(partnerId) : undefined;
    const close = partner && Math.hypot(partner.position.x-player.position.x,partner.position.z-player.position.z)<4;
    if (close && !moving) facing = Math.atan2(partner.position.x-player.position.x,partner.position.z-player.position.z);
    const focusX = close ? (player.position.x+partner.position.x)/2 : player.position.x;
    const focusZ = close ? (state.player.z+partner.position.z)/2 : state.player.z;
    const narrow = camera.aspect < .85;
    cameraPosition.set(focusX - .6, close ? 1.8 : 3.0, focusZ - (close ? (narrow ? 5.2 : 3.8) : 6.7));
    cameraLook.set(focusX + (narrow ? .15 : .5), close ? 1.8 : 1.8, focusZ + 1.5);
    const smoothing = 1 - Math.exp(-dt * 4);
    if (!cameraInitialized) { camera.position.copy(cameraPosition); smoothedLook.copy(cameraLook); cameraInitialized=true; }
    else { camera.position.lerp(cameraPosition,smoothing);smoothedLook.lerp(cameraLook,smoothing); }
    camera.lookAt(smoothedLook);
    sun.target.position.set(player.position.x,0,player.position.z);
    sun.position.set(player.position.x+26,17,player.position.z+24);
    elapsed += dt;
    for (const surface of waterMaterials) if (surface.normalMap) surface.normalMap.offset.set(elapsed*.006,elapsed*.003);
    renderer.render(scene, camera);
  };
  resize(); window.addEventListener('resize', resize);
  return {
    setMode() {}, resize, render,
    dispose() {
      disposed = true;
      window.removeEventListener('resize', resize);
      for (const rig of characters.values()) rig.mixer?.stopAllAction();
      releaseObject(scene);
      wetDeck.dispose();
      environment?.dispose();
      skyTexture?.dispose();
      environmentGenerator.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    }
  };
}
