import * as Haptics from 'expo-haptics';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/**
 * Smart drag & drop. A drop NEVER moves money: it only reports (payload, zone) so the caller can open a
 * pre-filled confirmation form. Same gesture code on iOS, Android and Web (gesture-handler + reanimated).
 *
 * Coordinates: every rectangle and every pointer position handled here lives in ONE space, the one returned by
 * `measureInWindow`. The finger position is derived as `windowOrigin(draggable) + grabPoint + translation`, never from
 * `absoluteX/Y` alone, because on Android the raw touch space and the window space may differ (status bar / insets).
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

/** A vertically scrolling container that the drag may auto-scroll when the finger nears its top/bottom edge. */
export interface Scroller {
  ref: RefObject<View | null>;
  getOffset(): number;
  getMax(): number;
  scrollTo(y: number): void;
}

/** Where the finger grabbed the dragged tile (tile-local px) and the tile size; used to draw the ghost. */
export interface Grab { x: number; y: number; w: number }

const EDGE = 84;
const MAX_STEP = 16;
const LONG_PRESS_MS = 350;

interface DragCtx {
  registerScroller(s: Scroller): () => void;
  dragging: DragPayload | null;
  hoverId: string | null;
  /** zone ids that would accept the current payload (to highlight valid targets) */
  validIds: ReadonlySet<string>;
  /** zone id hovered by a payload it rejects (invalid drop) */
  rejectedId: string | null;
  registerZone(id: string, zone: Zone): () => void;
  begin(p: DragPayload, ghost: ReactNode, x: number, y: number, grab?: Grab): void;
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
  const [ghostWidth, setGhostWidth] = useState(160);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [rejectedId, setRejectedId] = useState<string | null>(null);
  const [validIds, setValidIds] = useState<ReadonlySet<string>>(new Set());
  const gx = useSharedValue(0);
  const gy = useSharedValue(0);
  const grabX = useSharedValue(80);
  const grabY = useSharedValue(30);
  const lift = useSharedValue(0);
  const payloadRef = useRef<DragPayload | null>(null);
  const scroller = useRef<Scroller | null>(null);
  const scrollRect = useRef<Rect | undefined>(undefined);
  const pointer = useRef({ x: 0, y: 0 });
  const overlay = useRef<View>(null);
  const overlayOrigin = useRef({ x: 0, y: 0 });

  const registerScroller = useCallback((s: Scroller) => {
    scroller.current = s;
    return () => {
      if (scroller.current === s) scroller.current = null;
    };
  }, []);

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

  const place = useCallback((x: number, y: number) => {
    gx.set(x - overlayOrigin.current.x);
    gy.set(y - overlayOrigin.current.y);
  }, [gx, gy]);

  const begin = useCallback((p: DragPayload, g: ReactNode, x: number, y: number, grab?: Grab) => {
    payloadRef.current = p;
    // Measure every drop zone now (positions change with scrolling). Old rects are dropped first so a stale
    // rectangle from a previous drag can never be hit while the fresh measurement is still in flight.
    const valid = new Set<string>();
    zones.current.forEach((z, id) => {
      if (z.accepts(p)) valid.add(id);
      z.rect = undefined;
      z.ref.current?.measureInWindow((mx, my, w, h) => {
        z.rect = { x: mx, y: my, w, h };
      });
    });
    overlay.current?.measureInWindow((mx, my) => {
      overlayOrigin.current = { x: mx, y: my };
      place(pointer.current.x, pointer.current.y);
    });
    pointer.current = { x, y };
    scrollRect.current = undefined;
    scroller.current?.ref.current?.measureInWindow((mx, my, w, h) => {
      scrollRect.current = { x: mx, y: my, w, h };
    });
    grabX.set(grab?.x ?? 80);
    grabY.set(grab?.y ?? 30);
    setGhostWidth(grab?.w ?? 160);
    setValidIds(valid);
    setGhost(g);
    setDragging(p);
    place(x, y);
    lift.set(withSpring(1, { damping: 14, stiffness: 220 }));
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [grabX, grabY, lift, place]);

  const move = useCallback((x: number, y: number) => {
    const p = payloadRef.current;
    if (!p) return;
    pointer.current = { x, y };
    place(x, y);
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
  }, [zoneAt, place]);

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

  // Auto-scroll while the finger rests near the top/bottom edge of the scroller. Zone rects are window-relative,
  // so they are shifted by the scrolled distance and the hover state is recomputed from the same finger position.
  useEffect(() => {
    if (!dragging) return;
    const id = setInterval(() => {
      const s = scroller.current;
      const r = scrollRect.current;
      if (!s || !r) return;
      const py = pointer.current.y;
      let dy = 0;
      if (py < r.y + EDGE) dy = -MAX_STEP * Math.min(1, (r.y + EDGE - py) / EDGE);
      else if (py > r.y + r.h - EDGE) dy = MAX_STEP * Math.min(1, (py - (r.y + r.h - EDGE)) / EDGE);
      if (dy === 0) return;
      const cur = s.getOffset();
      const next = Math.max(0, Math.min(s.getMax(), cur + dy));
      const applied = next - cur;
      if (Math.abs(applied) < 0.5) return;
      s.scrollTo(next);
      zones.current.forEach((z) => {
        if (z.rect) z.rect = { ...z.rect, y: z.rect.y - applied };
      });
      move(pointer.current.x, pointer.current.y);
    }, 16);
    return () => clearInterval(id);
  }, [dragging, move]);

  const ghostStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: gx.get() - grabX.get() },
      { translateY: gy.get() - grabY.get() },
      { scale: 1 + 0.08 * lift.get() },
    ],
    opacity: 0.97,
  }));

  const value = useMemo<DragCtx>(
    () => ({ dragging, hoverId, validIds, rejectedId, registerZone, registerScroller, begin, move, end, cancel: finish }),
    [dragging, hoverId, validIds, rejectedId, registerZone, registerScroller, begin, move, end, finish],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Always mounted so its window origin can be measured before the first ghost frame. */}
      <View ref={overlay} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill}>
        {dragging && (
          <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: ghostWidth }, ghostStyle]}>{ghost}</Animated.View>
        )}
      </View>
    </Ctx.Provider>
  );
}

export function useDrag(): DragCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('DragProvider missing');
  return c;
}

/**
 * Long-press (350 ms) then drag. `ghost` is what follows the finger.
 *
 * The gesture object is created once and reads the latest props through refs: re-creating it on every render
 * (the old behaviour, because `ghost` is a fresh element each render) re-configures the native handler while it is
 * active, which is unreliable on Android. A short tap is a plain `Pressable` press, the same path every other
 * button in the app uses; it is suppressed after a drag so releasing on the origin tile cannot also fire it.
 */
export function Draggable({ payload, ghost, children, onTap }: {
  payload: DragPayload; ghost: ReactNode; children: ReactNode; onTap?: () => void;
}) {
  const d = useDrag();
  const { begin, move, end, cancel } = d;
  const isSource = d.dragging?.id === payload.id && d.dragging.kind === payload.kind;

  const host = useRef<View>(null);
  const latest = useRef({ payload, ghost, onTap });
  const size = useRef({ w: 160, h: 60 });
  const grab = useRef({ x: 0, y: 0 });
  const origin = useRef<{ x: number; y: number } | null>(null);
  const active = useRef(false);
  const justDragged = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    latest.current = { payload, ghost, onTap };
  });

  const toWindow = useCallback((tx: number, ty: number, ax: number, ay: number) => {
    const o = origin.current;
    return o ? { x: o.x + grab.current.x + tx, y: o.y + grab.current.y + ty } : { x: ax, y: ay };
  }, []);

  // JS-side handlers (React nodes and payloads never cross into the worklet runtime).
  const onBegin = useCallback((lx: number, ly: number, ax: number, ay: number) => {
    clearTimeout(timer.current);
    active.current = true;
    justDragged.current = true;
    grab.current = { x: lx, y: ly };
    origin.current = null;
    host.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
    });
    begin(latest.current.payload, latest.current.ghost, ax, ay, { x: lx, y: ly, w: size.current.w });
  }, [begin]);
  const onMove = useCallback((tx: number, ty: number, ax: number, ay: number) => {
    if (!active.current) return;
    const p = toWindow(tx, ty, ax, ay);
    move(p.x, p.y);
  }, [move, toWindow]);
  const settle = useCallback(() => {
    active.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { justDragged.current = false; }, 400);
  }, []);
  const onEnd = useCallback((tx: number, ty: number, ax: number, ay: number) => {
    if (!active.current) return;
    const p = toWindow(tx, ty, ax, ay);
    settle();
    end(p.x, p.y);
  }, [end, toWindow, settle]);
  const onCancel = useCallback(() => {
    if (!active.current) return;
    settle();
    cancel();
  }, [cancel, settle]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    if (active.current) cancel();
  }, [cancel]);

  /* eslint-disable react-hooks/refs -- the callbacks only touch refs when a gesture event fires, never while rendering */
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(LONG_PRESS_MS)
        .onStart((e) => {
          scheduleOnRN(onBegin, e.x, e.y, e.absoluteX, e.absoluteY);
        })
        .onUpdate((e) => {
          scheduleOnRN(onMove, e.translationX, e.translationY, e.absoluteX, e.absoluteY);
        })
        .onEnd((e) => {
          scheduleOnRN(onEnd, e.translationX, e.translationY, e.absoluteX, e.absoluteY);
        })
        // Touch cancelled (parent took the touch, app backgrounded, ...): drop nothing, restore the tile.
        .onFinalize((_e, success) => {
          if (!success) scheduleOnRN(onCancel);
        }),
    [onBegin, onMove, onEnd, onCancel],
  );
  /* eslint-enable react-hooks/refs */

  const press = useCallback(() => {
    if (justDragged.current) return;
    latest.current.onTap?.();
  }, []);

  return (
    <GestureDetector gesture={gesture}>
      <View
        ref={host}
        testID={`drag:${payload.kind}:${payload.id}`}
        collapsable={false}
        onLayout={(e) => { size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}
        style={{ opacity: isSource ? 0.35 : 1 }}
      >
        {onTap ? <Pressable accessible={false} onPress={press}>{children}</Pressable> : children}
      </View>
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
    <View ref={ref} testID={`drop:${id}`} collapsable={false}>
      {children({ active: d.hoverId === id, rejected: d.rejectedId === id, valid: d.validIds.has(id) })}
    </View>
  );
}
