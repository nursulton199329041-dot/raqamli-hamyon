import type { ReactElement } from 'react';
import { ScrollView as RNScrollView } from 'react-native';

/**
 * react-native-gesture-handler stand-in for component tests. It records the callbacks given to `Gesture.Pan()` per
 * detector (keyed by the child's testID) so a test can replay a real finger sequence: onStart -> onUpdate* -> onEnd,
 * or onFinalize(false) for a cancelled touch.
 */
export interface PanEvent {
  x: number; y: number; absoluteX: number; absoluteY: number; translationX: number; translationY: number;
}
export interface Recorded {
  onStart?(e: PanEvent): void;
  onUpdate?(e: PanEvent): void;
  onEnd?(e: PanEvent, success: boolean): void;
  onFinalize?(e: PanEvent, success: boolean): void;
  longPressMs?: number;
}

export const gestures = new Map<string, Recorded>();

function chain(rec: Recorded): unknown {
  const proxy: unknown = new Proxy({}, {
    get(_t, key) {
      if (key === '__rec') return rec;
      if (key === 'activateAfterLongPress') return (ms: number) => { rec.longPressMs = ms; return proxy; };
      if (key === 'onStart' || key === 'onUpdate' || key === 'onEnd' || key === 'onFinalize') {
        return (fn: never) => { (rec as Record<string, unknown>)[key] = fn; return proxy; };
      }
      return () => proxy;
    },
  });
  return proxy;
}

export const Gesture = { Pan: () => chain({}), Tap: () => chain({}), Exclusive: (...g: unknown[]) => g[0] };

export function GestureDetector({ gesture, children }: { gesture: { __rec: Recorded }; children: ReactElement<{ testID?: string }> }) {
  const id = children.props.testID;
  if (id) gestures.set(id, gesture.__rec);
  return children;
}

export const GestureHandlerRootView = ({ children }: { children: unknown }) => children;

export const ScrollView = RNScrollView;
