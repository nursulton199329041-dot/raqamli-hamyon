import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/**
 * Smart drag & drop. A drop NEVER moves money: it only reports (payload, zone) so the caller can open a
 * pre-filled confirmation form. Same gesture code on iOS, Android and Web (gesture-handler + reanimated).
 */
export interface DragPayload {
  kind: 'wallet' | 'source';
  id: string;
}

interface Rect { x: number; y: number; w: number; h: number }

interface Zone {
  accepts(p: DragPayload): boolean;
  onDrop(p: DragPayload): void;
  ref: RefObject<View | null>;
  rect?: Rect;
}

interface DragCtx {
  dragging: DragPayload | null;
  hoverId: string | null;
  /** zone ids that would accept the current payload (to highlight valid targets) */
  validIds: ReadonlySet<string>;
  /** zone id hovered by a payload it rejects (invalid drop) */
  rejectedId: string | null;
  registerZone(id: string, zone: Zone): () => void;
  begin(p: DragPayload, ghost: ReactNode, x: number, y: number): void;
  move(x: number, y: number): void;
  end(x: number, y: number): void;
  cancel(): void;
}

const Ctx = createContext<DragCtx | null>(null);

function hit(rect: Rect | undefined, x: number, y: number) {
  return !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function DragProvider({ children }: { children: ReactNode }) {
  const zones = useRef(new Map<string, Zone>());
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [ghost, setGhost] = useState<ReactNode>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [rejectedId, setRejectedId] = useState<string | null>(null);
  const [validIds, setValidIds] = useState<ReadonlySet<string>>(new Set());
  const gx = useSharedValue(0);
  const gy = useSharedValue(0);
  const lift = useSharedValue(0);
  const payloadRef = useRef<DragPayload | null>(null);

  const zoneAt = useCallback((x: number, y: number): [string, Zone] | null => {
    for (const [id, z] of zones.current) if (hit(z.rect, x, y)) return [id, z];
    return null;
  }, []);

  const registerZone = useCallback((id: string, zone: Zone) => {
    zones.current.set(id, zone);
    return () => {
      zones.current.delete(id);
    };
  }, []);

  const begin = useCallback((p: DragPayload, g: ReactNode, x: number, y: number) => {
    payloadRef.current = p;
    // Measure every drop zone now (positions change with scrolling).
    const valid = new Set<string>();
    zones.current.forEach((z, id) => {
      if (z.accepts(p)) valid.add(id);
      z.ref.current?.measureInWindow((mx, my, w, h) => {
        z.rect = { x: mx, y: my, w, h };
      });
    });
    setValidIds(valid);
    setGhost(g);
    setDragging(p);
    gx.set(x);
    gy.set(y);
    lift.set(withSpring(1, { damping: 14, stiffness: 220 }));
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [gx, gy, lift]);

  const move = useCallback((x: number, y: number) => {
    const p = payloadRef.current;
    if (!p) return;
    const found = zoneAt(x, y);
    if (!found) {
      setHoverId((h) => (h === null ? h : null));
      setRejectedId((h) => (h === null ? h : null));
      return;
    }
    const [id, z] = found;
    if (z.accepts(p)) {
      setHoverId((h) => {
        if (h !== id && Platform.OS !== 'web') void Haptics.selectionAsync();
        return id;
      });
      setRejectedId(null);
    } else {
      setHoverId(null);
      setRejectedId((h) => {
        if (h !== id && Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return id;
      });
    }
  }, [zoneAt]);

  const finish = useCallback(() => {
    payloadRef.current = null;
    setDragging(null);
    setGhost(null);
    setHoverId(null);
    setRejectedId(null);
    setValidIds(new Set());
    lift.set(0);
  }, [lift]);

  const end = useCallback((x: number, y: number) => {
    const p = payloadRef.current;
    const found = p ? zoneAt(x, y) : null;
    finish();
    if (p && found && found[1].accepts(p)) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      found[1].onDrop(p);
    }
  }, [zoneAt, finish]);

  const ghostStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: gx.get() - 80 },
      { translateY: gy.get() - 44 },
      { scale: 1 + 0.08 * lift.get() },
    ],
    opacity: 0.97,
  }));

  const value = useMemo<DragCtx>(
    () => ({ dragging, hoverId, validIds, rejectedId, registerZone, begin, move, end, cancel: finish }),
    [dragging, hoverId, validIds, rejectedId, registerZone, begin, move, end, finish],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {dragging && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 160 }, ghostStyle]}>{ghost}</Animated.View>
        </View>
      )}
    </Ctx.Provider>
  );
}

export function useDrag(): DragCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('DragProvider missing');
  return c;
}

/** Long-press (≈350 ms) then drag. `ghost` is what follows the finger. */
export function Draggable({ payload, ghost, children, onTap }: {
  payload: DragPayload; ghost: ReactNode; children: ReactNode; onTap?: () => void;
}) {
  const d = useDrag();
  const { begin, move, end, cancel } = d;
  const isSource = d.dragging?.id === payload.id && d.dragging.kind === payload.kind;

  // JS-side callbacks: React nodes/payloads never cross into the worklet runtime.
  const start = useCallback((x: number, y: number) => begin(payload, ghost, x, y), [begin, payload, ghost]);
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(350)
        .onStart((e) => {
          scheduleOnRN(start, e.absoluteX, e.absoluteY);
        })
        .onUpdate((e) => {
          scheduleOnRN(move, e.absoluteX, e.absoluteY);
        })
        .onEnd((e) => {
          scheduleOnRN(end, e.absoluteX, e.absoluteY);
        })
        .onFinalize((_e, success) => {
          if (!success) scheduleOnRN(cancel);
        }),
    [start, move, end, cancel],
  );

  const tap = useMemo(() => Gesture.Tap().maxDuration(300).onEnd((_e, ok) => {
    if (ok && onTap) scheduleOnRN(onTap);
  }), [onTap]);

  return (
    <GestureDetector gesture={Gesture.Exclusive(gesture, tap)}>
      <Animated.View style={{ opacity: isSource ? 0.35 : 1 }}>{children}</Animated.View>
    </GestureDetector>
  );
}

/** Wraps content so it can receive drops. Highlights when a valid payload hovers; flags invalid hovers. */
export function DropZone({ id, accepts, onDrop, children }: {
  id: string; accepts(p: DragPayload): boolean; onDrop(p: DragPayload): void;
  children: (s: { active: boolean; rejected: boolean; valid: boolean }) => ReactNode;
}) {
  const d = useDrag();
  const ref = useRef<View>(null);
  const latest = useRef({ accepts, onDrop });
  const { registerZone } = d;

  useEffect(() => {
    latest.current = { accepts, onDrop };
  });

  useEffect(
    () => registerZone(id, { accepts: (p) => latest.current.accepts(p), onDrop: (p) => latest.current.onDrop(p), ref }),
    [id, registerZone],
  );

  return (
    <View ref={ref} collapsable={false}>
      {children({ active: d.hoverId === id, rejected: d.rejectedId === id, valid: d.validIds.has(id) })}
    </View>
  );
}
