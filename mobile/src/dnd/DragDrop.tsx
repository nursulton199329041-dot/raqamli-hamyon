import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useMotionOff } from '@/design/look';
import { elevation, haptic, motion } from '@/design/tokens';

/**
 * Smart drag & drop. A drop NEVER moves money: it only reports (payload, zone) so the caller can open a
 * pre-filled confirmation form. Same gesture code on iOS, Android and Web (gesture-handler + reanimated).
 *
 * Coordinates — one space, the one `measureInWindow` returns ("window space"):
 *  - finger = windowOrigin(draggable) + touch-down point inside it + pan translation. Translation is computed by
 *    gesture-handler from root-view touch coordinates, so it is not affected by the page scrolling under the finger.
 *  - zone rectangles are measured ONCE, when the drag starts (the page is at rest then), together with the scroll offset
 *    at that moment. While the drag auto-scrolls the page, a zone's live position is pure arithmetic:
 *    `y_measured - (offsetNow - offsetAtMeasure)`, where offsetNow is the offset this engine commanded.
 *    They are NOT re-measured mid-scroll: on the new architecture `measureInWindow` derives the offset of a view inside a
 *    ScrollView from the ScrollView's shadow-tree state, which native updates asynchronously — during a programmatic
 *    scroll it lags, and rectangles re-measured then are off by that lag (the drop then lands on "nothing": drop:null).
 *
 * Threads: the floating card follows the finger on the UI thread (gesture worklet -> shared values -> animated style);
 * hit-testing, highlight state and the drop itself run on the JS thread.
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
  /** page (vertical) scroller offset the rect was measured at; undefined = the zone does not move with the page */
  scrollAt?: number;
  /** id of the horizontal row the zone lives in (see `DragRow`), and that row's offset at measurement */
  row?: string;
  rowAt?: number;
}

/**
 * A scrolling container the drag may auto-scroll when the finger nears its edge. The page is vertical (`axis` 'y',
 * one per screen); horizontal rows (`axis` 'x', `id` required) scroll sideways under a finger resting at their left/right end.
 */
export interface Scroller {
  ref: RefObject<View | null>;
  getOffset(): number;
  getMax(): number;
  scrollTo(offset: number): void;
  axis?: 'x' | 'y';
  id?: string;
}

/** Drop zones rendered inside a horizontal row read the row id from here, so their x position follows the row's scroll. */
export const DragRow = createContext<string | undefined>(undefined);

interface RowState { s: Scroller; rect?: Rect; pageAt?: number }

/** Where the finger grabbed the dragged tile (tile-local px) and the tile size; used to draw the ghost. */
export interface Grab { x: number; y: number; w: number }

/** Finger state shared with the gesture worklets (UI thread). */
interface Finger {
  x: SharedValue<number>;
  y: SharedValue<number>;
  originX: SharedValue<number>;
  originY: SharedValue<number>;
  grabX: SharedValue<number>;
  grabY: SharedValue<number>;
  /** key of the draggable that owns the current drag session ('' = none): one drag at a time, claimed on the UI thread */
  session: SharedValue<string>;
}

type Trace = (event: string, data?: Record<string, number | string | null>) => void;
let tracer: Trace | null = null;
/** Diagnostics hook: the touch-test screen subscribes to see raw/window coordinates and hit results on a real device. */
export function setDragTrace(fn: Trace | null) {
  tracer = fn;
}

const EDGE = 84;
/** band at the left/right end of a horizontal row in which a resting finger scrolls the row */
const EDGE_X = 48;
/** A finger that lands this close (px) to a zone still counts: tiles are separated by gaps a thumb easily hits. */
const NEAR = 14;
const MEASURE_TIMEOUT_MS = 120;
const RETURN_MS = 180;
const MAX_STEP = 16;
export const LONG_PRESS_MS = 350;
/** layout changes of a zone are re-measured only once programmatic scrolling has been quiet this long */
const SCROLL_SETTLE_MS = 160;

interface DragCtx {
  registerScroller(s: Scroller): () => void;
  dragging: DragPayload | null;
  hoverId: string | null;
  /** zone ids that would accept the current payload (to highlight valid targets) */
  validIds: ReadonlySet<string>;
  /** zone id hovered by a payload it rejects (invalid drop) */
  rejectedId: string | null;
  registerZone(id: string, zone: Zone): () => void;
  /** a registered zone changed size/position (onLayout) */
  zoneMoved(id: string): void;
  /** returns false when another drag is already running (only one session at a time) */
  begin(p: DragPayload, ghost: ReactNode, x: number, y: number, grab?: Grab): boolean;
  move(x: number, y: number): void;
  /** `home` = window position the finger had when it grabbed the tile; given, a rejected drop animates the ghost back there. */
  end(x: number, y: number, home?: { x: number; y: number }): void;
  cancel(): void;
  finger: Finger;
  /** last successful drop (zone id + counter) for success feedback on the target */
  lastDrop: { id: string; n: number } | null;
}

const Ctx = createContext<DragCtx | null>(null);

/** Distance from a point to a rectangle (0 when inside). */
function gap(r: Rect, x: number, y: number) {
  return Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));
}

const keyOf = (p: DragPayload) => `${p.kind}:${p.id}`;

export function DragProvider({ children }: { children: ReactNode }) {
  const zones = useRef(new Map<string, Zone>());
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [ghost, setGhost] = useState<ReactNode>(null);
  const [ghostWidth, setGhostWidth] = useState(160);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [rejectedId, setRejectedId] = useState<string | null>(null);
  const [validIds, setValidIds] = useState<ReadonlySet<string>>(new Set());
  const [lastDrop, setLastDrop] = useState<{ id: string; n: number } | null>(null);
  const reduced = useMotionOff();
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const grabX = useSharedValue(80);
  const grabY = useSharedValue(30);
  const session = useSharedValue('');
  const finger = useMemo<Finger>(
    () => ({ x: fx, y: fy, originX, originY, grabX, grabY, session }),
    [fx, fy, originX, originY, grabX, grabY, session],
  );
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const lift = useSharedValue(0);
  const payloadRef = useRef<DragPayload | null>(null);
  const scroller = useRef<Scroller | null>(null);
  const rows = useRef(new Map<string, RowState>());
  const scrollRect = useRef<Rect | undefined>(undefined);
  const pointer = useRef({ x: 0, y: 0 });
  const overlay = useRef<View>(null);
  const endToken = useRef(0);
  const measured = useRef<Promise<void>>(Promise.resolve());
  const lastAutoScroll = useRef(0);

  const registerScroller = useCallback((s: Scroller) => {
    if (s.axis === 'x' && s.id) {
      const id = s.id;
      rows.current.set(id, { s });
      return () => {
        if (rows.current.get(id)?.s === s) rows.current.delete(id);
      };
    }
    scroller.current = s;
    return () => {
      if (scroller.current === s) scroller.current = null;
    };
  }, []);

  /** Live window rectangle of a zone: measured rect shifted by how far the page was scrolled since the measurement. */
  const live = useCallback((z: Zone): Rect | undefined => {
    const r = z.rect;
    if (!r || r.w <= 0 || r.h <= 0) return undefined;
    const s = scroller.current;
    const row = z.row ? rows.current.get(z.row) : undefined;
    return {
      ...r,
      y: z.scrollAt === undefined || !s ? r.y : r.y - (s.getOffset() - z.scrollAt),
      x: z.rowAt === undefined || !row ? r.x : r.x - (row.s.getOffset() - z.rowAt),
    };
  }, []);

  /** The zone under the finger; otherwise the nearest zone that ACCEPTS the payload within NEAR px (thumb tolerance). */
  const zoneAt = useCallback((x: number, y: number, p?: DragPayload | null): [string, Zone] | null => {
    let best: [string, Zone] | null = null;
    let bestGap = Infinity;
    for (const [id, z] of zones.current) {
      const r = live(z);
      if (!r) continue;
      const d = gap(r, x, y);
      if (d === 0) return [id, z];
      if (d <= NEAR && d < bestGap && (!p || z.accepts(p))) {
        best = [id, z];
        bestGap = d;
      }
    }
    return best;
  }, [live]);

  /** Diagnostics: id and distance of the closest measured zone ("none" when nothing was measured). */
  const nearestInfo = useCallback((x: number, y: number) => {
    let id = 'none';
    let best = Infinity;
    zones.current.forEach((z, zid) => {
      const r = live(z);
      if (!r) return;
      const d = gap(r, x, y);
      if (d < best) {
        best = d;
        id = zid;
      }
    });
    return best === Infinity ? 'none' : `${id}@${Math.round(best)}px`;
  }, [live]);

  /** `measureInWindow` the given zones, remembering the scroll offset each measurement belongs to. */
  const measure = useCallback(
    (list: Zone[]) =>
      new Promise<void>((resolve) => {
        let pending = 0;
        let settled = false;
        const settle = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        for (const z of list) {
          const node = z.ref.current;
          if (!node) continue;
          const s = scroller.current;
          const at = s ? s.getOffset() : undefined;
          const rowAt = z.row ? rows.current.get(z.row)?.s.getOffset() : undefined;
          pending += 1;
          node.measureInWindow((mx, my, w, h) => {
            z.rect = { x: mx, y: my, w, h };
            z.scrollAt = at;
            z.rowAt = rowAt;
            pending -= 1;
            if (pending === 0) settle();
          });
        }
        if (pending === 0) settle();
        setTimeout(settle, MEASURE_TIMEOUT_MS);
      }),
    [],
  );

  const registerZone = useCallback((id: string, zone: Zone) => {
    zones.current.set(id, zone);
    // a zone that appears mid-drag (section expanded, list refreshed) is measured right away
    if (payloadRef.current) void measure([zone]);
    return () => {
      zones.current.delete(id);
    };
  }, [measure]);

  const zoneMoved = useCallback((id: string) => {
    if (!payloadRef.current) return; // measured fresh at the next drag start anyway
    const z = zones.current.get(id);
    if (!z) return;
    const again = () => {
      if (!payloadRef.current) return;
      if (Date.now() - lastAutoScroll.current < SCROLL_SETTLE_MS) setTimeout(again, SCROLL_SETTLE_MS);
      else void measure([z]);
    };
    again();
  }, [measure]);

  const finish = useCallback(() => {
    endToken.current += 1;
    payloadRef.current = null;
    finger.session.set('');
    setDragging(null);
    setGhost(null);
    setHoverId(null);
    setRejectedId(null);
    setValidIds(new Set());
    lift.set(0);
  }, [lift, finger]);

  const begin = useCallback((p: DragPayload, g: ReactNode, x: number, y: number, grab?: Grab) => {
    if (payloadRef.current) return false; // one drag at a time
    const f = finger;
    if (f.session.get() === '') f.session.set(keyOf(p)); // direct API use (no gesture worklet claimed it)
    endToken.current += 1;
    payloadRef.current = p;
    pointer.current = { x, y };
    tracer?.('begin', { x: Math.round(x), y: Math.round(y), zones: zones.current.size });
    // Old rects are dropped first so a stale rectangle from a previous drag can never be hit while the fresh measurement
    // is still in flight; `end` waits for this measurement.
    const valid = new Set<string>();
    zones.current.forEach((z, id) => {
      if (z.accepts(p)) valid.add(id);
      z.rect = undefined;
      z.scrollAt = undefined;
    });
    measured.current = measure([...zones.current.values()]);
    overlay.current?.measureInWindow((mx, my) => {
      ox.set(mx);
      oy.set(my);
    });
    scrollRect.current = undefined;
    scroller.current?.ref.current?.measureInWindow((mx, my, w, h) => {
      scrollRect.current = { x: mx, y: my, w, h };
    });
    // horizontal rows: visible window of each row (follows the page's vertical scroll like a zone)
    rows.current.forEach((r) => {
      r.rect = undefined;
      const pageAt = scroller.current?.getOffset();
      r.s.ref.current?.measureInWindow((mx, my, w, h) => {
        r.rect = { x: mx, y: my, w, h };
        r.pageAt = pageAt;
      });
    });
    if (grab) {
      f.grabX.set(grab.x);
      f.grabY.set(grab.y);
    }
    setGhostWidth(grab?.w ?? 160);
    setValidIds(valid);
    setGhost(g);
    setDragging(p);
    lift.set(reduced ? withTiming(1, { duration: 1 }) : withSpring(1, motion.lift));
    haptic.lift();
    return true;
  }, [lift, measure, ox, oy, reduced, finger]);

  const move = useCallback((x: number, y: number) => {
    const p = payloadRef.current;
    if (!p) return;
    pointer.current = { x, y };
    const found = zoneAt(x, y, p);
    tracer?.('move', { x: Math.round(x), y: Math.round(y), zone: found ? found[0] : null });
    if (!found) {
      setHoverId((h) => (h === null ? h : null));
      setRejectedId((h) => (h === null ? h : null));
      return;
    }
    const [id, z] = found;
    if (z.accepts(p)) {
      setHoverId((h) => {
        if (h !== id) haptic.tick();
        return id;
      });
      setRejectedId(null);
    } else {
      setHoverId(null);
      setRejectedId((h) => {
        if (h !== id) haptic.warning();
        return id;
      });
    }
  }, [zoneAt]);

  const end = useCallback((x: number, y: number, home?: { x: number; y: number }) => {
    const p = payloadRef.current;
    if (!p) return; // a second "end" for the same touch can never produce a second drop
    payloadRef.current = null;
    const token = (endToken.current += 1);
    void measured.current
      // zones that do not live in the scroller have no scroll arithmetic: re-measure those before deciding
      .then(() => (scroller.current ? undefined : measure([...zones.current.values()])))
      .then(() => {
        if (endToken.current !== token) return; // cancelled / replaced while measuring
        const found = zoneAt(x, y, p);
        const ok = !!found && found[1].accepts(p);
        const reason = ok ? 'drop' : found ? 'rejected' : zones.current.size === 0 ? 'no-zones' : 'no-zone-under-finger';
        tracer?.('end', {
          x: Math.round(x), y: Math.round(y), drop: ok && found ? found[0] : null, reason, zones: zones.current.size,
          nearest: nearestInfo(x, y), scroll: scroller.current ? Math.round(scroller.current.getOffset()) : null,
        });
        if (ok && found) {
          finish();
          haptic.success();
          setLastDrop((d) => ({ id: found[0], n: (d?.n ?? 0) + 1 }));
          found[1].onDrop(p);
          return;
        }
        if (home) {
          // rejected / missed: the card flies back to where it was picked up, then the drag state is cleared
          setHoverId(null);
          const f = finger;
          // the fly-back is cosmetic: the session is free at once, so the next long-press is never swallowed
          f.session.set('');
          const d = reduced ? 1 : RETURN_MS;
          f.x.set(withTiming(home.x, { duration: d }));
          f.y.set(withTiming(home.y, { duration: d }));
          haptic.warning();
          setTimeout(() => {
            if (endToken.current === token) finish();
          }, d + 20);
        } else {
          finish();
        }
      });
  }, [zoneAt, nearestInfo, finish, measure, reduced, finger]);

  // Auto-scroll while the finger rests near the top/bottom edge of the scroller. Zone positions follow by arithmetic
  // (see `live`), so the hover state is simply recomputed from the same finger position.
  useEffect(() => {
    if (!dragging) return;
    /** step towards an edge: 0 outside the band, up to MAX_STEP right at the edge */
    const step = (p: number, lo: number, hi: number, edge: number) =>
      p < lo + edge ? -MAX_STEP * Math.min(1, (lo + edge - p) / edge)
        : p > hi - edge ? MAX_STEP * Math.min(1, (p - (hi - edge)) / edge) : 0;
    const scrollBy = (s: Scroller, d: number) => {
      const cur = s.getOffset();
      const next = Math.max(0, Math.min(s.getMax(), cur + d));
      if (Math.abs(next - cur) < 0.5) return false;
      s.scrollTo(next);
      return true;
    };
    const id = setInterval(() => {
      const { x: px, y: py } = pointer.current;
      let moved = false;
      // page (vertical)
      const s = scroller.current;
      const r = scrollRect.current;
      if (s && r) {
        const dy = step(py, r.y, r.y + r.h, EDGE);
        if (dy !== 0) moved = scrollBy(s, dy) || moved;
      }
      // the horizontal row under the finger (its window moves with the page like a zone does)
      rows.current.forEach((row) => {
        const rr = row.rect;
        if (!rr || rr.w <= 0) return;
        const y = row.pageAt === undefined || !s ? rr.y : rr.y - (s.getOffset() - row.pageAt);
        if (py < y || py > y + rr.h) return;
        const dx = step(px, rr.x, rr.x + rr.w, EDGE_X);
        if (dx !== 0) moved = scrollBy(row.s, dx) || moved;
      });
      if (!moved) return;
      lastAutoScroll.current = Date.now();
      move(px, py);
    }, 16);
    return () => clearInterval(id);
  }, [dragging, move]);

  // Rotation / split screen / window resize: every measured rectangle is now wrong. Drop the drag (nothing is opened).
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', () => {
      zones.current.forEach((z) => {
        z.rect = undefined;
        z.scrollAt = undefined;
      });
      if (payloadRef.current) {
        tracer?.('cancel', { reason: 'dimensions' });
        finish();
      }
    });
    return () => sub.remove();
  }, [finish]);

  const ghostStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: finger.x.get() - ox.get() - finger.grabX.get() },
      { translateY: finger.y.get() - oy.get() - finger.grabY.get() },
      { scale: 1 + 0.05 * lift.get() },
    ],
    shadowOpacity: 0.32 * lift.get(),
  }));

  const value = useMemo<DragCtx>(
    () => ({
      dragging, hoverId, validIds, rejectedId, registerZone, zoneMoved, registerScroller, begin, move, end, cancel: finish,
      finger, lastDrop,
    }),
    [dragging, hoverId, validIds, rejectedId, registerZone, zoneMoved, registerScroller, begin, move, end, finish, finger, lastDrop],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Always mounted so its window origin can be measured before the first ghost frame; drawn above every screen. */}
      <View ref={overlay} collapsable={false} pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000 }]}>
        {dragging && (
          <Animated.View testID="drag-ghost" style={[{ position: 'absolute', left: 0, top: 0, width: ghostWidth }, elevation.float, ghostStyle]}>
            {ghost}
          </Animated.View>
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
 * Long-press (350 ms) then drag. `ghost` is the floating card that follows the finger.
 *
 * The gesture object is created once and reads the latest props through refs (re-creating it while active re-configures
 * the native handler, which is unreliable on Android). The worklets keep the floating card glued to the finger on the UI
 * thread; JS gets the same window-space position for hit-testing. A short tap is a plain `Pressable` press, the same
 * path every other button uses; it is suppressed right after a drag so releasing on the origin tile cannot also fire it.
 */
export function Draggable({ payload, ghost, children, onTap }: {
  payload: DragPayload; ghost: ReactNode; children: ReactNode; onTap?: () => void;
}) {
  const d = useDrag();
  const { begin, move, end, cancel, finger } = d;
  const isSource = d.dragging?.id === payload.id && d.dragging.kind === payload.kind;

  const host = useRef<View>(null);
  const latest = useRef({ payload, ghost, onTap });
  const size = useRef({ w: 160, h: 60 });
  const active = useRef(false);
  const drift = useRef({ x: 0, y: 0 });
  const justDragged = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const myKey = useSharedValue(keyOf(payload));

  useEffect(() => {
    latest.current = { payload, ghost, onTap };
    myKey.set(keyOf(payload));
  });

  const release = useCallback(() => {
    active.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { justDragged.current = false; }, 400);
  }, []);

  // JS-side handlers (React nodes and payloads never cross into the worklet runtime).
  const onBegin = useCallback((gx: number, gy: number, ax: number, ay: number) => {
    clearTimeout(timer.current);
    justDragged.current = true;
    drift.current = { x: 0, y: 0 };
    if (!begin(latest.current.payload, latest.current.ghost, ax, ay, { x: gx, y: gy, w: size.current.w })) {
      release();
      return;
    }
    active.current = true;
    // the measured window origin replaces the worklet's estimate (absolute minus local); same space as the zones
    host.current?.measureInWindow((x, y) => {
      finger.originX.set(x);
      finger.originY.set(y);
      tracer?.('origin', { dx: Math.round(ax - (x + gx)), dy: Math.round(ay - (y + gy)) });
    });
  }, [begin, finger, release]);
  const onMove = useCallback((x: number, y: number, ax: number, ay: number) => {
    if (!active.current) return;
    // raw touch coordinate minus the window-space finger, measured on EVERY move (not only at the start)
    drift.current = { x: Math.max(drift.current.x, Math.abs(ax - x)), y: Math.max(drift.current.y, Math.abs(ay - y)) };
    move(x, y);
  }, [move]);
  const onEnd = useCallback((x: number, y: number, ax: number, ay: number) => {
    if (!active.current) return;
    tracer?.('finger', { rawMinusWindowX: Math.round(ax - x), rawMinusWindowY: Math.round(ay - y), maxDriftX: Math.round(drift.current.x), maxDriftY: Math.round(drift.current.y) });
    release();
    const node = host.current;
    const g = { x: finger.grabX.get(), y: finger.grabY.get() };
    // a missed / rejected drop flies the card back to where it was picked up (measured fresh: the page may have scrolled)
    if (node) node.measureInWindow((hx, hy) => end(x, y, { x: hx + g.x, y: hy + g.y }));
    else end(x, y);
  }, [end, finger, release]);
  const onCancel = useCallback(() => {
    if (!active.current) return;
    tracer?.('cancel');
    release();
    cancel();
  }, [cancel, release]);

  useEffect(() => () => {
    clearTimeout(timer.current);
    if (active.current) cancel();
  }, [cancel]);

  /* eslint-disable react-hooks/refs -- the callbacks only touch refs when a gesture event fires, never while rendering */
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(LONG_PRESS_MS)
        .maxPointers(1)
        .onStart((e) => {
          // claim the single drag session on the UI thread: a second finger on another tile cannot start a parallel drag
          if (finger.session.get() !== '') return;
          finger.session.set(myKey.get());
          // touch-down point inside the tile (the finger may have crept a few px during the long press)
          const gx = e.x - e.translationX;
          const gy = e.y - e.translationY;
          finger.grabX.set(gx);
          finger.grabY.set(gy);
          finger.originX.set(e.absoluteX - e.x);
          finger.originY.set(e.absoluteY - e.y);
          finger.x.set(e.absoluteX);
          finger.y.set(e.absoluteY);
          scheduleOnRN(onBegin, gx, gy, e.absoluteX, e.absoluteY);
        })
        .onUpdate((e) => {
          if (finger.session.get() !== myKey.get()) return;
          const x = finger.originX.get() + finger.grabX.get() + e.translationX;
          const y = finger.originY.get() + finger.grabY.get() + e.translationY;
          finger.x.set(x);
          finger.y.set(y);
          scheduleOnRN(onMove, x, y, e.absoluteX, e.absoluteY);
        })
        .onEnd((e) => {
          if (finger.session.get() !== myKey.get()) return;
          const x = finger.originX.get() + finger.grabX.get() + e.translationX;
          const y = finger.originY.get() + finger.grabY.get() + e.translationY;
          scheduleOnRN(onEnd, x, y, e.absoluteX, e.absoluteY);
        })
        // Touch cancelled (parent took the touch, app backgrounded, ...): drop nothing, restore the tile.
        .onFinalize((_e, success) => {
          if (!success && finger.session.get() === myKey.get()) scheduleOnRN(onCancel);
        }),
    [onBegin, onMove, onEnd, onCancel, finger, myKey],
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
        style={{ opacity: isSource ? 0.3 : 1 }}
      >
        {onTap ? <Pressable accessible={false} onPress={press}>{children}</Pressable> : children}
      </View>
    </GestureDetector>
  );
}

/** Wraps content so it can receive drops. Highlights when a valid payload hovers; flags invalid hovers. */
export function DropZone({ id, accepts, onDrop, children }: {
  id: string; accepts(p: DragPayload): boolean; onDrop(p: DragPayload): void;
  /** `dropped` changes (a new number) every time a drop lands on this zone: drive a one-shot success animation with it */
  children: (s: { active: boolean; rejected: boolean; valid: boolean; dropped: number }) => ReactNode;
}) {
  const d = useDrag();
  const row = useContext(DragRow);
  const ref = useRef<View>(null);
  const latest = useRef({ accepts, onDrop });
  const { registerZone, zoneMoved } = d;

  useEffect(() => {
    latest.current = { accepts, onDrop };
  });

  useEffect(
    () => registerZone(id, { accepts: (p) => latest.current.accepts(p), onDrop: (p) => latest.current.onDrop(p), ref, row }),
    [id, registerZone, row],
  );

  return (
    <View ref={ref} testID={`drop:${id}`} collapsable={false} onLayout={() => zoneMoved(id)}>
      {children({
        active: d.hoverId === id, rejected: d.rejectedId === id, valid: d.validIds.has(id),
        dropped: d.lastDrop?.id === id ? d.lastDrop.n : 0,
      })}
    </View>
  );
}
