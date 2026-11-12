import { WORLD } from '../content/world';
import type { GameState } from '../simulation/state';
import type { Renderer } from './renderer';

const TILE = 18;
const MAP = { left: -44, top: -38, width: 88, height: 88 };

// This is an illustrated simplification of the harbor geometry, not a screenshot.
// Static scenery is painted once; only camera/character changes redraw the display.
function paintHarbor() {
  const sheet = document.createElement('canvas');
  sheet.width = MAP.width * TILE;
  sheet.height = MAP.height * TILE;
  const ink = sheet.getContext('2d')!;
  ink.scale(TILE, TILE);
  ink.translate(-MAP.left, -MAP.top);
  const sea = ink.createLinearGradient(0, -38, 0, 45);
  sea.addColorStop(0, '#183e4d'); sea.addColorStop(.7, '#345d62'); sea.addColorStop(1, '#587472');
  ink.fillStyle = sea;
  ink.fillRect(MAP.left, MAP.top, MAP.width, MAP.height);
  ink.lineWidth = .045;
  for (let row = -36; row < 9; row += 1.7) {
    for (let col = -42; col < 44; col += 3.8) {
      const x = col + Math.sin(row * .7) * 1.3;
      ink.strokeStyle = (Math.floor(col + row) % 3 === 0) ? '#98bbb52d' : '#9eb8af16';
      ink.beginPath(); ink.moveTo(x, row); ink.bezierCurveTo(x + .5, row - .18, x + 1.2, row + .18, x + 1.9, row); ink.stroke();
    }
  }
  // Coastline and pale stone breakwater follow the 3D shore at z ≈ -5.
  const coast = new Path2D();
  coast.moveTo(44,-5);coast.lineTo(-3,-5);coast.lineTo(-3,14);
  coast.lineTo(2,14);coast.lineTo(2,50);coast.lineTo(44,50);coast.closePath();
  ink.lineWidth = 1.15; ink.strokeStyle = '#aac2ad35'; ink.stroke(coast);
  ink.fillStyle = '#717e6b'; ink.fill(coast);
  ink.lineWidth = .28; ink.strokeStyle = '#b5b49a'; ink.stroke(coast);
  const grass = ink.createLinearGradient(0, 0, 0, 45);
  grass.addColorStop(0, '#73816c'); grass.addColorStop(1, '#435f55');
  ink.fillStyle = grass; ink.fill(coast);
  for (let z = 0; z < 47; z += 1.4) for (let x = -42; x < 44; x += 2.1) {
    const drift = Math.sin(x * 1.7 + z) * .3;
    ink.fillStyle = Math.sin(x + z * 3) > 0 ? '#aab08c19' : '#263e3320';
    ink.fillRect(x + drift, z, .65, .08);
  }

  function path(points: number[][], width: number) {
    ink.beginPath(); points.forEach(([x, z], i) => i ? ink.lineTo(x, z) : ink.moveTo(x, z));
    ink.lineCap = 'round'; ink.lineJoin = 'round';
    ink.strokeStyle = '#4e6155'; ink.lineWidth = width + .6; ink.stroke();
    ink.strokeStyle = '#b2aa8d'; ink.lineWidth = width; ink.stroke();
    ink.strokeStyle = '#d4c7a044'; ink.lineWidth = .12; ink.stroke();
  }
  path([[-.5, 2], [-.5, 11], [8, 11], [18, 10], [29, 7]], 2.6);
  ink.fillStyle='#647568';ink.fillRect(-17,14,14,3);
  ink.beginPath();ink.ellipse(-17,19,6.8,7,0,0,Math.PI*2);ink.fill();
  path([[-.5, 10],[-.5,15],[-13,15],[-17,18]], 2.4);
  path([[6, 11], [6, 2]], 2.1);

  function pier(x: number, z: number, width: number, height: number, vertical = false) {
    ink.fillStyle = '#0e282b55'; ink.fillRect(x + .35, z + .45, width, height);
    ink.fillStyle = '#817565'; ink.fillRect(x, z, width, height);
    ink.strokeStyle = '#413f38'; ink.lineWidth = .07;
    if (vertical) {
      for (let p = z; p < z + height; p += .38) { ink.beginPath(); ink.moveTo(x, p); ink.lineTo(x + width, p); ink.stroke(); }
    } else {
      for (let p = x; p < x + width; p += .38) { ink.beginPath(); ink.moveTo(p, z); ink.lineTo(p, z + height); ink.stroke(); }
    }
    ink.strokeStyle = '#b2a18a'; ink.lineWidth = .14; ink.strokeRect(x, z, width, height);
    for (let p = x + .5; p < x + width; p += 2.5) {
      for (const edge of [z, z + height]) {
        ink.fillStyle = '#383d35'; ink.beginPath(); ink.arc(p, edge, .17, 0, Math.PI * 2); ink.fill();
        ink.fillStyle = '#d1b58d'; ink.beginPath(); ink.arc(p - .02, edge - .03, .1, 0, Math.PI * 2); ink.fill();
      }
    }
  }
  pier(-19.25, -10.65, 30.2, 5.8);
  pier(-3, -4.85, 4.95, 15.55, true);
  // Landing step for the keeper, beside the interaction location.
  pier(.5, -11.7, 3.3, 1.1);

  function house(x: number, z: number, width: number, height: number, roof: string, label?: string) {
    ink.fillStyle = '#172e334c'; ink.fillRect(x + .55, z + .65, width, height);
    ink.fillStyle = '#c0b99c'; ink.fillRect(x, z, width, height);
    ink.fillStyle = roof; ink.fillRect(x - .2, z - .22, width + .4, height + .44);
    ink.fillStyle = '#f3e3b214'; ink.fillRect(x - .2, z - .22, width / 2 + .2, height + .44);
    ink.strokeStyle = '#273c3c'; ink.lineWidth = .13; ink.strokeRect(x - .2, z - .22, width + .4, height + .44);
    ink.strokeStyle = '#c1c8b44c'; ink.lineWidth = .07;
    for (let p = z + .25; p < z + height; p += .65) {
      ink.beginPath(); ink.moveTo(x, p); ink.lineTo(x + width, p); ink.stroke();
    }
    ink.strokeStyle = '#c5c1a2'; ink.lineWidth = .12;
    ink.beginPath(); ink.moveTo(x + width / 2, z - .3); ink.lineTo(x + width / 2, z + height + .3); ink.stroke();
    ink.fillStyle = '#2f3c36'; ink.fillRect(x + width * .74, z + .5, .55, .75);
    ink.fillStyle = '#bcb49e'; ink.fillRect(x + width * .74 - .09, z + .38, .73, .24);
    ink.fillStyle = '#f4cd80';
    for (const edge of [x + .8, x + width - 1.5]) ink.fillRect(edge, z + height, .55, .18);
    if (label) {
      ink.font = '.62px Georgia, serif'; ink.textAlign = 'center'; ink.textBaseline = 'top';
      ink.fillStyle = '#172e31'; ink.fillText(label, x + width / 2, z + height + .7);
    }
  }
  house(4.4, -3.6, 5.2, 5.2, '#4b6266', 'TIDE OFFICE');
  house(6.1, 4, 7.8, 8, '#45545c', 'CHANDLERY');
  house(13.8, 13, 8.4, 8, '#5e615d');

  // Lighthouse and keeper cottage occupy the same harbor landmark as the GLB.
  ink.fillStyle = '#55685c'; ink.beginPath(); ink.ellipse(-17, 18, 4.6, 4, -.25, 0, Math.PI * 2); ink.fill();
  house(-15.4, 18, 4, 3, '#4e6164');
  ink.fillStyle = '#253e3955'; ink.beginPath(); ink.ellipse(-16.6, 17.7, 1.6, 1.7, 0, 0, Math.PI * 2); ink.fill();
  ink.fillStyle = '#d8d3b7'; ink.beginPath(); ink.arc(-17, 17, 1.4, 0, Math.PI * 2); ink.fill();
  ink.strokeStyle = '#62726b'; ink.lineWidth = .23; ink.stroke();
  ink.fillStyle = '#304c51'; ink.beginPath(); ink.arc(-17, 17, 1.03, 0, Math.PI * 2); ink.fill();
  const halo = ink.createRadialGradient(-17, 17, .15, -17, 17, 3.2);
  halo.addColorStop(0, '#ffe6a785'); halo.addColorStop(1, '#ffe6a700');
  ink.fillStyle = halo; ink.fillRect(-20.2, 13.8, 6.4, 6.4);
  ink.fillStyle = '#f8daa0'; ink.beginPath(); ink.arc(-17, 17, .45, 0, Math.PI * 2); ink.fill();
  ink.font = '.65px Georgia, serif'; ink.textAlign = 'center'; ink.fillStyle = '#203b3a'; ink.fillText('KEEPER’S LIGHT', -17, 23);

  function lamp(x: number, z: number) {
    const light = ink.createRadialGradient(x, z, .03, x, z, 1.7);
    light.addColorStop(0, '#ffdd9a55'); light.addColorStop(1, '#ffdd9a00');
    ink.fillStyle = light; ink.fillRect(x - 1.7, z - 1.7, 3.4, 3.4);
    ink.fillStyle = '#263c3b'; ink.fillRect(x - .11, z - .11, .22, .22);
    ink.fillStyle = '#f8d593'; ink.fillRect(x - .07, z - .07, .14, .14);
  }
  [[1.5, -3.6], [1.5, 3.5], [7.5, 8], [14, 8]].forEach(([x, z]) => lamp(x, z));

  // A moored skiff; warm timber details remain legible at phone resolution.
  ink.save(); ink.translate(-24, -3); ink.rotate(-.3);
  ink.fillStyle = '#101f2d66'; ink.beginPath(); ink.ellipse(.35, .35, 1.8, 3.2, 0, 0, Math.PI * 2); ink.fill();
  ink.beginPath(); ink.moveTo(0, -3.2); ink.bezierCurveTo(2, -1.5, 1.5, 1.8, .9, 2.8); ink.lineTo(-.9, 2.8); ink.bezierCurveTo(-1.5, 1.8, -2, -1.5, 0, -3.2);
  ink.fillStyle = '#344f56'; ink.fill(); ink.strokeStyle = '#b7aa8b'; ink.lineWidth = .18; ink.stroke();
  ink.fillStyle = '#a28c6c'; for (const z of [-1.3, .1, 1.6]) ink.fillRect(-1.1, z, 2.2, .22);
  ink.restore();
  ink.font = '.85px Georgia, serif'; ink.textAlign = 'center'; ink.fillStyle = '#d2d9c87d'; ink.fillText('B E L L W E A T H E R   B A Y', -10, -21);
  ink.font = '.6px Georgia, serif'; ink.fillStyle = '#d5ddc574'; ink.fillText('THE OLD QUAY', -6, -13);
  return sheet;
}

export function createMapRenderer(canvas: HTMLCanvasElement): Renderer {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas2D is not supported in this browser.');
  const ink = context;
  const scenery = paintHarbor();
  let width = 0, height = 0, pixelRatio = 1, revision = 0, lastKey = '';
  let facing = 0;
  let previous: { x: number; z: number } = { ...WORLD.playerSpawn };
  canvas.setAttribute('aria-label', 'Bellweather lightweight 2D harbor');
  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    width = bounds.width; height = bounds.height;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * pixelRatio); canvas.height = Math.round(height * pixelRatio);
    revision++;
  };
  resize();
  window.addEventListener('resize', resize);

  function render(state: GameState) {
    if (!width || !height) { resize(); return; }
    const key = `${state.currentStage}:${state.activeNpcIds.join(',')}:${state.player.x.toFixed(3)}:${state.player.z.toFixed(3)}:${state.nearbyNpc || ''}:${revision}`;
    if (key === lastKey) return;
    lastKey = key;
    const dx = state.player.x - previous.x, dz = state.player.z - previous.z;
    if (Math.hypot(dx, dz) > .002) facing = Math.atan2(dz, dx) + Math.PI / 2;
    previous = { ...state.player };
    const mobile = width <= 640;
    const availableWidth = mobile ? width - 30 : width * .72 - 36;
    const availableHeight = mobile ? height * .58 - 95 : height - 190;
    const zoom = Math.max(6, Math.min(17, availableWidth / 42, availableHeight / 27));
    const originX = mobile ? width / 2 : width * .37;
    const originY = mobile ? height * .36 : height * .53;
    const project = (x: number, z: number) => ({ x: originX + (x - state.player.x) * zoom, y: originY + (z - state.player.z) * zoom });
    ink.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ink.fillStyle = '#193f4b'; ink.fillRect(0, 0, width, height);
    const corner = project(MAP.left, MAP.top);
    ink.drawImage(scenery, corner.x, corner.y, MAP.width * zoom, MAP.height * zoom);
    // An unobtrusive vignette holds the illustrated world together with the HUD.
    const vignette = ink.createRadialGradient(originX, originY, width * .12, originX, originY, Math.max(width, height) * .8);
    vignette.addColorStop(0, '#091c2000'); vignette.addColorStop(1, '#091c2070');
    ink.fillStyle = vignette; ink.fillRect(0, 0, width, height);

    function person(x: number, y: number, coat: string, player = false) {
      ink.fillStyle = '#0a232955'; ink.beginPath(); ink.ellipse(x + 2, y + 8, 9, 4, 0, 0, Math.PI * 2); ink.fill();
      ink.fillStyle = '#182d33'; ink.fillRect(x - 4, y + 2, 3, 7); ink.fillRect(x + 1, y + 2, 3, 7);
      ink.fillStyle = coat; ink.beginPath(); ink.roundRect(x - 6, y - 5, 12, 12, [5, 5, 2, 2]); ink.fill();
      ink.fillStyle = '#d9ad88'; ink.beginPath(); ink.arc(x, y - 8, 4.3, 0, Math.PI * 2); ink.fill();
      ink.fillStyle = player ? '#332c2a' : '#796254'; ink.beginPath(); ink.ellipse(x, y - 10, 4.5, 2.8, -.2, 0, Math.PI * 2); ink.fill();
      ink.fillStyle = player ? '#d6d1b9' : '#d5b180'; ink.fillRect(x - 5, y - 3, 10, 2);
    }
    for (const npc of WORLD.npcs) {
      if (!state.activeNpcIds.includes(npc.id)) continue;
      const point = project(npc.position.x, npc.position.z);
      const nearby = state.nearbyNpc === npc.id;
      if (nearby) {
        ink.strokeStyle = '#f2d79b77'; ink.lineWidth = 1;
        ink.setLineDash([3, 5]); ink.beginPath(); ink.arc(point.x, point.y, npc.interactionRadius * zoom, 0, Math.PI * 2); ink.stroke(); ink.setLineDash([]);
      }
      person(point.x, point.y, npc.id === 'eli' ? '#b7966b' : '#6d9c97');
      ink.font = '12px Georgia, serif'; ink.textAlign = 'center'; ink.textBaseline = 'middle';
      const label = npc.name;
      const labelWidth = ink.measureText(label).width + 18;
      ink.fillStyle = '#142e32e8'; ink.beginPath(); ink.roundRect(point.x - labelWidth / 2, point.y - 37, labelWidth, 21, 5); ink.fill();
      ink.strokeStyle = nearby ? '#d9c191' : '#8baf9c77'; ink.lineWidth = .8; ink.stroke();
      ink.fillStyle = '#eee1c8'; ink.fillText(label, point.x, point.y - 26);
    }
    const p = project(state.player.x, state.player.z);
    ink.strokeStyle = '#e7efdc'; ink.lineWidth = 1.4; ink.beginPath(); ink.ellipse(p.x, p.y + 5, 10, 6, 0, 0, Math.PI * 2); ink.stroke();
    person(p.x, p.y, '#44565f', true);
    ink.save(); ink.translate(p.x, p.y); ink.rotate(facing);
    ink.fillStyle = '#f1dfb0'; ink.beginPath(); ink.moveTo(0, -22); ink.lineTo(-3, -17); ink.lineTo(3, -17); ink.closePath(); ink.fill(); ink.restore();
    ink.textAlign = 'left'; ink.textBaseline = 'alphabetic';
    ink.font = '10px system-ui, sans-serif'; ink.fillStyle = '#dae3d4a8';
    ink.fillText('2D · LIGHTWEIGHT HARBOR', mobile ? 15 : 25, mobile ? height * .61 : height - 87);
  }
  return {
    setMode() {}, resize, render,
    dispose() { window.removeEventListener('resize', resize); scenery.width = scenery.height = 0; }
  };
}
