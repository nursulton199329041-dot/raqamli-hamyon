import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, ScrollView, Text } from 'react-native';
import { DragProvider, Draggable, DropZone, LONG_PRESS_MS, useDrag, type DragPayload } from '@/dnd/DragDrop';
import { Dashboard } from '@/features/Dashboard';
import { OperationSheet } from '@/features/OperationSheet';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { FakeServer, category, source, wallet } from '../test-utils/fakeServer';
import { gestures, type PanEvent } from '../test-utils/gestureMock';
import { useLayout, useLayout as layoutOf, type Box } from '../test-utils/layout';
import { renderApp } from '../test-utils/ui';

jest.mock('react-native-gesture-handler', () => jest.requireActual('../test-utils/gestureMock'));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.setTimeout(30000);

const ANDROID_STATUS_BAR = { x: 0, y: 24 };

/** Window-space event for a finger that touched `box` at `grab` (tile-local) and has since moved by (tx, ty). */
const evAt = (box: Box, grab: { x: number; y: number }, tx: number, ty: number, off = ANDROID_STATUS_BAR): PanEvent => ({
  x: grab.x + tx, y: grab.y + ty, absoluteX: box.x + grab.x + tx + off.x, absoluteY: box.y + grab.y + ty + off.y, translationX: tx, translationY: ty,
});

// ---------------------------------------------------------------------------------------------------------------------
// Engine level: provider + draggables, no app.

type Api = ReturnType<typeof useDrag>;
const holder: { api?: Api } = {};
function Probe() {
  // eslint-disable-next-line react-hooks/immutability
  holder.api = useDrag();
  return null;
}

function Engine({ drops }: { drops: string[] }) {
  return (
    <DragProvider>
      <Probe />
      <Draggable payload={{ kind: 'wallet', id: 'a' }} ghost={<Text>ghost a</Text>}><Text>A</Text></Draggable>
      <Draggable payload={{ kind: 'wallet', id: 'b' }} ghost={<Text>ghost b</Text>}><Text>B</Text></Draggable>
      <DropZone id="cat:food" accepts={(p: DragPayload) => p.kind === 'wallet'} onDrop={(p) => drops.push(`${p.id}->food`)}>
        {() => <Text>food</Text>}
      </DropZone>
    </DragProvider>
  );
}

const ENGINE_BOXES: Record<string, Box> = {
  'drag:wallet:a': { x: 20, y: 100, w: 150, h: 60 },
  'drag:wallet:b': { x: 200, y: 100, w: 150, h: 60 },
  'drop:cat:food': { x: 20, y: 400, w: 110, h: 60 },
};

describe('gesture engine', () => {
  beforeEach(() => useSettings.setState({ lang: 'uz', reduceEffects: true }));

  it('is a 350 ms long-press pan limited to one pointer', async () => {
    useLayout(ENGINE_BOXES);
    await render(<Engine drops={[]} />);
    expect(LONG_PRESS_MS).toBe(350);
    expect(gestures.get('drag:wallet:a')?.longPressMs).toBe(350);
  });

  it('the floating card follows the finger in WINDOW space on the UI-thread values (not the shifted raw touch space)', async () => {
    useLayout(ENGINE_BOXES, ANDROID_STATUS_BAR);
    await render(<Engine drops={[]} />);
    const rec = gestures.get('drag:wallet:a')!;
    const box = ENGINE_BOXES['drag:wallet:a']!;
    await act(async () => { rec.onStart?.(evAt(box, { x: 10, y: 10 }, 0, 0)); });
    await act(async () => { rec.onUpdate?.(evAt(box, { x: 10, y: 10 }, 40, 250)); });
    const f = holder.api!.finger;
    expect([f.x.get(), f.y.get()]).toEqual([20 + 10 + 40, 100 + 10 + 250]); // window space, raw would be 24px lower
    expect(screen.getByTestId('drag-ghost')).toBeTruthy();
  });

  it('the grab point is the touch-DOWN point even if the finger crept during the long press', async () => {
    useLayout(ENGINE_BOXES);
    await render(<Engine drops={[]} />);
    const rec = gestures.get('drag:wallet:a')!;
    // activation event: finger is 6px right / 4px down of where it touched
    await act(async () => { rec.onStart?.({ x: 16, y: 14, absoluteX: 36, absoluteY: 114, translationX: 6, translationY: 4 }); });
    const f = holder.api!.finger;
    expect([f.grabX.get(), f.grabY.get()]).toEqual([10, 10]);
    await act(async () => { rec.onUpdate?.({ x: 16, y: 14, absoluteX: 36, absoluteY: 114, translationX: 6, translationY: 4 }); });
    expect([f.x.get(), f.y.get()]).toEqual([36, 114]); // no double counting of the creep
  });

  it('only one drag session at a time: a second tile pressed meanwhile neither moves the card nor drops', async () => {
    const drops: string[] = [];
    useLayout(ENGINE_BOXES);
    await render(<Engine drops={drops} />);
    const a = gestures.get('drag:wallet:a')!;
    const b = gestures.get('drag:wallet:b')!;
    const boxA = ENGINE_BOXES['drag:wallet:a']!;
    const boxB = ENGINE_BOXES['drag:wallet:b']!;
    await act(async () => { a.onStart?.(evAt(boxA, { x: 10, y: 10 }, 0, 0, { x: 0, y: 0 })); });
    await act(async () => { b.onStart?.(evAt(boxB, { x: 10, y: 10 }, 0, 0, { x: 0, y: 0 })); });
    await act(async () => { b.onUpdate?.(evAt(boxB, { x: 10, y: 10 }, -150, 300, { x: 0, y: 0 })); });
    await act(async () => { b.onEnd?.(evAt(boxB, { x: 10, y: 10 }, -150, 300, { x: 0, y: 0 }), true); });
    expect(drops).toEqual([]);
    expect(holder.api!.dragging).toEqual({ kind: 'wallet', id: 'a' });
    // the first drag still works
    await act(async () => { a.onUpdate?.(evAt(boxA, { x: 10, y: 10 }, 20, 310, { x: 0, y: 0 })); });
    await act(async () => { a.onEnd?.(evAt(boxA, { x: 10, y: 10 }, 20, 310, { x: 0, y: 0 }), true); });
    expect(drops).toEqual(['a->food']);
    expect(holder.api!.finger.session.get()).toBe('');
  });

  it('a screen size change mid-drag cancels it (stale geometry never drops); the next drag measures fresh and drops', async () => {
    const drops: string[] = [];
    useLayout(ENGINE_BOXES);
    await render(<Engine drops={drops} />);
    const a = gestures.get('drag:wallet:a')!;
    const box = ENGINE_BOXES['drag:wallet:a']!;
    const g = { x: 10, y: 10 };
    const zero = { x: 0, y: 0 };
    await act(async () => { a.onStart?.(evAt(box, g, 0, 0, zero)); });
    await act(async () => {
      Dimensions.set({ window: { width: 800, height: 400, scale: 2, fontScale: 1 }, screen: { width: 800, height: 400, scale: 2, fontScale: 1 } });
    });
    expect(holder.api!.dragging).toBeNull();
    await act(async () => { a.onEnd?.(evAt(box, g, 20, 310, zero), true); });
    expect(drops).toEqual([]);

    await act(async () => { a.onStart?.(evAt(box, g, 0, 0, zero)); });
    await act(async () => { a.onEnd?.(evAt(box, g, 20, 310, zero), true); });
    expect(drops).toEqual(['a->food']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Dashboard level: real tiles, forms and fake ledger.

const BOXES: Record<string, Box> = {
  'dash-wrap': { x: 0, y: 0, w: 400, h: 800 },
  'drag:wallet:w1': { x: 20, y: 300, w: 150, h: 50 },
  'drop:wallet:w1': { x: 20, y: 300, w: 150, h: 50 },
  'drag:wallet:w2': { x: 200, y: 300, w: 150, h: 50 },
  'drop:wallet:w2': { x: 200, y: 300, w: 150, h: 50 },
  'drop:cat:c1': { x: 20, y: 600, w: 110, h: 50 },
  'drag:source:s1': { x: 20, y: 150, w: 92, h: 70 },
};

let server: FakeServer;
let restore: () => void;

beforeEach(() => {
  useSettings.setState({ lang: 'uz', reduceEffects: true });
  useUi.setState({ op: null, lastOp: null, form: null, formId: null });
  server = new FakeServer();
  server.wallets = [wallet('w1', 'Bank kartasi', 1_000_000), wallet('w2', 'Naqd pul', 200_000, { type: 0, icon: 'cash' })];
  server.categories = [category('c1', 'Kommunal')];
  server.sources = [source('s1', 'Maosh')];
  restore = server.install();
});
afterEach(() => restore());

/**
 * Page whose content is scrolled by `scroll.real`; what `measureInWindow` REPORTS uses `scroll.reported`, which can be
 * made to lag behind (new architecture: the offset of a view inside a ScrollView comes from shadow-tree state that native
 * updates asynchronously).
 */
async function scrollablePage(contentY: Record<string, number>) {
  const scroll = { real: 0, reported: 0 };
  const spy = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(((o: { y: number }) => { scroll.real = o.y; }) as never);
  const boxes: Record<string, Box> = { ...BOXES };
  for (const [id, y] of Object.entries(contentY)) {
    const b = { ...BOXES[id]! };
    Object.defineProperty(b, 'y', { get: () => y - scroll.reported, enumerable: true });
    boxes[id] = b;
  }
  layoutOf(boxes, ANDROID_STATUS_BAR); // not a React hook: test helper that stubs measureInWindow
  await renderApp(<><Dashboard /><OperationSheet /></>);
  await screen.findByText('1 000 000 UZS');
  await fireEvent(screen.getByTestId('dash-wrap'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } });
  await fireEvent(screen.getByTestId('dash-scroll'), 'contentSizeChange', 400, 1600);
  const userScroll = async (y: number) => {
    scroll.real = y;
    scroll.reported = y;
    await fireEvent(screen.getByTestId('dash-scroll'), 'scroll', { nativeEvent: { contentOffset: { x: 0, y } } });
  };
  return { scroll, boxes, spy, userScroll };
}

describe('dashboard: scroll and coordinates', () => {
  it('after a fast user scroll the drag measures the page at rest and drops on the right category', async () => {
    const page = await scrollablePage({ 'drag:wallet:w1': 700, 'drop:wallet:w1': 700, 'drop:cat:c1': 1100 });
    try {
      for (const y of [80, 220, 390, 400]) await page.userScroll(y); // fling, then the touch stops it at 400
      const rec = gestures.get('drag:wallet:w1')!;
      const box = page.boxes['drag:wallet:w1']!; // now at window y 300
      const g = { x: 10, y: 10 };
      await act(async () => { rec.onStart?.(evAt(box, g, 0, 0)); });
      // category is at window y 1100 - 400 = 700..750 -> finger to (40, 720)
      await act(async () => { rec.onUpdate?.(evAt(box, g, 10, 410)); });
      await act(async () => { rec.onEnd?.(evAt(box, g, 10, 410), true); });
      expect(useUi.getState().op).toEqual({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
    } finally {
      page.spy.mockRestore();
    }
  });

  it('ROOT CAUSE regression: measurements that lag behind a programmatic scroll cannot misplace the drop zone', async () => {
    jest.useFakeTimers();
    const page = await scrollablePage({ 'drop:cat:c1': 900 });
    try {
      const rec = gestures.get('drag:wallet:w1')!;
      const box = page.boxes['drag:wallet:w1']!;
      const g = { x: 10, y: 10 };
      await act(async () => { rec.onStart?.(evAt(box, g, 0, 0)); }); // page at rest: real = reported = 0
      await act(async () => { rec.onUpdate?.(evAt(box, g, 45, 460)); }); // finger rests at window (75, 770), bottom edge
      for (let i = 0; i < 15; i += 1) {
        await act(async () => { jest.advanceTimersByTime(16); });
        page.scroll.reported = Math.max(0, page.scroll.real - 60); // native state lags 60px behind the real offset
      }
      expect(page.scroll.real).toBeGreaterThan(100);
      // real category: 900 - real (contains y 770); a rect measured now would be 60px too low and miss the finger
      await act(async () => { rec.onEnd?.(evAt(box, g, 45, 460), true); });
      await act(async () => { jest.advanceTimersByTime(200); });
      expect(useUi.getState().op).toEqual({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
    } finally {
      page.spy.mockRestore();
      jest.useRealTimers();
    }
  });

  it('a drop on the bottom row works when the page cannot scroll further (auto-scroll edge at max offset)', async () => {
    jest.useFakeTimers();
    const page = await scrollablePage({ 'drop:cat:c1': 1550 });
    try {
      await page.userScroll(800); // max offset (1600 - 800): bottom row visible at window 750..800
      const rec = gestures.get('drag:wallet:w1')!;
      const g = { x: 10, y: 10 };
      // w1 itself scrolled off; pretend it sits at the top of the page now
      const box = { x: 20, y: 40, w: 150, h: 50 };
      page.boxes['drag:wallet:w1'] = box;
      await act(async () => { rec.onStart?.(evAt(box, g, 0, 0)); });
      await act(async () => { rec.onUpdate?.(evAt(box, g, 30, 730)); }); // window (60, 780): inside the edge band
      for (let i = 0; i < 10; i += 1) await act(async () => { jest.advanceTimersByTime(16); });
      expect(page.scroll.real).toBe(800); // nothing left to scroll
      await act(async () => { rec.onEnd?.(evAt(box, g, 30, 730), true); });
      await act(async () => { jest.advanceTimersByTime(200); });
      expect(useUi.getState().op).toEqual({ kind: 'expense', walletId: 'w1', categoryId: 'c1' });
    } finally {
      page.spy.mockRestore();
      jest.useRealTimers();
    }
  });
});

describe('dashboard: one gesture = one form', () => {
  it('a drop while a form is already open does not replace or stack it', async () => {
    const L = useLayout(BOXES, ANDROID_STATUS_BAR);
    await renderApp(<><Dashboard /><OperationSheet /></>);
    await screen.findByText('1 000 000 UZS');
    await L.drag('drag:wallet:w1', { x: 10, y: 10 }, [{ tx: 200, ty: 20 }]); // transfer w1 -> w2
    const first = useUi.getState();
    await L.drag('drag:source:s1', { x: 5, y: 5 }, [{ tx: 215, ty: 175 }]); // would be income -> w2
    expect(useUi.getState().op).toEqual({ kind: 'transfer', walletId: 'w1', toWalletId: 'w2' });
    expect(useUi.getState().opNonce).toBe(first.opNonce);
    expect(server.pushes).toHaveLength(0);
  });

  it('openOp ignores a second open until the form is closed', () => {
    useUi.getState().openOp({ kind: 'expense', categoryId: 'c1' });
    useUi.getState().openOp({ kind: 'income', sourceId: 's1' });
    expect(useUi.getState().op).toEqual({ kind: 'expense', categoryId: 'c1' });
    useUi.getState().closeOp();
    useUi.getState().openOp({ kind: 'income', sourceId: 's1' });
    expect(useUi.getState().op).toEqual({ kind: 'income', sourceId: 's1' });
  });

  it('releasing a drag on its own tile does not also fire the tile tap', async () => {
    const L = useLayout(BOXES);
    await renderApp(<><Dashboard /><OperationSheet /></>);
    await screen.findByText('1 000 000 UZS');
    await L.drag('drag:source:s1', { x: 5, y: 5 }, [{ tx: 4, ty: 4 }]); // dropped back home: nothing
    await fireEvent.press(screen.getByTestId('drag:source:s1').children[0] as never);
    expect(useUi.getState().op).toBeNull();
  });
});
