import { act } from '@testing-library/react-native';
import { gestures, type PanEvent } from './gestureMock';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MockNativeMethods = (require('@react-native/jest-preset/jest/MockNativeMethods') as { default: { measureInWindow: jest.Mock } }).default;

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Makes `measureInWindow` report the given window rectangle for the host view with that testID (every other view
 * reports 0,0). `touchOffset` simulates Android, where the raw touch space (`absoluteX/Y`) is shifted against the
 * window space (status bar height) that `measureInWindow` uses.
 */
export function useLayout(boxes: Record<string, Box>, touchOffset = { x: 0, y: 0 }) {
  MockNativeMethods.measureInWindow.mockImplementation(function (this: { props?: { testID?: string } }, cb: (x: number, y: number, w: number, h: number) => void) {
    const b = this.props?.testID ? boxes[this.props.testID] : undefined;
    if (b) cb(b.x, b.y, b.w, b.h);
    else cb(0, 0, 0, 0);
  });
  return {
    boxes,
    /**
     * Replays one finger gesture on the draggable `id`. `grab` is the touch point inside the tile (tile-local),
     * `path` the finger translation(s) since activation. Returns nothing; assertions are on app state.
     */
    async drag(id: string, grab: { x: number; y: number }, path: { tx: number; ty: number }[], finish: 'drop' | 'cancel' = 'drop') {
      const rec = gestures.get(id);
      const box = boxes[id];
      if (!rec || !box) throw new Error(`no gesture/box for ${id}`);
      const ev = (tx: number, ty: number): PanEvent => ({
        x: grab.x + tx, y: grab.y + ty,
        absoluteX: box.x + grab.x + tx + touchOffset.x, absoluteY: box.y + grab.y + ty + touchOffset.y,
        translationX: tx, translationY: ty,
      });
      await act(async () => { rec.onStart?.(ev(0, 0)); });
      for (const s of path) await act(async () => { rec.onUpdate?.(ev(s.tx, s.ty)); });
      const last = path[path.length - 1] ?? { tx: 0, ty: 0 };
      if (finish === 'drop') {
        await act(async () => { rec.onEnd?.(ev(last.tx, last.ty), true); rec.onFinalize?.(ev(last.tx, last.ty), true); });
      } else {
        await act(async () => { rec.onFinalize?.(ev(last.tx, last.ty), false); });
      }
    },
  };
}
