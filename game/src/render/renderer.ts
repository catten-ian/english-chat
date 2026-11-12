import type { GameState } from '../simulation/state';
import { createMapRenderer } from './map-renderer';

export type Renderer = {
  setMode(mode: GameState['mode']): void;
  resize(): void;
  render(state: GameState, dt: number): void;
  dispose(): void;
};

// A separate canvas is necessary: a canvas cannot change from a 2D context to WebGL.
// Three.js and all GLBs stay unloaded until the player requests 3D.
export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const map = createMapRenderer(canvas);
  let mode: GameState['mode'] = '2d';
  let three: Renderer | undefined;
  let threeCanvas: HTMLCanvasElement | undefined;
  let generation = 0;
  let disposed = false;
  canvas.dataset.renderer = 'canvas2d';

  function unloadThree() {
    three?.dispose();
    three = undefined;
    threeCanvas?.remove();
    threeCanvas = undefined;
    canvas.hidden = false;
  }

  async function loadThree(ticket: number) {
    try {
      const { createThreeRenderer } = await import('./three-renderer');
      if (disposed || ticket !== generation || mode !== '3d') return;
      const surface = document.createElement('canvas');
      surface.id = 'wg-canvas-3d';
      surface.setAttribute('aria-label', 'Bellweather 3D harbor');
      canvas.after(surface);
      threeCanvas = surface;
      three = createThreeRenderer(surface);
      canvas.hidden = true;
      canvas.dataset.renderer = 'webgl3d';
    } catch (error) {
      if (disposed || ticket !== generation) return;
      unloadThree();
      mode = '2d';
      canvas.dataset.renderer = 'canvas2d';
      canvas.dispatchEvent(new CustomEvent('world-game-renderer-fallback', {
        detail: { mode: '2d', reason: error instanceof Error ? error.message : '3D unavailable' }
      }));
      console.warn('3D unavailable; using the lightweight harbor map.', error);
    }
  }

  return {
    setMode(next) {
      if (disposed || (mode === next && (next === '2d' || three || canvas.dataset.renderer === 'loading3d'))) return;
      mode = next;
      const ticket = ++generation;
      if (next === '2d') {
        unloadThree();
        canvas.dataset.renderer = 'canvas2d';
        map.resize();
      } else {
        canvas.dataset.renderer = 'loading3d';
        void loadThree(ticket);
      }
    },
    resize() { map.resize(); three?.resize(); },
    render(state, dt) {
      if (disposed) return;
      if (mode === '3d' && three) three.render(state, dt);
      else map.render(state, dt);
    },
    dispose() {
      disposed = true;
      ++generation;
      unloadThree();
      map.dispose();
    }
  };
}
